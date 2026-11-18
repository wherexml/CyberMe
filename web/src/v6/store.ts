// CyberMe V6 data layer. All business state comes from the canonical HTTP API; only
// per-viewer UI preferences and unsent drafts are kept locally (native bridge when present).
import type {Bootstrap,Message,MessagePage} from '../../../shared/types';
import {CHAT_TRANSPORT_TIMEOUT_MS} from '../../../shared/chat-budgets';
import {isTheme,type ThemeKey} from './theme';
import type {VisualEntry} from './insight-visuals';

// The MyGO bridge is typed globally by web/src/desktop/runtime.ts; V6 reads it through one accessor.
export type Host={call:(method:string,...args:any[])=>Promise<any>;window?:{toggleMaximize:()=>Promise<void>}};
export const host=():Host|undefined=>(window as any).mygo;

export class ApiError extends Error{constructor(public status:number,public data:any){super(data?.message||data?.error||`Request failed (${status})`)}}
export async function api<T=any>(method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 if(!path.startsWith('/api/')&&!path.startsWith('/files/'))throw new Error('Disallowed endpoint');
 const form=body instanceof FormData;
 const res=await fetch(path,{method,signal,cache:'no-store',credentials:'same-origin',headers:form||body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:form?body as FormData:JSON.stringify(body)});
 const type=res.headers.get('content-type')||'';const data=type.includes('json')?await res.json():await res.text();
 if(!res.ok)throw new ApiError(res.status,data);return data as T;
}
export const enc=encodeURIComponent;
export const uid=(p:string)=>p+'-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));

// ---------- Per-viewer UI state ----------
export interface BriefMark{later?:string;pick?:{label:string;index:number;requestId?:string};why?:string;at?:string}
export interface JournalEntry{at:string;title:string;choice:string;why:string;itemId:string}
export interface ChatRecord{requestId:string;conversationId:string;message:string;contextIds:string[];attachmentIds:string[];status:'prepared'|'queued'|'running'|'succeeded'|'failed'|'partial'|'cancelled'|'unknown';error?:string;failureCode?:string;runId?:string;createdAt:string;quote?:string;refs?:string[];pick?:{kind:'brief'|'work';id:string;index:number;label:string};missing?:boolean;memoryProjectId?:string|null;queueCurrent?:boolean}
// A composer draft per owner (conversation). `pick` is the hidden record binding of a Brief/work/idea choice
// (sent as contextIds, never shown as a chip); `auto` is the unedited automatic option fragment a new pick may replace.
export interface DraftPick{k:'brief'|'work'|'idea'|'ctx';id:string;i:number;label:string;optionId?:string;revision?:number;quote?:string|null}
// `skill` is the composer's selected local skill {id,name}; sent as the leading `/skill:name` command.
export interface DraftSkill{id:string;name:string}
export interface DraftState{text:string;quote:string|null;refs:string[];pick?:DraftPick|null;auto?:string|null;skill?:DraftSkill|null}
export interface ModelProbeReceipt{id:string;version:string}
export interface ProviderProbeReceipt extends ModelProbeReceipt{providerId:string;draft:boolean}
// Typed-action receipt: operation identity, binding and immutable input only (no source text). See v6-data-contract.md.
export type ActionPhase='pending'|'not_saved'|'unknown'|'missing'|'succeeded'|'failed'|'refused';
export interface ActionReceipt{operationId:string;type:string;binding:{entityKind:'inbox'|'idea';entityId:string;requestMessageId?:string;requestRevision?:string;provenanceKey?:string};extra?:{until?:string};at:string;phase:ActionPhase;taskId?:string;dismissalId?:string;code?:string;message?:string}
export const UNRESOLVED:ActionPhase[]=['pending','not_saved','unknown','missing'];
export interface UIState{v:1;theme:ThemeKey;panelW:number|null;panelRatio:number|null;panel:boolean;tab:'today'|'tasks'|'memory'|'settings';briefTab:'dec'|'ins'|null;buddy:string;workOpen:string|null;workOpenSet?:boolean;brief:Record<string,BriefMark>;journal:JournalEntry[];gal:Record<string,boolean>;drafts:Record<string,DraftState>;requests:ChatRecord[];conversationId:string|null;cfg:{enterSend:boolean;progress:boolean};memDraft:MemDraft|null;proposals:Proposal[];actions:Record<string,ActionReceipt>;modelProbe?:ModelProbeReceipt;providerModelProbe?:ProviderProbeReceipt}
/** V6 email proposal: UI state around real Inbox draft, approval/send and follow-up task APIs. Statuses only come from API results. */
export interface Proposal{id:string;conversationId:string;itemIds:string[];picked:string[];tone:'brief'|'warm';createdAt:string;attempted?:string;created?:string;drafts:Record<string,{requestId:string;status:string;error?:string;tone?:'brief'|'warm'}>;sends:Record<string,{key:string;status:string;error?:string}>;sentAt?:string;task?:{taskId:string;title:string;sourceIds:string[];status:string;error?:string};follow?:{taskId:string;title:string;sourceIds:string[];due:string;status:string;error?:string}}
/** Unsaved or conflicting memory edit; kept across card, tab and app restarts until saved or deliberately discarded. */
export interface MemDraft{kind:'soul'|'memory';idx:number;text:string;base:string;status:''|'conflict'|'error'}
const KEY='cyberme-v6-ui';
const DEFAULT:UIState={v:1,theme:'quiet',panelW:null,panelRatio:null,panel:true,tab:'today',briefTab:null,buddy:'classic',workOpen:null,brief:{},journal:[],gal:{},drafts:{},requests:[],conversationId:null,cfg:{enterSend:true,progress:true},memDraft:null,proposals:[],actions:{}};
function sanitize(raw:any):UIState{
 const s={...DEFAULT,...(raw&&typeof raw==='object'?raw:{})} as UIState;
 s.panelRatio=typeof s.panelRatio==='number'&&Number.isFinite(s.panelRatio)?Math.max(1/3,Math.min(2/3,s.panelRatio)):null;
 s.panelW=typeof s.panelW==='number'&&Number.isFinite(s.panelW)&&s.panelW>0?s.panelW:null;
 if(!isTheme(s.theme))s.theme='quiet';if(!['today','tasks','memory','settings'].includes(s.tab))s.tab='today';
 s.requests=Array.isArray(s.requests)?s.requests.filter(r=>r&&typeof r.requestId==='string'&&typeof r.message==='string').slice(-200):[];
 s.journal=Array.isArray(s.journal)?s.journal.slice(0,200):[];s.cfg={...DEFAULT.cfg,...(s.cfg||{})};
 for(const k of ['brief','gal','drafts'] as const)if(!s[k]||typeof s[k]!=='object')(s as any)[k]={};
 for(const [k,d] of Object.entries(s.drafts)){const v:any=d;if(!v||typeof v!=='object'||typeof v.text!=='string'){delete s.drafts[k];continue}
  if(!Array.isArray(v.refs))v.refs=[];if(typeof v.quote!=='string')v.quote=null;if(typeof v.auto!=='string')v.auto=null;
  const p=v.pick;v.pick=p&&typeof p==='object'&&['brief','work','idea','ctx'].includes(p.k)&&typeof p.id==='string'&&typeof p.i==='number'&&typeof p.label==='string'?p:null;
  const sk=v.skill;v.skill=sk&&typeof sk==='object'&&typeof sk.id==='string'&&sk.id&&typeof sk.name==='string'&&/^[A-Za-z0-9][\w.-]{0,79}$/.test(sk.name)?{id:sk.id,name:sk.name}:null}
 s.proposals=Array.isArray(s.proposals)?s.proposals.filter(p=>p&&typeof p.id==='string'&&Array.isArray(p.itemIds)&&Array.isArray(p.picked)&&p.drafts&&typeof p.drafts==='object'&&p.sends&&typeof p.sends==='object').slice(-50):[];
 s.actions=sanitizeActions(s.actions);
 const probe=s.modelProbe;
 s.modelProbe=probe&&typeof probe.id==='string'&&/^[\w-]{1,128}$/.test(probe.id)&&typeof probe.version==='string'?{id:probe.id,version:probe.version}:undefined;
 const providerProbe=s.providerModelProbe;
 s.providerModelProbe=providerProbe&&typeof providerProbe.id==='string'&&/^[\w-]{1,128}$/.test(providerProbe.id)&&typeof providerProbe.version==='string'&&typeof providerProbe.providerId==='string'
  ?{id:providerProbe.id,version:providerProbe.version,providerId:providerProbe.providerId,draft:providerProbe.draft===true}:undefined;
 const m:any=s.memDraft;s.memDraft=m&&(m.kind==='soul'||m.kind==='memory')&&Number.isInteger(m.idx)&&typeof m.text==='string'&&typeof m.base==='string'&&m.base?{kind:m.kind,idx:m.idx,text:m.text,base:m.base,status:m.status==='conflict'||m.status==='error'?m.status:''}:null;
 return s;
}
/** Keeps every well-formed unresolved receipt; prunes only terminal receipts older than 30 days. */
function sanitizeActions(raw:any):Record<string,ActionReceipt>{
 const out:Record<string,ActionReceipt>={};if(!raw||typeof raw!=='object')return out;
 const phases:ActionPhase[]=['pending','not_saved','unknown','missing','succeeded','failed','refused'];
 for(const [k,v] of Object.entries(raw)){const r:any=v;
  if(!r||typeof r.operationId!=='string'||typeof r.type!=='string'||!phases.includes(r.phase)||!r.binding||typeof r.binding.entityId!=='string'||!['inbox','idea'].includes(r.binding.entityKind))continue;
  if(!UNRESOLVED.includes(r.phase)&&Date.now()-Date.parse(String(r.at||''))>30*864e5)continue;
  out[k]=r;
 }
 return out;
}
let ui:UIState=DEFAULT;const listeners=new Set<()=>void>();let saving=Promise.resolve();let saveError:string|null=null;let localError:string|null=null;
export const getUI=()=>ui;export const uiError=()=>saveError;
export function subscribeUI(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}}
export async function loadUI(){
 let raw:any=null;try{raw=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
 if(host()){try{const scope=await host()!.call('Bridge.Scope');if(localStorage.getItem(KEY+'-scope')!==scope){raw=null;localStorage.removeItem(KEY);localStorage.setItem(KEY+'-unsynced','false');localStorage.setItem(KEY+'-scope',scope)}}catch{}
  try{const state=await host()!.call('Bridge.ReadState');const native=state?.drafts?.['html:'+KEY];if(native&&localStorage.getItem(KEY+'-unsynced')!=='true')raw=JSON.parse(native)}catch{}}
 ui=sanitize(raw);
 try{const legacy=localStorage.getItem('cm-buddy');if(legacy&&!raw?.buddy)ui.buddy=legacy}catch{}
}
export function setUI(patch:Partial<UIState>|((s:UIState)=>Partial<UIState>)){
 const next=typeof patch==='function'?patch(ui):patch;ui={...ui,...next};listeners.forEach(f=>f());persist();
}
let persistTimer:number|undefined;
function persist(){
 const text=JSON.stringify(ui);try{localStorage.setItem(KEY,text);localStorage.setItem(KEY+'-unsynced','true');localError=null}catch(e:any){localError=String(e?.message||e)}
 if(!host()){try{localStorage.setItem(KEY+'-unsynced','false')}catch{};return}
 clearTimeout(persistTimer);persistTimer=window.setTimeout(flushNative,250);
}
function flushNative(){
 persistTimer=undefined;
 const text=JSON.stringify(ui);
 saving=saving.catch(()=>{}).then(async()=>{
  // Read-modify-write so the legacy shell's drafts in the same state file are preserved.
  for(let attempt=0;attempt<3;attempt++){const state=await host()!.call('Bridge.ReadState');const next={...state,drafts:{...(state.drafts||{}),['html:'+KEY]:JSON.stringify(ui)}};try{await host()!.call('Bridge.SaveState',next);saveError=null;if(JSON.stringify(ui)===text)localStorage.setItem(KEY+'-unsynced','false');return}catch(e:any){if(!String(e?.message||e).includes('conflict')||attempt===2)throw e}}
 }).catch(e=>{saveError=String(e?.message||e);listeners.forEach(f=>f())});
}
/** Resolves only once the current UI state is stored; rejects when the native save (or browser storage) failed. */
export async function durable(){if(persistTimer!==undefined){clearTimeout(persistTimer);persistTimer=undefined;if(host())flushNative()}await saving;const err=host()?saveError:localError;if(err)throw new Error(err)}

// ---------- Workspace snapshot ----------
export interface Workspace extends Bootstrap{primaryConversationId?:string;work?:{panels:any[];works:any[]};automaticMemories?:any[];ideasBackground?:any;insightVisuals?:Record<string,VisualEntry>}
export async function loadWorkspace():Promise<Workspace>{
 const b=await api<Workspace>('GET','/api/bootstrap?include=insightVisuals');
 // Bootstrap already carries the canonical main conversation. Auxiliary reads
 // must not hold the first usable workspace behind another network round trip.
 b.primaryConversationId=b.sources?.primaryConversationId;
 return b;
}
export async function loadWork(conversationId:string){return api<{panels:any[];works:any[]}>('GET','/api/chat/work/conversations/'+enc(conversationId),undefined,AbortSignal.timeout(15000))}

// ---------- Conversation messages ----------
export async function loadMessages(conversationId:string,before?:string){
 return api<MessagePage>('GET','/api/conversations/'+enc(conversationId)+'/messages?limit=50'+(before?'&before='+enc(before):''));
}

// ---------- Chat requests: receipts, recovery, no blind resend ----------
const posts=new Set<string>(),polls=new Set<string>();
function updateRecord(id:string,patch:Partial<ChatRecord>){setUI(s=>({requests:s.requests.map(r=>r.requestId===id?{...r,...patch}:r)}))}
const findRecord=(id:string)=>ui.requests.find(r=>r.requestId===id);
// Registered by the memory cache (which imports this module). A failed refresh never affects the chat receipt.
const chatMemoryListeners=new Set<(keys:string[])=>void>();
export function onChatMemoryChanged(fn:(keys:string[])=>void){chatMemoryListeners.add(fn);return()=>{chatMemoryListeners.delete(fn)}}
function settle(id:string,value:any){
 if(value.status==='succeeded'&&Array.isArray(value.memoryChanged))for(const fn of chatMemoryListeners){try{fn(value.memoryChanged)}catch{}}
 const r=findRecord(id);if(!r)return true;const status=value.status;
 if(['succeeded','partial','cancelled','failed'].includes(r.status)&&['queued','running','unknown'].includes(status))return true;
 if(['succeeded','partial','queued','running','cancelled','failed'].includes(status))updateRecord(id,{status,runId:value.runId,conversationId:value.conversationId||r.conversationId,failureCode:value.failureCode,error:undefined,missing:false});
 else updateRecord(id,{status:'unknown',missing:false});
 return !['queued','running'].includes(status);
}
async function check(id:string,submitting=false){
 try{const value=await api('GET','/api/chat/requests/'+enc(id),undefined,AbortSignal.timeout(15000));settle(id,value);return value}
 catch(e:any){const r=findRecord(id);if(submitting&&e.status===404&&r?.status==='prepared')return {status:'prepared'};if(r&&!['succeeded','partial','cancelled','failed'].includes(r.status))updateRecord(id,{status:'unknown',missing:e.status===404});throw e}
}
export async function recover(id:string){
 if(polls.has(id)||posts.has(id))return;polls.add(id);
 try{let failures=0;for(;;){try{const v=await check(id);failures=0;if(!['queued','running'].includes(v.status))break}catch(e:any){if(e.status===404||++failures>=120)break}await new Promise(r=>setTimeout(r,1500))}}finally{polls.delete(id)}
}
async function execute(id:string){
 const r=findRecord(id);if(!r||posts.has(id)||['partial','succeeded','cancelled'].includes(r.status))return;posts.add(id);
 try{
  // The request must be durably recorded before it is posted; otherwise it stays unsent with its text kept for Retry.
  try{await durable()}catch(e:any){updateRecord(id,{status:'prepared',failureCode:'not_saved',error:String(e?.message||e)});return}
  updateRecord(id,{status:'prepared',failureCode:undefined,error:undefined});
  const body={requestId:r.requestId,message:r.message,conversationId:r.conversationId,mode:'chat',contextIds:r.contextIds,attachmentIds:r.attachmentIds,preservePrimary:true,...(r.queueCurrent?{queueCurrent:true}:{interruptCurrent:true}),...(r.memoryProjectId!==undefined?{memoryProjectId:r.memoryProjectId}:{})};
  let busy=false;const poll=setInterval(async()=>{if(busy)return;busy=true;try{await check(id,true)}catch{}finally{busy=false}},1500);
  try{const result=await api('POST','/api/chat',body,AbortSignal.timeout(CHAT_TRANSPORT_TIMEOUT_MS));settle(id,{status:result.status==='queued'?'queued':'succeeded',runId:result.run?.id||result.runId,conversationId:result.conversationId||r.conversationId,memoryChanged:result.memoryChanged})}
  catch{await check(id).catch(()=>{})}finally{clearInterval(poll)}
 }catch{updateRecord(id,{status:'unknown'})}
 finally{posts.delete(id);if(['queued','running','unknown'].includes(findRecord(id)?.status||''))void recover(id)}
}
/** Records the request, waits until the receipt is durably saved, then posts it. A failed save removes the
 *  unsaved receipt and rejects, so nothing is posted and the caller keeps its composer content. */
export async function startChat(input:Omit<ChatRecord,'requestId'|'status'|'createdAt'>){
 const row:ChatRecord={...input,queueCurrent:true,requestId:uid('cyberme'),status:'prepared',createdAt:new Date().toISOString()};
 setUI(s=>({requests:[...s.requests,row].slice(-200)}));
 try{await durable()}catch(e){setUI(s=>({requests:s.requests.filter(r=>r.requestId!==row.requestId)}));throw e}
 void execute(row.requestId);return row;
}
/** Explicit retry: only a confirmed failure, or a request the server never registered, is resent. */
export async function retryChat(id:string){
 const r=findRecord(id);if(!r||posts.has(id)||['partial','cancelled','succeeded'].includes(r.status))return;
 if(r.status==='prepared'&&r.failureCode==='not_saved'){void execute(id);return}
 try{const v=await check(id);if(v.status==='failed')void execute(id)}catch(e:any){if(e.status===404)void execute(id)}
}
export function resumeChats(){for(const r of ui.requests)if(!unsent(r)&&['prepared','queued','running','unknown'].includes(r.status))void recover(r.requestId)}
/** Posted or about to post. A request whose local save failed is unsent, not in flight. */
export const inFlight=(r:ChatRecord)=>r.status==='queued'||r.status==='running'||(r.status==='prepared'&&r.failureCode!=='not_saved');
export const unsent=(r:ChatRecord)=>r.status==='prepared'&&r.failureCode==='not_saved';
export const activeRequest=(conversationId:string)=>ui.requests.find(r=>r.conversationId===conversationId&&inFlight(r));

// ---------- Settings documents (version-checked Markdown) ----------
export interface Doc{kind:string;content:string;version:string}
export const loadDoc=(kind:'soul'|'memory')=>api<Doc>('GET','/api/settings/documents/'+kind);
export const saveDoc=(kind:'soul'|'memory',content:string,version:string)=>api<Doc>('PATCH','/api/settings/documents/'+kind,{content,version});

// ---------- Native window ----------
export async function nativeCall(method:string,...args:any[]){if(!host())throw new Error('native_unavailable');return host()!.call(method,...args)}
