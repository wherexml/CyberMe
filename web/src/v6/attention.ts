// Direct record actions for the Brief. None of these write to the composer or call chat or a model by themselves,
// except recheck, which runs the real analysis or source recovery once and reports what actually came back.
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {InboxItem} from '../../../shared/types';
import type {InboxAttention} from '../../../shared/inbox-attention';
import {api,enc,uid} from './store';
import type {AttentionBinding} from '../../../shared/attention-actions';
import {ideaProvenance} from '../../../shared/attention-actions';
import type {Ctx} from './App';

export type RecheckTarget='triage'|'process-source';
export function recheckTarget(item:InboxItem,a:InboxAttention):RecheckTarget|null{
 if(!a.canRecheck)return null;
 return a.reason==='processing_failed'?'process-source':'triage';
}

// At most one acknowledgement, in memory only: a refresh drops it and the canonical dismissal stays.
const ACK_MS=15000;
export type Ack={itemId:string;dismissalId:string;kind?:'inbox'|'idea';operationId?:string;label?:string};
let ack:Ack|null=null,ackTimer:ReturnType<typeof setTimeout>|undefined;
const ackListeners=new Set<()=>void>();
function setAck(next:Ack|null,ms=ACK_MS){
 clearTimeout(ackTimer);ack=next;
 if(next)ackTimer=setTimeout(()=>setAck(null),Math.min(ACK_MS,ms));
 ackListeners.forEach(fn=>fn());
}
/** Next local morning: a server snooze needs a real instant, not a date string. */
export function tomorrowMorning(){const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);return d.toISOString();}
export function useDismissAck(){
 return useSyncExternalStore(fn=>{ackListeners.add(fn);return()=>{ackListeners.delete(fn)}},()=>ack);
}

/** HTTP success is not the outcome: a failed judgment is a 200, and a retry only queues a job. */
function recheckResult(target:RecheckTarget,r:any,zh:boolean):string{
 const status=String(r?.status||'');
 if(status==='failed'||status==='blocked'||status==='interrupted')throw new Error(typeof r?.error==='string'?r.error:'');
 if(target==='triage'&&status==='succeeded')return zh?'重新判断完成。':'Re-evaluation finished.';
 if(status==='queued')return zh?'已加入处理队列，尚未完成。':'Queued. Not finished yet.';
 if(status==='running')return zh?'正在处理，尚未完成。':'In progress. Not finished yet.';
 return zh?'结果未确认。':'Result not confirmed.';
}
const conflict=(e:any)=>e?.status===409;
type DismissalInput={operationId:string;baseUpdatedAt?:string;dismissalKey:string|null};
type DismissalReceipt={item:InboxItem;revision:number};
const dismissalPath=(id:string)=>'/api/inbox/'+enc(id)+'/attention-dismissal';
const dismissalTimeout=()=>AbortSignal.timeout(5000);
function receiptFor(item:InboxItem,operationId:string){
 const ack=item.attentionAck;
 return ack?.operationId===operationId?ack:item.attentionDismissal?.operationId===operationId?item.attentionDismissal:undefined;
}
function unconfirmedDismissal(error:any){
 return !error?.status||error.status>=500||error.status===408||error.status===429;
}
export function useAttentionAction(ctx:Ctx){
 const {zh}=ctx,[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const lock=useRef(false);
 const retryDismissal=useRef<{itemId:string;input:DismissalInput}|null>(null);
 async function run(work:()=>Promise<string|void>,failure:(e:any)=>string,waitForWorkspace=true){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNote('');
  const reload=()=>ctx.refresh(true).catch(()=>{});
  try{const done=await work();if(waitForWorkspace)await reload();else void reload();if(done)setNote(done)}
  catch(e:any){setError(failure(e));if(waitForWorkspace)await reload();else void reload()}
  finally{lock.current=false;setBusy(false)}
 }
 const reason=(e:any)=>e?.message?`：${e.message}`:'';
 return {busy,error,note,
  dismiss:(item:InboxItem)=>run(async()=>{
   const prior=retryDismissal.current;
   const input=prior?.itemId===item.id?prior.input:{operationId:uid('dismiss'),baseUpdatedAt:item.updatedAt,dismissalKey:item.attention?.dismissalKey??null};
   const path=dismissalPath(item.id);
   let result:DismissalReceipt;
   try{result=await api('POST',path,input,dismissalTimeout())}
   catch(e:any){
    if(!unconfirmedDismissal(e)){retryDismissal.current=null;throw e;}
    retryDismissal.current={itemId:item.id,input};
    const readback=await api<DismissalReceipt>('GET',path,undefined,dismissalTimeout()).catch(()=>null);
    if(!readback||!receiptFor(readback.item,input.operationId))return zh?'忽略结果待确认':'Dismissal unconfirmed';
    result=readback;
   }
   retryDismissal.current=null;
   const {item:row,revision}=result,binding=receiptFor(row,input.operationId);
   if(ctx.applyInboxChange(row,revision)&&binding)setAck({itemId:row.id,dismissalId:binding.id,label:row.title});
  },e=>e?.data?.error==='edit_conflict'?(zh?'事项已有更新，未忽略。':'This item changed and was not dismissed.'):(zh?'未能忽略':"Couldn't dismiss")+reason(e),false),
  undo:(item:InboxItem,dismissalId:string)=>run(async()=>{
   const result=await api<DismissalReceipt>('POST',dismissalPath(item.id)+'/undo',{dismissalId,baseUpdatedAt:item.updatedAt},dismissalTimeout());
   ctx.applyInboxChange(result.item,result.revision);
   setAck(null);
  },e=>conflict(e)?(zh?'已有更新，未撤销。':'This item changed, so nothing was undone.'):(zh?'未能撤销':"Couldn't undo")+reason(e),false),
  recheck:(item:InboxItem,target:RecheckTarget)=>run(async()=>{
   const r=await api('POST','/api/inbox/'+enc(item.id)+(target==='process-source'?'/process-source/retry':'/triage'),target==='process-source'?{}:{force:true});
   return recheckResult(target,r,zh);
  },()=>zh?'暂时无法重新判断，请稍后重试。':"Couldn't re-evaluate now. Try again later."),
 };
}

// ---------- Feishu message cooldown for draft generation. A normal wait, never a failure; the server gate stays authoritative.
// Readiness is granted only by a successful read-only GET of the exact record (App's refresh swallows read errors, so it
// cannot prove anything). Deadlines a refused draft returned are kept here until that read supersedes them.
const raceCooling=new Map<string,number>();          // itemId -> latest deadline learned from a refusal (or "now": read first)
const reconciled=new Map<string,string>();           // itemId -> identity proven ready by the latest successful exact read
// Deadlines seen in the future in this session (module-level, so remounts keep them). A deadline already past when first seen
// was not waited on here and needs no read; the server gate still refuses any newer source version.
const watched=new Set<string>();
const reading=new Map<string,number>(),readFailed=new Set<string>();let readGen=0;
let coolingVersion=0;const coolingListeners=new Set<()=>void>();
const emitCooling=()=>{coolingVersion++;coolingListeners.forEach(fn=>fn())};
const subscribeCooling=(fn:()=>void)=>{coolingListeners.add(fn);return()=>{coolingListeners.delete(fn)}};
const feishuPending=(item:any)=>/^feishu$/i.test(String(item?.channel||''))&&item?.sourceSystem!=='virtual-im'&&item?.copilot?.state==='pending';
/** Latest known deadline, including one already past but not yet reconciled. */
function deadlineOf(item:any):number{
 const own=feishuPending(item)?Date.parse(String(item.copilot.notBefore||'')):NaN;
 return Math.max(Number.isFinite(own)?own:0,raceCooling.get(item?.id)||0);
}
const identityOf=(item:any,deadline:number)=>String(item?.id)+'|'+String(item?.copilot?.signature||'')+'|'+deadline;
/** A refused draft: wait for the returned deadline, or (without one) until an exact read decides. Never replays anything. */
export function noteDraftCooling(itemId:string,notBefore?:unknown){
 const parsed=Date.parse(String(notBefore??'')),at=Number.isFinite(parsed)?parsed:Date.now();
 raceCooling.set(itemId,Math.max(at,raceCooling.get(itemId)||0));emitCooling();
}
export function draftCooling(item:any,now=Date.now()):{waiting:boolean;until?:number;expired?:boolean;readFailed?:boolean}{
 const until=deadlineOf(item);if(!until)return {waiting:false};
 const identity=identityOf(item,until);
 if(until>now){watched.add(identity);return {waiting:true,until}}
 if(!watched.has(identity)&&raceCooling.get(item.id)!==until)return {waiting:false};
 return {waiting:reconciled.get(item.id)!==identity,until,expired:true,readFailed:readFailed.has(item.id)};
}
/** One exact read-only GET per record at a time; only the latest generation may settle. No action or model is ever called. */
async function reconcileCooling(ctx:Ctx,id:string){
 if(reading.has(id))return;
 const my=++readGen;reading.set(id,my);emitCooling();
 try{
  // Bounded: a stalled connection fails after 15 s, so the read-only retry loop can recover.
  const fresh=await api<any>('GET','/api/inbox/'+enc(id),undefined,AbortSignal.timeout(15000));
  if(reading.get(id)!==my)return;
  readFailed.delete(id);
  const race=raceCooling.get(id);if(race&&race<=Date.now())raceCooling.delete(id);
  const until=deadlineOf(fresh);
  // Extended or still cooling: keep waiting; otherwise exactly this source version is ready.
  if(!until||until<=Date.now())reconciled.set(id,identityOf(fresh,until));
  void ctx.refresh(true).catch(()=>{});
 }catch{if(reading.get(id)===my)readFailed.add(id)}
 finally{if(reading.get(id)===my)reading.delete(id);emitCooling()}
}
/** Waits until the deadline, then until a successful exact read of the current source. Timers, focus, visibility and remount
 * only re-read; a held or failed read keeps the draft locked and is retried. */
export function useDraftCooling(ctx:Ctx,item:any){
 useSyncExternalStore(subscribeCooling,()=>coolingVersion);
 const [,setTick]=useState(0);
 const c=draftCooling(item),id=item?.id?String(item.id):'';
 const key=identityOf(item,c.until||0)+'|'+(c.waiting?'w':'r')+'|'+(c.expired?'x':'f');
 useEffect(()=>{
  if(!c.waiting||!id)return;
  let live=true;const bump=()=>{if(live)setTick(x=>x+1)};
  const read=()=>{if(live&&draftCooling(item).expired)void reconcileCooling(ctx,id)};
  const timers:any[]=[];
  if(!c.expired)timers.push(setTimeout(bump,Math.max(0,(c.until||0)-Date.now())+250));
  else{read();timers.push(setInterval(()=>{if(!reading.has(id))read()},4000))}
  const onFocus=()=>{bump();read()},visible=()=>{if(document.visibilityState==='visible')onFocus()};
  addEventListener('focus',onFocus);document.addEventListener('visibilitychange',visible);
  return()=>{live=false;timers.forEach(t=>{clearTimeout(t);clearInterval(t)});removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',visible)};
 },[key]);// eslint-disable-line react-hooks/exhaustive-deps
 return c;
}

/** Server undo window for a dismissal, counted from the operation's own start (attention-actions.ts UNDO_WINDOW_MS). */
const UNDO_WINDOW_MS=20000;
/** Undo acknowledgement for a typed dismiss settled by attention-action-state.ts. It lasts until the server operation's start
 * plus the undo window, capped by the usual 15 seconds; a late or reloaded success past that window offers no Undo, and an
 * operation with no known start time offers none either. */
export function ackTypedDismiss(binding:AttentionBinding,operationId:string,result:any,startedAt?:unknown){
 const start=Date.parse(String(startedAt??'')),left=Number.isFinite(start)?start+UNDO_WINDOW_MS-Date.now():0;
 if(left<=0)return;
 if(binding.entityKind==='inbox'&&result?.dismissalId)setAck({itemId:binding.entityId,dismissalId:result.dismissalId,kind:'inbox'},left);
 if(binding.entityKind==='idea')setAck({itemId:binding.entityId,dismissalId:operationId,kind:'idea',operationId},left);
}
/** Idea ignore, snooze, undo and restore, directly on the record. */
export async function ideaAttentionCall(idea:any,action:'dismiss'|'snooze'|'undo'|'restore',operationId=uid('idea-attention'),until?:string){
 await api('POST','/api/ideas/'+enc(idea.id)+'/attention',{action,operationId,baseUpdatedAt:idea.updatedAt,baseProvenanceKey:ideaProvenance(idea),...(until?{until}:{})});
 return operationId;
}
export const ackIdea=(id:string,operationId:string,label:string)=>setAck({itemId:id,dismissalId:operationId,kind:'idea',operationId,label});
export const clearAck=()=>setAck(null);
