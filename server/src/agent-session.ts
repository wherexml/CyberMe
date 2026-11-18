// One continuous logical Agent session per user conversation.
//
// The SDK session lives in memory (SessionManager.inMemory) with a stable ID derived from the
// conversation. Every SDK entry is mirrored, sanitized, into private application SQLite so a
// restart restores the same session ID and the same structured role/tool history without
// replaying any prompt or tool. Per-turn authority (run, credentials, evidence, readOnly,
// abort signal) is never stored on the session: stateless proxy tools delegate to the binding
// of the turn that is currently running and refuse everything else.
import {SessionManager} from '@earendil-works/pi-coding-agent';
import type {createAgentSession} from '@earendil-works/pi-coding-agent';
type AgentSession=Awaited<ReturnType<typeof createAgentSession>>['session'];
import {ROOT,db,now,hash,uid,get,list,publicValue} from './store';
import {gmailToolAudit,isGmailRead} from './gmail-read';
import {appleToolAudit,isAppleRead} from './apple-eventkit';
import {ApiError} from './integrations';
import {contextHistory} from './conversation-memory';
import {wechatToolAudit} from './wechat-sync';

db.exec(`CREATE TABLE IF NOT EXISTS agent_sessions(conversation_id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_session_entries(session_id TEXT NOT NULL,seq INTEGER NOT NULL,entry_id TEXT NOT NULL,run_id TEXT,kind TEXT NOT NULL,refs TEXT,data TEXT NOT NULL,PRIMARY KEY(session_id,seq));
CREATE INDEX IF NOT EXISTS agent_session_entries_entry ON agent_session_entries(session_id,entry_id);`);

export type Focus={ids:string[];titles:string[];runId:string;messageId?:string;at:string;turnsSince:number};
export type SessionRecord={sessionId:string;conversationId:string;header:any;createdAt:string;updatedAt:string;focus?:Focus;legacyMigrated?:boolean;fingerprint?:string;instances:number;turns:number;lastRunId?:string;edits?:Record<string,string>;notedRunIds?:string[];userContextHash?:string;capabilityContextHash?:string;skillCatalogHash?:string};
export type TurnBinding={runId:string;tools:Map<string,any>;signal:AbortSignal;saveEvent:(type:string,extra?:any)=>void};
export type LiveChat={conversationId:string;sessionId:string;instanceId:string;session:AgentSession;fingerprint:string;binding?:TurnBinding;persisted:number;lastUsed:number;turnsOnInstance:number;broken?:boolean;restored:boolean;
 // Edit states (shared with the record), run attribution for event-time persistence, failures.
 edits?:Record<string,string>;attributionRunId?:string;persistError?:string;unsubscribePersistence?:()=>void};

// SDK session IDs only allow [A-Za-z0-9._-]; a digest keeps the mapping stable and private.
export const sessionIdFor=(conversationId:string)=>'cm-'+hash('cyberme-agent-session:'+conversationId).slice(0,40);
export function sessionRecord(conversationId:string):SessionRecord|undefined{const row=db.prepare('SELECT data FROM agent_sessions WHERE conversation_id=?').get(conversationId) as any;return row?JSON.parse(row.data):undefined;}
export function saveSessionRecord(record:SessionRecord){record.updatedAt=now();db.prepare('INSERT INTO agent_sessions(conversation_id,session_id,data) VALUES(?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET data=excluded.data').run(record.conversationId,record.sessionId,JSON.stringify(record));return record;}
type Row={seq:number;entry_id:string;run_id:string|null;kind:string;refs:string|null;data:string};
const rows=(sessionId:string)=>db.prepare('SELECT seq,entry_id,run_id,kind,refs,data FROM agent_session_entries WHERE session_id=? ORDER BY seq').all(sessionId) as Row[];
export const sessionEntryCount=(sessionId:string)=>(db.prepare('SELECT count(*) n FROM agent_session_entries WHERE session_id=?').get(sessionId) as any).n as number;

// ---------- sanitization ----------
// CustomEntry (not model-visible) rows use "entry:", model-visible custom messages "custom:".
const entryKind=(e:any)=>e.type==='message'?'message:'+e.message?.role:e.type==='custom_message'?'custom:'+e.customType:e.type==='custom'?'entry:'+e.customType:e.type;
function toolCallFor(entries:any[],toolCallId:string){for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(e?.type==='message'&&e.message?.role==='assistant'&&Array.isArray(e.message.content)){const call=e.message.content.find((p:any)=>p?.type==='toolCall'&&p.id===toolCallId);if(call)return call;}}return undefined;}
function wechatAudit(entry:any,entries:any[]){
 if(entry?.type!=='message'||entry.message?.role!=='toolResult')return undefined;
 const call=toolCallFor(entries,entry.message.toolCallId),name=entry.message.toolName||call?.name,args=call?.arguments||{};
 if(isAppleRead(name,args))return appleToolAudit(args,entry.message.details).output;
 if(isGmailRead(name,args))return gmailToolAudit(args,entry.message.details).output;
 if(name!=='app_read'||!/^wechat_/.test(String(args.action||'')))return undefined;
 return wechatToolAudit(args,entry.message.details).output;
}
const wechatText=(audit:any)=>JSON.stringify({privacy:audit.privacy,audit,note:(audit.privacy==='apple_content_omitted'?'Apple 日程或提醒':audit.privacy==='gmail_body_omitted'?'邮件':'个人微信')+'原文只在读取当轮可见；需要引用时重新读取'});
const imagePlaceholder={type:'text',text:'[图片输入未随会话持久保存；如需再次查看请重新附加]'};
const hasImage=(content:any)=>Array.isArray(content)&&content.some((p:any)=>p?.type==='image');
const stripImages=(content:any)=>Array.isArray(content)?content.map((p:any)=>p?.type==='image'?imagePlaceholder:p):content;
// Persisted copy: registered secrets and credential-shaped keys removed, private WeChat bodies
// reduced to their audit, image bytes not duplicated into the transcript.
export function sanitizeEntry(entry:any,entries:any[]){
 let e:any=publicValue(JSON.parse(JSON.stringify(entry)));
 const audit=wechatAudit(entry,entries);
 if(audit)e={...e,message:{...e.message,content:[{type:'text',text:wechatText(audit)}],details:{privacy:audit.privacy,audit}}};
 if(e.type==='message'&&e.message)e.message={...e.message,content:stripImages(e.message.content)};
 if(e.type==='custom_message')e.content=stripImages(e.content);
 return e;
}
function collectIds(value:any,out:Set<string>,depth=0){if(depth>4||out.size>=200)return;if(Array.isArray(value)){for(const v of value.slice(0,200))collectIds(v,out,depth+1);return;}if(value&&typeof value==='object'){if(typeof value.id==='string')out.add(value.id);for(const [k,v] of Object.entries(value))if(k!=='id')collectIds(v,out,depth+1);}}
const isEditable=(kind:string)=>kind==='message:user'||kind==='message:assistant'||kind==='message:toolResult'||kind.startsWith('custom:');
// Edit states that only reflect privacy/ambient housekeeping, not content provenance.
const housekeeping=(state:string|undefined)=>!state||state==='sanitized'||state==='retired'||state==='dangling'?'':state;

// ---------- persistence ----------
// Called on every SDK entry_appended event and at turn boundaries. Throws on failure: callers
// must not report a turn as successful when its structured transcript is not durable.
export function persistNewEntries(live:LiveChat,runId:string|undefined){
 const entries=live.session.sessionManager.getEntries() as any[];
 if(live.persisted>=entries.length)return;
 const insert=db.prepare('INSERT OR IGNORE INTO agent_session_entries(session_id,seq,entry_id,run_id,kind,refs,data) VALUES(?,?,?,?,?,?,?)');
 let prior:Row[]|undefined;
 db.exec('BEGIN IMMEDIATE');
 try{
  for(let i=live.persisted;i<entries.length;i++){
   const entry=entries[i];let refs:any=undefined;
   if(entry.type==='message'&&entry.message?.role==='toolResult'){const ids=new Set<string>();collectIds(entry.message.details,ids);if(ids.size)refs={ids:[...ids]};}
   if(entry.type==='custom_message'&&Array.isArray(entry.details?.ids))refs={ids:entry.details.ids};
   if(entry.type==='compaction'){
    // Record what the summary was built from (runs and each covered entry's edit state) so a
    // later forget, deletion or source change can retire it instead of letting it survive.
    prior??=rows(live.sessionId);
    const ordered:{entry_id:string;run_id:string|null|undefined;kind:string;refs:string|null}[]=[...prior,...entries.slice(live.persisted,i).map((e:any)=>({entry_id:e.id,run_id:runId,kind:entryKind(e),refs:null}))];
    const covered=new Set<string>(),states:Record<string,string>={};
    for(const r of ordered){
     if(r.entry_id===entry.firstKeptEntryId)break;
     if(r.run_id&&isEditable(r.kind)&&live.edits?.[r.entry_id]!=='excluded')covered.add(r.run_id);
     if(isEditable(r.kind))states[r.entry_id]=housekeeping(live.edits?.[r.entry_id]);
    }
    // Earlier summaries are folded into this one; their (older) recorded states take precedence.
    for(const r of ordered)if(r.kind==='compaction'&&r.refs){const old=JSON.parse(r.refs);for(const id of old.coveredRunIds||[])covered.add(id);Object.assign(states,old.coveredStates||{});}
    refs={coveredRunIds:[...covered],coveredStates:states};
   }
   insert.run(live.sessionId,i,entry.id,entry.details?.runId??runId??null,entryKind(entry),refs?JSON.stringify(refs):null,JSON.stringify(sanitizeEntry(entry,entries)));
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 live.persisted=entries.length;
}
// Turn-boundary flush; surfaces any earlier event-time persistence failure.
export function flushChatTurn(live:LiveChat){
 try{persistNewEntries(live,live.attributionRunId);}catch(e){live.persistError??=String(e);}
 if(live.persistError)throw new ApiError(500,'agent_session_persist_failed','会话记录未能持久保存，本轮不视为成功',{error:publicValue(live.persistError).slice(0,300)});
}
export function restoredManager(record:SessionRecord){
 const entries=[record.header,...rows(record.sessionId).map(r=>JSON.parse(r.data))];
 return {manager:SessionManager.inMemory(ROOT,{id:record.sessionId},entries),count:entries.length-1};
}
export function newRecord(conversationId:string){
 const sessionId=sessionIdFor(conversationId);const manager=SessionManager.inMemory(ROOT,{id:sessionId});
 const record=saveSessionRecord({sessionId,conversationId,header:manager.getHeader(),createdAt:now(),updatedAt:now(),instances:0,turns:0,edits:{},notedRunIds:[]});
 return {record,manager};
}
// Drop the given compaction entries from the durable transcript and reparent their children,
// so the next instance (same session ID) rebuilds from the edited original entries.
function dropCompactions(sessionId:string,drop:Set<string>){
 if(!drop.size)return false;
 const all=rows(sessionId),parents=new Map<string,string|null>();
 for(const r of all)if(drop.has(r.entry_id))parents.set(r.entry_id,JSON.parse(r.data).parentId??null);
 const resolveParent=(id:string|null):string|null=>id&&parents.has(id)?resolveParent(parents.get(id)!):id;
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare('DELETE FROM agent_session_entries WHERE session_id=?').run(sessionId);
  const insert=db.prepare('INSERT INTO agent_session_entries(session_id,seq,entry_id,run_id,kind,refs,data) VALUES(?,?,?,?,?,?,?)');let seq=0;
  for(const r of all){if(parents.has(r.entry_id))continue;const data=JSON.parse(r.data);data.parentId=resolveParent(data.parentId??null);insert.run(sessionId,seq++,r.entry_id,r.run_id,r.kind,r.refs,JSON.stringify(data));}
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return true;
}

// ---------- exclusion / revocation hygiene ----------
// A run is excluded when memory forgetting/revocation marked its messages, request or run,
// or its user message was deleted. The same rules contextHistory() applies to flat history.
export function excludedRunIds(runIds:Iterable<string>){
 const marks=db.prepare('SELECT message_id,request_id FROM memory_exclusions').all() as any[];
 const ids=new Set(marks.map(r=>r.message_id)),requests=new Set(marks.map(r=>r.request_id).filter(Boolean));
 const deletedRequest=db.prepare("SELECT 1 FROM entities WHERE type='messages' AND deleted=1 AND json_extract(data,'$.requestId')=? LIMIT 1");
 const messages=list('messages');const out=new Set<string>();
 for(const runId of runIds){const run=get('runs',runId),requestId=run?.requestId;
  if(ids.has('run:'+runId)||requestId&&(requests.has(requestId)||deletedRequest.get(requestId))||messages.some(m=>(m.runId===runId||requestId&&m.requestId===requestId)&&ids.has(m.id)))out.add(runId);}
 return out;
}
// Messages still usable as model context (same filter as flat history: exclusions, derived projections, deletions).
const usableMessageIds=(ids:string[])=>new Set(contextHistory(ids.map(id=>get('messages',id)).filter(Boolean)).map((m:any)=>m.id));
const deletedEntity=db.prepare('SELECT 1 FROM entities WHERE id=? AND deleted=1 LIMIT 1');
export type SourceLoader=(id:string)=>string|undefined;
// The provenance edit a row needs now (forgotten run, legacy source removed, selected source
// deleted/changed, referenced entity deleted), or undefined when its content is still valid.
function desiredEdit(r:Row,excluded:Set<string>,currentSource:SourceLoader):{state:string;replacement:any}|undefined{
 if(!isEditable(r.kind))return undefined;
 if(r.run_id&&excluded.has(r.run_id))return {state:'excluded',replacement:null};
 if(r.kind==='custom:cyberme_legacy_history'){
  const details=JSON.parse(r.data).details||{},ids:string[]=details.messageIds||[],summaryIds:string[]=details.summarySourceIds||[];
  const kept=usableMessageIds(ids),summaryKept=usableMessageIds(summaryIds);
  const removed=ids.filter(id=>!kept.has(id)),summaryValid=summaryIds.every(id=>summaryKept.has(id));
  if(!removed.length&&summaryValid)return undefined;
  return {state:'legacy:'+hash([removed,summaryValid]),replacement:{content:'[服务端资料] '+renderLegacy(ids.filter(id=>kept.has(id)).map(id=>get('messages',id)),undefined)}};
 }
 if(r.kind==='custom:cyberme_selected_context'){
  const sources:any[]=JSON.parse(r.data).details?.sources||[];
  const changed=sources.map(s=>{const current=currentSource(s.id);return !current?{id:s.id,state:'removed'}:current!==s.contextHash?{id:s.id,state:'updated'}:undefined}).filter(Boolean) as any[];
  if(!changed.length)return undefined;
  return {state:'source:'+hash(changed),replacement:{content:`[选定资料已变化：${changed.map(c=>`${c.id}（${c.state==='removed'?'已删除、撤销或不可读取':'已有新版本'}）`).join('、')}。旧正文不再作为上下文；仍需要时用 get_entity 读取当前版本，已删除或撤销的资料不能再引用。]`}};
 }
 if(r.refs&&(r.kind==='message:toolResult'||r.kind==='custom:cyberme_attachments')){
  const gone=(JSON.parse(r.refs).ids||[]).filter((id:string)=>deletedEntity.get(id));
  if(gone.length)return {state:'deleted:'+hash(gone),replacement:{content:`[该工具结果引用的资料已删除（${gone.slice(0,5).join('、')}）；旧内容不再作为上下文。]`}};
 }
 return undefined;
}
const allRunIds=(sessionId:string)=>new Set((db.prepare('SELECT DISTINCT run_id FROM agent_session_entries WHERE session_id=? AND run_id IS NOT NULL').all(sessionId) as any[]).map(r=>r.run_id as string));
// A compaction summary built while a now-invalid entry was still visible is retired.
function taintedCompactions(sessionId:string,currentSource:SourceLoader){
 const all=rows(sessionId),byId=new Map(all.map(r=>[r.entry_id,r])),excluded=excludedRunIds(allRunIds(sessionId)),tainted=new Set<string>();
 for(const c of all){
  if(c.kind!=='compaction')continue;const refs=JSON.parse(c.refs||'{}');
  if((refs.coveredRunIds||[]).some((id:string)=>excluded.has(id))){tainted.add(c.entry_id);continue;}
  for(const [id,state] of Object.entries(refs.coveredStates||{})){const row=byId.get(id);const want=row&&desiredEdit(row,excluded,currentSource)?.state;if(want&&want!==state){tainted.add(c.entry_id);break;}}
 }
 return tainted;
}
export function applyHygiene(live:LiveChat,record:SessionRecord,currentSource:SourceLoader){
 const all=rows(live.sessionId),edits=record.edits||(record.edits={});const manager=live.session.sessionManager;
 const excluded=excludedRunIds(allRunIds(live.sessionId));
 let count=0;
 for(const r of all){const want=desiredEdit(r,excluded,currentSource);if(!want||edits[r.entry_id]===want.state)continue;try{manager.appendContextEdit(r.entry_id,want.replacement);edits[r.entry_id]=want.state;count++;}catch{}}
 if(count)live.session.refreshContext();
 return {edits:count,excluded:[...excluded]};
}
// Assistant tool calls without a durable result (process stopped mid-tool) would make the next
// provider request invalid; they are shown as interrupted text, never executed again.
export function repairDanglingToolCalls(live:LiveChat,record:SessionRecord,currentRunId:string){
 const entries=live.session.sessionManager.getEntries() as any[],edits=record.edits||(record.edits={});
 const answered=new Set(entries.filter(e=>e.type==='message'&&e.message?.role==='toolResult').map(e=>e.message.toolCallId));
 const durable=new Map(rows(live.sessionId).map(r=>[r.entry_id,r.run_id]));let count=0;
 for(const e of entries){
  if(e.type!=='message'||e.message?.role!=='assistant'||!Array.isArray(e.message.content)||edits[e.id]||durable.get(e.id)===currentRunId)continue;
  const missing=e.message.content.filter((p:any)=>p?.type==='toolCall'&&!answered.has(p.id));if(!missing.length)continue;
  const text=e.message.content.filter((p:any)=>p?.type==='text');
  try{live.session.sessionManager.appendContextEdit(e.id,{content:[...text,{type:'text',text:`[工具调用 ${missing.map((p:any)=>p.name).join('、')} 因服务中断没有结果，状态未知，未自动重放。]`}]});edits[e.id]='dangling';count++;}catch{}
 }
 if(count)live.session.refreshContext();
 return count;
}
// After the answer, transient private material (raw WeChat tool bodies, image bytes) leaves the
// live context too, so a reused instance and a restored one see the same sanitized history.
function skillBody(e:any){
 if(e?.type==='message'&&e.message?.role==='toolResult'&&e.message.toolName==='read_local_skill'){
  const d=e.message.details||{};if(typeof d.content!=='string')return undefined;
  return {content:[{type:'text',text:JSON.stringify({id:d.id,name:d.name,path:d.path,hash:d.hash,offset:d.offset,note:'技能正文已在使用它的轮次后移出上下文；需要时重新 read_local_skill 读取当前版本'})}]};
 }
 if(e?.type==='custom_message'&&e.customType==='cyberme_skill_invocation'&&e.details?.skillId)return {content:`[服务端资料] 早先轮次用户点名的技能 ${e.details.skillId}（sha256 ${e.details.skillHash}）正文已移出上下文；需要时重新 read_local_skill。`};
 return undefined;
}
export function sanitizeSettledTurn(live:LiveChat){
 const entries=live.session.sessionManager.getEntries() as any[],edits=live.edits||(live.edits={});let count=0;
 for(const e of entries){
  if(edits[e.id])continue;let replacement:any;
  const audit=wechatAudit(e,entries);
  if(audit)replacement={content:[{type:'text',text:wechatText(audit)}]};
  // Skill bodies are method material for the turn that used them; afterwards only their identity
  // stays, so obsolete bodies do not fill the context (re-read gives the current version).
  else if(skillBody(e))replacement=skillBody(e);
  else if(e.type==='message'&&(e.message?.role==='user'||e.message?.role==='toolResult')&&hasImage(e.message.content))replacement={content:publicValue(stripImages(e.message.content))};
  else if(e.type==='custom_message'&&hasImage(e.content))replacement={content:publicValue(stripImages(e.content))};
  if(!replacement)continue;
  try{live.session.sessionManager.appendContextEdit(e.id,replacement);edits[e.id]='sanitized';count++;}catch{}
 }
 if(count)live.session.refreshContext();
 return count;
}
export function retireOlder(live:LiveChat,record:SessionRecord,customType:string){
 const edits=record.edits||(record.edits={});let count=0;
 for(const r of rows(live.sessionId))if(r.kind==='custom:'+customType&&!edits[r.entry_id]){try{live.session.sessionManager.appendContextEdit(r.entry_id,null);edits[r.entry_id]='retired';count++;}catch{}}
 if(count)live.session.refreshContext();
 return count;
}
// Runs whose turn settled inside the durable session (a settle marker or an outcome note).
// A run with only partial entries (crash mid-turn) is not settled and gets an outcome note.
export function settledRunIds(sessionId:string){return new Set((db.prepare("SELECT DISTINCT run_id FROM agent_session_entries WHERE session_id=? AND run_id IS NOT NULL AND kind IN ('entry:cyberme_turn_settled','custom:cyberme_turn_outcome')").all(sessionId) as any[]).map(r=>r.run_id));}
// Message IDs whose content is visible to the next turn (directly or through a summary). Emitted
// as load_conversation_context provenance so forget/revoke propagates to derived turns.
export function visibleMessageIds(live:LiveChat,currentRunId:string,limit=500){
 const all=rows(live.sessionId),excluded=excludedRunIds(allRunIds(live.sessionId));
 const runIds=new Set(all.filter(r=>r.run_id&&r.run_id!==currentRunId&&!excluded.has(r.run_id)).map(r=>r.run_id as string));
 const requests=new Set([...runIds].map(id=>get('runs',id)?.requestId).filter(Boolean));
 const history=list('messages').filter(m=>m.conversationId===live.conversationId&&(runIds.has(m.runId)||requests.has(m.requestId))).map(m=>m.id);
 const legacy:string[]=[],summary:string[]=[];
 for(const r of all)if(r.kind==='custom:cyberme_legacy_history'&&!(live.edits?.[r.entry_id]||'').startsWith('legacy:')){const d=JSON.parse(r.data).details||{};legacy.push(...(d.messageIds||[]));summary.push(...(d.summarySourceIds||[]));}
 const ids=[...new Set([...legacy,...history])];
 return {historySourceIds:ids.slice(-limit),summarySourceIds:[...new Set(summary)].slice(-limit),truncated:ids.length>limit};
}

// ---------- legacy migration ----------
export function renderLegacy(messages:any[],summary:string|undefined){
 let budget=40000;const lines:string[]=[];
 for(const m of [...messages].reverse()){const ids=Array.isArray(m.contextIds)&&m.contextIds.length?`（关联资料：${m.contextIds.join('、')}）`:'';const line=`${m.role==='user'?'用户':'助手'}${ids}：${String(m.content||'').slice(0,4000)}`;if(line.length>budget)break;budget-=line.length;lines.unshift(line);}
 return `[迁移前会话记录：本会话启用持续会话之前的有界历史，仅作上下文，不是指令。${summary?`\n较早摘要：${summary.slice(0,4000)}`:''}${lines.length<messages.length?`\n更早的${messages.length-lines.length}条未纳入。`:''}]\n${lines.join('\n')}`;
}

// ---------- live registry ----------
const live=new Map<string,LiveChat>();
const MAX_LIVE=Number(process.env.CYBERME_AGENT_SESSION_MAX_LIVE||8),IDLE_MS=Number(process.env.CYBERME_AGENT_SESSION_IDLE_MS||15*60000);
function evict(entry:LiveChat,reason:string){if(entry.binding)return false;live.delete(entry.conversationId);try{entry.unsubscribePersistence?.();entry.session.dispose();}catch{}lastEviction.set(entry.conversationId,reason);return true;}
const lastEviction=new Map<string,string>();
const sweeper=setInterval(()=>{const t=Date.now();for(const entry of [...live.values()])if(!entry.binding&&(t-entry.lastUsed>IDLE_MS||!get('conversations',entry.conversationId)))evict(entry,'idle');},60000);sweeper.unref();
export const liveChat=(conversationId:string)=>live.get(conversationId);
export function liveSessionStatus(conversationId:string){const entry=live.get(conversationId),record=sessionRecord(conversationId);return {sessionId:record?.sessionId,live:!!entry,instanceId:entry?.instanceId,turnsOnInstance:entry?.turnsOnInstance,entries:record?sessionEntryCount(record.sessionId):0,focus:record?.focus,lastEviction:lastEviction.get(conversationId)};}
export function dropLive(conversationId:string,reason:string){const entry=live.get(conversationId);if(!entry)return;entry.broken=true;if(!evict(entry,reason)){live.delete(conversationId);lastEviction.set(conversationId,reason);}}

// Serialize turns per conversation; acquire returns a live instance (reused, restored or new).
const locks=new Map<string,Promise<void>>();
async function lock(conversationId:string){
 const previous=locks.get(conversationId)||Promise.resolve();let release!:()=>void;
 const mine=new Promise<void>(r=>release=r),chained=previous.then(()=>mine);locks.set(conversationId,chained);
 const unlock=()=>{release();if(locks.get(conversationId)===chained)locks.delete(conversationId);};
 const ready=await Promise.race([previous.then(()=>true),new Promise<boolean>(r=>setTimeout(()=>r(false),15000))]);
 if(!ready){unlock();throw new ApiError(409,'conversation_busy','上一轮会话尚未结束，请稍后重试');}
 return unlock;
}
export async function acquireChat(conversationId:string,fingerprint:string,create:(manager:SessionManager)=>Promise<AgentSession>,onRebuild:(reason:string)=>void,currentSource:SourceLoader){
 const unlock=await lock(conversationId);
 try{return await acquireLocked(conversationId,fingerprint,create,onRebuild,unlock,currentSource);}catch(e){unlock();throw e;}
}
async function acquireLocked(conversationId:string,fingerprint:string,create:(manager:SessionManager)=>Promise<AgentSession>,onRebuild:(reason:string)=>void,unlock:()=>void,currentSource:SourceLoader){
 let entry=live.get(conversationId);
 // A compaction summary that still contains forgotten turns, deleted/changed selected sources or
 // deleted referenced entities is retired; the instance is rebuilt (same session ID) from the
 // original entries, which hygiene then edits.
 const existing=sessionRecord(conversationId);
 if(existing&&dropCompactions(existing.sessionId,taintedCompactions(existing.sessionId,currentSource))){onRebuild('compaction_retired');if(entry)entry.broken=true;}
 if(entry&&(entry.broken||entry.fingerprint!==fingerprint||!entry.session.isIdle)){
  if(!entry.session.isIdle){try{await Promise.race([entry.session.abort(),new Promise(r=>setTimeout(r,5000))]);}catch{}}
  if(entry.fingerprint!==fingerprint||entry.broken||!entry.session.isIdle){if(!entry.broken)onRebuild(entry.fingerprint!==fingerprint?'model_settings_changed':'instance_not_idle');entry.binding=undefined;evict(entry,'rebuild');entry=undefined;}
 }
 if(!entry){
  if(live.size>=MAX_LIVE){const idle=[...live.values()].filter(e=>!e.binding).sort((a,b)=>a.lastUsed-b.lastUsed)[0];if(idle)evict(idle,'capacity');}
  let record=sessionRecord(conversationId),manager:SessionManager,count=0,restored=false;
  if(record){const r=restoredManager(record);manager=r.manager;count=r.count;restored=true;}else{const n=newRecord(conversationId);record=n.record;manager=n.manager;}
  if(manager.getSessionId()!==record.sessionId)throw new ApiError(500,'agent_session_identity','会话身份恢复不一致');
  const session=await create(manager);
  record.instances=(record.instances||0)+1;record.fingerprint=fingerprint;saveSessionRecord(record);
  const created:LiveChat={conversationId,sessionId:record.sessionId,instanceId:uid('agent-instance'),session,fingerprint,persisted:count,lastUsed:Date.now(),turnsOnInstance:0,restored,edits:record.edits||{}};
  // Pi 1.3 does not emit entry_appended for ordinary messages. Observe the public
  // append operations after they update the manager, before execution can continue.
  // Each manager belongs only to this live session; no global SDK patch is involved.
  for(const name of ['appendMessage','appendCustomMessageEntry','appendContextEdit','appendCompaction','appendCustomEntry'] as const){
   const target=manager as any,append=target[name].bind(manager);
   target[name]=(...args:any[])=>{const id=append(...args);try{persistNewEntries(created,created.attributionRunId);}catch(e){created.persistError??=String(e);}return id;};
  }
  created.unsubscribePersistence=session.subscribe((event:any)=>{if(event?.type!=='entry_appended')return;try{persistNewEntries(created,created.attributionRunId);}catch(e){created.persistError??=String(e);}});
  live.set(conversationId,created);
  // Setup entries the SDK appended while constructing (model/thinking level) are not a turn.
  persistNewEntries(created,undefined);
  entry=created;
 }
 const acquired=entry;
 return {live:acquired,release:()=>{acquired.lastUsed=Date.now();unlock();}};
}
// Stateless tool proxies registered once per instance; authority comes only from the bound turn.
export function proxyTools(templates:any[],getLive:()=>LiveChat|undefined){
 return templates.map(template=>({...template,execute:async(callId:string,params:any,...rest:any[])=>{
  const binding=getLive()?.binding;
  if(!binding||binding.signal.aborted)throw new ApiError(409,'stale_turn','该工具调用不属于当前轮次，已拒绝');
  const impl=binding.tools.get(template.name);
  if(!impl)throw new ApiError(403,'tool_not_available_this_turn','本轮权限未提供此工具');
  return impl.execute(callId,params,...rest);
 }}));
}

// Read-only diagnostics: identity, live instance and entry shape. No message bodies are returned.
export function agentSessionView(conversationId:string){
 if(!get('conversations',conversationId))throw new ApiError(404,'conversation_not_found','会话不存在');
 const record=sessionRecord(conversationId),status=liveSessionStatus(conversationId);
 const entries=record?rows(record.sessionId).map(r=>{const data=JSON.parse(r.data),message=data.message||{};
  return {seq:r.seq,entryId:r.entry_id,runId:r.run_id,kind:r.kind,
   ...(r.kind==='message:assistant'&&Array.isArray(message.content)?{toolCalls:message.content.filter((p:any)=>p?.type==='toolCall').map((p:any)=>({id:p.id,name:p.name}))}:{}),
   ...(r.kind==='message:toolResult'?{toolCallId:message.toolCallId,toolName:message.toolName,isError:!!message.isError}:{}),
   ...(r.kind==='context_edit'?{targetId:data.targetId,removed:data.replacement===null}:{}),
   ...(r.kind==='compaction'?{firstKeptEntryId:data.firstKeptEntryId,coveredRunIds:JSON.parse(r.refs||'{}').coveredRunIds||[]}:{})};}):[];
 return {conversationId,sessionId:record?.sessionId,createdAt:record?.createdAt,instances:record?.instances||0,turns:record?.turns||0,legacyMigrated:!!record?.legacyMigrated,focus:record?.focus||null,live:status.live,instanceId:status.instanceId,turnsOnInstance:status.turnsOnInstance,lastEviction:status.lastEviction,entries};
}
export function mountAgentSession(app:{get:(path:string,handler:(c:any)=>any)=>any}){app.get('/api/chat/conversations/:id/agent-session',c=>c.json(agentSessionView(c.req.param('id'))));}
