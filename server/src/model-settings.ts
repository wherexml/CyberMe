import {privatePath} from './private-paths';
import {existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {registerSecret} from './store';
import {ApiError} from './integrations';
import type {ModelSettings, ModelSelection} from '../../shared/model-settings';

type Provider = {id:string; baseUrl:string; apiKey:string; api:string; compatibility?:string};
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
    let match=providers.find(x=>x.baseUrl===p.baseUrl&&x.api===p.api&&x.apiKey===p.apiKey&&x.compatibility===p.compatibility);
    if(!match){match={...p,id:providers.some(x=>x.id===p.id)?'provider-'+providers.length:p.id};providers.push(match);}
    return {providerId:match.id,model:(i?llm.deepModel:llm.model)||'claude-opus-5-5'};
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
    return {id:p.id,name:isGo?'OpenCode Go':new URL(baseUrl==='(invalid endpoint)'?'https://invalid.local':baseUrl).hostname,baseUrl,api:p.api,configured:!!p.apiKey&&baseUrl!=='(invalid endpoint)',models:isGo?['deepseek-v4.1-flash']:p.api==='anthropic-messages'?['claude-haiku-4-5-20251001','claude-opus-5-5']:[]};
  })};
}
function selection(value:any,providers:Provider[]):{choice:ModelSelection;provider:Provider} {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['providerId','model'].includes(k))||typeof value.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(value.model.trim()))throw new ApiError(400,'invalid_model','请输入有效的模型 ID。 / Enter a valid model ID.');
  const provider=providers.find(p=>p.id===value.providerId);
  if(!provider||!provider.apiKey||!provider.baseUrl)throw new ApiError(400,'invalid_provider','所选渠道尚未配置。 / Provider is not configured.');
  return {choice:{providerId:provider.id,model:value.model.trim()},provider};
}
export function saveModelSettings(input:any):ModelSettings {
  const state=read();
  if(Object.keys(input).some(k=>!['version','standard','deep'].includes(k)))throw new ApiError(400,'invalid_model_settings','包含不支持的配置字段。 / Unsupported configuration fields.');
  if(input.version!==state.version)throw new ApiError(409,'model_settings_changed','配置已在其他地方变更，请先重新读取。 / Configuration changed. Reload before saving.');
  const standard=selection(input.standard,state.providers),deep=selection(input.deep,state.providers);
  const llm={...state.llm,modelProviders:state.providers,model:standard.choice.model,baseUrl:standard.provider.baseUrl,apiKey:standard.provider.apiKey,api:standard.provider.api,gatewayCompatibility:standard.provider.compatibility,deepModel:deep.choice.model,deepBaseUrl:deep.provider.baseUrl,deepApiKey:deep.provider.apiKey,deepApi:deep.provider.api,deepGatewayCompatibility:deep.provider.compatibility};
  const root=state.root.llm?{...state.root,llm}:llm;
  const temp=file+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temp,JSON.stringify(root,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}
  catch {throw new ApiError(500,'model_settings_save_failed','模型配置保存失败，原配置未覆盖，请重试。 / Could not save model configuration. Retry.');}
  finally {if(existsSync(temp))unlinkSync(temp);}
  return modelSettings();
}
