import { presentInbox } from './message-presentation';
import {isQuietInbox} from '../../shared/inbox-surfacing';
import { normalizeInboxAttachments } from '../../shared/attachments';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import type { Bootstrap, Settings } from '../../shared/types';

export const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const DATA = process.env.OPSTWIN_DATA_DIR ? resolve(process.env.OPSTWIN_DATA_DIR) : join(ROOT, 'data');
if (!DATA.startsWith(ROOT + '/')) throw new Error('Data directory must stay inside this project');
mkdirSync(DATA, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(join(DATA, 'opstwin-advance.db'));
chmodSync(join(DATA, 'opstwin-advance.db'), 0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS entities (type TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,local_edited INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(type,id));
CREATE INDEX IF NOT EXISTS entity_type_deleted ON entities(type,deleted);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings_history (id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_snapshots (type TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,imported_at TEXT NOT NULL,PRIMARY KEY(type,id));
CREATE TABLE IF NOT EXISTS send_intents (key TEXT PRIMARY KEY,item_id TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connection_private (id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_history (id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_requests (id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_intents (key TEXT PRIMARY KEY,item_id TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS draft_requests (id TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL);
`);

export const now = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}-${randomUUID()}`;
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const TYPES = ['tasks','projects','inbox','ideas','memories','automations','connections','conversations'] as const;
export type Resource = typeof TYPES[number];
export function meta<T>(key:string, fallback:T):T {const r=db.prepare('SELECT value FROM meta WHERE key=?').get(key) as any;return r?JSON.parse(r.value):fallback;}
export function setMeta(key:string,value:unknown) {db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
export function revision() {return meta('revision',0);}
export function bump() {const next=revision()+1;setMeta('revision',next);return next;}
export function list<T=any>(type:string, deleted=false):T[] {return (db.prepare('SELECT data FROM entities WHERE type=? AND deleted=? ORDER BY rowid DESC').all(type,deleted?1:0) as any[]).map(x=>{const value=JSON.parse(x.data);return type==='inbox'?withInboxTriage(normalizeInboxAttachments(value)):value;}).filter(value=>type!=='artifacts'||!value.archivedAt);}
export function get<T=any>(type:string,id:string,includeDeleted=false):T|undefined {const r=db.prepare(`SELECT data FROM entities WHERE type=? AND id=? ${includeDeleted?'':'AND deleted=0'}`).get(type,id) as any;if(!r)return undefined;const value=JSON.parse(r.data);return type==='inbox'?withInboxTriage(normalizeInboxAttachments(value)):value;}
export function put<T extends Record<string,any>>(type:string,value:T,local=true):T & {id:string;createdAt:string;updatedAt:string} {if(type==='inbox'){value=normalizeInboxAttachments(value);const {triage,surfacing,sourceRule,dismissalFeedbackActive,...rest}=value;value=rest as T;}const data={...value,id:value.id||uid(type.slice(0,-1)),createdAt:value.createdAt||now(),updatedAt:now()};db.prepare('INSERT INTO entities(type,id,data,local_edited) VALUES(?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,local_edited=MAX(entities.local_edited,excluded.local_edited)').run(type,data.id,JSON.stringify(data),local?1:0);bump();return data as T & {id:string;createdAt:string;updatedAt:string};}
export function remove(type:string,id:string) {db.prepare('UPDATE entities SET deleted=1,local_edited=1 WHERE type=? AND id=?').run(type,id);bump();}
export function restore(type:string,id:string) {db.prepare('UPDATE entities SET deleted=0,local_edited=1 WHERE type=? AND id=?').run(type,id);bump();return get(type,id);}
export function importEntity(type:string,id:string,value:Record<string,any>) {if(type==='inbox')value=normalizeInboxAttachments(value);const r=db.prepare('SELECT local_edited,deleted FROM entities WHERE type=? AND id=?').get(type,id) as any;const snapshot={...value,id,sourceSystem:'opstwin',sourceId:value.sourceId||id,importedAt:now()};db.prepare('INSERT INTO source_snapshots(type,id,data,hash,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,hash=excluded.hash,imported_at=excluded.imported_at').run(type,id,JSON.stringify(snapshot),hash(snapshot),now());if(r?.local_edited||r?.deleted)return false;put(type,snapshot,false);return true;}
export function activity(title:string,kind:string,status='succeeded',detail?:string,entityId?:string,receipt?:any) {return put('activities',{id:uid('activity'),title,kind,status,detail,entityId,receipt});}
export function beginRun(kind:string,title:string,extra:Record<string,any>={}) {return put('runs',{id:uid('run'),kind,title,status:'running',startedAt:now(),engine:'pi',tools:[],events:[],...extra});}
export function updateRun(id:string,patch:Record<string,any>) {const run=get('runs',id);if(!run)throw new Error('Run not found');return put('runs',{...run,...patch});}
export function toolEvidence(runId:string,name:string,input:unknown,output:unknown,status='succeeded',metadata:Record<string,unknown>={}) {const run=get('runs',runId);if(!run)return;updateRun(runId,{tools:[...(run.tools||[]),{id:uid('tool'),name,input,output,status,at:now(),...metadata}]});}

// Judgment lives independently so background analysis cannot invalidate draft edit leases.
export const TRIAGE_POLICY_VERSION='inbox-triage-v6';
export function inboxFeedback(item:any){
 const key=item.senderId||item.sender;
 return list('inbox_feedback').filter(f=>f.active&&f.itemId!==item.id&&f.channel===item.channel&&f.senderKey===key).slice(0,8).map(f=>({id:f.id,itemId:f.itemId,title:f.title,body:f.body,action:'dismiss',createdAt:f.createdAt}));
}
export function recordInboxFeedback(old:any,saved:any){
 if(old.status===saved.status)return;
 if(saved.status==='dismissed')put('inbox_feedback',{id:saved.id,itemId:saved.id,active:true,channel:saved.channel,senderKey:saved.senderId||saved.sender,title:saved.title,body:String(saved.body||'').slice(0,1500)});
 if(old.status==='dismissed'&&saved.status!=='dismissed'){const feedback=get('inbox_feedback',saved.id);if(feedback)put('inbox_feedback',{...feedback,active:false});}
}
export function inboxTriageState(item:any){
 const owner=settings().identity;
 const linked=list('tasks').filter(task=>(item.context||[]).includes(task.id)||task.inboxId===item.id||task.sourceInboxId===item.id).map(task=>({id:task.id,title:task.title,status:task.status,dueDate:task.dueDate,notes:task.notes}));
 const state={dismissalFeedback:inboxFeedback(item),owner:{name:owner.name,aliases:owner.name==='许茂林'?['Steve','许茂林']:[],role:owner.role,instructions:owner.instructions},message:{title:item.title,body:item.body,sender:item.sender,senderId:item.senderId,isMine:item.isMine,direction:item.direction,isSelfTest:item.isSelfTest===true,recipientId:item.recipientId,channel:item.channel,origin:item.origin,sensitive:!!item.sensitive,sourceId:item.sourceId},recentMessages:(item.messages||[]).slice(-20).map((m:any)=>({text:m.text||m.content||m.body,isMine:m.isMine,direction:m.direction,senderId:m.senderId,sender:m.senderName,sentAt:m.sentAt,createdAt:m.createdAt})),linkedTasks:linked,sourceAttachments:item.sourceAttachments||[]};
 return state;
}
export function inboxTriageVersion(item:any){return hash({state:inboxTriageState(item),policyVersion:TRIAGE_POLICY_VERSION});}
function withInboxTriage(item:any){
 const row=db.prepare("SELECT data FROM entities WHERE type='inbox_triages' AND id=? AND deleted=0").get(item.id) as any;
 const saved=row?JSON.parse(row.data):undefined;
 const {triage,sourceRule,...rest}=item;
 const rule=item.sourceId?get('inbox_source_rules',hash([item.channel,item.sourceId])):undefined;
 const result={...rest,...(rule?.active?{sourceRule:{id:rule.id,name:rule.name,active:true}}:{}),...(saved?.sourceVersion===inboxTriageVersion(item)&&saved.policyVersion===TRIAGE_POLICY_VERSION?{triage:saved}:{})};return {...result,dismissalFeedbackActive:get('inbox_feedback',item.id)?.active===true,surfacing:isQuietInbox(result)?'quiet':'attention'};
}

const defaultSettings:Settings={
 identity:{name:'许茂林',role:'企业经营管理者',about:'',instructions:'优先使用真实数据，清晰标明未知事项。外发内容先草拟并经我确认。',language:'en'},
 autonomy:{holdSending:false,levels:{ack:'draft',meet:'draft',docs:'draft',commit:'draft',boss:'draft',sensitive:'observe'},deepThink:['vip','stakes'],files:[],quietFrom:'23:00',quietUntil:'07:00',alerts:'urgent_digest',transparency:true},
 channels:{feishu:{enabled:true},email:{enabled:false}},
};
export function settings():Settings {return meta('settings',defaultSettings);}
export function deepMerge(base:any,patch:any):any {if(!patch||typeof patch!=='object'||Array.isArray(patch))return patch;const out={...base};for(const [k,v]of Object.entries(patch)){if(['__proto__','constructor','prototype'].includes(k))continue;out[k]=v&&typeof v==='object'&&!Array.isArray(v)?deepMerge(base?.[k]||{},v):v;}return out;}
export function patchSettings(patch:Record<string,any>,reason='update') {const prior=settings();const history={id:uid('history'),createdAt:now(),reason,data:prior};db.prepare('INSERT INTO settings_history VALUES(?,?,?,?)').run(history.id,JSON.stringify(prior),history.createdAt,reason);const next=deepMerge(prior,patch);next.autonomy.levels={...defaultSettings.autonomy.levels,...next.autonomy.levels,commit:'draft',boss:'draft',sensitive:'observe'};next.autonomy.files=[...new Set([...(next.autonomy.files||[]),'show_before_send'])];setMeta('settings',next);bump();activity(reason==='restore'?'恢复设置':'更新设置','settings','succeeded',undefined,history.id);return next;}
export function settingsHistory() {return (db.prepare('SELECT * FROM settings_history ORDER BY created_at DESC').all() as any[]).map(x=>({id:x.id,createdAt:x.created_at,reason:x.reason,settings:JSON.parse(x.data)}));}
export function snapshotMemories(reason='manual') {const id=uid('memory-history'),createdAt=now(),values=list('memories');db.prepare('INSERT INTO memory_history VALUES(?,?,?,?)').run(id,JSON.stringify(values),createdAt,reason);return {id,createdAt,count:values.length,reason,preview:values.map(v=>v.title).join(' · ').slice(0,300)};}
export function memoryHistory() {return (db.prepare('SELECT * FROM memory_history ORDER BY created_at DESC').all() as any[]).map(row=>{const values=JSON.parse(row.data);return {id:row.id,createdAt:row.created_at,reason:row.reason,count:values.length,preview:values.map((v:any)=>v.title).join(' · ').slice(0,300)};});}
export function restoreMemories(id:string) {const row=db.prepare('SELECT data FROM memory_history WHERE id=?').get(id) as any;if(!row)return undefined;db.exec('BEGIN IMMEDIATE');try{snapshotMemories('before_restore');db.prepare("UPDATE entities SET deleted=1,local_edited=1 WHERE type='memories'").run();const values=JSON.parse(row.data);for(const value of values){put('memories',value);db.prepare("UPDATE entities SET deleted=0 WHERE type='memories' AND id=?").run(value.id);}db.exec('COMMIT');activity('恢复知识快照','memory','succeeded',`${values.length} 项`,id);return {ok:true,id,count:values.length,memories:values};}catch(e){db.exec('ROLLBACK');throw e;}}

// Recursive redaction is shared by every HTTP response and stored diagnostic envelope.
const privateStrings=new Set<string>();
export function registerSecret(value:unknown){if(typeof value==='string'&&value.length>=8){privateStrings.add(value);if(/^Bearer\s+/i.test(value))privateStrings.add(value.replace(/^Bearer\s+/i,''));}}
for(const row of db.prepare('SELECT data FROM connection_private').all() as any[]){try{const config=JSON.parse(row.data);registerSecret(config.apiKey);for(const [name,value]of Object.entries(config.headers||{}))if(/authorization|api.?key|token/i.test(name))registerSecret(value);}catch{}}
export function publicValue<T>(v:T):T {if(Array.isArray(v))return v.map(publicValue) as T;if(v&&typeof v==='object'){const out:Record<string,any>={};for(const [k,val]of Object.entries(v)){if(/^(apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|appSecret|app_secret|authorization|password|secret|token|headers|diskPath)$/i.test(k))continue;out[k]=publicValue(val);}return out as T;}if(typeof v==='string'){let text=v.replace(/\bsk-[a-zA-Z0-9_-]{16,}\b/g,'[redacted]');for(const secret of privateStrings)if(text.includes(secret))text=text.split(secret).join('[redacted]');return text as T;}return v;}
export function bootstrap():Bootstrap {const summarize=(entity:any,limit:number)=>{const out={...entity};for(const key of ['body','content','summary','markdown'])if(typeof out[key]==='string')out[key]=out[key].slice(0,limit);delete out.transcript;delete out.messages;return out;};const sources:any={...meta<any>('sources',{}),primaryConversationId:meta('primaryConversationId',undefined)};for(const key of ['meetings','persons','briefs','chats','mails'])if(Array.isArray(sources[key]))sources[key]=sources[key].map((x:any)=>summarize(x,600));return publicValue({tasks:list('tasks'),projects:list('projects'),inbox:list('inbox').map(presentInbox).map(i=>({...i,messages:(i.messages||[]).slice(-12),body:String(i.body||'').slice(0,8000)})),ideas:list('ideas'),activities:list('activities').slice(0,300),conversations:list('conversations'),messages:list('messages').reverse(),artifacts:list('artifacts'),connections:list('connections'),automations:list('automations'),memories:list('memories').map(x=>summarize(x,1200)),settings:settings(),sources,revision:revision()});}
