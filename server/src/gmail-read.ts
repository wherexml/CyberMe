import {ApiError} from './integrations';
import {activity,get,hash,now,put} from './store';
import {clearGoogleTokens,gmailReadGranted,googleAccessToken} from './google-oauth';

// Gmail read adapter. OAuth proves an account; localRead is the separate, default-off
// permission. Search and message reads run only from a direct Chat turn and have no HTTP route.
const ID='gmail-oauth',API='https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_RESPONSE=2_000_000,MAX_BODY=20_000,MAX_RUN_READS=8,MAX_LIMIT=10;
const unavailable=()=>new ApiError(502,'gmail_unavailable','Gmail 暂时无法访问，请稍后重试');
const invalid=()=>new ApiError(502,'gmail_invalid_response','Gmail 返回了无效响应');
const revoked=()=>new ApiError(401,'google_authorization_revoked','Google 授权已失效，请重新连接');
const changed=()=>new ApiError(409,'connection_changed','Gmail 连接已变更，本次结果已丢弃');

type Session={base:any;token:string;assert:()=>void};

export function setGmailReadGrant(input:any){
 if(Object.keys(input).some(k=>!['read','baseUpdatedAt'].includes(k))||typeof input.read!=='boolean'||typeof input.baseUpdatedAt!=='string')throw new ApiError(400,'invalid_grant_input','需要 read 与 baseUpdatedAt');
 const row=get('connections',ID);
 if(!row)throw new ApiError(409,'gmail_disconnected','请先通过 Google 授权');
 if(row.updatedAt!==input.baseUpdatedAt)throw new ApiError(409,'connection_changed','连接已变更，请刷新后重试',{updatedAt:row.updatedAt});
 if(input.read&&(row.status!=='connected'||typeof row.config?.account!=='string'))throw new ApiError(409,'gmail_disconnected','请先通过 Google 授权');
 const {localRead,...rest}=row;
 const saved=put('connections',input.read?{...rest,localRead:{enabled:true,account:row.config.account,grantedAt:now()}}:rest);
 activity(input.read?'允许对话查信：Gmail':'关闭对话查信：Gmail','connection','succeeded',undefined,ID);
 return {read:gmailReadGranted(saved),account:saved.config?.account,updatedAt:saved.updatedAt,connection:saved};
}

function markReconnect(base:any){
 const row=get('connections',ID);
 if(row?.status!=='connected'||row.updatedAt!==base.updatedAt)return;
 const {localRead,...rest}=row;
 put('connections',{...rest,status:'reauth',capabilities:[],message:'Google 授权已失效，请重新连接'});
 try{clearGoogleTokens();}catch{}
 activity('Gmail 需要重新连接','connection','failed',undefined,ID);
}
async function accessToken(base:any,force=false){
 try{return await googleAccessToken(base,force);}
 catch(e){
  if(!(e instanceof ApiError))throw unavailable();
  if(['google_authorization_revoked','google_refresh_missing'].includes(e.code))markReconnect(base);
  throw e;
 }
}
async function send(token:string,path:string){
 try{return await fetch(API+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error'});}
 catch{throw unavailable();}
}
async function boundedJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw invalid();
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>MAX_RESPONSE){await reader.cancel().catch(()=>{});throw new ApiError(502,'gmail_response_too_large','Gmail 响应超过读取上限');}
   chunks.push(value);
  }
 }catch(e){throw e instanceof ApiError?e:unavailable();}
 let value:any;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
 return value;
}
function httpError(status:number){
 if(status===404)return new ApiError(404,'gmail_message_not_found','没有找到这封邮件');
 if(status===403)return new ApiError(403,'gmail_forbidden','Gmail 拒绝了读取请求');
 if(status===429)return new ApiError(429,'gmail_rate_limited','Gmail 请求过于频繁，请稍后重试');
 return unavailable();
}
// Every network wait is followed by a fresh connection check, so a disconnect or
// re-authorization cannot let an in-flight response reach the caller.
async function gmailGet(session:Session,path:string){
 session.assert();
 let response=await send(session.token,path);session.assert();
 if(response.status===401){
  await response.body?.cancel().catch(()=>{});
  session.token=await accessToken(session.base,true);session.assert();
  response=await send(session.token,path);session.assert();
  if(response.status===401){await response.body?.cancel().catch(()=>{});markReconnect(session.base);throw revoked();}
 }
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw httpError(response.status);}
 const value=await boundedJson(response);session.assert();return value;
}

export async function checkGoogle(){
 const base=get('connections',ID);
 if(base?.status!=='connected')throw new ApiError(409,'gmail_disconnected','请先通过 Google 授权');
 const assert=()=>{const row=get('connections',ID);if(row?.status!=='connected'||row.updatedAt!==base.updatedAt)throw changed();};
 const profile=await gmailGet({base,assert,token:await accessToken(base)},'/profile');
 if(typeof profile.emailAddress!=='string')throw invalid();
 if(profile.emailAddress!==base.config?.account){markReconnect(base);throw new ApiError(409,'gmail_account_mismatch','Gmail 账户与授权记录不一致，请重新连接');}
 return {ok:true,account:profile.emailAddress,message:'Gmail 账户读取验证成功'};
}

// A sentence must open with the action (after a polite lead-in); a mention, statement or question is not a request.
const MAIL='(?:gmail|google\\s*mail|谷歌邮箱|邮件|邮箱|信件|e-?mails?|mailbox)',BOX='(?:我的\\s*)?(?:gmail|google\\s*mail|谷歌邮箱|邮箱)',ACT='(?:查|搜|找|读|看看|看一下|看下|(?:search|find|look\\s*up|read|check|show|list|fetch|retrieve)\\b)',POLITE='请你?|麻烦你?|帮我|帮忙|替我|给我|please|kindly|help\\s+me',ASK='(?:can|could|would|will)\\s+you|(?:能否|能不能|能|可以|可否)\\s*(?:帮我|帮忙|替我|给我)';
const SHAPE=`(?:${ACT}.*${MAIL}|(?:(?:在|从|去|到|用)\\s*${BOX}\\s*(?:里面|里|中|上)?|${BOX}\\s*(?:里面|里|中|上))\\s*(?:帮我\\s*)?${ACT})`;
const REQUESTED=new RegExp(`^\\s*(?:(?:${POLITE})\\s*)*${SHAPE}`,'i'),ASKED=new RegExp(`^\\s*(?:(?:${POLITE}|${ASK})\\s*)*${SHAPE}`,'i');
// A clear read names mail as its object, so words like OAuth or login are subject matter, not settings.
const MAIL_OBJECT=/邮件|信件|\be-?mails?\b|\bmails?\b|\bmessages?\b|\b(?:search|find|look\s*up)\b.*\b(?:gmail|google\s*mail|mailbox)\s+for\s+\S/i;
const MAIL_SETTING=/(?:邮件|信件|e-?mails?|\bmails?|messages?)\s*(?:的\s*)?(?:授权|权限|配置|设置|连接|连通|状态|登录|账号|账户|地址|scopes?\b|permission|authori[sz]|auth\b|settings?\b|set\s*up|config|connect|status\b|log\s*in|sign[\s-]?in|accounts?\b|address)/i;
const NOT_DIRECT=new RegExp(`${ACT}\\s*(?:一下\\s*)?(?:me\\s+)?(?:how\\b|why\\b|whether\\b|if\\b|是否|怎么|如何|怎样|为什么)`,'i');
const clearMailRead=(sentence:string)=>ASKED.test(sentence)&&MAIL_OBJECT.test(sentence)&&!MAIL_SETTING.test(sentence)&&!NOT_DIRECT.test(sentence);
const NOT_READ=/[?？]|吗|是否|怎么|如何|怎样|为什么|\bhow\b|\bwhy\b|oauth|授权|权限|配置|设置|连接|连上|连通|断开|重连|登录|状态|功能|结果|坏|故障|报错|auth(?:ori[sz]|enticat)|\bscopes?\b|permission|set\s*up|configur|connect|log\s*in|sign[\s-]?in|\btokens?\b|credential|凭据|密钥|broken|\bbug\b/i;
const mailReadRequested=(direct:string)=>direct.split(/[。.!！；;\n]+/).some(sentence=>clearMailRead(sentence)||(REQUESTED.test(sentence)&&!NOT_READ.test(sentence)));
const runReads=new Map<string,number>();
function requireChatRead(runId:string,direct:string){
 const run=get('runs',runId);
 if(run?.kind!=='chat'||run.status!=='running')throw new ApiError(403,'gmail_direct_chat_only','Gmail 只能在直接对话中按请求读取');
 if(!mailReadRequested(direct))throw new ApiError(403,'gmail_not_requested','当前请求没有明确要求查看 Gmail');
}
function readable(){
 const row=get('connections',ID);
 if(row?.status!=='connected')throw new ApiError(403,'gmail_disconnected','Gmail 未连接');
 if(!gmailReadGranted(row))throw new ApiError(403,'gmail_read_not_granted','尚未在设置中允许对话查信');
 return row;
}
function countRead(runId:string){
 const used=(runReads.get(runId)||0)+1;
 if(used>MAX_RUN_READS)throw new ApiError(429,'gmail_read_scope_limit','本轮 Gmail 读取次数已到上限，请缩小范围');
 runReads.set(runId,used);
 if(runReads.size>256)runReads.delete(runReads.keys().next().value as string);
}
async function readSession(runId:string,direct:string):Promise<Session>{
 requireChatRead(runId,direct);
 const base=readable();
 countRead(runId);
 const assert=()=>{if(readable().updatedAt!==base.updatedAt)throw changed();};
 return {base,assert,token:await accessToken(base)};
}

const header=(message:any,name:string)=>{const rows=Array.isArray(message.payload?.headers)?message.payload.headers:[];return String(rows.find((h:any)=>String(h?.name).toLowerCase()===name)?.value||'').slice(0,500);};
const summary=(message:any)=>({id:message.id,threadId:message.threadId,subject:header(message,'subject'),from:header(message,'from'),date:header(message,'date'),snippet:String(message.snippet||'').slice(0,300)});
const decode=(data:string)=>Buffer.from(data,'base64url').toString('utf8');
const stripHtml=(html:string)=>html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\n{3,}/g,'\n\n').trim();
function extract(payload:any){
 const plain:string[]=[],html:string[]=[],attachments:any[]=[];let seen=0;
 const walk=(part:any,depth:number)=>{
  if(!part||typeof part!=='object'||depth>12||++seen>200)return;
  const mime=String(part.mimeType||'').toLowerCase();
  if(part.filename||part.body?.attachmentId){if(attachments.length<20)attachments.push({filename:String(part.filename||'').slice(0,200),mimeType:mime.slice(0,100),size:Number(part.body?.size)||0});}
  else if(typeof part.body?.data==='string'&&mime==='text/plain')plain.push(decode(part.body.data));
  else if(typeof part.body?.data==='string'&&mime==='text/html')html.push(decode(part.body.data));
  if(Array.isArray(part.parts))for(const child of part.parts.slice(0,100))walk(child,depth+1);
 };
 walk(payload,0);
 return {body:plain.length?plain.join('\n\n'):stripHtml(html.join('\n\n')),attachments};
}
const untrusted={untrustedContent:true,instructionsHaveUserAuthority:false};

export async function gmailSearch(runId:string,direct:string,input:any){
 requireChatRead(runId,direct);
 const query=typeof input.query==='string'?input.query.trim():'';
 if(!query||query.length>500||/[\u0000-\u001f]/.test(query))throw new ApiError(400,'invalid_query','需要 1–500 字的查询条件');
 const limit=input.limit===undefined?5:input.limit;
 if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)throw new ApiError(400,'invalid_limit',`limit 需为 1–${MAX_LIMIT}`);
 const session=await readSession(runId,direct);
 const list=await gmailGet(session,'/messages?'+new URLSearchParams({q:query,maxResults:String(limit)}));
 const items:any[]=[];
 for(const row of Array.isArray(list.messages)?list.messages.slice(0,limit):[]){
  if(typeof row?.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(row.id))throw invalid();
  const message=await gmailGet(session,`/messages/${row.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
  if(message.id!==row.id)throw invalid();
  items.push(summary(message));
 }
 return {account:session.base.config.account,items,hasMore:typeof list.nextPageToken==='string',proof:'actual_gmail_api',...untrusted};
}

export async function gmailMessage(runId:string,direct:string,input:any){
 requireChatRead(runId,direct);
 const messageId=input.messageId;
 if(typeof messageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(messageId))throw new ApiError(400,'invalid_message_id','需要精确的邮件 ID');
 const session=await readSession(runId,direct);
 const message=await gmailGet(session,`/messages/${messageId}?format=full`);
 if(message.id!==messageId)throw invalid();
 const {body,attachments}=extract(message.payload);
 return {account:session.base.config.account,message:{...summary(message),to:header(message,'to'),cc:header(message,'cc'),body:body.slice(0,MAX_BODY),bodyTruncated:body.length>MAX_BODY,attachments},proof:'actual_gmail_api',...untrusted};
}

export const isGmailRead=(name:string,params:any)=>name==='app_read'&&/^gmail_/.test(String(params?.action||''));
// Receipts keep call and outcome only; query and mail content stay out of durable records.
export function gmailToolAudit(params:any,result?:any,errorCode?:string){
 return {input:{action:params?.action,scopeHash:hash(params?.input??{}),privacy:'gmail_query_omitted'},output:{privacy:'gmail_body_omitted',count:Array.isArray(result?.items)?result.items.length:result?.message?1:0,hasMore:result?.hasMore===true,bodyTruncated:result?.message?.bodyTruncated===true,...(errorCode||result?.code?{code:errorCode||result.code}:{})}};
}
