// Direct record actions for the Brief. None of these write to the composer or call chat or a model by themselves,
// except recheck, which runs the real analysis or source recovery once and reports what actually came back.
import {useRef,useState,useSyncExternalStore} from 'react';
import type {InboxItem} from '../../../shared/types';
import type {InboxAttention} from '../../../shared/inbox-attention';
import {api,enc,uid} from './store';
import type {AttentionActionType,AttentionBinding} from '../../../shared/attention-actions';
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
function setAck(next:Ack|null){
 clearTimeout(ackTimer);ack=next;
 if(next)ackTimer=setTimeout(()=>setAck(null),ACK_MS);
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
export function useAttentionAction(ctx:Ctx){
 const {zh}=ctx,[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const lock=useRef(false);
 async function run(work:()=>Promise<string|void>,failure:(e:any)=>string){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNote('');
  try{const done=await work();if(done)setNote(done);await ctx.refresh()}
  catch(e:any){setError(failure(e));try{await ctx.refresh()}catch{}}
  finally{lock.current=false;setBusy(false)}
 }
 const reason=(e:any)=>e?.message?`：${e.message}`:'';
 return {busy,error,note,
  dismiss:(item:InboxItem)=>{const operationId=uid('dismiss');return run(async()=>{
   let row:any;const post=(base:unknown)=>api<{item:InboxItem}>('POST','/api/inbox/'+enc(item.id)+'/attention-dismissal',{operationId,baseUpdatedAt:base});
   try{row=(await post(item.updatedAt)).item}
   catch(e:any){
    if(e?.status===409&&e?.data?.error!=='dismiss_blocked'){
     // A background update moved the version. Retry once only if the card still means the same request; otherwise show the conflict.
     const latest:any=await api<InboxItem>('GET','/api/inbox/'+enc(item.id));
     if(latest.triage?.requestMessageId!==(item as any).triage?.requestMessageId||!latest.attention?.canDismiss)throw e;
     row=(await post(latest.updatedAt)).item;
    }else{
     // The response was lost, not refused: read the record back instead of repeating or guessing.
     if(e?.status)throw e;
     row=await api<InboxItem>('GET','/api/inbox/'+enc(item.id));
     if(row.attentionDismissal?.operationId!==operationId&&row.attentionAck?.operationId!==operationId)throw e;
    }
   }
   const binding=row.attentionAck?.operationId===operationId?row.attentionAck:row.attentionDismissal;
   if(binding)setAck({itemId:row.id,dismissalId:binding.id,label:row.title});
  },e=>conflict(e)?(zh?'事项已有更新，未忽略。':'This item changed and was not dismissed.'):(zh?'未能忽略':"Couldn't dismiss")+reason(e))},
  undo:(item:InboxItem)=>run(async()=>{
   await api('POST','/api/inbox/'+enc(item.id)+'/attention-dismissal/undo',{dismissalId:(item as any).attentionAck?.id||item.attentionDismissal?.id,baseUpdatedAt:item.updatedAt});
   setAck(null);
  },e=>conflict(e)?(zh?'已有更新，未撤销。':'This item changed, so nothing was undone.'):(zh?'未能撤销':"Couldn't undo")+reason(e)),
  recheck:(item:InboxItem,target:RecheckTarget)=>run(async()=>{
   const r=await api('POST','/api/inbox/'+enc(item.id)+(target==='process-source'?'/process-source/retry':'/triage'),target==='process-source'?{}:{force:true});
   return recheckResult(target,r,zh);
  },()=>zh?'暂时无法重新判断，请稍后重试。':"Couldn't re-evaluate now. Try again later."),
 };
}

/** One typed action. Refusals are reported as they are; a lost response is read back by operation ID, never repeated. */
export function useEntityAction(ctx:Ctx){
 const {zh}=ctx,[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function run(binding:AttentionBinding,type:AttentionActionType,extra?:{until?:string}):Promise<boolean>{
  if(lock.current)return false;lock.current=true;setBusy(true);setError('');
  const operationId=uid('action');
  try{
   let op:any;
   try{op=await api('POST','/api/attention/actions',{...binding,type,operationId,...extra})}
   catch(e:any){if(e?.status)throw e;op=await api('GET','/api/attention/actions/'+enc(operationId))}
   if(op.status==='running'||op.status==='unknown'){setError(zh?'结果未确认，请查看原记录。':'Result not confirmed. Check the record.');return false}
   if(op.status==='failed'){setError(zh?'未能完成，没有外发任何内容。':"Couldn't finish. Nothing was sent.");return false}
   if(type==='dismiss'&&binding.entityKind==='inbox'&&op.result?.dismissalId)setAck({itemId:binding.entityId,dismissalId:op.result.dismissalId,kind:'inbox'});
   if(type==='dismiss'&&binding.entityKind==='idea')setAck({itemId:binding.entityId,dismissalId:operationId,kind:'idea',operationId});
   await ctx.refresh();return true;
  }catch(e:any){
   setError(e?.status===409?(zh?'来源已更新，这个动作已失效。':'The source changed, so this action no longer applies.'):(zh?'未能完成：':"Couldn't finish: ")+(e?.message||''));
   try{await ctx.refresh()}catch{}
   return false;
  }finally{lock.current=false;setBusy(false)}
 }
 return {busy,error,run};
}
/** Idea ignore, snooze, undo and restore, directly on the record. */
export async function ideaAttentionCall(idea:any,action:'dismiss'|'snooze'|'undo'|'restore',operationId=uid('idea-attention'),until?:string){
 await api('POST','/api/ideas/'+enc(idea.id)+'/attention',{action,operationId,baseUpdatedAt:idea.updatedAt,baseProvenanceKey:ideaProvenance(idea),...(until?{until}:{})});
 return operationId;
}
export const ackIdea=(id:string,operationId:string,label:string)=>setAck({itemId:id,dismissalId:operationId,kind:'idea',operationId,label});
export const clearAck=()=>setAck(null);
