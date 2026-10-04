import {privatePath} from './private-paths';
import {existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {registerSecret} from './store';
import {ApiError} from './integrations';
import type {ModelSettings, ModelSelection, ModelDefinition} from '../../shared/model-settings';

type Provider = {id:string; baseUrl:string; apiKey:string; api:string; compatibility?:string; name?:string; enabled?:boolean; definitions?:ModelDefinition[]};
const file = privatePath('config.json');
function read() {
  privatePath('config.json');
  if (!existsSync(file)) throw new ApiError(503,'llm_setup_required','请先在本机服务端配置模型渠道。 / Configure a model provider on this server first.');
  let root:any;
  try { root=JSON.parse(readFileSync(file,'utf8')); } catch { throw new ApiError(503,'invalid_llm_config','模型配置文件无效。 / Invalid model configuration.'); }
  const llm=root.llm||root;
  const current:Provider[]=[
    {id:'standard',baseUrl:llm.baseUrl,apiKey:llm.apiKey,api:llm.api||'anthropic-messages',compatibility:llm.gatewayCompatibility},
    {id:'deep',baseUrl:llm.deepBaseUrl||llm.baseUrl,apiKey:llm.deepApiKey||llm.apiKey,api:llm.deepApi||llm.api||'anthropic-messages',compatibility:llm.deepGatewayCompatibility},
  ];
  const providers:Provider[]=Array.isArray(llm.modelProviders)?llm.modelProviders.map((p:Provider)=>({...p})):[];
  // Keep existing channels even when both roles are switched to the same one.
  const selections=current.map((p,i)=>{
    registerSecret(p.apiKey);
    const field=i?'deepProviderId':'standardProviderId',model=(i?llm.deepModel:llm.model)||'claude-opus-5-5';
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
  try {const u=new URL(value);return u.origin+u.pathname;} catch {return '(invalid endpoint)';}
}
export function modelSettings():ModelSettings {
  const {providers,selections,version}=read();
  return {version,standard:selections[0],deep:selections[1],providers:providers.map(p=>{
    const baseUrl=safeUrl(p.baseUrl),isGo=baseUrl.startsWith('https://opencode.ai/');
    const defaults=isGo?['deepseek-v4.1-flash']:p.api==='anthropic-messages'?['claude-haiku-4-5-20251001','claude-opus-5-5']:[];
    const definitions=p.definitions||[...new Set([...defaults,...selections.filter(s=>s.providerId===p.id).map(s=>s.model)])].map(id=>({id,smart:true,contextWindow:200000,maxTokens:7000,reasoning:false,vision:true}));
    return {id:p.id,name:p.name||(isGo?'OpenCode Go':new URL(baseUrl==='(invalid endpoint)'?'https://invalid.local':baseUrl).hostname),baseUrl,api:p.api,configured:p.enabled!==false&&!!p.apiKey&&baseUrl!=='(invalid endpoint)',enabled:p.enabled!==false,compatibility:p.compatibility,definitions,models:definitions.map(m=>m.id)};
  })};
}
function selection(value:any,providers:Provider[]):{choice:ModelSelection;provider:Provider} {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['providerId','model'].includes(k))||typeof value.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(value.model.trim()))throw new ApiError(400,'invalid_model','请输入有效的模型 ID。 / Enter a valid model ID.');
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
  const standardDef=standard.provider.definitions?.find(m=>m.id===standard.choice.model),deepDef=deep.provider.definitions?.find(m=>m.id===deep.choice.model);
  const llm={...state.llm,standardProviderId:standard.choice.providerId,deepProviderId:deep.choice.providerId,modelOptions:standardDef,deepModelOptions:deepDef,modelProviders:state.providers,model:standard.choice.model,baseUrl:standard.provider.baseUrl,apiKey:standard.provider.apiKey,api:standard.provider.api,gatewayCompatibility:standard.provider.compatibility,deepModel:deep.choice.model,deepBaseUrl:deep.provider.baseUrl,deepApiKey:deep.provider.apiKey,deepApi:deep.provider.api,deepGatewayCompatibility:deep.provider.compatibility};
  const root=state.root.llm?{...state.root,llm}:llm;
  const temp=file+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temp,JSON.stringify(root,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}
  catch {throw new ApiError(500,'model_settings_save_failed','模型配置保存失败，原配置未覆盖，请重试。 / Could not save model configuration. Retry.');}
  finally {if(existsSync(temp))unlinkSync(temp);}
  return modelSettings();
}

// Provider writes use the same optimistic lease and private atomic configuration as role writes.
export function saveModelProvider(input:any):ModelSettings {
  const state=read();
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['version','provider'].includes(k)))throw new ApiError(400,'invalid_model_settings','包含不支持的配置字段。');
  if(input.version!==state.version)throw new ApiError(409,'model_settings_changed','配置已变更，请重新读取。');
  const p=input.provider;
  const invalid=()=>{throw new ApiError(400,'invalid_model_provider','请检查供应商地址、API 格式、凭据和模型参数。');};
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['id','name','baseUrl','api','apiKey','enabled','compatibility','definitions'].includes(k)))invalid();
  if(typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.enabled!=='boolean'||!['anthropic-messages','openai-completions','openai-responses'].includes(p.api))invalid();
  let url:URL;try{url=new URL(p.baseUrl);}catch{invalid();}
  if(!['https:','http:'].includes(url!.protocol)||url!.username||url!.password||url!.search||url!.hash)invalid();
  if(p.compatibility!==undefined&&!['','claude-code'].includes(p.compatibility))invalid();
  if(p.compatibility==='claude-code'&&p.api!=='anthropic-messages')invalid();
  const old=state.providers.find(x=>x.id===p.id);
  if(p.apiKey!==undefined&&(typeof p.apiKey!=='string'||p.apiKey.trim().length<8||p.apiKey.length>8192))invalid();
  // A stored key can only be reused for its original destination/protocol.
  const apiKey=p.apiKey?.trim()||(old&&old.baseUrl===p.baseUrl&&old.api===p.api&&old.compatibility===(p.compatibility||undefined)?old.apiKey:undefined);
  if(p.enabled&&!apiKey)invalid();
  if(!Array.isArray(p.definitions)||p.definitions.length>100)invalid();
  const ids=new Set<string>();
  for(const m of p.definitions){
    if(!m||Object.keys(m).some(k=>!['id','smart','contextWindow','maxTokens','reasoning','vision'].includes(k))||typeof m.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(m.id)||ids.has(m.id)||typeof m.smart!=='boolean'||typeof m.reasoning!=='boolean'||typeof m.vision!=='boolean'||!Number.isSafeInteger(m.contextWindow)||m.contextWindow<1||m.contextWindow>10000000||!Number.isSafeInteger(m.maxTokens)||m.maxTokens<1||m.maxTokens>m.contextWindow)invalid();
    ids.add(m.id);
  }
  const selected=state.selections.filter(x=>x.providerId===p.id);
  if(selected.length&&(!p.enabled||selected.some(x=>!ids.has(x.model))))throw new ApiError(400,'provider_in_use','当前任务正在使用此供应商的模型，请先切换任务模型。');
  registerSecret(apiKey);
  const provider:Provider={id:p.id,name:p.name.trim(),baseUrl:p.baseUrl,api:p.api,apiKey:apiKey||'',enabled:p.enabled,compatibility:p.compatibility||undefined,definitions:p.definitions};
  const providers=state.providers.filter(x=>x.id!==p.id).concat(provider);
  const llm={...state.llm,standardProviderId:state.selections[0].providerId,deepProviderId:state.selections[1].providerId,modelProviders:providers};
  for(const [i,choice] of state.selections.entries()){
    if(choice.providerId!==p.id)continue;
    const def=provider.definitions!.find(m=>m.id===choice.model);
    if(i===0)Object.assign(llm,{baseUrl:provider.baseUrl,apiKey:provider.apiKey,api:provider.api,gatewayCompatibility:provider.compatibility,modelOptions:def});
    else Object.assign(llm,{deepBaseUrl:provider.baseUrl,deepApiKey:provider.apiKey,deepApi:provider.api,deepGatewayCompatibility:provider.compatibility,deepModelOptions:def});
  }
  const root=state.root.llm?{...state.root,llm}:llm,temp=file+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temp,JSON.stringify(root,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}catch{throw new ApiError(500,'model_settings_save_failed','模型配置保存失败，请重试。');}finally{if(existsSync(temp))unlinkSync(temp);}
  return modelSettings();
}
