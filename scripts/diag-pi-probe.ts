import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ModelRuntime} from '@earendil-works/pi-coding-agent';

// Deliberately do not import server/store or the session agent: those write runs.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=join(ROOT,'output/pi-probe');
const LIMIT=44_000;
let secret='';
function safeError(value:unknown){let text=String(value instanceof Error?value.message:value);if(secret)text=text.split(secret).join('[REDACTED]');return text.replace(/Bearer\s+[^\s"',}]+/gi,'Bearer [REDACTED]').replace(/sk-[\w-]{6,}/gi,'[REDACTED]').replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}]+)/gi,'$1[REDACTED]').slice(0,1800);}
function save(name:string,value:unknown){const text=JSON.stringify(value,null,2);if(secret&&text.includes(secret))throw new Error('Refusing to write secret-containing evidence');writeFileSync(join(OUTPUT,name),text,{mode:0o600});}
function shape(value:any,depth=0):any{if(depth>8)return {type:'nested'};if(value===null)return {type:'null'};if(Array.isArray(value))return {type:'array',length:value.length,items:value.slice(0,12).map(item=>shape(item,depth+1))};if(typeof value==='string')return {type:'string',characters:value.length};if(typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shape(item,depth+1)]));if(typeof value==='number'||typeof value==='boolean')return {type:typeof value,value};return {type:typeof value};}
function credentialsMemory(){const values=new Map<string,any>();return {read:async(provider:string)=>values.get(provider),list:async()=>[],modify:async(provider:string,fn:any)=>{const value=await fn(values.get(provider));if(value)values.set(provider,value);else values.delete(provider);return value;},delete:async(provider:string)=>{values.delete(provider);}};}
const probes=[
  {id:'A',title:'No tools: pong',tools:false,eager:undefined,cache:undefined,bearer:false},
  {id:'B',title:'Baseline: read-only list_tasks',tools:true,eager:undefined,cache:undefined,bearer:false},
  {id:'C',title:'B with eager input streaming disabled',tools:true,eager:false,cache:undefined,bearer:false},
  {id:'D',title:'B with cache retention none',tools:true,eager:undefined,cache:'none' as const,bearer:false},
  {id:'E',title:'B with provider authHeader true',tools:true,eager:undefined,cache:undefined,bearer:true},
] as const;

async function main(){
  mkdirSync(OUTPUT,{recursive:true,mode:0o700});
  let config:any;try{const raw=JSON.parse(readFileSync(join(ROOT,'.local/config.json'),'utf8'));config=raw.llm||raw;}catch{throw new Error('Private LLM config missing or invalid; no gateway call performed');}
  if(!config.apiKey||!config.baseUrl)throw new Error('Private LLM config incomplete; no gateway call performed');
  secret=String(config.apiKey);const endpoint=new URL(config.baseUrl);if(!['https:','http:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw new Error('Unsupported configured endpoint');
  const modelId=config.deepModel||'claude-opus-5-5',api=config.api||'anthropic-messages';
  if(modelId!=='claude-opus-5-5'||api!=='anthropic-messages')throw new Error('This authorized matrix expects claude-opus-5-5 over anthropic-messages; no call performed');
  for(const probe of probes)if(existsSync(join(OUTPUT,probe.id+'-started.json'))||existsSync(join(OUTPUT,probe.id+'.json')))throw new Error(`Probe ${probe.id} was already started; refusing automatic paid repeat`);
  const packageRoot=join(ROOT,'node_modules/@earendil-works/pi-coding-agent');
  const version=(path:string)=>JSON.parse(readFileSync(path,'utf8')).version;
  const environment={startedAt:new Date().toISOString(),node:process.version,versions:{piCodingAgent:version(join(packageRoot,'package.json')),piAI:version(join(packageRoot,'node_modules/@earendil-works/pi-ai/package.json')),anthropicSDK:version(join(packageRoot,'node_modules/@anthropic-ai/sdk/package.json'))},envVariableNames:Object.keys(process.env).filter(name=>/proxy|anthropic|^pi_/i.test(name)).sort(),modelId,api,maxCallsPerCase:1,hardDeadlineMs:LIMIT,storeImported:false,toolExecution:false};
  save('environment.json',environment);
  const results:any[]=[];const nativeFetch=globalThis.fetch;
  for(const probe of probes){
    const started=Date.now(),controller=new AbortController();const evidence:any={id:probe.id,title:probe.title,startedAt:new Date(started).toISOString(),deadlineMs:LIMIT,modelId,api,options:{toolCount:probe.tools?1:0,...(probe.eager===false?{supportsEagerToolInputStreaming:false}:{}),...(probe.cache?{cacheRetention:probe.cache}:{}),...(probe.bearer?{authHeader:true}:{})},requestCount:0,events:[]};
    save(probe.id+'-started.json',{id:probe.id,startedAt:evidence.startedAt,paidAttemptReserved:true});console.log(JSON.stringify({id:probe.id,status:'started',at:evidence.startedAt}));
    const timer=setTimeout(()=>{evidence.deadlineReached=true;controller.abort(new Error('Probe hard deadline reached'));},LIMIT);
    try{
      const runtime=await ModelRuntime.create({credentials:credentialsMemory(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false,signal:controller.signal});
      runtime.registerProvider('opstwin-api',{baseUrl:config.baseUrl,apiKey:secret,api, ...(probe.bearer?{authHeader:true}:{}),models:[{id:modelId,name:modelId,reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:7000,...(probe.eager===false?{compat:{supportsEagerToolInputStreaming:false}}:{})}]});
      const model=runtime.getModel('opstwin-api',modelId);if(!model)throw new Error('Registered model unavailable');
      const context:Parameters<ModelRuntime['streamSimple']>[1]={systemPrompt:'This is a read-only gateway compatibility diagnostic. Never disclose credentials or claim execution. Do not create, modify, send, or delete anything.',messages:[{role:'user',content:probe.tools?'请调用 list_tasks 一次读取实际任务。只发出这一个只读工具调用，不解释，不做修改，不发送消息。':'只回复 pong',timestamp:Date.now()}],...(probe.tools?{tools:[{name:'list_tasks',description:'读取独立数据库实际任务，不含已删除数据。',parameters:{type:'object',properties:{status:{type:'string'}},required:[],additionalProperties:false} as any}]}:{})};
      const observeFetch:typeof fetch=async(input,init)=>{
        evidence.requestCount++;if(evidence.requestCount>1)throw new Error('Probe blocked a second provider request');
        const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init?.headers).forEach((value,name)=>headers.set(name,value));
        evidence.requestHeaderNames=[...headers.keys()].sort();evidence.requestAt=new Date().toISOString();evidence.requestElapsedMs=Date.now()-started;
        const target=new URL(input instanceof Request?input.url:String(input));evidence.requestPath=target.pathname;evidence.method=init?.method||(input instanceof Request?input.method:'GET');
        try{const response=await nativeFetch(input,init);evidence.fetchHeadersAt=new Date().toISOString();evidence.fetchHeadersElapsedMs=Date.now()-started;evidence.httpStatus=response.status;evidence.responseHeaderNames=[...response.headers.keys()].sort();return response;}catch(e){evidence.fetchErrorAt=new Date().toISOString();evidence.fetchError=safeError(e);throw e;}
      };
      const stream=runtime.streamSimple(model,context,{signal:controller.signal,timeoutMs:LIMIT,maxRetries:0,maxTokens:256,fetch:observeFetch,...(probe.cache?{cacheRetention:probe.cache}:{}),onPayload:payload=>{evidence.payloadAt=new Date().toISOString();evidence.payloadShape=shape(payload);const body=payload as any;evidence.payloadFeatures={topLevelFields:Object.keys(body).sort(),toolNames:(body.tools||[]).map((tool:any)=>tool.name),toolEagerFlags:(body.tools||[]).map((tool:any)=>tool.eager_input_streaming??null),cacheControlOccurrences:(JSON.stringify(body).match(/"cache_control"/g)||[]).length};},onResponse:response=>{evidence.headersAt=new Date().toISOString();evidence.headersElapsedMs=Date.now()-started;evidence.httpStatus=response.status;evidence.responseHeaderNames=Object.keys(response.headers).sort();}});
      for await(const event of stream){if(evidence.firstEventAt===undefined){evidence.firstEventAt=new Date().toISOString();evidence.firstEventElapsedMs=Date.now()-started;}if(event.type==='text_delta'&&evidence.firstTextAt===undefined){evidence.firstTextAt=new Date().toISOString();evidence.firstTextElapsedMs=Date.now()-started;}if(evidence.events.length<120)evidence.events.push({type:event.type,at:new Date().toISOString(),elapsedMs:Date.now()-started});}
      const message=await stream.result();evidence.stopReason=message.stopReason;evidence.error=message.errorMessage?safeError(message.errorMessage):undefined;evidence.toolCallNames=message.content.filter(part=>part.type==='toolCall').map(part=>(part as any).name);evidence.outputCharacters=message.content.filter(part=>part.type==='text').reduce((n,part)=>n+(part as any).text.length,0);if(probe.id==='A')evidence.pong=message.content.filter(part=>part.type==='text').map(part=>(part as any).text).join('').trim().toLowerCase()==='pong';
      evidence.ok=!!evidence.firstEventAt&&!evidence.error&&!['error','aborted'].includes(message.stopReason)&&!evidence.deadlineReached;evidence.readOnlyToolRequested=probe.tools?evidence.toolCallNames.includes('list_tasks'):undefined;
    }catch(e){evidence.ok=false;evidence.error=safeError(e);}finally{clearTimeout(timer);controller.abort();evidence.completedAt=new Date().toISOString();evidence.elapsedMs=Date.now()-started;save(probe.id+'.json',evidence);results.push(evidence);save('manifest.json',{...environment,completedCases:results.map(({payloadShape,...result})=>result),complete:results.length===probes.length});console.log(JSON.stringify({id:probe.id,ok:evidence.ok,httpStatus:evidence.httpStatus,elapsedMs:evidence.elapsedMs,headersElapsedMs:evidence.headersElapsedMs,stopReason:evidence.stopReason,toolCallNames:evidence.toolCallNames,error:evidence.error}));}
  }
  const byId=Object.fromEntries(results.map(result=>[result.id,result]));let interpretation='No single compatible variable isolated; inspect timestamps, payload features and the production session timeline.';
  if(results.every(result=>!result.ok&&result.httpStatus===502))interpretation='All five single-call probes received real HTTP 502 before an SSE start. The error body reports Cloudflare origin_bad_gateway. No tested single field fixed the failure, including no-tools A. Provider onResponse does not fire for these SDK HTTP errors; fetchHeadersElapsedMs records the actual response-header receipt. E adds Authorization while retaining x-api-key, so it is not a Bearer-only request. Compare the successful CLI transport or gateway condition before adopting a compatibility flag; this matrix does not verify a production fix.';
  else if(results.every(result=>result.ok))interpretation='All five single-call PI probes completed. The failure is not reproduced by this minimal matrix; inspect the production session prompts, retry/phase timeline and context. No gateway field is proven incompatible.';
  else if(byId.A.ok&&!byId.B.ok){const successful=['C','D','E'].filter(id=>byId[id].ok);interpretation=successful.length?`A completed, B failed, ${successful.join(', ')} completed. These changes are compatibility candidates, not confirmed production fixes; use the observed field/header difference and verify one real Deep Think run.`:'A completed but all tool cases failed. Minimal tool schema changes correlate with the failure; no tested single field resolved it.';}
  else if(!byId.A.ok&&byId.E.ok)interpretation='Baseline authentication/transport did not complete while the Bearer case completed. Verify the observed request header names and one production run before attributing causality.';
  save('interpretation.json',{at:new Date().toISOString(),interpretation,paidCalls:results.reduce((n,result)=>n+result.requestCount,0),productionRunVerified:false});
  const table=['# Read-only PI gateway compatibility probes','',`Installed PI ${environment.versions.piCodingAgent}; Anthropic SDK ${environment.versions.anthropicSDK}. Exactly one authorized attempt per case, no tool execution/store import/message sending.`, '', '| Case | HTTP | Fetch / provider headers ms | Total ms | Stop reason | Tool call | Result |','|---|---|---|---|---|---|---|',...results.map(result=>`| ${result.id} | ${result.httpStatus??'none'} | ${result.fetchHeadersElapsedMs??'none'} / ${result.headersElapsedMs??'none'} | ${result.elapsedMs} | ${result.stopReason??'none'} | ${(result.toolCallNames||[]).join(', ')||'none'} | ${result.ok?'completed':'failed'} |`),'',interpretation,'','Case JSON stores only payload shape/header names/event types/timestamps/redacted errors. No prompt text, provider response text, keys or header values are retained. `*-started.json` prevents accidental paid reruns.'];writeFileSync(join(OUTPUT,'report.md'),table.join('\n')+'\n',{mode:0o600});
}
main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
