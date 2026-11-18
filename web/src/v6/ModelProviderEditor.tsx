import {useEffect,useRef,useState} from 'react';
import {MODEL_ID_PATTERN,PROVIDER_MODEL_LIMIT,type ModelDefinition,type ModelSettings,type ProviderModelTest} from '../../../shared/model-settings';
import {StandardSelect} from '../desktop/full/StandardSelect';
import type {Ctx} from './App';
import {I} from './icons';
import {ApiError,api,durable,enc,setUI,uid} from './store';

type Provider=ModelSettings['providers'][number];
const protocolOptions=[
 ['openai-completions','OpenAI Chat Completions'],
 ['openai-responses','OpenAI Responses'],
 ['anthropic-messages','Anthropic Messages'],
];
const newDefinition=():ModelDefinition=>({id:'',smart:true,contextWindow:200000,maxTokens:7000,reasoning:false,vision:false});
type BatchView={id:string;value:ProviderModelTest|'unreachable'|'missing'};
type Discovery={models:ModelDefinition[];truncated:boolean};

export function modelSettingsError(error:unknown,zh:boolean,action:'read'|'save'){
 const z=(en:string,cn:string)=>zh?cn:en;
 const code=error instanceof ApiError?error.data?.error:'';
 switch(code){
  case 'model_settings_changed':return z('Model settings changed. Reload before saving.','模型配置已变更，请重新读取。');
  case 'invalid_llm_config':return z('The local model configuration is invalid.','本机模型配置文件格式无效。');
  case 'model_provider_binding_invalid':return z('A saved model no longer matches its provider configuration.','已选模型与供应商配置不一致，请检查本机配置。');
  case 'provider_in_use':return z('Switch the current model before disabling this provider or removing a model in use.','请先切换当前模型，再停用此供应商或移除使用中的模型。');
  case 'model_provider_key_required':return z('Enter the API key for this endpoint and protocol.','请填写此地址和协议使用的 API 密钥。');
  case 'invalid_provider':
  case 'invalid_model':return z('The selected model is no longer available.','所选模型已不可用，请重新选择。');
  case 'llm_setup_required':return z('Choose a configured model first.','请先选择已配置的模型。');
  case 'invalid_model_provider':return z('Check the endpoint, API key and model parameters.','请检查服务地址、API 密钥及模型参数。');
  case 'model_settings_save_failed':return z('Could not save model settings.','模型配置保存失败。');
 }
 return action==='read'
  ?z('Could not load models.','无法读取模型配置。')
  :z('Could not confirm the save. Reload to check.','保存结果未确认，请重新读取后核对。');
}

export function ModelProviderEditor({ctx,models,provider,onSaved,onReload}:{
 ctx:Ctx;models:ModelSettings;provider?:Provider;onSaved:(value:ModelSettings)=>void;onReload:(value:ModelSettings)=>void;
}){
 const z=(en:string,cn:string)=>ctx.zh?cn:en;
 const [id]=useState(()=>provider?.id||uid('provider'));
 const [form,setForm]=useState(()=>({
  name:provider?.name||'',baseUrl:provider?.baseUrl||'',api:provider?.api||'openai-completions',
  enabled:provider?.enabled??true,
 }));
 const [definitions,setDefinitions]=useState(()=>(provider?.definitions??[]).map(value=>({key:uid('model'),value})));
 const [expanded,setExpanded]=useState<string>();
 const [apiKey,setApiKey]=useState('');
 const [message,setMessage]=useState('');
 const [needsReload,setNeedsReload]=useState(false);
 const [busy,setBusy]=useState<'save'|'reload'|'discover'|'test'>();
 const pending=useRef(false);
 const [discovery,setDiscovery]=useState<Discovery>();
 const [filter,setFilter]=useState('');
 const [picked,setPicked]=useState<string[]>([]);
 const [batchView,setBatchView]=useState<BatchView>();
 const [check,recheck]=useState(0);
 const testStartedHere=useRef<string|undefined>(undefined);
 const stored=ctx.ui.providerModelProbe;
 const receipt=stored?.providerId===id&&stored.version===models.version&&(!stored.draft||testStartedHere.current===stored.id)?stored:undefined;
 const observed=receipt&&batchView?.id===receipt.id?batchView.value:undefined;
 const batch=typeof observed==='object'?observed:undefined;
 const testing=!!receipt&&(!observed||batch?.status==='running');
 const modelIds=definitions.map(({value})=>value.id.trim());
 const modelsValid=modelIds.length>0&&modelIds.every(model=>MODEL_ID_PATTERN.test(model))&&new Set(modelIds).size===modelIds.length;
 const connection={id,baseUrl:form.baseUrl.trim(),api:form.api,...(apiKey.trim()?{apiKey:apiKey.trim()}:{})};
 const update=(patch:Partial<typeof form>)=>setForm(current=>({...current,...patch}));
 const definition=(key:string,patch:Partial<ModelDefinition>)=>setDefinitions(current=>current.map(item=>item.key===key?{...item,value:{...item.value,...patch}}:item));

 useEffect(()=>{
  if(!receipt||busy==='test')return;
  const controller=new AbortController();
  let timer:number|undefined;
  async function read(){
   try{
    const result=await api<ProviderModelTest>('GET','/api/settings/models/provider-tests/'+enc(receipt!.id),undefined,
     AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]));
    if(controller.signal.aborted)return;
    setBatchView({id:receipt!.id,value:result});
    if(result.status==='running')timer=window.setTimeout(read,1000);
   }catch(error){
    if(!controller.signal.aborted)setBatchView({id:receipt!.id,value:error instanceof ApiError&&error.status===404?'missing':'unreachable'});
   }
  }
  void read();
  return()=>{controller.abort();window.clearTimeout(timer)};
 },[receipt?.id,busy==='test',check]);

 function resetConnectionResults(){
  if(receipt)setUI({providerModelProbe:undefined});
  setDiscovery(undefined);setPicked([]);setFilter('');setMessage('');
 }
 const failureLabel=(code?:string)=>{
  switch(code){
   case 'provider_auth':return z('Authentication rejected','鉴权失败');
   case 'provider_quota':return z('Quota or rate limit','额度或限流');
   case 'provider_connection':return z('Connection failed','连接失败');
   case 'provider_model_unavailable':return z('Model or endpoint unavailable','模型或接口不可用');
   case 'provider_unavailable':return z('Provider unavailable','供应商暂不可用');
   case 'llm_timeout':return z('Timed out','响应超时');
   case 'provider_catalog_unsupported':return z('No catalog endpoint. You can add model IDs manually.','供应商未提供目录接口，可手动添加模型 ID。');
   case 'provider_catalog_invalid':return z('The provider returned an invalid catalog.','供应商返回的目录格式不可用。');
   case 'provider_catalog_too_large':return z('The provider catalog is too large.','供应商返回的目录过大。');
   case 'provider_probe_busy':return z('A model batch is already running.','已有一批模型正在测试。');
   case 'provider_empty_response':return z('Empty response','响应为空');
   case 'provider_test_rejected':return z('Request rejected','模型请求未通过');
  }
 };
 function displayError(error:unknown,mode:'discover'|'test'){
  const code=error instanceof ApiError?error.data?.error:undefined;
  if(code==='model_settings_changed')setNeedsReload(true);
  if(code==='model_settings_changed'||code==='model_provider_key_required'||code==='invalid_model_provider'||code==='invalid_model')return modelSettingsError(error,ctx.zh,'read');
  return failureLabel(code)|| (mode==='discover'?z('Could not fetch models.','无法获取模型目录。'):z('Could not start model tests.','无法启动模型测试。'));
 }
 async function discover(){
  if(needsReload||pending.current||testing)return;
  pending.current=true;setBusy('discover');setMessage('');
  try{
   const value=await api<Discovery>('POST','/api/settings/models/providers/discover',{version:models.version,provider:connection},AbortSignal.timeout(15000));
   setDiscovery(value);setPicked([]);setFilter('');
  }catch(error){setDiscovery(undefined);setPicked([]);setMessage(displayError(error,'discover'))}
  finally{pending.current=false;setBusy(undefined)}
 }
 async function test(){
  if(needsReload||pending.current||testing)return;
  if(observed==='unreachable'){setBatchView(undefined);recheck(n=>n+1);return;}
  if(!modelsValid)return;
  pending.current=true;setBusy('test');setMessage('');
  const usingSavedConnection=!!provider&&provider.baseUrl===connection.baseUrl&&provider.api===connection.api&&!connection.apiKey;
  const next={id:observed==='missing'&&receipt?receipt.id:uid('provider-probe'),providerId:id,version:models.version,draft:!usingSavedConnection};
  testStartedHere.current=next.id;
  setBatchView(undefined);setUI({providerModelProbe:next});
  try{
   await durable();
  }catch{
   setUI({providerModelProbe:undefined});setMessage(z('Could not save the local test receipt.','无法保存本机测试回执。'));
   pending.current=false;setBusy(undefined);return;
  }
  try{
   await api('POST','/api/settings/models/provider-tests',{requestId:next.id,version:next.version,provider:connection,models:modelIds},AbortSignal.timeout(10000));
  }catch(error){
   // A dropped response can follow real registration. Leave the ID for GET-only recovery.
   if(error instanceof ApiError&&[400,409].includes(error.status)){
    setUI({providerModelProbe:undefined});setMessage(displayError(error,'test'));
   }
  }finally{pending.current=false;setBusy(undefined)}
 }

 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(needsReload||pending.current||testing)return;
  pending.current=true;setBusy('save');setMessage('');
  try{
   const value=await api<ModelSettings>('PATCH','/api/settings/models/providers',{version:models.version,provider:{
    ...form,...connection,name:form.name.trim(),
    definitions:definitions.map(({value})=>({...value,id:value.id.trim()})),
   }},AbortSignal.timeout(10000));
   setApiKey('');onSaved(value);
  }catch(error){
   setNeedsReload(!(error instanceof ApiError)||error.status===409||error.status>=500);
   setMessage(modelSettingsError(error,ctx.zh,'save'));
  }finally{pending.current=false;setBusy(undefined)}
 }
 async function reload(){
  if(pending.current)return;
  pending.current=true;setBusy('reload');
  try{
   const fresh=await api<ModelSettings>('GET','/api/settings/models',undefined,AbortSignal.timeout(10000));
   if(!fresh.version||!Array.isArray(fresh.providers))throw new Error('invalid_model_settings_response');
   onReload(fresh);setNeedsReload(false);
   setMessage(z('Latest configuration loaded. Review your changes before saving.','已读取最新配置。请核对当前输入后保存。'));
  }catch(error){setMessage(modelSettingsError(error,ctx.zh,'read'))}
  finally{pending.current=false;setBusy(undefined)}
 }
 const blocked=!!busy||testing;
 const knownIds=new Set(modelIds);
 const capacity=PROVIDER_MODEL_LIMIT-definitions.length;
 const available=discovery?.models.filter(model=>!knownIds.has(model.id))??[];
 const visible=available.filter(model=>model.id.toLowerCase().includes(filter.trim().toLowerCase()));
 const toggle=(model:string)=>setPicked(current=>current.includes(model)?current.filter(id=>id!==model):[...current,model].slice(0,capacity));
 const addPicked=()=>{
  setDefinitions(current=>[...current,...available.filter(model=>picked.includes(model.id)).slice(0,capacity).map(value=>({key:uid('model'),value}))]);
  setDiscovery(undefined);setPicked([]);setFilter('');
 };
 const manual=()=>{
  const key=uid('model');setDefinitions(current=>[...current,{key,value:newDefinition()}]);setExpanded(key);
 };
 const testLabel=observed==='unreachable'?z('Check results','查询结果'):observed==='missing'?z('Retry tests','重试测试'):testing||busy==='test'
  ?z('Testing…','测试中…'):z('Test models','批量测试');
 return <form className="cm-model-editor" onSubmit={save} autoComplete="off">
  <h2>{provider?.name||z('Add provider','添加供应商')}</h2>
  <fieldset className="cm-model-card" disabled={blocked}>
   <label>{z('Name','名称')}<input required maxLength={100} value={form.name} onChange={e=>update({name:e.target.value})}/></label>
   <label>{z('API endpoint','API 地址')}<input required type="url" value={form.baseUrl} onChange={e=>{resetConnectionResults();update({baseUrl:e.target.value})}}/></label>
   <label>{z('API format','API 格式')}<span className="cm-model-select">
    <StandardSelect className="cm-select" value={form.api} onChange={e=>{resetConnectionResults();update({api:e.target.value})}}>
     {protocolOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </StandardSelect><I n="caret-down"/>
   </span></label>
   <label>{z('API key','API 密钥')}<input type="password" autoComplete="new-password" value={apiKey} onChange={e=>{resetConnectionResults();setApiKey(e.target.value)}}
    placeholder={provider?.hasKey||provider?.configured?'••••••••':undefined}/></label>
   <label className="cm-model-toggle"><input type="checkbox" checked={form.enabled} onChange={e=>update({enabled:e.target.checked})}/>{z('Enabled','启用')}</label>
  </fieldset>
  <fieldset className="cm-model-card" disabled={blocked}>
   <legend>{z('Models','模型目录')}</legend>
   <div className="cm-model-toolbar">
    <button className="cm-model-link" type="button" disabled={needsReload||!connection.baseUrl} onClick={()=>void discover()}>{busy==='discover'?z('Fetching…','获取中…'):z('Fetch models','获取模型')}</button>
    <button className="cm-model-link" type="button" disabled={needsReload||(!modelsValid&&observed!=='unreachable')} onClick={()=>void test()}>{testLabel}</button>
    <button className="cm-model-link" type="button" disabled={capacity<1} onClick={manual}>{z('Add manually','手动添加')}</button>
   </div>
   {observed==='unreachable'||observed==='missing'?<div role="status" className="cm-model-message">{observed==='unreachable'?z('Test results unconfirmed.','测试结果未确认。'):z('Test request not found.','未收到测试请求。')}</div>:null}
   {discovery?<div className="cm-model-pick">
    {available.length?<><input type="search" aria-label={z('Search models','搜索模型')} placeholder={z('Search models','搜索模型')} value={filter} onChange={e=>setFilter(e.target.value)}/>
     <div className="cm-model-pick-list">{visible.map(model=><label key={model.id} className="cm-model-toggle">
      <input type="checkbox" checked={picked.includes(model.id)} disabled={!picked.includes(model.id)&&picked.length>=capacity} onChange={()=>toggle(model.id)}/><span>{model.id}</span>
     </label>)}</div>{!visible.length?<span className="cm-model-message">{z('No matching models','没有匹配的模型')}</span>:null}
    </>:<span role="status" className="cm-model-message">{discovery.models.length?z('All returned models are already added.','返回的模型均已添加。'):z('The provider returned no models.','供应商未返回模型。')}</span>}
    {discovery.truncated?<span className="cm-model-message">{z('Showing the first page range from this provider.','当前展示供应商返回的部分目录。')}</span>:null}
    <div className="cm-model-toolbar">
     {visible.length?<button className="cm-model-link" type="button" disabled={capacity<1} onClick={()=>setPicked(current=>[...new Set([...current,...visible.map(model=>model.id)])].slice(0,capacity))}>{z('Select all shown','全选可见')}</button>:null}
     <button className="cm-model-link" type="button" disabled={!picked.length||capacity<1} onClick={addPicked}>{z('Add selected','添加所选')}{picked.length?` (${picked.length})`:''}</button>
     <button className="cm-model-link cm-model-remove" type="button" onClick={()=>{setDiscovery(undefined);setPicked([])}}>{z('Close list','关闭目录')}</button>
    </div>
   </div>:null}
   {definitions.map(({key,value},index)=>{
    const row=batch?.results.find(item=>item.model===value.id.trim());
    const state=row?.status;
    const result=state==='queued'?z('Queued','待测试'):state==='running'?z('Testing…','测试中…'):state==='succeeded'?z('Working','正常'):
     state==='failed'?failureLabel(row?.failureCode)||z('Failed','失败'):state==='unknown'?z('Unconfirmed','未确认'):'';
    return <div className="cm-model-entry" key={key}>
    <button className="cm-model-row" type="button" aria-expanded={expanded===key} onClick={()=>setExpanded(expanded===key?undefined:key)}>
     <I n={expanded===key?'caret-down':'caret-right'}/><span>{value.id||z('New model','新模型')}</span>
     {result?<span className="cm-model-outcome" data-status={state}>{result}</span>:null}
    </button>
    <div className="cm-model-edit-fields" hidden={expanded!==key}>
    <label>{z('Model ID','模型 ID')}<input aria-label={z('Model ID','模型 ID')+' '+(index+1)} required maxLength={200} value={value.id} onChange={e=>definition(key,{id:e.target.value})}/></label>
    <details>
     <summary>{z('Model parameters','模型参数')}</summary>
     <div className="cm-model-limits">
      <label>{z('Context tokens','上下文 Token')}<input type="number" min={1} max={10000000} required value={value.contextWindow} onChange={e=>definition(key,{contextWindow:Number(e.target.value)})}/></label>
      <label>{z('Output tokens','最大输出 Token')}<input type="number" min={1} max={value.contextWindow} required value={value.maxTokens} onChange={e=>definition(key,{maxTokens:Number(e.target.value)})}/></label>
     </div>
     <div className="cm-model-options">
      {([['smart',z('Smart defaults','智能配置')],['reasoning',z('Reasoning','推理')],['vision',z('Image input','图片输入')]] as const).map(([k,label])=>
       <label className="cm-model-toggle" key={k}><input type="checkbox" checked={value[k]} onChange={e=>definition(key,{[k]:e.target.checked})}/>{label}</label>)}
     </div>
    </details>
    <button className="cm-model-link cm-model-remove" type="button" onClick={()=>setDefinitions(current=>current.filter(item=>item.key!==key))}>{z('Remove model','移除此模型')}</button>
    </div>
   </div>})}
  </fieldset>
  {message?<div role="status" className="cm-model-message">{message}</div>:null}
  <div className="cm-model-actions">
   {needsReload?<button type="button" className="cm-model-link" disabled={blocked} onClick={()=>void reload()}>{z('Reload','重新读取')}</button>:null}
   <button type="submit" className="cm-model-save" disabled={blocked||needsReload||!!definitions.length&&!modelsValid}>{busy==='save'?z('Saving…','保存中…'):z('Save provider','保存供应商')}</button>
  </div>
 </form>;
}
