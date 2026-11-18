import {InMemoryCredentialStore} from '@earendil-works/pi-ai';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {MODEL_ID_PATTERN,PROVIDER_MODEL_LIMIT,type ModelDefinition,type ProviderModelTest,type ProviderModelTestRow} from '../../shared/model-settings';
import {ApiError} from './integrations';
import {modelProviderConnection,type ProviderConnection} from './model-settings';
import {applyClaudeCodeTransport} from './model-transport';
import {beginRun,db,get,hash,now,publicValue,put,updateRun} from './store';

const TIMEOUT=12000, MAX_CATALOG_BYTES=1024*1024, MAX_CATALOG_MODELS=1000, MAX_CATALOG_PAGES=6;
const syntheticMessage='Reply with OK.';

function providerError(status:number,kind:'catalog'|'test') {
 if(status===401||status===403)return 'provider_auth';
 if(status===402||status===429)return 'provider_quota';
 if(status===404||status===405||status===501)return kind==='catalog'?'provider_catalog_unsupported':'provider_model_unavailable';
 if(status>=500)return 'provider_unavailable';
 return kind==='catalog'?'provider_catalog_invalid':'provider_test_rejected';
}

function catalogFailure(code:string):never {
 throw new ApiError(502,code,'无法获取供应商模型目录。');
}

function modelCatalogURLs(provider:ProviderConnection) {
 const base=new URL(provider.baseUrl);
 const path=base.pathname.replace(/\/$/,'');
 const at=(pathname:string)=>{const url=new URL(base);url.pathname=pathname;return url};
 // DeepSeek documents its catalog on the same origin as its separate Anthropic base.
 if(provider.api==='anthropic-messages'&&base.origin==='https://api.deepseek.com'&&path==='/anthropic')return [at('/models')];
 if(provider.api==='anthropic-messages')return [at(path.endsWith('/v1')?path+'/models':path+'/v1/models')];
 return /\/v\d+[a-z]*$/i.test(path)?[at(path+'/models')]:[at(path+'/models'),at(path+'/v1/models')];
}

async function readCatalog(response:Response) {
 if(!response.body)catalogFailure('provider_catalog_invalid');
 const reader=response.body.getReader();
 const chunks:Uint8Array[]=[];
 let bytes=0;
 try{
  for(;;) {
   const item=await reader.read();
   if(item.done)break;
   bytes+=item.value.length;
   if(bytes>MAX_CATALOG_BYTES)catalogFailure('provider_catalog_too_large');
   chunks.push(item.value);
  }
 } finally {await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return catalogFailure('provider_catalog_invalid')}
}

function catalogDefinition(value:any):ModelDefinition {
 const cap=value.context_window;
 const contextWindow=Number.isSafeInteger(cap)&&cap>0&&cap<=10000000?cap:200000;
 const output=value.max_output_tokens;
 const maxTokens=Number.isSafeInteger(output)&&output>0?Math.min(output,contextWindow):Math.min(7000,contextWindow);
 return {id:value.id,smart:true,contextWindow,maxTokens,reasoning:Array.isArray(value.effort?.supported_levels)&&value.effort.supported_levels.length>0,
  vision:Array.isArray(value.input_modalities)&&value.input_modalities.includes('image')};
}

export async function discoverProviderModels(input:any,requestSignal?:AbortSignal) {
 const provider=modelProviderConnection(input.version,input.provider);
 const timeout=AbortSignal.timeout(TIMEOUT);
 const signal=requestSignal?AbortSignal.any([timeout,requestSignal]):timeout;
 const headers=new Headers({accept:'application/json'});
 const urls=modelCatalogURLs(provider);
 if(provider.api==='anthropic-messages'&&urls[0].pathname!=='/models'){
  headers.set('x-api-key',provider.apiKey);headers.set('anthropic-version','2023-06-01');
 }else headers.set('authorization',`Bearer ${provider.apiKey}`);
 if(provider.compatibility)headers.set('authorization',`Bearer ${provider.apiKey}`);

 const models=new Map<string,ModelDefinition>(),seen=new Set<string>();
 let url=urls[0],hasMore=false;
 try{
  for(let page=0;page<MAX_CATALOG_PAGES;page++){
   let response=await fetch(url,{headers,signal,redirect:'manual'});
   if(!page&&urls[1]&&[404,405].includes(response.status)){
    await response.body?.cancel().catch(()=>{});
    url=urls[1];
    response=await fetch(url,{headers,signal,redirect:'manual'});
   }
   if(!response.ok){await response.body?.cancel().catch(()=>{});catalogFailure(providerError(response.status,'catalog'));}
   const data=await readCatalog(response);
   if(!Array.isArray(data?.data))catalogFailure('provider_catalog_invalid');
   for(const row of data.data){
    if(typeof row?.id!=='string'||!MODEL_ID_PATTERN.test(row.id)||row.id.includes(provider.apiKey)||publicValue(row.id)!==row.id||models.has(row.id))continue;
    models.set(row.id,catalogDefinition(row));
    if(models.size>=MAX_CATALOG_MODELS)return {models:[...models.values()],truncated:true};
   }
   hasMore=data.has_more===true;
   if(!hasMore)break;
   if(typeof data.last_id!=='string'||!MODEL_ID_PATTERN.test(data.last_id)||seen.has(data.last_id)||data.last_id.includes(provider.apiKey))catalogFailure('provider_catalog_invalid');
   seen.add(data.last_id);url.searchParams.set('after_id',data.last_id);
  }
 }catch(e){
  if(e instanceof ApiError)throw e;
  catalogFailure(timeout.aborted?'llm_timeout':'provider_connection');
 }
 return {models:[...models.values()],truncated:hasMore};
}

type SavedBatch=ProviderModelTest & {fingerprint:string;runId:string};
const batchEntity='model_provider_probes';
let activeBatch:string|undefined;
export function providerModelTest(id:string):ProviderModelTest {
 const receipt=get<SavedBatch>(batchEntity,id);
 if(!receipt)throw new ApiError(404,'model_probe_not_found','未收到此测试请求。');
 const {providerId,version,results}=receipt;
 if(receipt.status==='running'&&activeBatch!==id)return {id,providerId,version,status:'unknown',
  results:results.map(row=>row.status==='succeeded'||row.status==='failed'?row:{...row,status:'unknown'})};
 return {id,providerId,version,status:receipt.status,results};
}

export function startProviderModelTest(input:any):ProviderModelTest {
 const {requestId:id,version,models}=input;
 if(typeof id!=='string'||!/^[\w-]{1,128}$/.test(id))throw new ApiError(400,'invalid_request_id','测试请求 ID 无效。');
 if(!Array.isArray(models)||models.length<1||models.length>PROVIDER_MODEL_LIMIT||
  models.some(m=>typeof m!=='string'||!MODEL_ID_PATTERN.test(m))||new Set(models).size!==models.length){
  throw new ApiError(400,'invalid_model','请输入有效且不重复的模型 ID。');
 }
 const fingerprint=hash({version,provider:input.provider,models});
 const old=get<SavedBatch>(batchEntity,id);
 if(old){
  if(old.fingerprint!==fingerprint)throw new ApiError(409,'model_probe_conflict','此请求 ID 已用于其他测试。');
  return providerModelTest(id);
 }
 if(activeBatch)throw new ApiError(409,'provider_probe_busy','已有一批模型正在测试。');
 const provider=modelProviderConnection(version,input.provider);
 if(models.some(m=>m.includes(provider.apiKey)||publicValue(m)!==m))throw new ApiError(400,'invalid_model','模型 ID 无效。');
 db.exec('BEGIN IMMEDIATE');
 let batch:SavedBatch;
 try{
  const run=beginRun('model_provider_probe','Provider model connection tests',{readOnly:true,availableTools:[]});
  batch={id,providerId:provider.id,version,runId:run.id,status:'running',fingerprint,
   results:models.map(model=>({model,status:'queued'}))};
  put(batchEntity,batch);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 activeBatch=id;
 void executeBatch(batch,provider).catch(()=>{/* If storage failed, pending rows become unconfirmed on readback. */});
 return providerModelTest(id);
}

async function executeBatch(batch:SavedBatch,provider:ProviderConnection) {
 try{
  const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false});
  const base=new URL(provider.baseUrl);
  runtime.registerProvider('opstwin-provider-probe',{baseUrl:provider.baseUrl,apiKey:provider.apiKey,api:provider.api,
   ...(base.hostname==='opencode.ai'?{headers:{'User-Agent':'opstwin-advance/0.1.0','x-opencode-session':batch.runId}}:{}),
   models:batch.results.map(({model:id})=>({id,name:id,input:['text'],reasoning:false,contextWindow:8192,maxTokens:128,
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0}})),
  });
  let next=0;
  const worker=async()=>{
   while(next<batch.results.length){
    const index=next++;
    const model=runtime.getModel('opstwin-provider-probe',batch.results[index].model);
    if(!model)throw new Error('model_missing');
    batch.results[index].status='running';put(batchEntity,batch);
    const started=Date.now(),signal=AbortSignal.timeout(TIMEOUT);
    let failureCode:string|undefined;
    let status=0;
    try{
     const result=await runtime.completeSimple(model,{messages:[{role:'user',content:syntheticMessage,timestamp:started}]},{
      apiKey:provider.apiKey,signal,maxTokens:128,maxRetries:0,timeoutMs:TIMEOUT,
      fetch:async(input,init)=>{
       const target=new URL(input instanceof Request?input.url:String(input));
       if(target.origin!==base.origin)throw new Error('provider_origin_mismatch');
       const headers=new Headers(input instanceof Request?input.headers:undefined);
       new Headers(init?.headers).forEach((value,key)=>headers.set(key,value));
       if(provider.compatibility&&target.pathname.endsWith('/v1/messages'))applyClaudeCodeTransport(target,headers,provider.apiKey);
       const response=await fetch(input instanceof Request?new Request(target,input):target,{...init,headers,signal,redirect:'manual'});
       status=response.status;
       return response;
      },
      ...(/(^|\/)deepseek-/i.test(model.id)&&provider.api!=='openai-responses'?{onPayload:(payload:unknown)=>({...payload as object,thinking:{type:'disabled'}})}:{}),
     });
     if(status>=300)failureCode=providerError(status,'test');
     else if(!status||result.stopReason==='error'||result.stopReason==='aborted')failureCode=signal.aborted?'llm_timeout':status?'provider_test_rejected':'provider_connection';
     else if(!result.content.some(part=>part.type==='text'&&part.text.trim()))failureCode='provider_empty_response';
    }catch{failureCode=signal.aborted?'llm_timeout':status>=300?providerError(status,'test'):'provider_connection';}
    batch.results[index]={model:model.id,status:failureCode?'failed':'succeeded',failureCode,elapsedMs:Date.now()-started} satisfies ProviderModelTestRow;
    put(batchEntity,batch);
   }
  };
  if((await Promise.allSettled(Array.from({length:Math.min(4,batch.results.length)},worker))).some(result=>result.status==='rejected'))throw new Error('batch_interrupted');
  batch.status='finished';put(batchEntity,batch);
  updateRun(batch.runId,{status:batch.results.every(row=>row.status==='succeeded')?'succeeded':'failed',completedAt:now()});
 }catch{
  batch.status='unknown';
  batch.results=batch.results.map(row=>row.status==='queued'||row.status==='running'?{...row,status:'unknown'}:row);
  put(batchEntity,batch);updateRun(batch.runId,{status:'failed',error:'provider_probe_interrupted',completedAt:now()});
 }finally{activeBatch=undefined;}
}
