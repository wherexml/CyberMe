import {communicationMessages} from './communication-context';
import {pinyin} from 'pinyin-pro';
/** Typed, read-only Feishu context. No shell/tool chosen by model, no message audit. */
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SOURCE_DATA} from './runtime-paths';
import {db,get,hash,now} from './store';
import {ApiError,connectionPermission,feishuConnection,lark,requireSelf} from './integrations';
import {selectedChatScope,matchesConnectionFilter} from './connection-scope';
import {extractMessageText} from './feishu-visible-text';

type Chat={id:string;name:string;mode:string;personId:string;syncedAt?:string};
type Message={id:string;chatId:string;chatName:string;mode:string;senderId:string;senderName:string;isMine?:boolean;sentAt:string;displayTime?:string;text:string;parentId?:string;threadId?:string;mentions:string[];truncated:boolean};
const normalize=(s:unknown)=>String(s??'').trim().toLocaleLowerCase();
const parse=(s:any)=>typeof s==='string'?JSON.parse(s):s;
function stamp(v:any){const n=Number(v);return Number.isFinite(n)&&n>0?new Date(n<1e12?n*1000:n).toISOString():typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():'';}
function chat(v:any):Chat{return {id:String(v.chat_id||v.id||''),name:String(v.name||''),mode:v.chat_mode||'',personId:v.p2p_target_id||v.p2p_target?.id||'',syncedAt:v.synced_at};}
function message(v:any,c:Chat,owner:string):Message|undefined{
 if(v.deleted||v.is_deleted||v.recalled||v.is_recalled)return;
 const senderId=v.sender?.id||v.sender_id||v.senderId||'',raw=v.text||extractMessageText(v.body?.content||v.content||'',v.msg_type||v.type,v.mentions||[]);
 const text=String(raw),id=String(v.message_id||v.id||'');if(!id)return;
 return {id,chatId:c.id,chatName:c.name,mode:c.mode,senderId,senderName:v.sender?.name||v.sender_name||v.senderName||senderId,isMine:owner&&senderId&&(!v.sender?.id_type||v.sender.id_type==='open_id')?senderId===owner:undefined,sentAt:stamp(v.create_time||v.sent_at||v.sentAt),displayTime:String(v.create_time||v.sent_at||v.sentAt||''),text:text.slice(0,12000),parentId:v.parent_id||v.reply_to_message_id||v.replyToId,threadId:v.thread_id,mentions:(v.mentions||[]).map((x:any)=>typeof x.id==='string'?x.id:x.id?.open_id||x.open_id).filter(Boolean),truncated:text.length>12000};
}
function configGuard(){
 connectionPermission('read');const c=feishuConnection();if(!c||c.status!=='connected')throw new ApiError(403,'feishu_not_connected','请先连接飞书用户身份');
 const lease=hash({id:c.id,status:c.status,permissions:c.permissions,config:c.config,updatedAt:c.updatedAt});
 return ()=>{connectionPermission('read');const latest=feishuConnection();if(!latest||hash({id:latest.id,status:latest.status,permissions:latest.permissions,config:latest.config,updatedAt:latest.updatedAt})!==lease)throw new ApiError(409,'feishu_context_changed','飞书连接或读取范围已改变，请重新查询');};
}
function permitted(c:Chat,all:Chat[]){return !!selectedChatScope({chat_id:c.id,name:c.name,chat_mode:c.mode},all.map(x=>({chat_id:x.id,name:x.name,chat_mode:x.mode})),feishuConnection()?.config||{});}
function names(query:string){
 const values=new Set([normalize(query)]);
 // Names/aliases only. Never use this other app's IDs, nor copy the directory.
 try{const path=process.env.OPSTWIN_PEOPLE_MAP||'/Users/steve/Projects/00-optimax/people-identity-map.json';const source=readFileSync(path,'utf8');if(source.length>2_000_000)return values;const people=parse(source).people;if(Array.isArray(people))for(const p of people){if([p.name,...(Array.isArray(p.aliases)?p.aliases:[])].some(x=>normalize(x)===normalize(query)))for(const alias of [p.name,...(Array.isArray(p.aliases)?p.aliases:[])])if(typeof alias==='string'&&alias.trim())values.add(normalize(alias));}}catch{}
 return values;
}
function candidates(chats:Chat[],query:string){const aliases=names(query),q=normalize(query);return chats.filter(c=>permitted(c,chats)&&(aliases.has(normalize(c.name))||normalize(c.name).includes(q)||/^[a-z]{2,}$/.test(q)&&normalize(pinyin(c.name,{pattern:'first',toneType:'none',type:'array'}).join('').replace(/[^a-z]/gi,''))===q));}
function localSnapshot(){
 const path=process.env.OPSTWIN_FEISHU_CONTEXT_CACHE||join(SOURCE_DATA,'dev.db');if(!existsSync(path))return undefined;
 let source:DatabaseSync|undefined;try{source=new DatabaseSync(path,{readOnly:true});
 source.exec('PRAGMA query_only=ON; BEGIN');
 const chats=(source.prepare('SELECT id,name,payload,synced_at FROM feishu_chats LIMIT 1001').all() as any[]).map(r=>chat({...parse(r.payload),chat_id:r.id,name:r.name,synced_at:r.synced_at}));
 const ownerRow=source.prepare("SELECT value FROM feishu_meta WHERE key='owner_open_id'").get() as any;let owner=ownerRow?.value||'';try{owner=JSON.parse(owner);}catch{}
 return {source,chats,owner:typeof owner==='string'?owner:'',truncated:chats.length>1000};
 }catch{source?.close();return undefined;}
}
function closeLocal(snapshot:ReturnType<typeof localSnapshot>){if(snapshot){try{snapshot.source.exec('ROLLBACK');}finally{snapshot.source.close();}}}
function localRead(s:NonNullable<ReturnType<typeof localSnapshot>>,target:Chat,start:string,end:string){
 const allowed=s.chats.filter(c=>permitted(c,s.chats)),chatMap=new Map(allowed.map(c=>[c.id,c]));
 const eventTime=`CASE WHEN trim(sent_at)<>'' AND trim(sent_at) NOT GLOB '*[^0-9]*' THEN CASE WHEN CAST(sent_at AS INTEGER)<1000000000000 THEN CAST(sent_at AS INTEGER)*1000 ELSE CAST(sent_at AS INTEGER) END WHEN instr(sent_at,'T')>0 AND (substr(sent_at,-1)='Z' OR substr(sent_at,-6,1) IN ('+','-')) THEN CAST(strftime('%s',sent_at) AS INTEGER)*1000 ELSE NULL END`;
 const scope=`m.chat_id IN (${allowed.map(()=>'?').join(',')||'NULL'}) AND (m.chat_id=? OR (?<>'' AND (json_extract(m.payload,'$.sender.id')=? OR EXISTS(SELECT 1 FROM json_each(m.payload,'$.mentions') j WHERE coalesce(json_extract(j.value,'$.id.open_id'),json_extract(j.value,'$.id'))=?))))`;
 const params=[...allowed.map(c=>c.id),target.id,target.mode==='p2p'?target.personId:'',target.personId,target.personId];
 const from=`FROM (SELECT *,${eventTime} AS event_ms FROM feishu_messages) m WHERE ${scope}`;
 const missingTimes=Number((s.source.prepare(`SELECT COUNT(*) AS n ${from} AND event_ms IS NULL`).get(...params) as any).n);
 const select=`SELECT m.id,m.chat_id,m.sent_at,m.payload ${from} AND event_ms>=? AND event_ms<=?`;
 const direct=s.source.prepare(`${select} AND m.chat_id=? ORDER BY event_ms DESC,m.id DESC LIMIT 151`).all(...params,Date.parse(start),Date.parse(end),target.id) as any[];
 const groupIds=allowed.filter(c=>c.mode==='group'&&c.id!==target.id).map(c=>c.id);
 const group=target.mode==='p2p'&&groupIds.length?s.source.prepare(`${select} AND m.chat_id IN (${groupIds.map(()=>'?').join(',')}) ORDER BY event_ms DESC,m.id DESC LIMIT 151`).all(...params,Date.parse(start),Date.parse(end),...groupIds) as any[]:[];
 const raw=[...direct.slice(0,150),...group.slice(0,150)],limited=direct.length>150||group.length>150;
 const items=raw.slice(0,300).flatMap(r=>{const c=chatMap.get(r.chat_id);if(!c||c.id!==target.id&&c.mode!=='group')return [];const m=message({...parse(r.payload),message_id:r.id,sent_at:r.sent_at},c,s.owner);return m&&matchesConnectionFilter(c,m,feishuConnection()?.config?.filter)?[m]:[];});
 const ids=new Set(items.map(m=>m.id)),missing=[...new Set(items.map(m=>m.parentId).filter((x):x is string=>!!x&&!ids.has(x)))];
 for(const id of missing.slice(0,30)){const r=s.source.prepare('SELECT id,chat_id,sent_at,payload FROM feishu_messages WHERE id=?').get(id) as any;if(!r)continue;const c=chatMap.get(r.chat_id);if(!c||!items.some(m=>m.chatId===c.id&&m.parentId===id))continue;const m=message({...parse(r.payload),message_id:r.id,sent_at:r.sent_at},c,s.owner);if(m&&matchesConnectionFilter(c,m,feishuConnection()?.config?.filter)){items.push(m);ids.add(id);}}
 return {items,limited,missingTimes,missingParents:missing.filter(id=>!ids.has(id)).length};
}
function page(e:any){const outer=e.data??e;const d=outer.data??outer;const rows=Array.isArray(d)?d:d.items||d.messages||d.chats;if(!Array.isArray(rows))throw new ApiError(502,'feishu_invalid_response','飞书返回格式无效');return {rows,more:!!(d.has_more??d.hasMore??(e.meta?.pagination?.complete===false)),token:d.page_token||d.pageToken||e.meta?.pagination?.next_token};}
async function liveReader(guard:()=>void){
 const auth=await requireSelf();guard();const deadline=Date.now()+55000;
 const call=async(args:string[])=>{guard();const remaining=deadline-Date.now();if(remaining<=0)throw new ApiError(504,'feishu_read_timeout','飞书查询达到时间上限');let result;try{result=await lark([...args,'--as','user','--format','json'],Math.min(20000,remaining));}catch(e){guard();throw new ApiError(502,e instanceof ApiError?e.code:'feishu_read_failed','飞书实时读取失败，未确认完整覆盖');}guard();return result;};
 const pages=async(args:string[],max:number)=>{const out:any[]=[];let token:string|undefined;const seen=new Set<string>();for(let i=0;i<max;i++){const p=page(await call([...args,...(token?['--page-token',token]:[])]));if(p.rows.length>100)throw new ApiError(502,'feishu_invalid_page','飞书返回超过单页窗口');out.push(...p.rows);if(!p.more)return {rows:out,limited:false};if(!p.token||seen.has(p.token)||!p.rows.length)throw new ApiError(502,'feishu_invalid_cursor','飞书分页游标缺失或重复，未确认覆盖');seen.add(p.token);token=p.token;}return {rows:out,limited:true};};
 return {owner:auth.openId,call,pages};
}
function response(target:Chat,items:Message[],coverage:any){
 coverage={...coverage,missingTimes:Math.max(coverage.missingTimes||0,items.filter(m=>!m.sentAt).length),ordering:items.some(m=>!m.sentAt)?'display_time_best_effort; timezone_unknown':'timestamp'};
 const sorted=[...new Map(items.map(m=>[m.id,m])).values()].sort((a,b)=>(a.sentAt||a.displayTime||'').localeCompare(b.sentAt||b.displayTime||'')||a.id.localeCompare(b.id));
 let directBudget=24000,otherBudget=24000;const reserved=sorted.filter(m=>m.chatId===target.id).slice(-100),selected=new Set(reserved.map(m=>m.id));for(const m of sorted.slice().reverse()){if(selected.size>=200)break;selected.add(m.id);}const visible=sorted.filter(m=>selected.has(m.id)).reverse().map(m=>{const direct=m.chatId===target.id,text=m.text.slice(0,Math.max(0,direct?directBudget:otherBudget));if(direct)directBudget-=text.length;else otherBudget-=text.length;return {...m,text,truncated:m.truncated||text.length<m.text.length};}).reverse();
 return {status:coverage.source==='local'||coverage.stale||coverage.limited||coverage.missingParents||coverage.missingTimes||coverage.gaps?.length||sorted.length>200||visible.some(m=>m.truncated)?'partial':'found',target:{id:target.id,name:target.name,kind:target.mode==='p2p'?'person':'group'},queriedAt:now(),messages:visible,coverage:{...coverage,messageLimit:200,contentTruncated:sorted.length>200||visible.some(m=>m.truncated),complete:false,threadCoverage:'bounded parents and returned thread replies; missing/truncated threads remain partial'},workflow:{readOnly:true,sending:'existing_server_policy',next:'核对当前请求、本人后续回复及关联工作结果；未解决才准备回复'}};
}
export async function queryFeishuContext(input:any){
 const guard=configGuard();if(typeof input.query!=='string'||!input.query.trim()||input.query.length>100)throw new ApiError(400,'invalid_query','请输入姓名、群名或已记录缩写');
 const days=input.days??3;if(!Number.isInteger(days)||days<1||days>30)throw new ApiError(400,'invalid_days','查询范围为1–30天');
 if(input.targetId!==undefined&&(typeof input.targetId!=='string'||input.targetId.length>200))throw new ApiError(400,'invalid_target','无效会话选择');
 if(input.refresh!==undefined&&typeof input.refresh!=='boolean')throw new ApiError(400,'invalid_refresh','refresh必须为布尔值');
 const start=new Date(Date.now()-days*86400000).toISOString(),end=now();let cached:any,cacheTarget:Chat|undefined;
 const s=localSnapshot();try{if(s){const found=candidates(s.chats,input.query);const selected=input.targetId?found.filter(c=>c.id===input.targetId):found;
 if(selected.length===1&&!s.truncated&&(input.refresh===false||input.targetId)){cacheTarget=selected[0];const read=localRead(s,cacheTarget,start,end);cached=response(cacheTarget,read.items,{source:'local',start,end,stale:!cacheTarget.syncedAt||!Number.isFinite(Date.parse(cacheTarget.syncedAt))||Date.parse(cacheTarget.syncedAt)>Date.now()||Date.now()-Date.parse(cacheTarget.syncedAt)>300000,cachedAt:cacheTarget.syncedAt,limited:read.limited,missingParents:read.missingParents,missingTimes:read.missingTimes,crossGroupCoverage:'cached_only'});}
 }}finally{closeLocal(s);}guard();
 // The cache cannot prove cross-group freshness or identity uniqueness in the live directory.
 // Refresh by default; explicit cache-only is useful offline and always reports partial coverage.
 if(input.refresh===false)return cached||{status:'cache_unavailable',messages:[],coverage:{source:'local',complete:false,reason:'missing_or_ambiguous_cache'}};
 let live:Awaited<ReturnType<typeof liveReader>>;let chats:Chat[];
 try{live=await liveReader(guard);const all=await live.pages(['im','+chat-list','--types','p2p,group','--page-size','100','--sort','active_time'],10);chats=all.rows.map(chat);if(chats.some(c=>!c.id||!c.name||!['p2p','group'].includes(c.mode))||new Set(chats.map(c=>c.id)).size!==chats.length)throw new ApiError(502,'feishu_invalid_identity','飞书会话身份不完整或重复');if(all.limited)return {status:'incomplete_identity_search',candidates:candidates(chats,input.query).map(c=>({id:c.id,name:c.name,kind:c.mode==='p2p'?'person':'group'})),coverage:{source:'live',complete:false,reason:'metadata_limit'},messages:[]};}
 catch(e){guard();if(cached)return {...cached,coverage:{...cached.coverage,stale:true,liveError:e instanceof ApiError?e.code:'feishu_read_failed'}};throw e;}
 const found=candidates(chats,input.query);const selected=input.targetId?found.filter(c=>c.id===input.targetId):found;
 if(selected.length!==1)return {status:selected.length?'ambiguous':'not_found',candidates:found.slice(0,20).map(c=>({id:c.id,name:c.name,kind:c.mode==='p2p'?'person':'group'})),coverage:{source:'live',complete:found.length<=20},messages:[]};
 const target=selected[0],byId=new Map(chats.filter(c=>permitted(c,chats)).map(c=>[c.id,c])),items:Message[]=[],gaps:string[]=[];let limited=false;
 const addReplies=(v:any,c:Chat)=>{if(v.thread_has_more||v.thread_replies_error)gaps.push('thread_incomplete');if(Array.isArray(v.thread_replies)){if(v.thread_replies.length>50)gaps.push('thread_reply_limit');for(const reply of v.thread_replies.slice(0,50)){if(reply.chat_id&&reply.chat_id!==c.id)continue;const m=message({...reply,thread_id:reply.thread_id||v.thread_id},c,live.owner);if(m&&matchesConnectionFilter(c,m,feishuConnection()?.config?.filter))items.push(m);}}};
 const consume=(raw:any[],fallback?:Chat,mentioned=false)=>{for(const v of raw){const c=byId.get(v.chat_id||v.chatId||fallback?.id);if(!c)continue;if(v.sender?.id_type&&v.sender.id_type!=='open_id'||!v.sender?.id&&!v.sender_id&&!v.senderId)gaps.push('sender_identity_unknown');if((v.mentions||[]).some((x:any)=>x.id&&typeof x.id==='object'&&!x.id.open_id))gaps.push('mention_identity_unknown');const m=message(v,c,live.owner);if(!m||!matchesConnectionFilter(c,m,feishuConnection()?.config?.filter))continue;if(mentioned&&!m.mentions.includes(target.personId))continue;if(c.id!==target.id&&(c.mode!=='group'||m.senderId!==target.personId&&!m.mentions.includes(target.personId)))continue;items.push(m);addReplies(v,c);}};
 const cliTime=(value:string)=>value.replace(/\.\d{3}Z$/,'+00:00');
 const window=['--start',cliTime(start),'--end',cliTime(end),'--page-size','50','--no-reactions'];
 const read=async(label:string,args:string[],fallback?:Chat,mentioned=false)=>{try{const p=await live.pages(args,3);limited ||= p.limited;consume(p.rows,fallback,mentioned);}catch(e){guard();gaps.push(label+':'+(e instanceof ApiError?e.code:'failed'));}};
 await read('conversation',['im','+chat-messages-list','--chat-id',target.id,'--order','desc',...window],target);
 if(target.mode==='p2p'){if(!target.personId)gaps.push('person_identity_missing');else{const groups=[...byId.values()].filter(c=>c.mode==='group');if(groups.length>100)gaps.push('allowed_group_limit');for(let i=0;i<Math.min(groups.length,100);i+=50){const scope=['--chat-id',groups.slice(i,i+50).map(c=>c.id).join(',')];await read('group_sender',['im','+messages-search','--query','','--sender',target.personId,'--chat-type','group',...scope,...window]);await read('group_mentions',['im','+messages-search','--query','','--at-chatter-ids',target.personId,'--chat-type','group',...scope,...window],undefined,true);}}}
 const threadHosts=[...new Map(items.filter(m=>m.mode==='group'&&m.threadId).map(m=>[m.threadId,m])).values()];
 if(threadHosts.length>10)gaps.push('thread_host_limit');
 for(const host of threadHosts.slice(0,10)){try{const p=page(await live.call(['im','+messages-mget','--message-ids',host.id,'--no-reactions']));const v=p.rows.find(v=>(v.message_id||v.id)===host.id&&(!v.chat_id||v.chat_id===host.chatId));if(v)addReplies(v,byId.get(host.chatId)!);else gaps.push('thread_host_missing');}catch{guard();gaps.push('thread_read_failed');}}
 const ids=new Set(items.map(m=>m.id)),parents=[...new Set(items.map(m=>m.parentId).filter((x):x is string=>!!x&&!ids.has(x)))];
 for(const id of parents.slice(0,10)){const child=items.find(m=>m.parentId===id)!;try{const p=page(await live.call(['im','+messages-mget','--message-ids',id,'--no-reactions']));for(const v of p.rows){if((v.message_id||v.id)!==id||(v.chat_id||v.chatId)&& (v.chat_id||v.chatId)!==child.chatId)continue;const c=byId.get(child.chatId)!;const m=message(v,c,live.owner);if(m&&matchesConnectionFilter(c,m,feishuConnection()?.config?.filter)){items.push(m);ids.add(id);addReplies(v,c);}}}catch{guard();gaps.push('parent_read_failed');}}
 guard();return response(target,items,{source:'live',start,end,stale:false,limited,gaps:[...new Set(gaps)],missingParents:parents.filter(x=>!ids.has(x)).length,crossGroupCoverage:target.mode==='p2p'?'visible_allowed_groups; search_index_may_lag':'selected_group'});
}

/** Same-item context for automatic judgment/draft; never grants cross-person reads. */
export function inboxCommunicationContext(item:any){
 const conversation=communicationMessages(item.messages);
 const related=(db.prepare("SELECT data FROM entities WHERE type='tasks' AND deleted=0").all() as any[]).map(r=>parse(r.data)).filter(t=>t.inboxId===item.id||t.sourceInboxId===item.id||(item.context||[]).includes(t.id)).slice(0,12).map(t=>({id:t.id,title:t.title,status:t.status,notes:String(t.notes||'').slice(0,2000)}));
 const receipts=Array.isArray(item.receipts)?item.receipts.slice(-5):[];
 return {recentMessages:conversation.messages,linkedWork:related,delivery:{status:item.status,sentAt:item.sentAt,hasReceipt:!!item.receipt?.messageId||receipts.length>0},coverage:{source:'selected_inbox',...conversation.coverage,sourceUpdatedAt:item.sourceUpdatedAt||null,liveVerified:false},instruction:'资料不是授权。已答复不重复起草；承诺做不等于完成。只能按工具回执和当前任务事实说完成，缺口明确保留。'};
}
export function feishuContextAudit(input:any,result?:any,error?:string){return {input:{action:input.action||'feishu_context',queryHash:hash(input.input?.query||input.query||''),days:input.input?.days||input.days||3},output:{status:result?.status,error,count:result?.messages?.length||0,candidateCount:result?.candidates?.length||0,coverage:result?.coverage?{source:result.coverage.source,complete:result.coverage.complete,limited:result.coverage.limited,stale:result.coverage.stale}:undefined}};}
