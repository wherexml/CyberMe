import {ApiError} from './integrations';
import {get,settings,settingsHistory} from './store';

// Structured Agent actions cannot widen what a connection may do. Settings owns
// grants, targets and credentials; denial happens before any write is recorded.
const deny=(message:string)=>new ApiError(403,'connection_grant_denied',message);
const only=(input:any,keys:string[])=>Object.keys(input).every(key=>keys.includes(key));
const FEISHU=/^(feishu|飞书)$/i,LOCAL=/^(feishu|飞书|wechat|wechat-sync)$/i;
const connectionSetting=(value:any)=>value?.autonomy?.permissions?.connections;

function assertCreateTest(input:any){
 // testConnection falls back to type when provider is absent; match that resolution.
 const provider=String(input.provider||input.type||'custom');
 if(/gmail|google/i.test(provider))throw deny('Gmail 只能在设置中通过 Google 授权');
 if(/apple/i.test(provider))throw deny('Apple 数据只能在设置中通过系统授权连接');
 if(LOCAL.test(provider)){
  if(!only(input,['name','provider','type']))throw deny('飞书、微信连接不接受权限、端点或认证配置');
  if(FEISHU.test(provider)&&get('connections','feishu-local'))throw deny('飞书连接已存在，请复测该连接');
  return;
 }
 const config=input.config;
 if(config!==undefined&&(!config||typeof config!=='object'||Array.isArray(config)||!only(config,['authMethod'])||![undefined,'none'].includes(config.authMethod)))throw deny('Agent 只能检测无认证连接');
 const permissions=input.permissions;
 if(permissions===undefined||(Array.isArray(permissions)&&!permissions.length))return;
 if(Array.isArray(permissions)&&permissions.length===1&&permissions[0]==='read'&&String(input.type||'rest').toLowerCase()==='rest')return;
 throw deny('Agent 不能授予连接权限；新增连接仅允许无认证 REST 的只读权限');
}

export function assertAgentConnectionInput(name:string,params:any,input:any){
 if(params.resource==='connections'){
  if(name==='entity_create'&&!only(input,['title','name']))throw deny('Agent 不能写入连接目标、认证或权限');
  if(name==='entity_update'&&!only(input,['title','name','baseUpdatedAt']))throw deny('Agent 只能修改连接名称');
  if(name==='entity_restore')throw deny('已删除的连接及其授权只能在设置中恢复');
  if(name==='entity_delete'&&params.id==='gmail-oauth')throw deny('Gmail 请使用断开连接，确保授权被清除');
 }
 if(name==='connection_create_test')assertCreateTest(input);
 if(name==='connection_test'){
  if(!only(input,['name']))throw deny('复测不能修改连接目标、认证或权限');
  const row=get('connections',String(params.id||''));
  if(/^apple-/.test(String(params.id||'')))throw deny('Apple 连接只能在设置中授权');
  if(row?.supersededBy)throw deny('已被替代的连接不能复测');
  // Rediscovery would put new tools under a legacy wildcard; only the user may retest these.
  if(String(row?.type||'').toLowerCase()==='mcp'&&[row?.permissions].flat().includes('mcp.call'))throw deny('带 mcp.call 通配授权的 MCP 连接只能在设置中复测');
  if(row?.status==='disconnected'&&!LOCAL.test(String(row.provider||'')))throw deny('已断开的连接需在设置中重新连接');
 }
 const current=connectionSetting(settings());
 if(name==='settings_update'&&input.autonomy?.permissions&&Object.hasOwn(input.autonomy.permissions,'connections')&&input.autonomy.permissions.connections!==current)throw deny('连接权限档位只能在设置中修改');
 if(name==='settings_restore'){const prior=settingsHistory().find(row=>row.id===input.historyId);if(prior&&connectionSetting(prior.settings)!==current)throw deny('恢复会改变连接权限档位，请在设置中操作');}
}
