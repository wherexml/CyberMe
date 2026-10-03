import {db,publicValue,put} from './store';
import {validConnectionCredentials} from './connection-credentials-policy';
export {validConnectionCredentials,hasCredentialHeaders,connectionCredentialValues} from './connection-credentials-policy';

// Private transport credentials belong to a saved target, never to its display name.
export function credentialTarget(connection:any) {
 return {type:String(connection.type||'REST').toLowerCase(),provider:String(connection.provider||'Custom').toLowerCase(),endpoint:String(connection.endpoint||connection.config?.endpoint||''),path:String(connection.config?.path||'')};
}
const sameTarget=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
export function privateConnectionConfig(id?:string):Record<string,any> {
 const row=id?db.prepare('SELECT data FROM connection_private WHERE id=?').get(id) as any:undefined;
 return row?JSON.parse(row.data):{};
}
export function publicConnectionConfig(config:any,ready=false) {
 const result={...publicValue(config||{})};delete result._credentialTarget;delete result._credentialMethod;result.credentialReady=ready;return result;
}
export function connectionAuth(connection:any,old?:any,input:any={}) {
 const stored=privateConnectionConfig(old?.id||connection.id);
 // A legacy credential is anchored to the original entity before any reconfiguration.
 const bound=stored._credentialTarget||(old?credentialTarget(old):undefined),target=credentialTarget(connection);
 const config={...connection.config,...input};delete config.credentialReady;delete config._credentialTarget;delete config._credentialMethod;delete config.apiKey;delete config.headers;
 const authMethod=String(config.authMethod||stored.authMethod||(input.apiKey||stored.apiKey?'api-key':input.headers||stored.headers?'headers':'none')).toLowerCase();
 config.authMethod=authMethod;
 if(authMethod!=='none'&&authMethod!=='oauth'&&['rest','mcp'].includes(target.type)) {
  const boundMethod=String(stored._credentialMethod||stored.authMethod||old?.config?.authMethod||(stored.apiKey?'api-key':stored.headers?'headers':'none')).toLowerCase();
  if(sameTarget(bound,target)&&boundMethod===authMethod){if(stored.apiKey)config.apiKey=stored.apiKey;if(stored.headers)config.headers=stored.headers;}
  if(typeof input.apiKey==='string'&&input.apiKey.trim())config.apiKey=input.apiKey.trim();
  if(input.headers&&typeof input.headers==='object'&&!Array.isArray(input.headers))config.headers=input.headers;
 }
 const ready=authMethod==='api-key'&&typeof config.apiKey==='string'&&config.apiKey.trim().length>=8&&validConnectionCredentials(config);
 return {config,ready,privateConfig:{...config,_credentialTarget:target,_credentialMethod:authMethod},publicConfig:publicConnectionConfig(config,ready)};
}
export function validateConnectionConfig(data:any,old:any={}) {
 const config=publicConnectionConfig(data.config);
 const current={...data,config};const auth=connectionAuth(current,old.id?old:undefined);
 data.config=auth.publicConfig;
 // Capabilities and evidence are always server-owned, even when status is unchanged.
 for(const key of ['capabilities','identity','lastTestAt','message','evidence']){delete data[key];if(old[key]!==undefined)data[key]=old[key];}
 const changed=old.id&&(!sameTarget(credentialTarget(old),credentialTarget(data))||String(old.config?.authMethod||'')!==String(config.authMethod||''));
 if(changed){data.status='setup_required';data.capabilities=[];delete data.identity;delete data.lastTestAt;delete data.evidence;data.message='连接配置已变更，请重新检测';}
 return data;
}
export function putConnection(data:any,old?:any,privateConfig?:any) {
 db.exec('SAVEPOINT connection_configuration');
 try {
  if(privateConfig)db.prepare('INSERT INTO connection_private(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id,JSON.stringify(privateConfig));
  else if(old?.id){const stored=privateConnectionConfig(old.id);if(Object.keys(stored).length&&(!stored._credentialTarget||!stored._credentialMethod))db.prepare('UPDATE connection_private SET data=? WHERE id=?').run(JSON.stringify({...stored,_credentialTarget:stored._credentialTarget||credentialTarget(old),_credentialMethod:stored._credentialMethod||stored.authMethod||old.config?.authMethod||(stored.apiKey?'api-key':stored.headers?'headers':'none')}),old.id);}
  const saved=put('connections',publicValue(data));db.exec('RELEASE connection_configuration');return saved;
 }catch(error){db.exec('ROLLBACK TO connection_configuration; RELEASE connection_configuration');throw error;}
}
