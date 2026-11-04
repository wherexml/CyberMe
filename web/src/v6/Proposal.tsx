import React,{useEffect,useState,useSyncExternalStore} from 'react';
import type {Ctx} from './App';
import type {InboxItem} from '../../../shared/types';
import {I} from './icons';
import {Hv,pill,actBtn,unset,type PillStatus} from './ui';
import {api,enc,uid,setUI,getUI,durable,type Proposal} from './store';
import {openClassic} from './Brief';
import {proposalState,emailSteps} from './proposal-state';

// V6 email proposal → task → review → result → follow-up, mapped onto the real Inbox contracts:
// drafts:   POST /api/inbox/:id/draft (requestId; outcome re-read from /draft-requests/:requestId)
// send:     PATCH /api/inbox/:id {approved:true} (explicit user approval) then POST /api/inbox/:id/send
//           with a durably stored idempotency key; the server policy decides, and only its result is shown
// follow-up: POST /api/tasks with a deterministic id (a replay is "already scheduled", never a duplicate)
// Nothing is shown as drafted, sent or scheduled unless the API said so.

const chip=(on:boolean,dis:boolean):React.CSSProperties=>({height:28,padding:'0 12px',border:'none',boxShadow:on?'none':'0 0 0 0.5px var(--lineStrong)',borderRadius:'var(--r-innerBtn)',font:'inherit',fontSize:14,cursor:dis?'default':'pointer',background:on?'var(--accentSoft)':'transparent',color:on?'var(--accentText)':'var(--text3)',textDecoration:on?'none':'line-through',whiteSpace:'nowrap',transition:'all 250ms ease-out'});
const bubble:React.CSSProperties={background:'var(--aiBubble)',boxShadow:'0 0 0 0.5px var(--aiLine)',borderRadius:'var(--r-bubble)'};
const ghost:React.CSSProperties={height:30,padding:'0 8px',border:'none',borderRadius:'var(--r-btn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'};

const update=(id:string,fn:(p:Proposal)=>Proposal)=>setUI(s=>({proposals:s.proposals.map(p=>p.id===id?fn(p):p)}));
const current=(id:string)=>getUI().proposals.find(p=>p.id===id);
const who=(it?:InboxItem)=>it?(it.sender||it.title):'';
const addDays=(iso:string,n:number)=>{const d=new Date(iso);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};

/** Opens a proposal in the current conversation for Inbox items that need a reply. */
export function propose(conversationId:string,itemIds:string[]){
 const p:Proposal={id:uid('v6prop'),conversationId,itemIds,picked:[...itemIds],tone:'brief',createdAt:new Date().toISOString(),drafts:{},sends:{}};
 setUI(s=>({proposals:[...s.proposals,p].slice(-50)}));return p;
}

// ---- exact receipts (read-only; observing never repeats work) ----
type Read={status:string;error?:string};
const failCode=(e:any)=>typeof e?.status==='number'&&e.status<500;
async function readDraft(item:InboxItem,requestId:string,tone?:string):Promise<Read>{
 try{const r=await api('GET','/api/inbox/'+enc(item.id)+'/draft-requests/'+enc(requestId));const st=String(r.status||r.state||'');
  if(tone&&r.tone&&r.tone!==tone)return {status:'failed',error:'This draft request was registered with a different tone.'};
  return {status:st==='succeeded'?'succeeded':st==='review'?'review':st==='failed'?'failed':['running','pending','queued','preparing'].includes(st)?'running':'unknown'}}
 catch(e:any){return {status:e.status===404?'unregistered':'unknown',error:e.message}}
}
async function readSend(item:InboxItem,key:string):Promise<Read>{
 try{const r=await api('GET','/api/inbox/'+enc(item.id)+'/send-requests/'+enc(key));const st=String(r.status||'');
  return {status:st==='sent'?'sent':st==='failed'?'failed':st==='recalled'?'recalled':'unknown'}}
 catch(e:any){return {status:e.status===404?'unregistered':'unknown',error:e.message}}
}
const sameIds=(a:unknown,b:string[])=>Array.isArray(a)&&a.length===b.length&&b.every(x=>a.includes(x));
/** The follow-up task is "scheduled" only when the persisted task with that exact id/title/sources/due date exists. */
async function readTask(f:{taskId:string;title:string;sourceIds:string[];due?:string}):Promise<Read>{
 try{const t=await api('GET','/api/tasks/'+enc(f.taskId));return t&&!t.deleted&&t.title===f.title&&sameIds(t.sourceIds,f.sourceIds)&&(f.due===undefined||String(t.dueDate||'').slice(0,10)===f.due)?{status:'done'}:{status:'failed',error:'A different task already uses this id.'}}
 catch(e:any){return {status:e.status===404?'unregistered':'unknown',error:e.message}}
}
const markCreated=(pid:string)=>update(pid,p=>p.created?p:{...p,created:new Date().toISOString()});
const readFollow=readTask;

// Draft request ids are durably recorded before the POST, so a crash can only be followed by a read of that id.
// The tone is stored with the requestId before the POST; a reused requestId is always re-sent with its recorded tone,
// and the server rejects any other tone for that id (request_conflict), so a request never changes tone in flight.
// A legacy record (registered before tones existed) has no tone and is replayed without one, keeping its original fingerprint.
async function draftOne(pid:string,item:InboxItem,tone:'brief'|'warm'|undefined,reuse?:string){
 const requestId=reuse||uid('cyberme-draft');update(pid,p=>({...p,drafts:{...p.drafts,[item.id]:{requestId,status:'starting',tone}}}));
 try{await durable()}catch(e:any){update(pid,p=>({...p,drafts:{...p.drafts,[item.id]:{requestId,status:'not_started',error:e.message,tone}}}));return}
 let r:Read;
 try{await api('POST','/api/inbox/'+enc(item.id)+'/draft',{requestId,mode:'auto',baseUpdatedAt:item.updatedAt,...(tone?{tone}:{})});r={status:'succeeded'}}
 catch(e:any){const back=await readDraft(item,requestId,tone);r=back.status==='unregistered'?{status:failCode(e)?'failed':'not_started',error:e.message}:{...back,error:back.error||e.message}}
 update(pid,p=>({...p,drafts:{...p.drafts,[item.id]:{requestId,...r,tone}}}));
}

// One busy guard per proposal, shared by every rendering (chat blocks and the task detail panel), so two mounted views
// can never start the same create/send/follow/recheck twice. `take` checks and claims atomically.
const busyMap=new Map<string,string>();const busySubs=new Set<()=>void>();
const setBusyFor=(pid:string,v:string)=>{if(v)busyMap.set(pid,v);else busyMap.delete(pid);busySubs.forEach(f=>f())};
function useBusy(pid:string):[string,(v:string)=>void,(v:string)=>boolean]{
 const busy=useSyncExternalStore(f=>{busySubs.add(f);return()=>{busySubs.delete(f)}},()=>busyMap.get(pid)||'');
 return [busy,v=>setBusyFor(pid,v),v=>{if(busyMap.get(pid))return false;setBusyFor(pid,v);return true}];
}
// Read-only reconciliation and polling run once per proposal even when several views are mounted.
const reconciling=new Set<string>(),pollers=new Set<string>();

/** Proposal state and actions on the real Inbox/task contracts, shared by the chat blocks and the task detail. */
function useProposal(ctx:Ctx,p:Proposal){
 const {ws,T,zh}=ctx;const [busy,setBusy,take]=useBusy(p.id);
 const items=p.itemIds.map(id=>ws.inbox.find(x=>x.id===id)).filter(Boolean) as InboxItem[];
 const picked=items.filter(it=>p.picked.includes(it.id));
 // Created only when the canonical task was confirmed (older proposals without one offer Create task again; drafts are reused).
 const created=!!p.created&&p.task?.status==='done';
 const draftOf=(it:InboxItem)=>String(it.draft||'').trim();
 const toneOf=(it:InboxItem)=>((it as any).draftTone||'brief') as 'brief'|'warm';
 const toneOk=(it:InboxItem)=>toneOf(it)===p.tone;
 const ready=picked.filter(it=>p.drafts[it.id]?.status==='succeeded'&&draftOf(it)&&toneOk(it));
 // Only items with no send record at all join "Send N"; every prior outcome has its own explicit control.
 const sendable=ready.filter(it=>!it.sensitive&&!p.sends[it.id]);

 // After a reload/restart, pending records are reconciled by reading their exact receipts; nothing is re-posted here.
 useEffect(()=>{if(reconciling.has(p.id))return;reconciling.add(p.id);let live=true;void (async()=>{try{const cur=current(p.id);if(!cur)return;let touched=false;
  for(const [id,d] of Object.entries(cur.drafts)){if(!d.requestId||!['starting','running','unknown'].includes(d.status))continue;const it=ws.inbox.find(x=>x.id===id);if(!it)continue;
   const r=await readDraft(it,d.requestId,d.tone);if(!live)return;const status=r.status==='unregistered'?'not_started':r.status;update(p.id,x=>({...x,drafts:{...x.drafts,[id]:{...d,status,error:r.error}}}));touched=true}
  if(cur.task&&['running','unknown'].includes(cur.task.status)){const r=await readTask(cur.task);if(!live)return;update(p.id,x=>x.task?{...x,task:{...x.task,status:r.status==='unregistered'?'not_started':r.status,error:r.error}}:x);if(r.status==='done')markCreated(p.id);touched=true}
  for(const [id,sd] of Object.entries(cur.sends)){if(!['sending','unknown'].includes(sd.status))continue;const it=ws.inbox.find(x=>x.id===id);if(!it)continue;
   const r=await readSend(it,sd.key);if(!live)return;const status=r.status==='unregistered'?'not_sent':r.status;update(p.id,x=>({...x,sends:{...x.sends,[id]:{...sd,status,error:r.error}},sentAt:status==='sent'?x.sentAt||new Date().toISOString():x.sentAt}));touched=true}
  if(cur.follow&&['running','unknown'].includes(cur.follow.status)){const r=await readFollow(cur.follow);if(!live)return;update(p.id,x=>x.follow?{...x,follow:{...x.follow,status:r.status==='unregistered'?'not_started':r.status,error:r.error}}:x);touched=true}
  if(touched&&live)void ctx.refresh()}finally{reconciling.delete(p.id)}})();return()=>{live=false}},[p.id]);// eslint-disable-line react-hooks/exhaustive-deps

 // "Task created" is bound to a deterministic canonical task (`v6-proposal-<id>`), verified by exact GET when
 // the POST is not conclusive. Its id/title/sources are durably stored before the POST; nothing else creates it.
 async function ensureTask():Promise<boolean>{
  let cur=current(p.id);if(!cur)return false;
  if(cur.task?.status==='done'){markCreated(p.id);return true}
  if(cur.task&&['unknown','running'].includes(cur.task.status)){const r=await readTask(cur.task);
   if(r.status!=='unregistered'){update(p.id,x=>x.task?{...x,task:{...x.task,status:r.status,error:r.error}}:x);if(r.status==='done')markCreated(p.id);return r.status==='done'}
   update(p.id,x=>x.task?{...x,task:{...x.task,status:'not_started'}}:x);cur=current(p.id)!}
  const ids=picked.map(it=>it.id);
  const t={taskId:cur.task&&cur.task.status!=='failed'?cur.task.taskId:'v6-proposal-'+cur.id+(cur.task?'-'+Date.now().toString(36):''),title:T.emailTitle(ids.length),sourceIds:ids,status:'running'};
  update(p.id,x=>({...x,task:t}));
  try{await durable()}catch(e:any){update(p.id,x=>({...x,task:cur!.task}));ctx.notify(e.message,'error');return false}
  let r:Read;
  try{await api('POST','/api/tasks',{id:t.taskId,title:t.title,status:'in_progress',completed:false,sourceIds:t.sourceIds,notes:picked.map(it=>who(it)).join('\n')});r={status:'done'}}
  catch(e:any){const back=await readTask(t);r=back.status==='unregistered'?{status:failCode(e)?'failed':'not_started',error:e.message}:back}
  update(p.id,x=>({...x,task:{...t,status:r.status,error:r.error}}));if(r.status==='done')markCreated(p.id);return r.status==='done';
 }
 async function recheckTask0(){const cur=current(p.id);if(cur?.task){const r=await readTask(cur.task);update(p.id,x=>x.task?{...x,task:{...x.task,status:r.status==='unregistered'?'not_started':r.status,error:r.error}}:x);if(r.status==='done')markCreated(p.id)}setBusy('')}

 async function createTask0(){if(created||!picked.length)return;update(p.id,x=>({...x,attempted:new Date().toISOString()}));
  if(!await ensureTask()){setBusy('');return}
  await draftsFor();await ctx.refresh();setBusy('')}
 // Initializes draft records for picked items that have none (or a retryable one). Only ever called from a click:
 // a task recovered by Check again or on mount waits for the explicit "Continue drafting" action.
 async function continueDrafts0(){if(!created)return;await draftsFor();await ctx.refresh();setBusy('')}
 async function draftsFor(){
  const cur=current(p.id);if(!cur)return;
  for(const it of picked){const prior=current(p.id)?.drafts[it.id];
   if(prior?.status==='succeeded'||prior?.status==='running'||prior?.status==='review')continue;
   const tone=cur.tone;
   if(prior?.requestId&&['unknown','starting'].includes(prior.status)){const r=await readDraft(it,prior.requestId,prior.tone);if(r.status!=='unregistered'){update(p.id,x=>({...x,drafts:{...x.drafts,[it.id]:{...prior,...r}}}));if(r.status!=='failed')continue}else{await draftOne(p.id,it,prior.tone,prior.requestId);continue}}
   // An existing draft is reused only in the proposal's tone; a different-tone draft the user edited is never overwritten.
   if(draftOf(it)&&!(it as any).draftStale&&toneOf(it)===tone){update(p.id,x=>({...x,drafts:{...x.drafts,[it.id]:{requestId:'',status:'succeeded',tone}}}));continue}
   if(draftOf(it)&&(it as any).editedByUser&&toneOf(it)!==tone){update(p.id,x=>({...x,drafts:{...x.drafts,[it.id]:{requestId:'',status:'review',tone,error:zh?'已有你修改过的草稿，语气不同；请在完整收件箱中处理。':'An edited draft in a different tone already exists; review it in the full Inbox.'}}}));continue}
   // A request the server never registered is retried with the same id and tone; a confirmed failure gets a new id.
   await draftOne(p.id,it,prior?.status==='not_started'&&prior.requestId?prior.tone:tone,prior?.status==='not_started'?prior.requestId:undefined)}
 }
 async function draftRead(it:InboxItem){const d=current(p.id)?.drafts[it.id];if(!d?.requestId)return;const r=await readDraft(it,d.requestId,d.tone);
  update(p.id,x=>({...x,drafts:{...x.drafts,[it.id]:{...d,status:r.status==='unregistered'?'not_started':r.status,error:r.error}}}));return r.status}
 // Bounded read-only polling while any draft request is still running (3 s, up to 40 reads); Check again stays available after.
 const runningDrafts=picked.filter(it=>p.drafts[it.id]?.status==='running'&&p.drafts[it.id]?.requestId).map(it=>it.id).join();
 useEffect(()=>{if(!runningDrafts||pollers.has(p.id))return;pollers.add(p.id);let n=0,live=true;const t=window.setInterval(async()=>{if(++n>40){clearInterval(t);pollers.delete(p.id);return}
  let changed=false;for(const id of runningDrafts.split(',')){const it=ws.inbox.find(x=>x.id===id);if(!it||!live)continue;const st=await draftRead(it);if(st&&st!=='running')changed=true}
  if(changed&&live)void ctx.refresh()},3000);return()=>{live=false;clearInterval(t);pollers.delete(p.id)}},[runningDrafts]);// eslint-disable-line react-hooks/exhaustive-deps

 // Outcome of one send attempt, reconciled against the exact receipt whenever the response is not conclusive.
 async function sendOne(it:InboxItem,key:string):Promise<Read>{
  try{if(!(it as any).approved)await api('PATCH','/api/inbox/'+enc(it.id),{approved:true,baseUpdatedAt:it.updatedAt})}
  catch(e:any){return {status:'not_sent',error:e.message}}
  try{const r=await api('POST','/api/inbox/'+enc(it.id)+'/send',{idempotencyKey:key,draft:draftOf(it)});const st=String(r?.item?.status||'');
   if(st==='sent')return {status:'sent'};const back=await readSend(it,key);return back.status==='unregistered'?{status:'unknown'}:back}
  catch(e:any){const back=await readSend(it,key);if(back.status==='unregistered')return {status:failCode(e)?'not_sent':'unknown',error:e.message};return {...back,error:back.error||e.message}}
 }
 async function send0(list:InboxItem[],fresh=false){if(!list.length)return;
  // Keys are durably recorded before any request: unknown outcomes are only ever re-read with the same key.
  const keys:Record<string,string>={};for(const it of list){const prior=current(p.id)?.sends[it.id];keys[it.id]=!fresh&&prior?prior.key:uid('v6send')}
  const before=Object.fromEntries(list.map(it=>[it.id,current(p.id)?.sends[it.id]]));
  update(p.id,x=>({...x,sends:{...x.sends,...Object.fromEntries(list.map(it=>[it.id,{key:keys[it.id],status:'sending'}]))}}));
  try{await durable()}catch(e:any){update(p.id,x=>{const sends={...x.sends};for(const it of list){const b=before[it.id];if(b)sends[it.id]=b;else delete sends[it.id]}return {...x,sends}});ctx.notify(e.message,'error');setBusy('');return}
  for(const it of list){const r=await sendOne(it,keys[it.id]);
   update(p.id,x=>({...x,sends:{...x.sends,[it.id]:{key:keys[it.id],status:r.status,error:r.error}},sentAt:r.status==='sent'?x.sentAt||new Date().toISOString():x.sentAt}))}
  await ctx.refresh();setBusy('')}
 async function recheck0(it:InboxItem){const sd=current(p.id)?.sends[it.id];if(!sd)return;const r=await readSend(it,sd.key);
  update(p.id,x=>({...x,sends:{...x.sends,[it.id]:{...sd,status:r.status==='unregistered'?'not_sent':r.status,error:r.error}},sentAt:r.status==='sent'?x.sentAt||new Date().toISOString():x.sentAt}));await ctx.refresh();setBusy('')}

 async function recheckFollow0(){const cur=current(p.id);if(!cur?.follow)return;const r=await readFollow(cur.follow);
  update(p.id,x=>x.follow?{...x,follow:{...x.follow,status:r.status==='unregistered'?'not_started':r.status,error:r.error}}:x);await ctx.refresh();setBusy('')}
 // POST only when nothing is pending or ambiguous: not_started reuses its id, a confirmed failure gets a new one, unknown is only read.
 async function follow0(){const cur=current(p.id);if(!cur?.sentAt||['done','unknown','running'].includes(String(cur.follow?.status)))return;
  const sent=cur.itemIds.filter(id=>cur.sends[id]?.status==='sent');
  const f=cur.follow&&cur.follow.status!=='failed'?cur.follow:{taskId:'v6-follow-'+cur.id+(cur.follow?'-'+Date.now().toString(36):''),title:zh?`检查 ${sent.length} 封跟进邮件的回复`:`Check for replies to ${sent.length} follow-up email${sent.length===1?'':'s'}`,sourceIds:sent,due:addDays(cur.sentAt,3),status:'running'};
  update(p.id,x=>({...x,follow:{...f,status:'running',error:undefined}}));
  try{await durable()}catch(e:any){update(p.id,x=>({...x,follow:cur.follow}));ctx.notify(e.message,'error');setBusy('');return}
  let r:Read;
  try{await api('POST','/api/tasks',{id:f.taskId,title:f.title,status:'pending',completed:false,dueDate:f.due,notes:f.sourceIds.map(id=>who(ws.inbox.find(x=>x.id===id))).join('\n'),sourceIds:f.sourceIds});r={status:'done'}}
  catch(e:any){const back=await readFollow(f);r=back.status==='unregistered'?{status:failCode(e)?'failed':'not_started',error:e.message}:back}
  update(p.id,x=>({...x,follow:{...f,status:r.status,error:r.error}}));await ctx.refresh();setBusy('')}

 // Aggregate state for the task event, strictly from recorded API outcomes.
 // Shared pure projection (proposal-state.ts): the same status and step as the Tasks list row and the task detail.
 const {status:st,step}=proposalState(p,ws.inbox);
 const missingDrafts=created&&!busy&&picked.some(it=>!p.drafts[it.id]);
 const taskFailed=!created&&!busy&&['failed','not_started'].includes(String(p.task?.status));
 const sentItems=items.filter(it=>p.sends[it.id]?.status==='sent'),otherSends=items.filter(it=>p.sends[it.id]&&p.sends[it.id].status!=='sent'&&p.sends[it.id].status!=='sending');
 const fdate=p.sentAt?new Date(addDays(p.sentAt,3)).toLocaleDateString(zh?'zh-CN':'en-US',{month:zh?'numeric':'short',day:'numeric'}):'';
 const evidence=()=>items[0]&&ctx.openDetail({type:'ins',id:items[0].id});
 // Every acting control goes through one guard per proposal: claim atomically, run, and always release — also when an
 // action throws unexpectedly (then the error is shown and the recorded state stays as the action left it).
 const guarded=async(tag:string,fn:()=>Promise<unknown>)=>{if(!take(tag))return;try{await fn()}catch(e:any){ctx.notify(e?.message||String(e),'error')}finally{setBusy('')}};
 const recheckTask=()=>guarded('create',recheckTask0),createTask=()=>guarded('create',createTask0),continueDrafts=()=>guarded('create',continueDrafts0);
 const send=(list:InboxItem[],fresh=false)=>guarded('send',()=>send0(list,fresh)),recheck=(it:InboxItem)=>guarded('check',()=>recheck0(it));
 const recheckFollow=()=>guarded('follow',recheckFollow0),follow=()=>guarded('follow',follow0);
 // Per-row draft recovery: a never-registered request is retried with its own id and tone; a confirmed failure gets a new id.
 const retryDraft=(it:InboxItem)=>guarded('draft',async()=>{const d=current(p.id)?.drafts[it.id];const reuse=d?.status==='not_started'&&d.requestId?d.requestId:undefined;await draftOne(p.id,it,reuse?d!.tone:p.tone,reuse);await ctx.refresh()});
 const checkDraft=(it:InboxItem)=>guarded('check',async()=>{await draftRead(it);await ctx.refresh()});
 // Event-card Retry (reference R:172), draft branch only: no send record among the selected ids, every present recipient has a
 // draft record, nothing in flight, no legacy draft without a requestId, and at least one present failed/not_started draft.
 // The current proposal is re-read inside the shared guard, so a stale click (new send, unknown id, already retried) does nothing.
 const draftRetryable=(x:Proposal|undefined)=>{if(!x||!x.created||x.task?.status!=='done'||x.picked.some(id=>x.sends[id]))return false;
  const ds=x.picked.filter(id=>ws.inbox.some(it=>it.id===id)).map(id=>x.drafts[id]);
  if(ds.some(d=>!d||d.status==='running'||d.status==='starting'||(!d.requestId&&d.status!=='succeeded'&&d.status!=='review')))return false;
  return ds.some(d=>d.status==='failed'||d.status==='not_started')};
 const retryDrafts=()=>guarded('create',async()=>{if(!draftRetryable(current(p.id)))return;await draftsFor();await ctx.refresh()});
 const canRetryDrafts=created&&st==='failed'&&!busy&&!missingDrafts&&draftRetryable(p);
 // Reference openTask (R:1380): every task entry opens the right panel on the original canonical email task — never the follow-up.
 const openTask=()=>{const id=current(p.id)?.task?.taskId;if(id)ctx.openDetail({type:'task',id})};
 return {ws,T,zh,busy,items,picked,created,draftOf,ready,sendable,createTask,recheckTask,continueDrafts,draftRead,retryDraft,retryDrafts,canRetryDrafts,checkDraft,send,recheck,recheckFollow,follow,st,missingDrafts,taskFailed,sentItems,otherSends,fdate,evidence,openTask,step};
}

export function ProposalBlocks({ctx,p}:{ctx:Ctx;p:Proposal}){
 const {T,zh,busy,items,picked,created,createTask,recheckTask,continueDrafts,retryDrafts,canRetryDrafts,follow,recheckFollow,st,step,missingDrafts,taskFailed,sentItems,otherSends,fdate,evidence,openTask}=useProposal(ctx,p);
 // Reference hover quote (R:1946-1952): the proposal quotes its rendered sentence, the result its rendered title; the
 // task-created event row has none. Quoting only sets the composer quote (App quoteFrom: ≤800 chars, focus, draft kept).
 const resultTitle=sentItems.length?T.sentN(sentItems.length):T.notSentN(otherSends.length);
 const qProp=ctx.quoteRow('prop:'+p.id,T.proposal),qRes=ctx.quoteRow('res:'+p.id,resultTitle);

 return <>
  <div {...qProp.row} style={{display:'flex',gap:10,alignItems:'flex-start',animation:'cmIn 250ms ease-out both'}}><div style={{minWidth:0,maxWidth:'85%',display:'flex',flexDirection:'column',gap:8}}>
   <div data-ai-text="1" style={{width:'fit-content',...bubble,padding:'10px 14px',textWrap:'pretty',lineHeight:1.6} as React.CSSProperties}>{T.proposal}</div>
   <div style={{...bubble,padding:16,display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:12,color:'var(--accentText)'}}>{T.actionH}</span><span style={{fontSize:16,fontWeight:600}}>{T.emailTitle(picked.length)}</span></div>
    <div style={{display:'grid',gridTemplateColumns:'72px 1fr',gap:'10px 12px',alignItems:'center'}}>
     <span style={{fontSize:12,color:'var(--text3)'}}>{T.recipients}</span>
     <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{items.map(it=>{const on=p.picked.includes(it.id);return <button key={it.id} type="button" aria-pressed={on} aria-disabled={created||undefined} title={it.channel} onClick={()=>!created&&update(p.id,x=>x.created?x:({...x,picked:on?x.picked.filter(i=>i!==it.id):[...x.picked,it.id]}))} style={chip(on,created)}>{who(it)}</button>})}</div>
     <span style={{fontSize:12,color:'var(--text3)'}}>{T.tone}</span>
     <div style={{display:'flex',gap:6}}>{(['brief','warm'] as const).map(k=><button key={k} type="button" aria-pressed={p.tone===k} aria-disabled={created||undefined} onClick={()=>!created&&update(p.id,x=>x.created||Object.keys(x.drafts).length?x:{...x,tone:k})} style={{...chip(p.tone===k,created),textDecoration:'none'}}>{T[k]}</button>)}</div>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:8}}>
     {!created&&picked.length&&!['unknown','running'].includes(String(p.task?.status))?<Hv onClick={()=>void createTask()} disabled={!!busy} style={{...actBtn('primary'),transition:'background 250ms ease-out'}} hover={{background:'var(--accentHover)'}}>{T.createTask}</Hv>:null}
     {!created&&!picked.length?<span style={{fontSize:12,color:'var(--text3)'}}>{T.pickOne}</span>:null}
     {taskFailed?<span title={p.task?.error} style={{fontSize:12,color:'var(--errText)'}}>{zh?'未能创建任务，可以重试':'No task was created; try again'}</span>:null}
     {!created&&p.task?.status==='unknown'?<><span title={p.task.error} style={{fontSize:12,color:'var(--warnText)'}}>{T.ts.unknown}</span><Hv onClick={()=>void recheckTask()} disabled={!!busy} style={actBtn('sec')} hover={{background:'var(--selected)'}}>{T.checkAgain}</Hv></>:null}
     {!created&&busy==='create'?<span style={{fontSize:12,color:'var(--text3)'}}>{T.ts.running}</span>:null}
     {created?<><span style={{fontSize:12,color:'var(--text3)'}}>{T.taskExists}</span><Hv onClick={openTask} style={actBtn('sec')} hover={{background:'var(--selected)'}}>{T.viewTask}</Hv></>:null}
     <div style={{flex:1}}/>
     <Hv onClick={evidence} style={{...ghost,height:32,padding:'0 10px'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.evidence}</Hv>
    </div>
   </div>
  </div>{qProp.btn}</div>

  {created?<div style={{display:'flex',gap:10,alignItems:'flex-start',animation:'cmIn 250ms ease-out both'}}><div style={{flex:1,minWidth:0,maxWidth:'85%',...bubble,padding:'12px 12px 12px 14px',display:'flex',flexDirection:'column',gap:10}}>
   <div style={{display:'flex',alignItems:'center',gap:12}}>
    <button type="button" onClick={openTask} style={unset({all:'unset',cursor:'pointer',flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2})}><span style={{fontSize:12,color:'var(--text3)'}}>{T.taskCreated}</span><span style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{T.emailTitle(picked.length)}</span></button>
    <span style={pill(st)}>{T.ts[st]}</span>
    {missingDrafts?<Hv onClick={()=>void continueDrafts()} disabled={!!busy} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:14,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--accentHover)'}}>{zh?'继续起草':'Continue drafting'}</Hv>:null}
    {canRetryDrafts?<Hv onClick={()=>void retryDrafts()} disabled={!!busy} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.retry}</Hv>:null}
    {st==='confirm'&&!missingDrafts?<Hv onClick={openTask} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:14,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--accentHover)'}}>{T.review}</Hv>:null}
   </div>
   {/* Reference task bar (R:175-176, taskView R:1460-1465; hidden by the conversation progress setting, R:1948): real step of the four email steps. */}
   {['queued','running','sending','confirm'].includes(st)&&ctx.ui.cfg.progress?<div style={{height:2,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><div style={{display:'block',height:'100%',width:Math.max(6,((step+(st==='queued'?0:.5))/4)*100)+'%',background:st==='confirm'?'var(--warnDot)':'var(--accent)',transition:'width 250ms ease-out'}}/></div>:null}
  </div></div>:null}

  {sentItems.length||otherSends.length?<div {...qRes.row} style={{display:'flex',gap:10,alignItems:'flex-start',animation:'cmIn 250ms ease-out both'}}><div style={{flex:1,minWidth:0,maxWidth:'85%',...bubble,padding:'14px 14px 10px',display:'flex',flexDirection:'column',gap:8}}>
   <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:sentItems.length?'var(--okText)':'var(--warnText)'}}><I n={sentItems.length?'check':'circle'} style={{fontSize:14}}/><span>{T.resultH}</span></div>
   <div data-ai-text="1" style={{fontSize:16,fontWeight:600}}>{resultTitle}</div>
   <div style={{display:'flex',flexDirection:'column',gap:2,color:'var(--text2)'}}>
    {sentItems.map(it=><span key={it.id}>{[who(it),it.channel].filter(Boolean).join(', ')}</span>)}
    {sentItems.length?otherSends.map(it=><span key={it.id} style={{color:'var(--text3)'}}>{who(it)} · {p.sends[it.id].status==='recalled'?(zh?'已撤回':'Recalled'):['failed','not_sent'].includes(p.sends[it.id].status)?T.ts.failed:T.ts.unknown}</span>):otherSends.map(it=><span key={it.id}>{who(it)} · {p.sends[it.id].status==='recalled'?(zh?'已撤回':'Recalled'):p.sends[it.id].error||T.ts[['failed','not_sent'].includes(p.sends[it.id].status)?'failed':'unknown']}</span>)}
   </div>
   <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',margin:'4px 0 0 -8px'}}>
    <Hv onClick={evidence} style={ghost} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.evidence}</Hv>
    <Hv onClick={openTask} style={ghost} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.taskDetails}</Hv>
    <div style={{flex:1}}/>
    {p.follow?.status==='unknown'?<Hv onClick={()=>void recheckFollow()} disabled={!!busy} title={p.follow.error} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.checkAgain}</Hv>:null}
    {sentItems.length&&(!p.follow||['failed','not_started'].includes(p.follow.status))?<Hv onClick={()=>void follow()} disabled={!!busy} title={p.follow?.error} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.follow(fdate)}</Hv>:null}
    {p.follow?.status==='running'?<span style={{fontSize:12,color:'var(--text3)',paddingRight:4}}>…</span>:null}
    {p.follow?.status==='done'?<span style={{fontSize:12,color:'var(--text3)',paddingRight:4}}>{T.followDone}</span>:null}
   </div>
  </div>{qRes.btn}</div>:null}
 </>;
}

/** Reference email task detail (R:863-910) for the canonical proposal task. It renders only recorded API outcomes; opening
 *  it posts nothing. Draft/send recovery controls that the inline chat review used to hold live here. */
export function ProposalTaskDetail({ctx,p,task,discuss}:{ctx:Ctx;p:Proposal;task:any;discuss:(id:string)=>void}){
 const m=useProposal(ctx,p);const {T,zh,busy,picked,draftOf,sendable,st,step,missingDrafts,sentItems,otherSends}=m;
 // The workspace list can lag (initial load, right after Create task): an exact read decides. Unavailable only when the
 // server confirms the task is missing (404) or deleted; other failures show a retryable "could not check" state.
 const taskId=p.task?.taskId||'';const [look,setLook]=useState<{s:'loading'|'found'|'missing'|'error';task?:any;error?:string}>({s:'loading'});const [nonce,setNonce]=useState(0);
 useEffect(()=>{if(task||!taskId)return;let live=true;setLook({s:'loading'});
  api('GET','/api/tasks/'+enc(taskId)).then((t:any)=>{if(!live)return;if(t&&!t.deleted){setLook({s:'found',task:t});void ctx.refresh()}else setLook({s:'missing'})})
   .catch((e:any)=>{if(live)setLook(e?.status===404?{s:'missing'}:{s:'error',error:e?.message})});return()=>{live=false}},[!!task,taskId,nonce]);// eslint-disable-line react-hooks/exhaustive-deps
 task=task||look.task;
 const box:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'20px 20px 24px',display:'flex',flexDirection:'column',gap:22,animation:'cmSlide 250ms ease-out both'};
 if(!task)return <div style={box}>{look.s==='missing'||!taskId?<div style={{color:'var(--text2)'}}>{zh?'这项任务已不存在或已被移除。':'This task no longer exists.'}</div>
  :look.s==='error'?<div style={{display:'flex',alignItems:'center',gap:8}}><span title={look.error} style={{flex:1,color:'var(--warnText)'}}>{zh?'暂时无法确认这项任务的状态。':'Could not check this task right now.'}</span><Hv onClick={()=>setNonce(n=>n+1)} style={actBtn('sec')} hover={{background:'var(--selected)'}}>{T.checkAgain}</Hv></div>
  :<div style={{color:'var(--text3)'}}>{zh?'正在读取任务…':'Loading task…'}</div>}</div>;
 const steps=emailSteps(zh);
 const live=['running','sending'].includes(st);
 const ring=st==='failed'?'var(--errDot)':st==='confirm'?'var(--warnDot)':'var(--accent)';
 const failMsg=st==='failed'?(picked.map(it=>p.sends[it.id]?.error||p.drafts[it.id]?.error).find(Boolean)||T.ts.failed):'';
 const rowNote=(it:InboxItem)=>{const d=p.drafts[it.id],sd=p.sends[it.id];const dst=d?.status;
  return sd?(sd.status==='sent'?T.ts.done:sd.status==='sending'?T.ts.sending:sd.status==='failed'||sd.status==='not_sent'?(sd.error||T.ts.failed):sd.status==='recalled'?(zh?'已撤回':'Recalled'):T.ts.unknown)
   :dst==='running'||dst==='starting'?T.ts.running:dst==='review'?(d?.error||(zh?'候选草稿待在完整收件箱中审阅':'Draft candidate needs review in the full Inbox')):dst&&dst!=='succeeded'?(d?.error||T.ts[dst==='failed'||dst==='not_started'?'failed':'unknown']):it.sensitive?(zh?'敏感事项需在完整收件箱中审批':'Sensitive: approve in the full Inbox'):!dst?(zh?'尚未起草':'Not drafted yet'):''};
 const small:React.CSSProperties={...ghost,height:26,fontSize:12};
 // Strict reference (R:877 `dT.isConfirm`, user-approved 2026-10-29): the whole draft region shows only while awaiting review.
 // Drafts and receipts stay recorded; the failure note and sent results remain outside this visibility gate.
 const showDrafts=picked.length>0&&st==='confirm';
 // Reference jumpTo (R:1387): scroll to this proposal's own timeline block and flash it, switching conversation when needed.
 const conv=()=>ctx.jumpToProposal(p.id,p.conversationId);
 return <div style={box}>
  <div style={{display:'flex',flexDirection:'column',gap:10,alignItems:'flex-start'}}><span style={pill(st)}>{T.ts[st]}</span><div style={{fontSize:20,fontWeight:600,lineHeight:1.3,letterSpacing:'-0.01em',textWrap:'pretty'} as React.CSSProperties}>{task.title||T.emailTitle(picked.length)}</div></div>
  <div style={{display:'flex',flexDirection:'column',gap:12}}><div style={{fontSize:12,color:'var(--text3)'}}>{T.stepsH}</div>
   {steps.map((label,i)=>{const done=i<step;const cur=!done&&i===step&&st!=='queued';
    const mark:React.CSSProperties={width:16,height:16,borderRadius:'50%',flex:'none',display:'flex',alignItems:'center',justifyContent:'center',boxSizing:'border-box',transition:'all 250ms ease-out',...(done?{background:'var(--accent)',color:'var(--onAccent)'}:cur?{border:`1.5px solid ${ring}`,animation:live?'cmPulse 1.4s ease-in-out infinite':'none'}:{border:'1px solid var(--lineStrong)'})};
    return <div key={i} style={{display:'flex',alignItems:'center',gap:12}}><span style={mark}>{done?<I n="check" style={{fontSize:12}}/>:null}</span><span style={{color:done?'var(--text2)':cur?'var(--text)':'var(--text3)',fontWeight:cur?500:400}}>{label}</span></div>})}
  </div>
  {showDrafts?<div style={{display:'flex',flexDirection:'column',gap:12,animation:'cmIn 250ms ease-out both'}}>
   <div style={{fontSize:12,color:'var(--text3)'}}>{T.draftsH}</div>
   <div style={{borderRadius:'var(--r-inner)',background:'var(--hover)',overflow:'hidden'}}>
    {picked.map((it,i)=>{const d=p.drafts[it.id],sd=p.sends[it.id];const dst=d?.status;const text=draftOf(it);const note=rowNote(it);
     return <div key={it.id} style={{padding:'12px 14px',display:'flex',flexDirection:'column',gap:2,borderTop:i?'0.5px solid var(--line)':'none'}}>
      <span style={{fontSize:12,color:'var(--text3)'}}>{[who(it),it.channel].filter(Boolean).join(', ')}</span>
      <span style={{fontWeight:500}}>{it.title}</span>
      {text?<span style={{color:'var(--text2)',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',whiteSpace:'pre-wrap'} as React.CSSProperties}>{text}</span>:null}
      {note||(dst==='failed'||dst==='not_started')||dst==='review'||((dst==='unknown'||dst==='running')&&d?.requestId)||sd?.status==='failed'||sd?.status==='not_sent'||sd?.status==='unknown'?<div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:2}}>
       {note?<span style={{flex:1,minWidth:0,fontSize:12,color:sd?.status==='sent'?'var(--okText)':sd?.status==='failed'||dst==='failed'?'var(--errText)':'var(--text3)'}}>{note}</span>:<span style={{flex:1}}/>}
       {(dst==='failed'||dst==='not_started')&&!sd?<Hv onClick={()=>void m.retryDraft(it)} disabled={!!busy} style={small} hover={{background:'var(--hover)'}}>{T.retry}</Hv>:null}
       {dst==='review'&&!sd?<Hv onClick={()=>openClassic('inbox',it.id)} style={small} hover={{background:'var(--hover)'}}>{zh?'在完整收件箱中打开':'Open in full Inbox'}</Hv>:null}
       {(dst==='unknown'||dst==='running')&&d?.requestId&&!sd?<Hv onClick={()=>void m.checkDraft(it)} disabled={!!busy} style={small} hover={{background:'var(--hover)'}}>{T.checkAgain}</Hv>:null}
       {sd?.status==='failed'||sd?.status==='not_sent'?<Hv onClick={()=>void m.send([it],sd.status==='failed')} disabled={!!busy} style={small} hover={{background:'var(--hover)'}}>{T.retry}</Hv>:null}
       {sd?.status==='unknown'?<Hv onClick={()=>void m.recheck(it)} disabled={!!busy} style={small} hover={{background:'var(--hover)'}}>{T.checkAgain}</Hv>:null}
      </div>:null}
     </div>})}
   </div>
   <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
    {missingDrafts?<Hv onClick={()=>void m.continueDrafts()} disabled={!!busy} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'继续起草':'Continue drafting'}</Hv>:null}
    {sendable.length?<Hv onClick={()=>void m.send(sendable)} disabled={!!busy} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{busy==='send'?T.ts.sending:T.sendN(sendable.length)}</Hv>:null}
    <Hv onClick={()=>discuss(picked[0]?.id||p.itemIds[0])} style={{height:32,padding:'0 8px',border:'none',borderRadius:'var(--r-btn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.editInConv}</Hv>
   </div>
  </div>:null}
  {st==='failed'?<div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:'var(--errSoft)',color:'var(--errText)',fontSize:12}}>{failMsg}</div>:null}
  {sentItems.length?<div style={{display:'flex',flexDirection:'column',gap:6,animation:'cmIn 250ms ease-out both'}}>
   <div style={{fontSize:12,color:'var(--okText)'}}>{T.resultH}</div>
   <div style={{textWrap:'pretty'} as React.CSSProperties}>{T.sentN(sentItems.length)}{zh?'。':'.'}</div>
   {sentItems.map(it=><span key={it.id} style={{color:'var(--text2)'}}>{[who(it),it.channel].filter(Boolean).join(', ')}</span>)}
   {otherSends.map(it=><span key={it.id} style={{color:'var(--text3)'}}>{who(it)} · {p.sends[it.id].status==='recalled'?(zh?'已撤回':'Recalled'):['failed','not_sent'].includes(p.sends[it.id].status)?T.ts.failed:T.ts.unknown}</span>)}
  </div>:null}
  <div style={{display:'flex',justifyContent:'flex-end'}}><Hv onClick={conv} style={{height:32,padding:'0 14px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}><I n="chat-circle" style={{fontSize:16}}/><span>{T.jumpConv}</span></Hv></div>
 </div>;
}
