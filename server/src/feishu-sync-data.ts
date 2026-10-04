import {existsSync, mkdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {DATA, ROOT, db, get, put, list, hash, now, meta, setMeta} from './store';
import {ApiError, connectionPermission, feishuConnection, lark, requireSelf, command} from './integrations';
import {selectedChatScope, unresolvedScopes, matchesConnectionFilter} from './connection-scope';
import {extractMessageText} from './feishu-visible-text';
import {profileAvatar} from './message-presentation';
import {meetingNoteLinksFromMessage, parseMeetingNote, normalizeMeetingTranscript} from './feishu-meeting-note';

export type SyncScope='all'|'chats'|'minutes'|'mail';
export const syncScopes:SyncScope[]=['all','chats','minutes','mail'];
export function syncSettings(){
 const legacy=feishuConnection()?.config?.syncInterval;
 return {chatIntervalMinutes:({manual:0,'5m':5,'15m':15,'30m':30,hourly:60} as any)[legacy]??0,analysisDelayMinutes:5,meetingEnabled:false,meetingIntervalMinutes:60,sourceChatName:'智能纪要助手',mailEnabled:false,mailIntervalMinutes:60,chatLimit:100,messagesPerChat:50,minutesLimit:100,minutesMessageLimit:200,mailLimit:25,includeAttachments:!!feishuConnection()?.config?.includeAttachments,...meta<any>('feishuSyncSettings',{})};
}
export function saveSyncSettings(input:any){
 const rules:Record<string,number[]>={chatIntervalMinutes:[0,5,15,30,60],analysisDelayMinutes:[0,5,10,15,30]};
 const ranges:Record<string,number[]>={meetingIntervalMinutes:[1,1440],mailIntervalMinutes:[5,1440],chatLimit:[1,1000],messagesPerChat:[1,1000],minutesLimit:[1,500],minutesMessageLimit:[1,1000],mailLimit:[1,400]};
 const allowed=new Set([...Object.keys(rules),...Object.keys(ranges),'meetingEnabled','mailEnabled','sourceChatName','includeAttachments']);
 for(const [key,value] of Object.entries(input)){
  if(!allowed.has(key))throw new ApiError(400,'invalid_sync_setting',`未知同步设置：${key}`);
  if(rules[key]&&!rules[key].includes(value as number)||ranges[key]&&(!Number.isInteger(value)||Number(value)<ranges[key][0]||Number(value)>ranges[key][1]))throw new ApiError(400,'invalid_sync_setting',`同步设置无效：${key}`);
  if(['meetingEnabled','mailEnabled','includeAttachments'].includes(key)&&typeof value!=='boolean')throw new ApiError(400,'invalid_sync_setting',`${key} 必须是布尔值`);
  if(key==='sourceChatName'&&(typeof value!=='string'||!value.trim()||value.length>100))throw new ApiError(400,'invalid_sync_setting','请输入会议纪要助手名称');
 }
 const saved={...syncSettings(),...input,...(input.sourceChatName?{sourceChatName:input.sourceChatName.trim()}:{}),updatedAt:now()};setMeta('feishuSyncSettings',saved);
 const c=feishuConnection();if(c)put('connections',{...c,config:{...c.config,syncInterval:({0:'manual',5:'5m',15:'15m',30:'30m',60:'hourly'} as any)[saved.chatIntervalMinutes],includeAttachments:saved.includeAttachments}});
 return saved;
}
export function rows(e:any):any[]{const d=e?.data??e;return Array.isArray(d)?d:d?.items||d?.messages||d?.chats||d?.data?.items||[];}
function pagination(e:any){const d=e?.data??e;return {more:!!(d?.has_more??d?.hasMore??e?.meta?.pagination?.has_more??(e?.meta?.pagination?.complete===false)),token:d?.page_token||d?.pageToken||e?.meta?.pagination?.next_token};}
const check=()=>connectionPermission('read');
function safeError(e:any){if(e instanceof ApiError&&Number(e.detail?.code)===3380003)return {code:'source_deleted',message:'飞书源文档已被删除，已保留本次同步的其他结果',upstreamCode:3380003};if(e instanceof ApiError&&['meeting_source_lookup_truncated','meeting_source_not_found','meeting_source_ambiguous','meeting_source_invalid'].includes(e.code))return {code:e.code,message:e.message};return {code:e instanceof ApiError?e.code:'sync_read_failed',message:e instanceof ApiError&&e.status===403?'连接权限或范围已变更':'读取失败，请检查授权、资源权限或连接后重试'};}
function record(kind:string,id:string,payload:any){check();const key=kind+':'+id;const old=get('feishu_records',key),digest=hash(payload);if(old?.digest===digest)return false;put('feishu_records',{id:key,kind,sourceId:id,payload,digest,bytes:Buffer.byteLength(JSON.stringify(payload)),syncedAt:now()});return true;}
export function syncStorage(){
 const counts:Record<string,number>={chats:0,messages:0,minutes:0,mail:0,attachments:0};let dataBytes=0,attachmentBytes=0;
 for(const r of list('feishu_records')){counts[r.kind]=(counts[r.kind]||0)+1;dataBytes+=r.bytes||0;}
 for(const r of list('feishu_assets')){try{const p=realpathSync(r.diskPath);if(!p.startsWith(realpathSync(join(DATA,'feishu-attachments'))+'/'))continue;attachmentBytes+=statSync(p).size;counts.attachments++;}catch{}}
 return {counts,dataBytes,attachmentBytes,totalBytes:dataBytes+attachmentBytes,measuredAt:now(),basis:'JSON UTF-8 payload bytes + indexed attachment files; excludes SQLite overhead and sibling snapshots'};
}
export function syncedAsset(id:string){check();const r=get('feishu_assets',id);if(!r)throw new ApiError(404,'not_found','附件不存在');const path=realpathSync(r.diskPath);if(!path.startsWith(realpathSync(join(DATA,'feishu-attachments'))+'/'))throw new ApiError(403,'invalid_path','附件路径无效');return {bytes:readFileSync(path),name:r.name,mime:r.mime};}
export function syncRecords(kind:string,offset:number){if(!['chats','messages','minutes','mail'].includes(kind))throw new ApiError(400,'invalid_kind','无效数据类型');const all=list('feishu_records').filter(r=>r.kind===kind);return {total:all.length,offset,items:all.slice(offset,offset+25).map(r=>({id:r.id,kind:r.kind,sourceId:r.sourceId,bytes:r.bytes,syncedAt:r.syncedAt}))};}

// Discovery reads metadata only. It is deliberately independent of the chat
// body collection window; none of these rows are recorded as synced chats.
export async function discoverMeetingSource(sourceName:string,call:(args:string[],timeout:number)=>Promise<any>,progress:(metadata:any)=>void=()=>{}){
 const metadata={status:'searching',scannedChats:0,pages:0,limit:1000,pageLimit:10,budgetMs:60000,truncated:false,candidateCount:0};
 const deadline=Date.now()+metadata.budgetMs,seen=new Set<string>(),matches=new Map<string,any>();let token:string|undefined;
 const report=()=>progress({...metadata});
 const truncated=()=>{metadata.status='truncated';metadata.truncated=true;throw new ApiError(413,'meeting_source_lookup_truncated','纪要助手查找达到元数据窗口或时间上限，未读取助手正文');};
 try{
  report();
  do{
   const remaining=deadline-Date.now();if(remaining<=0||metadata.pages>=metadata.pageLimit||metadata.scannedChats>=metadata.limit)truncated();
   const envelope=await call(['im','+chat-list','--types','p2p,group','--sort','active_time','--page-size','100',...(token?['--page-token',token]:[])],Math.min(45000,remaining));
   if(Date.now()>deadline)truncated();
   const page=rows(envelope),p=pagination(envelope);metadata.pages++;
   if(page.length>100||metadata.scannedChats+page.length>metadata.limit)truncated();
   metadata.scannedChats+=page.length;
   for(const chat of page)if(chat.name===sourceName){const id=chat.chat_id||chat.id;if(typeof id!=='string'||!id)throw new ApiError(502,'meeting_source_invalid','纪要助手元数据缺少稳定ID');matches.set(id,chat);}
   metadata.candidateCount=matches.size;report();
   if(p.more&&!p.token)throw new ApiError(502,'missing_cursor','纪要助手查找分页游标缺失');
   if(p.more&&!page.length)throw new ApiError(502,'empty_cursor_page','纪要助手查找分页没有取得会话');
   token=p.more?p.token:undefined;
   if(token&&seen.has(token))throw new ApiError(502,'repeated_cursor','纪要助手查找分页游标重复');
   if(token)seen.add(token);
   if(token&&(metadata.scannedChats>=metadata.limit||metadata.pages>=metadata.pageLimit))truncated();
  }while(token);
  if(matches.size>1){metadata.status='ambiguous';throw new ApiError(409,'meeting_source_ambiguous','找到多个同名纪要助手，未读取正文；请指定唯一来源名称');}
  if(!matches.size){metadata.status='not_found';throw new ApiError(404,'meeting_source_not_found','在完整查找窗口中未找到纪要助手');}
  metadata.status='found';report();return [...matches.values()][0];
 }catch(error){if(metadata.status==='searching')metadata.status='failed';report();throw error;}
}

export async function collectFeishu(scope:SyncScope='chats',progress:(patch:any)=>void=()=>{}){
 check();const auth=await requireSelf();check();const config=syncSettings();
 const result:any={ok:true,imported:0,itemIds:[],chats:0,selected:0,skipped:0,filtered:0,unresolved:[],failures:[],truncated:[],counts:{chats:0,messages:0,minutes:0,mail:0,attachments:0},changed:0,receivedBytes:0};
 const fail=(stage:string,e:any,sourceId?:string)=>{result.failures.push({stage,...safeError(e),...(sourceId?{sourceId}: {})});progress({failures:result.failures,counts:result.counts});};
 const call=async(args:string[],timeout=45000)=>{check();let e:any;if(args[0]==='mail'){const r=await command(process.env.OPSTWIN_LARK_CLI||'/Users/steve/.local/bin/lark-cli',[...args,'--as','user','--format','json'],timeout);let parsed:any;try{parsed=JSON.parse(r.stdout)}catch{throw new ApiError(502,'invalid_mail_response','邮箱返回格式无效')}if(r.exitCode!==0||parsed.ok===false||parsed.error)throw new ApiError(502,parsed.error?.subtype||'mail_read_failed','邮箱读取失败');e=parsed.ok===true?parsed:{data:parsed};}else e=await lark([...args,'--as','user','--format','json'],timeout);check();result.receivedBytes+=Buffer.byteLength(JSON.stringify(e.data??{}));return e;};
 async function pages(args:string[],limit:number,label:string){const out:any[]=[];let token:string|undefined;const seen=new Set<string>();do{const e=await call([...args,...(token?['--page-token',token]:[])]);const pageRows=rows(e),remaining=limit-out.length;if(pageRows.length>remaining)result.truncated.push(label);out.push(...pageRows.slice(0,remaining));const p=pagination(e);token=p.more?p.token:undefined;if(p.more&&!token)throw new ApiError(502,'missing_cursor','分页游标缺失');if(token&&seen.has(token))throw new ApiError(502,'repeated_cursor','分页游标重复');if(token)seen.add(token);if(token&&out.length>=limit){result.truncated.push(label);break;}}while(token);return out;}
 async function attachment(m:any){
  if(!config.includeAttachments)return [];
  const content=m.body?.content??m.content??'',refs=new Map<string,{key:string;name:string;type:string}>();
  function ref(key:any,name:any,image=false){if(typeof key==='string'&&/^(img|file)_[A-Za-z0-9_-]+$/.test(key))refs.set(key,{key,name:String(name||key),type:image?'image':'file'});}
  function jsonRefs(value:any){if(!value||typeof value!=='object')return;if(value.file_key)ref(value.file_key,value.file_name);if(value.image_key)ref(value.image_key,'',true);for(const v of Object.values(value))if(typeof v==='object')jsonRefs(v);}
  try{jsonRefs(typeof content==='string'?JSON.parse(content):content);}catch{}
  if(typeof content==='string'){
   for(const match of content.matchAll(/<(file|audio|video|media)\b([^>]*)>/g)){const key=match[2].match(/\bkey="([^"]+)"/)?.[1],name=match[2].match(/\bname="([^"]+)"/)?.[1];ref(key,name);}
   for(const match of content.matchAll(/!\[[^\]]*\]\((img_[A-Za-z0-9_-]+)\)/g))ref(match[1],'',true);
  }
  if(!refs.size&&['file','image','audio','video','media'].includes(m.msg_type||m.type))fail('attachment',new ApiError(502,'attachment_reference_missing','未读取到附件引用'),String(m.message_id||m.id));
  const assets:any[]=[];
  for(const resource of refs.values()){
   const {key,type}=resource,id=hash({message:m.message_id||m.id,key}),old=get('feishu_assets',id);
   if(old&&existsSync(old.diskPath)){assets.push({id,name:old.name,sizeBytes:old.sizeBytes,url:'/api/feishu/sync/assets/'+id});continue;}
   const name=resource.name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,180),dir=join(DATA,'feishu-attachments',id);mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,name);
   try{
    const downloaded=await call(['im','+messages-resources-download','--message-id',String(m.message_id||m.id),'--file-key',key,'--type',type,'--output',relative(ROOT,path)],90000);check();
    const saved=downloaded.data?.saved_path,actual=saved?(saved.startsWith('/')?saved:join(ROOT,saved)):path,verified=realpathSync(actual);
    if(!verified.startsWith(realpathSync(dir)+'/'))throw new Error('Unsafe download');const sizeBytes=statSync(verified).size;if(!sizeBytes)throw new Error('Empty download');
    const mime=type==='image'?'image/jpeg':'application/octet-stream';put('feishu_assets',{id,name,sizeBytes,mime,diskPath:verified});result.counts.attachments++;assets.push({id,name,sizeBytes,url:'/api/feishu/sync/assets/'+id});
   }catch(e){fail('attachment',e,String(m.message_id||m.id));}
  }
  return assets;
 }

 let chats:any[]=[];
 if(scope==='all'||scope==='chats'){
  try{chats=await pages(['im','+chat-list','--types','p2p,group','--sort','active_time','--page-size','100'],config.chatLimit,'chats');result.chats=chats.length;}catch(e){fail('chat_list',e);}
 }
 if(scope==='all'||scope==='chats'){
  const initial=feishuConnection()?.config||{};result.unresolved=unresolvedScopes(chats,initial);const selected=chats.filter(c=>selectedChatScope(c,chats,initial));result.selected=selected.length;result.skipped=chats.length-selected.length;
  for(const chat of selected){const id=chat.chat_id||chat.id;if(!id)continue;try{
   check();if(!selectedChatScope(chat,chats,feishuConnection()?.config||{}))continue;
   progress({phase:'chats',counts:result.counts});const raw=await pages(['im','+chat-messages-list','--chat-id',id,'--order','desc','--page-size','50','--no-reactions'],config.messagesPerChat,'messages');
   const messages:any[]=[];for(const m of raw){const attachments=await attachment(m);messages.push({id:m.message_id||m.id,sentAt:m.create_time||m.createdAt,text:m.text||extractMessageText(m.body?.content||m.content,m.msg_type||m.type,m.mentions||[]),avatarUrl:profileAvatar(m.sender)||profileAvatar(m),senderName:m.sender?.name||m.sender_name||m.sender?.id||'联系人',senderId:m.sender?.id,isMine:m.sender?.id&&auth.openId?m.sender.id===auth.openId:undefined,type:m.msg_type||m.type,attachments});}
   check();const latest=feishuConnection()?.config||{},selectedScope=selectedChatScope(chat,chats,latest);if(!selectedScope)continue;
   const matching=messages.filter(m=>matchesConnectionFilter(chat,m,latest.filter));result.filtered+=messages.length-matching.length;
   if(record('chats',id,chat))result.changed++;result.counts.chats++;
   for(const m of matching){if(record('messages',m.id,{...m,chatId:id}))result.changed++;result.counts.messages++;}
   if(!matching.length)continue;
   const prior=get('inbox',`live-${id}`),ordered=matching.slice().reverse(),body=ordered.map(m=>`${m.senderName}: ${m.text}`).join('\n'),changed=!!prior&&prior.body!==body;
   // Never overwrite drafts, attachments or outbound states; changed sources invalidate approval.
   put('inbox',{...prior,...(changed?{approved:false,sensitiveApproved:false,sourceChangedAt:now()}:{}),id:`live-${id}`,title:chat.name||'飞书会话',sender:chat.name||'飞书联系人',avatarUrl:profileAvatar(chat.p2p_target_profile)||profileAvatar(chat),channel:'Feishu',body,origin:'human',status:prior?.status||'pending',messages:ordered,sourceScope:{id:selectedScope.id,mode:selectedScope.mode,chatMode:chat.chat_mode,explicit:Array.isArray(latest.scopes),filter:latest.filter||''},sourceSystem:'feishu-cli',sourceId:id,sourceUpdatedAt:now(),recipientId:prior?.recipientId||'',isSelfTest:prior?.isSelfTest||false});result.itemIds.push(`live-${id}`);result.imported++;
  }catch(e){fail('chat',e,id);if(e instanceof ApiError&&e.status===403)throw e;}}
 }
 if(scope==='all'||scope==='minutes')try{
  progress({phase:'minutes',counts:result.counts});
  const assistant=await discoverMeetingSource(config.sourceChatName,call,metadata=>{result.meetingSourceLookup=metadata;progress({meetingSourceLookup:metadata});});check();
  const raw=await pages(['im','+chat-messages-list','--chat-id',assistant.chat_id||assistant.id,'--order','desc','--page-size','50','--no-reactions'],config.minutesMessageLimit,'meeting_messages');
  const links=new Map<string,any>();for(const m of raw)for(const link of meetingNoteLinksFromMessage(m.body?m:{...m,body:{content:m.text||m.content||''}}))links.set(link.documentId,link);
  if(!links.size)throw new ApiError(404,'meeting_documents_not_found','纪要助手中未找到文档链接');
  if(links.size>config.minutesLimit)result.truncated.push('minutes');
  for(const link of [...links.values()].slice(0,config.minutesLimit))try{
   const fetchDoc=async(id:string)=>{const e=await call(['docs','+fetch','--doc',id,'--doc-format','markdown','--detail','simple','--scope','full'],90000);const d=e.data?.document??e.data;const content=d?.content??d?.markdown;if(typeof content!=='string'||!content.trim())throw new ApiError(502,'empty_document','文档正文为空');return content;};
   const markdown=await fetchDoc(link.documentId),parsed=parseMeetingNote(markdown,link.documentId);const transcript=parsed.transcriptDocumentId?normalizeMeetingTranscript(await fetchDoc(parsed.transcriptDocumentId)):'';
   const payload={...parsed,...link,markdown,transcript};if(record('minutes',link.documentId,payload))result.changed++;result.counts.minutes++;
   const id='feishu-minute-'+link.documentId,prior=get('memories',id);const content=markdown+(transcript?'\n\n'+transcript:'');if(!prior||prior.sourceManaged===true&&prior.sourceContentHash&&hash(prior.content)===prior.sourceContentHash)put('memories',{...prior,id,title:parsed.title,content,sourceContentHash:hash(content),category:'meeting',sourceManaged:true,sourceSystem:'feishu-cli',sourceId:link.documentId});
  }catch(e){fail('meeting_document',e,link.documentId);}
 }catch(e){fail('minutes',e);}
 if(scope==='all'||scope==='mail')try{
  progress({phase:'mail',counts:result.counts});const triage=await call(['mail','+triage','--mailbox','me','--folder','INBOX','--max',String(config.mailLimit)]);if(pagination(triage).more)result.truncated.push('mail');
  const ids=rows(triage).map(m=>m.message_id||m.messageId||m.id).filter(Boolean);if(ids.length){const full=await call(['mail','+messages','--mailbox','me','--message-ids',ids.join(','),'--html=false'],90000);
   for(const missing of full.data?.unavailable_message_ids||[])fail('mail_message_unavailable',new Error('Unavailable'));
   for(const entry of rows(full)){const m=entry.message??entry,id=m.message_id||m.messageId||m.id;if(!id||entry.error){fail('mail_message',new Error('Missing message'));continue;}if(record('mail',id,m))result.changed++;result.counts.mail++;const key='mail-'+id,prior=get('inbox',key),body=m.body?.plain_text||m.body_plain_text||m.body?.text||m.body||m.text||'';put('inbox',{...prior,id:key,title:m.subject||'飞书邮件',sender:m.from?.name||m.head_from?.name||m.sender||'邮件联系人',channel:'Email',body:typeof body==='string'?body:JSON.stringify(body),origin:'human',status:prior?.status||'pending',sourceSystem:'feishu-cli',sourceId:id,sourceUpdatedAt:now(),...(prior&&prior.body!==body?{approved:false,sensitiveApproved:false}:{}),recipientId:prior?.recipientId||'',isSelfTest:false});}
  }
 }catch(e){fail('mail',e);}
 result.ok=!result.failures.length&&!result.unresolved.length&&!result.truncated.length;result.truncated=[...new Set(result.truncated)];return result;
}
