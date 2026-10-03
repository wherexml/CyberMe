// Public protocol headers carry no authentication; every other configured
// header is private. Shared by transport validation and startup recovery.
const publicHeaders=new Set(['accept','accept-language','content-type','user-agent','cache-control']);
export const isPrivateCredentialHeader=(name:string)=>!publicHeaders.has(name.toLowerCase());
export function connectionCredentialValues(config:any):unknown[] {
 return [config.apiKey,...Object.entries(config.headers||{}).filter(([name])=>isPrivateCredentialHeader(name)).map(([,value])=>value)];
}
export function hasCredentialHeaders(config:any) {
 return Object.keys(config.headers||{}).some(isPrivateCredentialHeader);
}
export function validConnectionCredentials(config:any) {
 if(typeof config.apiKey==='string'&&config.apiKey.trim().length<8)return false;
 return Object.entries(config.headers||{}).every(([name,value])=>typeof value==='string'&&(!isPrivateCredentialHeader(name)||value.trim().replace(/^Bearer\s+/i,'').length>=8));
}
