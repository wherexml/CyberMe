import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,sep,basename} from 'node:path';
import sharp from 'sharp';
import {ApiError,command} from './integrations';
import {get,list,put,activity,now,meta,setMeta} from './store';
import {attachmentKind,exactAttachmentEnabled,inspectWechatAttachment,materializeWechatAttachment,verifyWechatAttachmentCli,type WechatAttachmentKind} from './wechat-attachment-cli';
import {wechatRuntimeSelection} from './wechat-runtime-selector';
const ID='wechat-sync-local';
const seenConversations=new Map<string,{version:string,sourceHash:string,at:number}>();
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)??'').digest('hex');
async function query(args:string[],stdin?:string){
  verifyWechatAttachmentCli();
  let result;
  try{result=await command(wechatRuntimeSelection().binary,args,20000,stdin);}catch{throw new ApiError(503,'wechat_cli_unavailable','无法启动 wechat-sync，请确认本机 GreenBubbles 已安装。');}
  verifyWechatAttachmentCli();
  if(result.timedOut)throw new ApiError(504,'wechat_timeout','微信读取超时，请稍后重试。');
  let value;try{value=JSON.parse(result.stdout);}catch{throw new ApiError(502,'wechat_invalid_response','微信同步返回格式异常，请检查 GreenBubbles。');}
  if(result.exitCode!==0||value?.ok!==true)throw new ApiError(503,'wechat_source_unavailable','本机微信数据暂不可读，请在 GreenBubbles 确认连接后重试。');
  if(value.schema!=='greenbubbles.query.v1')throw new ApiError(502,'wechat_invalid_response','GreenBubbles 协议不兼容。');
  return value;
}
export async function connectWechat(){
  wechatRuntimeSelection();
  const old=get('connections',ID);let status='error',message='',evidence:any={readOnly:true},sample:any;
  try{
    const source=await query(['source','status']);
    if(!(source.databaseCount>0))throw new ApiError(503,'wechat_source_empty','尚未发现可读取的微信数据库。');
    sample=await query(['chats','--limit','1']);rows(sample);
    status='connected';message='已连接本机个人微信（wechat-sync），仅支持读取。';
    evidence={readOnly:true,databaseCount:source.databaseCount,coverageComplete:sample.consistency?.coverageComplete===true,verifiedAt:now()};
  }catch(error){message=error instanceof ApiError?error.message:'微信连接检测失败，请重试。';}
  if(get('connections',ID)?.updatedAt!==old?.updatedAt)throw new ApiError(409,'connection_changed','连接状态已变更，请刷新后重试。');
  const connection=put('connections',{...old,id:ID,name:'微信',provider:'wechat',type:'CLI',status,permissions:['read'],capabilities:status==='connected'?['wechat.chats.read','wechat.contacts.read','wechat.messages.read','wechat.messages.search','wechat.message.read']:[],config:{adapter:'wechat-sync',readOnly:true},message,evidence,lastTestAt:now()});
  if(sample&&status==='connected')setMeta('wechatLastReadAt',now());
  clearWechatReader();if(sample&&status==='connected')rememberConversations(rows(sample),sample,connection.updatedAt);
  for(const duplicate of list('connections').filter(c=>c.id!==ID&&/^(wechat|wechat-sync)$/i.test(c.provider||'')))put('connections',{...duplicate,status:'disconnected',supersededBy:ID});
  activity('连接个人微信','connection',status==='connected'?'succeeded':'failed',message,ID);
  return {ok:status==='connected',connection,message,capabilities:connection.capabilities};
}
function requireConnection(){wechatRuntimeSelection();const c=get('connections',ID);if(c?.status!=='connected'||!c.permissions?.includes('read')){clearWechatReader();throw new ApiError(409,'wechat_not_connected','请先连接本机微信。');}return c;}
function rememberConversations(items:any[],value:any,version=requireConnection().updatedAt){if(!value.source?.identity)return;if([...seenConversations.values()].some(v=>v.version!==version||v.sourceHash!==digest(value.source.identity)))clearWechatReader();for(const item of items)if(typeof item.id==='string')seenConversations.set(item.id,{version,sourceHash:digest(value.source.identity),at:Date.now()});for(const [id,v] of seenConversations)if(Date.now()-v.at>3600000)seenConversations.delete(id);while(seenConversations.size>1000){const oldest=seenConversations.keys().next().value;if(!oldest)break;seenConversations.delete(oldest);}}
function verifiedConversation(input:unknown){requireConnection();const id=exactId(input,'conversation');const selected=seenConversations.get(id);if(!selected||selected.version!==requireConnection().updatedAt||Date.now()-selected.at>3600000)throw new ApiError(409,'wechat_conversation_unverified','请刷新联系人或会话列表，并选择精确会话标识。');return id;}
function assertConversationSource(id:string,value:any){if(seenConversations.get(id)?.sourceHash!==digest(value.source?.identity)){clearWechatReader();throw new ApiError(409,'wechat_source_changed','本机微信来源已变化，请刷新并重新选择会话。');}}
function cursorArgs(cursor?:string){if(!cursor)return [];if(typeof cursor!=='string'||cursor.length>8192||/[\x00-\x1f]/.test(cursor))throw new ApiError(400,'invalid_cursor','分页参数无效，请刷新会话。');return ['--cursor',cursor];}
function boundedLimit(value:unknown,fallback:number,max:number){if(value===undefined)return fallback;const n=Number(value);if(!Number.isInteger(n)||n<1||n>max)throw new ApiError(400,'invalid_limit','读取数量超出范围。');return n;}
function exactId(value:unknown,kind:string){if(typeof value!=='string'||!value||value.length>4096||/[\x00-\x20]/.test(value)||value.startsWith('-'))throw new ApiError(400,`invalid_${kind}`,'请从读取结果选择精确标识。');return value;}
function privateQuery(value:unknown,required=false){if(value===undefined&&!required)return '';if(typeof value!=='string'||(required&&!value.trim())||Buffer.byteLength(value)>16384||value.includes('\0'))throw new ApiError(400,'invalid_query','搜索内容不能为空且最多 16 KiB。');return value;}
function rows(value:any){if(!Array.isArray(value.items))throw new ApiError(502,'wechat_invalid_response','GreenBubbles 列表格式异常。');return value.items;}
function pageInfo(value:any){return {hasMore:value.page?.hasMore===true,nextCursor:typeof value.page?.nextCursor==='string'?value.page.nextCursor:undefined,page:value.page,consistency:value.consistency,coverageComplete:value.consistency?.coverageComplete===true,hasWarnings:Array.isArray(value.warnings)&&value.warnings.length>0,warnings:Array.isArray(value.warnings)?value.warnings:[],sourceHash:digest(value.source?.identity??null),untrustedSource:true,readOnly:true};}
async function read(args:string[],stdin?:string){const before=requireConnection();const value=await query(args,stdin);if(requireConnection().updatedAt!==before.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请重新读取。');setMeta('wechatLastReadAt',now());return value;}
export function wechatReadStatus(){const c=get('connections',ID);return {connected:c?.status==='connected',lastReadAt:meta('wechatLastReadAt',null)||c?.evidence?.verifiedAt||null,mode:'local-read-only'};}
// A contact name is never sufficient proof of account ownership.
async function boundOwner(source:any){try{const value=await read(['contacts','list','--kind','account-holder','--limit','1','--details']);const items=rows(value);if(!source?.identity||!value.source?.identity||digest(value.source?.identity)!==digest(source?.identity)||items.length!==1||items[0].isAccountHolder!==true||typeof items[0].id!=='string')return undefined;return items[0].id;}catch{return undefined;}}
function message(m:any,owner?:string){
  const text=typeof m.content?.Text==='string'?m.content.Text:m.content&&typeof m.content==='object'?JSON.stringify(m.content):undefined;
  const max=262144;const originalLength=text?.length??0;const adapterTruncated=originalLength>max;
  return {id:m.id,conversationId:m.conversationId,senderId:m.sender,sender:m.senderDisplayName||m.sender||'微信联系人',at:m.createdAtUnix,text:text===undefined?`[${m.messageTypeLabel||'非文本消息'}]`:text.slice(0,max),messageType:m.messageType,messageTypeLabel:m.messageTypeLabel,messageSubtype:m.messageSubtype,contentDecodeState:m.contentDecodeState,contentTruncated:m.contentTruncated===true||adapterTruncated,cliContentTruncated:m.contentTruncated===true,adapterTruncated,originalLength,self:owner&&typeof m.sender==='string'?m.sender===owner:null,directionEvidence:owner?'cli-account-holder-id':'unknown',untrustedSource:true};
}
export async function wechatChats(cursor?:string,limit?:unknown){const value=await read(['chats','--limit',String(boundedLimit(limit,20,100)),...cursorArgs(cursor)]);rememberConversations(rows(value),value);return {...pageInfo(value),items:rows(value).map((c:any)=>({id:c.id,name:c.displayName||c.id,lastAt:c.sortTimestamp,summaryTruncated:c.summaryTruncated===true}))};}
export async function wechatMessages(conversation:string,cursor?:string,limit?:unknown){
  const id=verifiedConversation(conversation);const before=requireConnection();const value=await read(['messages','list','--conversation',id,'--limit',String(boundedLimit(limit,50,100)),'--json',...cursorArgs(cursor)]);assertConversationSource(id,value);const owner=await boundOwner(value.source);if(requireConnection().updatedAt!==before.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请重新读取。');
  return {...pageInfo(value),accountHolderKnown:!!owner,items:rows(value).map((m:any)=>message(m,owner))};
}
// Explicit archive lookup advances bounded contact pages; ordinary calls keep page semantics.
const contactCursors=new Map<string,{scope:string,at:number,version:string,sourceHash:string,coverageComplete:boolean,warnings:any[]}>();
export async function wechatContacts(input:any={}){
  const connection=requireConnection();const q=privateQuery(input.query);const limit=boundedLimit(input.limit,50,100);
  if(input.searchAll!==undefined&&typeof input.searchAll!=='boolean')throw new ApiError(400,'invalid_search_scope','搜索范围无效。');
  const searchAll=input.searchAll===true&&!!q;const scope=digest({q,limit,searchAll});
  const saved=input.cursor?contactCursors.get(input.cursor):undefined;
  if(input.cursor&&(!saved||saved.scope!==scope||saved.version!==connection.updatedAt||Date.now()-saved.at>3600000))throw new ApiError(400,'invalid_cursor','查找条件已改变或过期，请从第一页开始。');
  let cursor=input.cursor,sourceHash=saved?.sourceHash,scanned=0,pagesScanned=0,value:any,filtered:any[]=[];
  let coverageComplete=searchAll?(saved?.coverageComplete??true):true;const warnings:any[]=searchAll?[...(saved?.warnings||[])]:[];
  const started=Date.now(),seen=new Set<string>();
  do{
    if(cursor){cursorArgs(cursor);if(seen.has(cursor))throw new ApiError(502,'wechat_cursor_repeated','联系人分页未前进，请重新搜索。');seen.add(cursor);}
    value=await read(['contacts','list','--limit',String(limit),'--details',...cursorArgs(cursor)]);
    if(requireConnection().updatedAt!==connection.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请重新读取。');
    const currentHash=digest(value.source?.identity);
    if(!value.source?.identity||(sourceHash&&sourceHash!==currentHash)){clearWechatReader();throw new ApiError(409,'wechat_source_changed','本机微信来源已变化，请重新搜索。');}
    sourceHash=currentHash;coverageComplete=coverageComplete&&pageInfo(value).coverageComplete;
    for(const warning of pageInfo(value).warnings)if(warnings.length<64&&!warnings.some(w=>digest(w)===digest(warning)))warnings.push(warning);
    const sourceRows=rows(value);scanned+=sourceRows.length;pagesScanned++;
    rememberConversations(sourceRows,value,connection.updatedAt);
    filtered=sourceRows.filter((c:any)=>!q||[c.id,c.displayName,c.nickname,c.nickName,c.remark,c.alias].some(v=>typeof v==='string'&&v.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
    cursor=pageInfo(value).nextCursor;
    // A positive match is useful immediately. More pages remain explicitly available.
  }while(searchAll&&!filtered.length&&value.page?.hasMore===true&&cursor&&pagesScanned<20&&Date.now()-started<8000);
  const info={...pageInfo(value),coverageComplete,hasWarnings:warnings.length>0,warnings};
  if(info.hasMore&&!info.nextCursor)throw new ApiError(502,'wechat_cursor_missing','联系人分页缺少后续标识，请重新搜索。');
  if(info.nextCursor){if(seen.has(info.nextCursor))throw new ApiError(502,'wechat_cursor_repeated','联系人分页未前进，请重新搜索。');if(contactCursors.size>1000)contactCursors.clear();contactCursors.set(info.nextCursor,{scope,at:Date.now(),version:connection.updatedAt,sourceHash:sourceHash!,coverageComplete,warnings});}
  return {...info,filterScope:searchAll?'bounded-archive-contact-search':'bounded-contact-page',scanned,pagesScanned,searchPending:searchAll&&info.hasMore,queryComplete:!info.hasMore&&info.coverageComplete,ambiguous:filtered.length>1,items:filtered.map((c:any)=>({id:c.id,name:c.displayName||c.remark||c.nickname||c.nickName||c.id,kind:c.kind,alias:c.alias,remark:c.remark}))};
}
export async function wechatSearch(input:any){
  const conversation=verifiedConversation(input?.conversation);const q=privateQuery(input?.query,true);const args=['messages','search','--query-stdin','--conversation',conversation,'--limit',String(boundedLimit(input.limit,50,100)),'--json',...cursorArgs(input.cursor)];for(const k of ['since','until'])if(input[k]!==undefined){if(!Number.isSafeInteger(input[k])||input[k]<0)throw new ApiError(400,'invalid_time','时间范围无效。');args.push(`--${k}`,String(input[k]));}if(input.since!==undefined&&input.until!==undefined&&input.since>input.until)throw new ApiError(400,'invalid_time','时间范围无效。');
  const before=requireConnection();const value=await read(args,q);assertConversationSource(conversation,value);const owner=await boundOwner(value.source);if(requireConnection().updatedAt!==before.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请重新读取。');return {...pageInfo(value),accountHolderKnown:!!owner,items:rows(value).map((m:any)=>message(m,owner))};
}
export async function wechatMessage(input:any){
  const conversation=verifiedConversation(input?.conversation);const id=exactId(input?.message,'message');const before=requireConnection();const value=await read(['message','get','--conversation',conversation,'--message',id]);assertConversationSource(conversation,value);if(!value.item||value.item.id!==id||value.item.conversationId!==conversation)throw new ApiError(502,'wechat_message_mismatch','精确消息引用不一致，请重新读取。');const owner=await boundOwner(value.source);if(requireConnection().updatedAt!==before.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请重新读取。');return {...pageInfo(value),accountHolderKnown:!!owner,item:message(value.item,owner)};
}
export function wechatCapabilities(){requireConnection();const exact=verifyWechatAttachmentCli();return {readOnly:true,chats:true,contacts:true,contactLookup:'bounded-page-filter',contactArchiveLookup:'explicit-bounded-scan',messageSearch:'conversation-only-stdin',messageGet:true,direction:'cli-account-holder-id-or-unknown',textLimitCharacters:262144,attachments:{mode:exact?'verified-exact-cli':'installed-image-fallback',images:exact?'exact-message-inspect-materialize':'exact-message-single-row-cli-cache',voice:exact?'exact-message-inspect-materialize':'unsupported-ordinary-inspect',video:exact?'exact-message-inspect-materialize':'unsupported-ordinary-inspect',document:exact?'exact-message-inspect-materialize':'unsupported-ordinary-inspect',maxBytes:25000000,ambiguousTimestamp:'rejected',businessMediaVerified:false},send:false,archiveExport:false};}
// Search/body never enters persisted tool evidence, including failed requests.
export function wechatToolAudit(params:any,result?:any,errorCode?:string){return {input:{action:params?.action,scopeHash:digest(params?.input??{}),privacy:'wechat_query_omitted'},output:{privacy:'wechat_body_omitted',count:Array.isArray(result?.items)?result.items.length:result?.item?1:0,hasMore:result?.hasMore===true,coverageComplete:result?.coverageComplete===true,warningCount:Array.isArray(result?.warnings)?result.warnings.length:0,...(errorCode?{code:errorCode}:{})}};}

const mediaCache=new Map<string,{data:Buffer,conversation:string,message:string,version:string,connectionVersion:string,sha256:string,mime:string,bytes:number,at:number,kind?:WechatAttachmentKind,format?:string,candidate?:string,epoch?:number}>();
let readerEpoch=0,attachmentBusy=false;
export function clearWechatReader(){readerEpoch++;seenConversations.clear();contactCursors.clear();for(const item of mediaCache.values())item.data.fill(0);mediaCache.clear();}
const attachmentError=(code:string)=>new ApiError(409,code,'附件无法唯一验证，请在 GreenBubbles 查看原消息。');
function rawVersion(value:any){return digest({source:value.source?.identity,item:value.item});}
async function rawExact(conversation:string,id:string){const value=await read(['message','get','--conversation',conversation,'--message',id]);assertConversationSource(conversation,value);if(value.item?.id!==id||value.item?.conversationId!==conversation)throw attachmentError('wechat_message_mismatch');return value;}
// The ordinary CLI materializes its own image cache. We never read its credentials.
async function legacyWechatAttachment(input:any){
 const conversation=verifiedConversation(input?.conversation),id=exactId(input?.message,'message');const before=requireConnection();const exact=await rawExact(conversation,id),m=exact.item;const md5=m.content?.Image?.md5;
 if(typeof md5!=='string'||!/^([a-fA-F0-9]{32})$/.test(md5))throw new ApiError(501,'wechat_attachment_kind_unsupported','当前默认来源仅能安全读取 CLI 精确图片缓存；语音、视频和文件需 CLI 默认来源 inspect 支持。');
 if(!Number.isSafeInteger(m.createdAtUnix))throw attachmentError('wechat_attachment_ambiguous');
 const args=['messages','list','--conversation',conversation,'--since',String(m.createdAtUnix),'--until',String(m.createdAtUnix),'--limit','2'];
 const range=await read([...args,'--json']);if(digest(range.source?.identity)!==digest(exact.source?.identity)||range.consistency?.coverageComplete!==true||range.page?.hasMore===true||rows(range).length!==1||range.items[0].id!==id||digest(range.items[0])!==digest(m))throw attachmentError('wechat_attachment_ambiguous');
 let result;try{result=await command(wechatRuntimeSelection().binary,[...args,'--brief'],20000);}catch{throw attachmentError('wechat_attachment_unavailable');}if(result.timedOut||result.exitCode!==0)throw attachmentError('wechat_attachment_unavailable');
 let lines:any[];try{lines=result.stdout.split('\n').filter(Boolean).map(l=>JSON.parse(l));}catch{throw attachmentError('wechat_invalid_response');}
 const briefRows=lines.filter(v=>typeof v.from==='string');if(lines[0]?.hasMore!==false||lines[0]?.returned!==1||briefRows.length!==1||typeof briefRows[0].file!=='string')throw attachmentError('wechat_attachment_ambiguous');
 const expected=resolve(homedir(),'.greenbubbles/cache/media');let cacheRoot:string,path:string,bytes:Buffer;
 try{cacheRoot=realpathSync(expected);path=resolve(briefRows[0].file);if(cacheRoot!==expected||realpathSync(path)!==path||!path.startsWith(cacheRoot+sep)||!basename(path).toLowerCase().includes(md5.toLowerCase()))throw Error();const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>25000000||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw Error();bytes=readFileSync(path);if(bytes.length!==stat.size)throw Error();}catch{throw attachmentError('wechat_attachment_cache_boundary');}
 let metadata;try{metadata=await sharp(bytes,{limitInputPixels:16000000}).metadata();}catch{throw attachmentError('wechat_attachment_invalid_bytes');}if(!['png','jpeg','webp'].includes(metadata.format||''))throw attachmentError('wechat_attachment_invalid_bytes');
 const current=await rawExact(conversation,id);if(rawVersion(current)!==rawVersion(exact)||requireConnection().updatedAt!==before.updatedAt)throw attachmentError('connection_changed');
 const token=randomUUID(),sha256=createHash('sha256').update(bytes).digest('hex'),mime='image/'+metadata.format;
 for(const [key,c] of mediaCache)if(Date.now()-c.at>600000)mediaCache.delete(key);
 while(mediaCache.size>=16||[...mediaCache.values()].reduce((n,c)=>n+c.bytes,0)+bytes.length>64*1024*1024){const oldest=mediaCache.keys().next().value;if(!oldest)break;mediaCache.delete(oldest);}
 mediaCache.set(token,{data:bytes,conversation,message:id,version:rawVersion(exact),connectionVersion:before.updatedAt,sha256,mime,bytes:bytes.length,at:Date.now()});
 setTimeout(()=>mediaCache.delete(token),600000).unref();
 return {attachmentId:token,url:'/api/wechat/attachments/'+token,mime,bytes:bytes.length,sha256,width:metadata.width,height:metadata.height,kind:'image',format:metadata.format,formatValidation:'image-metadata',binding:'exact-opaque-message-single-timestamp-cli-cache-md5-name',decodedImage:true,readOnly:true,storage:'bounded-memory',expiresInSeconds:600,expiresAt:new Date(Date.now()+600000).toISOString()};
}
// One materialization/selection validation at a time; unrelated reads remain available.
export async function wechatAttachment(input:any){
 if(attachmentBusy)throw new ApiError(409,'wechat_attachment_busy','正在验证微信附件，请稍后重试。');
 attachmentBusy=true;
 try{return exactAttachmentEnabled()?await exactWechatAttachment(input):await legacyWechatAttachment(input);}finally{attachmentBusy=false;}
}
function cacheMedia(token:string,item:Parameters<typeof mediaCache.set>[1]){
 for(const [key,c] of mediaCache)if(Date.now()-c.at>600000){c.data.fill(0);mediaCache.delete(key);}
 while(mediaCache.size>=16||[...mediaCache.values()].reduce((n,c)=>n+c.bytes,0)+item.bytes>64*1024*1024){const key=mediaCache.keys().next().value;if(!key)break;mediaCache.get(key)?.data.fill(0);mediaCache.delete(key);}
 mediaCache.set(token,item);setTimeout(()=>{mediaCache.get(token)?.data.fill(0);mediaCache.delete(token);},600000).unref();
}
function attachmentOwnerGuard(conversation:string,connectionVersion:string,epoch:number){
 const sourceHash=seenConversations.get(conversation)?.sourceHash;
 return ()=>{
  if(requireConnection().updatedAt!==connectionVersion||readerEpoch!==epoch)throw attachmentError('connection_changed');
  verifiedConversation(conversation);
  if(!sourceHash||seenConversations.get(conversation)?.sourceHash!==sourceHash)throw attachmentError('wechat_source_changed');
 };
}
async function exactWechatAttachment(input:any){
 verifyWechatAttachmentCli();
 const conversation=verifiedConversation(input?.conversation),id=exactId(input?.message,'message');
 const before=requireConnection(),epoch=readerEpoch,guard=attachmentOwnerGuard(conversation,before.updatedAt,epoch);
 guard();const exact=await rawExact(conversation,id);guard();
 const kind=attachmentKind(exact.item),selected=await inspectWechatAttachment(conversation,id,kind,guard);
 guard();
 // Inspect may have waited while the user revoked access or the message changed.
 // Rehydrate only while the original owner remains valid, before any new materialize.
 const beforeMaterialize=await rawExact(conversation,id);guard();
 if(rawVersion(beforeMaterialize)!==rawVersion(exact))throw attachmentError('wechat_attachment_changed');
 const materialized=await materializeWechatAttachment(conversation,id,kind,selected.candidate,guard);
 let published=false;
 try{
 guard();const selectedNow=await inspectWechatAttachment(conversation,id,kind,guard);guard();
 if(selectedNow.candidate!==selected.candidate)throw attachmentError('wechat_attachment_changed');
 const current=await rawExact(conversation,id);guard();
 if(rawVersion(current)!==rawVersion(exact)||requireConnection().updatedAt!==before.updatedAt||readerEpoch!==epoch)throw attachmentError('connection_changed');
 const token=randomUUID(),at=Date.now();
 cacheMedia(token,{data:materialized.bytes,conversation,message:id,version:rawVersion(exact),connectionVersion:before.updatedAt,sha256:materialized.sha256,mime:materialized.mime,bytes:materialized.bytes.length,at,kind,format:materialized.format,candidate:selected.candidate,epoch});
 published=true;
 return {attachmentId:token,url:'/api/wechat/attachments/'+token,mime:materialized.mime,bytes:materialized.bytes.length,sha256:materialized.sha256,kind,format:materialized.format,formatValidation:materialized.formatValidation,width:'width' in materialized?materialized.width:undefined,height:'height' in materialized?materialized.height:undefined,binding:'exact-opaque-message-verified-cli-candidate-content-digest',decodedImage:kind==='image',readOnly:true,storage:'bounded-memory',expiresInSeconds:600,expiresAt:new Date(at+600000).toISOString()};
 }finally{if(!published)materialized.bytes.fill(0);}
}
export async function wechatAttachmentContent(token:string){
 if(attachmentBusy)throw new ApiError(409,'wechat_attachment_busy','正在验证微信附件，请稍后重试。');
 attachmentBusy=true;
 try{
 requireConnection();const item=mediaCache.get(token);
 if(!item||Date.now()-item.at>600000)throw new ApiError(404,'wechat_attachment_expired','附件读取已过期，请重新读取原消息。');
 if(requireConnection().updatedAt!==item.connectionVersion)throw attachmentError('connection_changed');
 const ownerGuard=attachmentOwnerGuard(item.conversation,item.connectionVersion,readerEpoch);
 const guard=()=>{ownerGuard();if(mediaCache.get(token)!==item)throw attachmentError('connection_changed');};
 guard();const exact=await rawExact(item.conversation,item.message);guard();
 if(rawVersion(exact)!==item.version)throw attachmentError('wechat_attachment_changed');
 if(item.candidate&&item.kind){
  const current=await inspectWechatAttachment(item.conversation,item.message,item.kind,guard);guard();
  if(current.candidate!==item.candidate)throw attachmentError('wechat_attachment_changed');
  const after=await rawExact(item.conversation,item.message);guard();
  if(rawVersion(after)!==item.version||readerEpoch!==item.epoch)throw attachmentError('wechat_attachment_changed');
 }
 const bytes=item.data;
 if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw attachmentError('wechat_attachment_changed');
 if(requireConnection().updatedAt!==item.connectionVersion||mediaCache.get(token)!==item)throw attachmentError('connection_changed');
 return {bytes,mime:item.mime,sha256:item.sha256};
 }finally{attachmentBusy=false;}
}
