// Shared, durable state for typed attention actions (draft_reply, create_task, snooze, dismiss). One receipt per entity and
// action type, used by the insight card, the derived chat message and the detail view. The server records the operation
// before running it and deduplicates a repeated ID with the same payload; this module only keeps that ID, reads it back and
// lets the user explicitly resubmit the identical payload. Automatic traffic is GET only. See docs/public/intent-handling.md.
import {useEffect,useSyncExternalStore} from 'react';
import type {Ctx} from './App';
import {api,enc,uid,getUI,setUI,subscribeUI,durable,UNRESOLVED,type ActionReceipt} from './store';
import type {AttentionActionType,AttentionBinding} from '../../../shared/attention-actions';
import {noteDraftCooling,ackTypedDismiss} from './attention';

// The POST transport is bounded; the server keeps running and the same ID is read back. Polling a running operation stops
// after POLL_LIMIT reads and the action becomes "check again" (never busy forever).
const MAX_UNRESOLVED=100,POST_TIMEOUT_MS=30000,POLL_MS=2000,POLL_LIMIT=30;
const posting=new Set<string>(),reading=new Set<string>(),polls=new Map<string,number>(),capRefused=new Set<string>();
export const slotKey=(b:AttentionBinding,type:AttentionActionType)=>`${b.entityKind}:${b.entityId}:${type}`;
const sameBinding=(a:AttentionBinding,b:AttentionBinding)=>a.entityKind===b.entityKind&&a.entityId===b.entityId&&(a.requestMessageId||'')===(b.requestMessageId||'')&&(a.requestRevision||'')===(b.requestRevision||'')&&(a.provenanceKey||'')===(b.provenanceKey||'');
const receipt=(key:string)=>getUI().actions?.[key];
function write(key:string,patch:Partial<ActionReceipt>|null){
 setUI(s=>{const actions={...(s.actions||{})};if(patch===null)delete actions[key];else actions[key]={...actions[key],...patch} as ActionReceipt;return {actions}});
}
// A definitive server refusal: a 4xx with an error code, except timeouts and rate limits.
const definitive=(e:any)=>typeof e?.status==='number'&&e.status>=400&&e.status<500&&![408,429].includes(e.status)&&!!e?.data?.error;

/** Applies an operation record read from the server (POST response or GET). Returns true when the outcome is settled. */
async function settle(ctx:Ctx,key:string,op:any):Promise<boolean>{
 const r=receipt(key);if(!r||op?.id&&op.id!==r.operationId)return true;
 if(op?.status==='succeeded'){
  write(key,{phase:'succeeded',taskId:op.result?.taskId,dismissalId:op.result?.dismissalId,code:undefined,message:undefined});
  if(r.type==='dismiss')ackTypedDismiss(r.binding as AttentionBinding,r.operationId,op.result,op.startedAt);
  return true;
 }
 if(op?.status==='failed'){
  if(r.type==='draft_reply'&&op.error==='inbox_cooling'){noteDraftCooling(r.binding.entityId);write(key,null);return true}
  write(key,{phase:'failed',code:op.error,message:undefined});return true;
 }
 if(op?.status==='unknown'){
  // Interrupted on the server: only exact positive evidence settles it. Absence proves nothing.
  const proof=await positiveEvidence(r).catch(()=>null);
  if(proof)return settle(ctx,key,{id:r.operationId,...proof});
  write(key,{phase:'unknown'});return false;
 }
 write(key,{phase:'pending'});return false; // running or queued
}
async function positiveEvidence(r:ActionReceipt):Promise<any|null>{
 const path=r.binding.entityKind==='idea'?'/api/ideas/':'/api/inbox/';
 if(r.type==='create_task')return null; // only the exact op's returned task ID counts, which an interrupted op does not have
 if(r.type==='draft_reply'&&r.binding.entityKind!=='inbox')return null;
 const row:any=r.type==='draft_reply'?null:await api('GET',path+enc(r.binding.entityId),undefined,AbortSignal.timeout(15000));
 if(r.type==='draft_reply'){
  // The draft request ledger is the exact record for this operation (the attention op uses its ID as the draft request ID).
  const d:any=await api('GET',path+enc(r.binding.entityId)+'/draft-requests/'+enc(r.operationId),undefined,AbortSignal.timeout(15000));
  return d?.requestId===r.operationId&&(d.status==='succeeded'||d.status==='review')?{status:'succeeded',result:{}}:d?.requestId===r.operationId&&d.status==='failed'?{status:'failed',error:'draft_failed'}:null}
 if(r.type==='snooze')return row?.attentionSnooze?.operationId===r.operationId||row?.attentionAction?.operationId===r.operationId?{status:'succeeded',result:{}}:null;
 if(r.type==='dismiss'){const b=row?.attentionAck?.operationId===r.operationId?row.attentionAck:row?.attentionDismissal?.operationId===r.operationId?row.attentionDismissal:null;
  if(b)return {status:'succeeded',result:{dismissalId:b.id}};return row?.attentionAction?.operationId===r.operationId?{status:'succeeded',result:{}}:null}
 return null;
}
/** GET-only readback of the original operation ID. Never posts. */
export async function checkAction(ctx:Ctx,key:string,explicit=false){
 const r=receipt(key);if(!r||!UNRESOLVED.includes(r.phase)||r.phase==='not_saved'||reading.has(r.operationId)||posting.has(r.operationId))return;
 if(explicit)polls.delete(r.operationId);
 reading.add(r.operationId);emit();
 let settled=false;
 try{
  const op=await api('GET','/api/attention/actions/'+enc(r.operationId),undefined,AbortSignal.timeout(15000));
  settled=await settle(ctx,key,op);
 }catch(e:any){
  // 404: not recorded (yet). It may still arrive, so only an explicit same-ID resubmission is offered. Other errors keep the state.
  const cur=receipt(key);
  if(e?.status===404&&cur?.operationId===r.operationId)write(key,{phase:'missing'});
  // A restored 'pending' receipt that cannot be read is shown as unconfirmed (check again), never resubmitted.
  else if(cur?.operationId===r.operationId&&cur.phase==='pending'&&!posting.has(r.operationId))write(key,{phase:'unknown'});
 }finally{reading.delete(r.operationId);emit()}
 if(settled)void ctx.refresh(true).catch(()=>{});
 else if(receipt(key)?.phase==='pending')schedulePoll(ctx,key,r.operationId);
}
function schedulePoll(ctx:Ctx,key:string,operationId:string){
 const n=polls.get(operationId)||0;if(polls.has(operationId+':t'))return;
 // Exhausted: keep the operation reference, stop looking busy, offer a GET-only check.
 if(n>=POLL_LIMIT){if(receipt(key)?.operationId===operationId&&receipt(key)?.phase==='pending')write(key,{phase:'unknown'});return}
 polls.set(operationId,n+1);polls.set(operationId+':t',1);
 setTimeout(()=>{polls.delete(operationId+':t');if(receipt(key)?.operationId===operationId)void checkAction(ctx,key)},POLL_MS);
}
/** Posts exactly the stored payload. Used for a new operation and for an explicit same-ID resubmission. */
async function post(ctx:Ctx,key:string){
 const r=receipt(key);if(!r||posting.has(r.operationId))return;
 posting.add(r.operationId);emit();
 let settled=false;
 // A resubmission of an operation that may already have run keeps that uncertainty if this save fails.
 const prior=r.phase,mayHaveRun=prior==='missing'||prior==='unknown';
 try{
  // Pending is persisted before the durability barrier and the POST, so a restart after sending never claims "not submitted".
  write(key,{phase:'pending',code:undefined,message:undefined});
  try{await durable()}catch(e:any){write(key,mayHaveRun?{phase:prior}:{phase:'not_saved',message:String(e?.message||e)});return}
  try{
   const op=await api('POST','/api/attention/actions',{...r.binding,type:r.type,operationId:r.operationId,...(r.extra||{})},AbortSignal.timeout(POST_TIMEOUT_MS));
   settled=await settle(ctx,key,op);
  }catch(e:any){
   if(r.type==='draft_reply'&&e?.data?.error==='inbox_cooling'){noteDraftCooling(r.binding.entityId,e.data.detail?.notBefore);write(key,null);settled=true}
   else if(definitive(e)){write(key,{phase:'refused',code:e.data.error,message:e.message});settled=true}
   else write(key,{phase:'unknown'}); // lost, timed out or ambiguous 5xx: read back by the original ID
  }
 }finally{posting.delete(r.operationId);emit()}
 if(settled)void ctx.refresh(true).catch(()=>{});
 else void checkAction(ctx,key);
}
/** Starts a new operation only when no unresolved receipt exists for this entity and type. */
export function startAction(ctx:Ctx,binding:AttentionBinding,type:AttentionActionType,extra?:{until?:string}):string|null{
 const key=slotKey(binding,type),r=receipt(key);
 if(r&&UNRESOLVED.includes(r.phase))return null; // never silently replace an unresolved operation, even for a newer binding
 const unresolved=Object.values(getUI().actions||{}).filter(x=>UNRESOLVED.includes(x.phase)).length;
 // At capacity a new operation is refused; every unresolved receipt is kept.
 if(unresolved>=MAX_UNRESOLVED){capRefused.add(key);emit();return null}
 capRefused.delete(key);
 setUI(s=>({actions:{...(s.actions||{}),[key]:{operationId:uid('action'),type,binding:{...binding},...(extra?{extra:{...extra}}:{}),at:new Date().toISOString(),phase:'pending'}}}));
 void post(ctx,key);return key;
}
/** Explicit same-ID resubmission after a failed local save or a 404 readback. Never a new ID. */
export function resubmitAction(ctx:Ctx,key:string){const r=receipt(key);if(r&&(r.phase==='not_saved'||r.phase==='missing'))void post(ctx,key)}

let version=0;const listeners=new Set<()=>void>();
function emit(){version++;listeners.forEach(fn=>fn())}
const subscribe=(fn:()=>void)=>{listeners.add(fn);const off=subscribeUI(fn);return()=>{listeners.delete(fn);off()}};

export type ActionView={phase?:ActionReceipt['phase'];busy:boolean;own:boolean;receipt?:ActionReceipt;error:string;tone:'err'|'warn'|''};
/** State for one entity's typed actions, shared by every caller. Mount and focus read unresolved receipts back (GET only). */
export function useTypedActions(ctx:Ctx,binding:AttentionBinding,types:AttentionActionType[]){
 useSyncExternalStore(subscribe,()=>version+':'+JSON.stringify(Object.fromEntries(types.map(t=>[t,getUI().actions?.[slotKey(binding,t)]?.phase||'']))));
 const {zh}=ctx,keys=types.map(t=>slotKey(binding,t));
 // 'missing' is re-read too: a delayed original may still arrive and settle it.
 const unresolvedKeys=keys.filter(k=>{const r=receipt(k);return r&&['unknown','pending','missing'].includes(r.phase)}).join(',');
 useEffect(()=>{
  if(!unresolvedKeys)return;
  const read=()=>{for(const k of unresolvedKeys.split(','))void checkAction(ctx,k)};
  read();const onFocus=()=>read(),visible=()=>{if(document.visibilityState==='visible')read()};
  addEventListener('focus',onFocus);document.addEventListener('visibilitychange',visible);
  return()=>{removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',visible)};
 },[unresolvedKeys]);// eslint-disable-line react-hooks/exhaustive-deps
 const view=(type:AttentionActionType):ActionView=>{
  const key=slotKey(binding,type),r=receipt(key),t=(a:string,b:string)=>zh?a:b;
  if(capRefused.has(key)&&(!r||!UNRESOLVED.includes(r.phase)))return {busy:false,own:true,receipt:r,error:t('待核对的操作过多，请先核对已有结果。','Too many unconfirmed actions. Check them first.'),tone:'err'};
  if(!r)return {busy:false,own:false,error:'',tone:''};
  const own=sameBinding(r.binding as AttentionBinding,binding),busy=r.phase==='pending'||reading.has(r.operationId);
  // The judgment can move on even while the original terminal receipt remains available.
  const item=type==='draft_reply'&&binding.entityKind==='inbox'&&r.code==='draft_judgment_required'
   ?ctx.ws.inbox.find(x=>x.id===binding.entityId):undefined;
  const judgmentSupersedesRefusal=item?.attention?.reason==='reevaluating_open'||
   Date.parse(item?.triage?.completedAt||'')>Date.parse(r.at);
  const error=judgmentSupersedesRefusal&&(r.phase==='refused'||r.phase==='failed')?''
   :r.phase==='not_saved'?t('未保存，未提交。','Not saved, not submitted.')
   :r.phase==='unknown'||r.phase==='missing'?t('结果未确认，请查看原记录。','Result not confirmed. Check the record.')
   // A stale-binding refusal is shown after the card re-binds (that is its point); other old results never label a new request.
   :r.phase==='refused'&&(own||r.code==='action_stale')?(r.code==='action_stale'?t('事项已变化，请查看最新内容。','This item changed. Check the latest version.'):t('未能完成：','Couldn\'t finish: ')+(r.message||r.code||''))
   :r.phase==='failed'&&own?t('未能完成。',"Couldn't finish."):'';
  return {phase:r.phase,busy,own,receipt:r,error,tone:r.phase==='unknown'||r.phase==='missing'?'warn':error?'err':''};
 };
 const anyBusy=types.some(t=>view(t).busy);
 return {
  view,anyBusy,
  /** The primary click for one action type: start, explicit same-ID resubmit, or GET-only check, depending on the receipt. */
  act:(type:AttentionActionType,extra?:{until?:string})=>{
   const key=slotKey(binding,type),r=receipt(key);
   if(r?.phase==='not_saved'||r?.phase==='missing')return resubmitAction(ctx,key);
   if(r?.phase==='unknown')return void checkAction(ctx,key,true);
   if(r?.phase==='pending')return;
   startAction(ctx,binding,type,extra);
  },
  /** The task an exact successful create_task receipt for this binding returned, when it still exists. */
  task:()=>{const r=receipt(slotKey(binding,'create_task'));if(r?.phase!=='succeeded'||!r.taskId||!sameBinding(r.binding as AttentionBinding,binding))return undefined;return (ctx.ws.tasks||[]).find((t:any)=>t.id===r.taskId)},
 };
}
/** Label for an unresolved receipt on its own action, reusing existing wording. */
export function pendingLabel(view:ActionView,zh:boolean,idle:string){
 if(view.phase==='pending')return zh?'处理中…':'Working…';
 if(view.phase==='unknown')return zh?'再次核对':'Check again';
 if(view.phase==='missing'||view.phase==='not_saved')return zh?'重试':'Retry';
 return idle;
}
