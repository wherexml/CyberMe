import {privatePath} from './private-paths';
import {existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {registerSecret} from './store';
import {ApiError} from './integrations';
import {MODEL_ID_PATTERN, PROVIDER_MODEL_LIMIT,type ModelSettings,type ModelSelection,type ModelDefinition} from '../../shared/model-settings';

type Provider = {id:string; baseUrl:string; apiKey:string; api:string; compatibility?:string; name?:string; enabled?:boolean; definitions?:ModelDefinition[]};
const protocols=['anthropic-messages','openai-completions','openai-responses'] as const;
export type ProviderConnection = {id:string;baseUrl:string;api:typeof protocols[number];apiKey:string;compatibility?:'claude-code'};
const file = privatePath('config.json');
function read() {
  privatePath('config.json');
  const unselected={providerId:'',model:''};
  if (!existsSync(file)) return {root:{llm:{}},llm:{},providers:[] as Provider[],selections:[unselected,unselected],version:'unconfigured'};
  let root:any;
  try { root=JSON.parse(readFileSync(file,'utf8')); } catch { throw new ApiError(503,'invalid_llm_config','模型配置文件无效。 / Invalid model configuration.'); }
  const llm=root&&Object.hasOwn(root,'llm')?root.llm:root;
  if(!llm||typeof llm!=='object'||Array.isArray(llm))throw new ApiError(503,'invalid_llm_config','模型配置文件无效。 / Invalid model configuration.');
  const current:Provider[]=[
    {id:'standard',baseUrl:llm.baseUrl,apiKey:llm.apiKey,api:llm.api||'anthropic-messages',compatibility:llm.gatewayCompatibility},
    {id:'deep',baseUrl:llm.deepBaseUrl||llm.baseUrl,apiKey:llm.deepApiKey||llm.apiKey,api:llm.deepApi||llm.api||'anthropic-messages',compatibility:llm.deepGatewayCompatibility},
  ];
  const providers:Provider[]=Array.isArray(llm.modelProviders)?llm.modelProviders.map((p:Provider)=>({...p})):[];
  // Keep existing channels even when both roles are switched to the same one.
  const selections=current.map((p,i)=>{
    registerSecret(p.apiKey);
    const field=i?'deepProviderId':'standardProviderId',model=(i?llm.deepModel:llm.model)||'claude-opus-5-5';
    if(!Object.hasOwn(llm,field)&&!p.baseUrl&&!p.apiKey)return unselected;
    const matchesBinding=(x:Provider)=>x.baseUrl===p.baseUrl&&x.api===p.api&&x.apiKey===p.apiKey&&(x.compatibility||undefined)===(p.compatibility||undefined);
    let match:Provider|undefined;
    if(Object.hasOwn(llm,field)){
      const id=llm[field];
      match=typeof id==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(id)&&providers.filter(x=>x.id===id).length===1?providers.find(x=>x.id===id):undefined;
      if(!match||!matchesBinding(match)||match.enabled===false||!match.apiKey||(match.definitions&&!match.definitions.some(m=>m.id===model)))throw new ApiError(503,'model_provider_binding_invalid','模型供应商绑定无效，请恢复或修正服务端配置。 / Invalid model provider binding. Restore or repair the server configuration.');
    }else{
      // Only configurations without an explicit role identity use legacy inference.
      match=providers.find(matchesBinding);
    }
    if(!match){match={...p,id:providers.some(x=>x.id===p.id)?'provider-'+providers.length:p.id};providers.push(match);}
    return {providerId:match.id,model};
  });
  providers.forEach(p=>registerSecret(p.apiKey));
  const s=statSync(file,{bigint:true});
  return {root,llm,providers,selections,version:`${s.ino}-${s.mtimeNs}-${s.size}`};
}
function safeUrl(value:string) {
  try {const u=new URL(value);if(u.protocol==='http:'||u.protocol==='https:')return u.origin+u.pathname;} catch {}
  return '(invalid endpoint)';
}
export function modelSettings():ModelSettings {
  const {providers,selections,version,llm}=read();
  return {version,standard:selections[0],deep:selections[1],providers:providers.map(p=>{
    const baseUrl=safeUrl(p.baseUrl),isGo=baseUrl.startsWith('https://opencode.ai/');
    const defaults=isGo?['deepseek-v4.1-flash']:p.api==='anthropic-messages'?['claude-haiku-4-5-20251001','claude-opus-5-5']:[];
    const catalog=p.definitions||[...new Set([...defaults,...selections.filter(s=>s.providerId===p.id).map(s=>s.model)])].map(id=>{
      const role=selections.findIndex(s=>s.providerId===p.id&&s.model===id);
      const options=role===0?llm.modelOptions:role===1?llm.deepModelOptions:undefined;
      return {smart:true,contextWindow:200000,maxTokens:7000,reasoning:false,vision:true,...options,id};
    });
    const definitions=catalog.map(({id,smart,contextWindow,maxTokens,reasoning,vision}:ModelDefinition)=>({id,smart,contextWindow,maxTokens,reasoning,vision}));
    return {id:p.id,name:p.name||(isGo?'OpenCode Go':baseUrl==='(invalid endpoint)'?p.id:new URL(baseUrl).hostname),baseUrl,api:p.api,configured:p.enabled!==false&&!!p.apiKey&&baseUrl!=='(invalid endpoint)',hasKey:!!p.apiKey,enabled:p.enabled!==false,compatibility:p.compatibility,definitions,models:definitions.map(m=>m.id)};
  })};
}
function selection(value:any,providers:Provider[]):{choice:ModelSelection;provider:Provider} {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['providerId','model'].includes(k))||typeof value.model!=='string'||!MODEL_ID_PATTERN.test(value.model.trim()))throw new ApiError(400,'invalid_model','请输入有效的模型 ID。 / Enter a valid model ID.');
  const provider=providers.find(p=>p.id===value.providerId);
  if(!provider||provider.enabled===false||!provider.apiKey||!provider.baseUrl)throw new ApiError(400,'invalid_provider','所选渠道尚未配置。 / Provider is not configured.');
  if(provider.definitions&&!provider.definitions.some(m=>m.id===value.model.trim()))throw new ApiError(400,'invalid_model','所选模型不在供应商目录中。 / The selected model is not in the provider catalog.');
  return {choice:{providerId:provider.id,model:value.model.trim()},provider};
}
export function saveModelSettings(input:any):ModelSettings {
  const state=read();
  if(Object.keys(input).some(k=>!['version','standard','deep'].includes(k)))throw new ApiError(400,'invalid_model_settings','包含不支持的配置字段。 / Unsupported configuration fields.');
  if(input.version!==state.version)throw new ApiError(409,'model_settings_changed','配置已在其他地方变更，请先重新读取。 / Configuration changed. Reload before saving.');
  const standard=selection(input.standard,state.providers),deep=selection(input.deep,state.providers);
  const options=(value:ReturnType<typeof selection>,index:number)=>{
    const previous=state.selections[index];
    const definition=value.provider.definitions?.find(m=>m.id===value.choice.model);
    const existing=previous.providerId===value.choice.providerId&&previous.model===value.choice.model
      ? index===0?state.llm.modelOptions:state.llm.deepModelOptions
      : undefined;
    return definition&&existing?{...existing,...definition}:definition??existing;
  };
  const standardDef=options(standard,0),deepDef=options(deep,1);
  const llm={...state.llm,standardProviderId:standard.choice.providerId,deepProviderId:deep.choice.providerId,modelOptions:standardDef,deepModelOptions:deepDef,modelProviders:state.providers,model:standard.choice.model,baseUrl:standard.provider.baseUrl,apiKey:standard.provider.apiKey,api:standard.provider.api,gatewayCompatibility:standard.provider.compatibility,deepModel:deep.choice.model,deepBaseUrl:deep.provider.baseUrl,deepApiKey:deep.provider.apiKey,deepApi:deep.provider.api,deepGatewayCompatibility:deep.provider.compatibility};
  const root=state.root.llm?{...state.root,llm}:llm;
  const temp=file+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temp,JSON.stringify(root,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}
  catch {throw new ApiError(500,'model_settings_save_failed','模型配置保存失败，原配置未覆盖，请重试。 / Could not save model configuration. Retry.');}
  finally {if(existsSync(temp))unlinkSync(temp);}
  return modelSettings();
}

const invalidProvider=():never=>{throw new ApiError(400,'invalid_model_provider','请检查供应商地址、API 格式、凭据和模型参数。');};
function connection(p:any,old?:Provider):ProviderConnection {
  if(!p||typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(p.id)||!protocols.includes(p.api))invalidProvider();
  if(typeof p.baseUrl!=='string'||p.baseUrl.length>2048)invalidProvider();
  let url:URL;
  try{url=new URL(p.baseUrl);}catch{return invalidProvider();}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)invalidProvider();
  const sameEndpoint=!!old&&old.api===p.api&&safeUrl(old.baseUrl)!=='(invalid endpoint)'&&new URL(old.baseUrl).href===url.href;
  // The V6 editor omits compatibility. Retain it for the original transport; legacy callers can still set it explicitly.
  const compatibility=p.compatibility===undefined?(sameEndpoint?old?.compatibility:undefined):p.compatibility||undefined;
  if(p.compatibility!==undefined&&!['','claude-code'].includes(p.compatibility))invalidProvider();
  if(compatibility&&!(compatibility==='claude-code'&&p.api==='anthropic-messages'))invalidProvider();
  if(p.apiKey!==undefined&&(typeof p.apiKey!=='string'||p.apiKey.trim().length<8||p.apiKey.length>8192||/[\r\n\0]/.test(p.apiKey)))invalidProvider();
  const sameBinding=sameEndpoint&&(old?.compatibility||undefined)===compatibility;
  if(old?.apiKey&&!sameBinding&&!p.apiKey)throw new ApiError(400,'model_provider_key_required','更改服务地址或协议时，请填写该服务的 API 密钥。');
  return {id:p.id,baseUrl:p.baseUrl,api:p.api,apiKey:p.apiKey?.trim()||(sameBinding?old?.apiKey:undefined)||'',compatibility};
}
export function modelProviderConnection(version:unknown,provider:any):ProviderConnection {
  const state=read();
  if(version!==state.version)throw new ApiError(409,'model_settings_changed','配置已变更，请重新读取。');
  if(!provider||typeof provider!=='object'||Array.isArray(provider)||Object.keys(provider).some(k=>!['id','baseUrl','api','apiKey'].includes(k)))invalidProvider();
  const value=connection(provider,state.providers.find(p=>p.id===provider.id));
  if(!value.apiKey)throw new ApiError(400,'model_provider_key_required','请填写 API 密钥。');
  return value;
}

// Provider writes use the same optimistic lease and private atomic configuration as role writes.
export function saveModelProvider(input:any):ModelSettings {
  const state=read();
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['version','provider'].includes(k)))throw new ApiError(400,'invalid_model_settings','包含不支持的配置字段。');
  if(input.version!==state.version)throw new ApiError(409,'model_settings_changed','配置已变更，请重新读取。');
  const p=input.provider,invalid=invalidProvider;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['id','name','baseUrl','api','apiKey','enabled','compatibility','definitions'].includes(k)))invalid();
  if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.enabled!=='boolean')invalid();
  const old=state.providers.find(x=>x.id===p.id);
  const transport=connection(p,old);
  if(p.enabled&&!transport.apiKey)invalid();
  if(!Array.isArray(p.definitions)||p.definitions.length>PROVIDER_MODEL_LIMIT)invalid();
  const ids=new Set<string>();
  for(const m of p.definitions){
    if(!m||Object.keys(m).some(k=>!['id','smart','contextWindow','maxTokens','reasoning','vision'].includes(k))||typeof m.id!=='string'||!MODEL_ID_PATTERN.test(m.id)||ids.has(m.id)||typeof m.smart!=='boolean'||typeof m.reasoning!=='boolean'||typeof m.vision!=='boolean'||!Number.isSafeInteger(m.contextWindow)||m.contextWindow<1||m.contextWindow>10000000||!Number.isSafeInteger(m.maxTokens)||m.maxTokens<1||m.maxTokens>m.contextWindow)invalid();
    ids.add(m.id);
  }
  const selected=state.selections.filter(x=>x.providerId===p.id);
  if(selected.length&&(!p.enabled||selected.some(x=>!ids.has(x.model))))throw new ApiError(400,'provider_in_use','当前任务正在使用此供应商的模型，请先切换任务模型。');
  registerSecret(transport.apiKey);
  const definitions=p.definitions.map((model:ModelDefinition)=>({...old?.definitions?.find(d=>d.id===model.id),...model}));
  const provider:Provider={...old,...transport,name:p.name.trim(),enabled:p.enabled,definitions};
  const providers=old?state.providers.map(x=>x.id===p.id?provider:x):[...state.providers,provider];
  const llm={...state.llm,modelProviders:providers};
  for(const [i,choice] of state.selections.entries()){
    if(choice.providerId)llm[i===0?'standardProviderId':'deepProviderId']=choice.providerId;
    if(choice.providerId!==p.id)continue;
    const def=definitions.find((m:ModelDefinition)=>m.id===choice.model);
    if(i===0)Object.assign(llm,{baseUrl:provider.baseUrl,apiKey:provider.apiKey,api:provider.api,gatewayCompatibility:provider.compatibility,modelOptions:{...state.llm.modelOptions,...def}});
    else Object.assign(llm,{deepBaseUrl:provider.baseUrl,deepApiKey:provider.apiKey,deepApi:provider.api,deepGatewayCompatibility:provider.compatibility,deepModelOptions:{...state.llm.deepModelOptions,...def}});
  }
  const root=state.root.llm?{...state.root,llm}:llm,temp=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temp,JSON.stringify(root,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}catch{throw new ApiError(500,'model_settings_save_failed','模型配置保存失败，请重试。');}finally{if(existsSync(temp))unlinkSync(temp);}
  return modelSettings();
}
