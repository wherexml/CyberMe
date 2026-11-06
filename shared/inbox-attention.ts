// One shared answer to "should this take the user's attention now?". `disposition` stays the
// full-Inbox diagnostic; a `verify` placement is a system fact here, not automatically a user task.
import type {InboxItem} from './types';
import {closureTimeUnknown,dispositionOf,messageRevision,inboxTimestamp} from './inbox-surfacing';

export type AttentionState='actionable'|'execution'|'reevaluating'|'system_error'|'quiet';
export type AttentionSurface='decision'|'insight'|'none';
export interface InboxAttention {state:AttentionState;surface:AttentionSurface;reason:string;canDismiss:boolean;canRecheck:boolean;question?:string;detail?:string}
export interface AttentionDismissal {id:string;operationId:string;requestMessageId?:string;sourceVersion?:string;knownMessages:Record<string,string>;priorStatus:string;priorClosedAt?:string;dismissedAt:string}

export const CLOSED_STATUSES=['sent','delivered','done','dismissed','cancelled','archived','recalled'];
/** Statuses whose real outcome only send, readback or recall paths may change. */
const LOCKED=['sending','send_unknown','sent','delivered','recalled'];
const MAX_KNOWN_MESSAGES=1000;

const view=(state:AttentionState,surface:AttentionSurface,reason:string,canDismiss:boolean,canRecheck=false,extra:Partial<InboxAttention>={}):InboxAttention=>({state,surface,reason,canDismiss,canRecheck,...extra});
const hasMessage=(item:any,id?:string)=>!!id&&(Array.isArray(item.messages)?item.messages:[]).some((m:any)=>m.id===id&&!m.deleted&&!m.recalled);

/** Positive evidence only: uncertainty alone never qualifies. */
function hasPositiveRequest(t:any){
 if(t?.status!=='succeeded')return false;
 return (t.resolution==='open'&&['reply','decision'].includes(t.actionType))||(t.needsReply??0)>=.75||(t.needsOwner??0)>=.75||(t.risk??0)>=.75||t.priority==='high';
}
function missingContextView(item:any,t:any,canDismiss:boolean){
 const question=typeof item.v6?.question==='string'&&item.v6.question.trim()?item.v6.question.trim().slice(0,200):undefined;
 return view('actionable','insight','missing_context',canDismiss,true,{...(question?{question}:{}),...(typeof t.reason==='string'?{detail:t.reason}:{})});
}

/** A snooze holds this exact request revision until its time, or an hour before a deadline that falls earlier. */
export function snoozeActive(item:any,at=Date.now()):boolean{
 const s=item?.attentionSnooze,until=inboxTimestamp(s?.until);if(!s||until===undefined||until<=at)return false;
 const due=inboxTimestamp(item.dueAt);if(due!==undefined&&due<until&&at>=due-3600e3)return false;
 const t=item.triage;if(t?.status==='succeeded'&&(t.requestMessageId||undefined)!==(s.requestMessageId||undefined))return false;
 if(s.requestMessageId){const m=(Array.isArray(item.messages)?item.messages:[]).find((x:any)=>x.id===s.requestMessageId);if(m&&messageRevision(m)!==s.requestRevision)return false}
 return true;
}
/** Only exact evidence attaches an idea to a live decision. Same thread, sources, sender or title never does. */
export function ideaAttachedDecision(idea:any,inbox:any[]):any|undefined{
 // A message can contain several independent matters. Only an explicit relationship may attach an idea.
 const binding=idea?.requestBinding;if(!binding)return;
 for(const e of Array.isArray(idea?.evidence)?idea.evidence:[]){
  if(binding.sourceId!==e.sourceId||binding.requestMessageId!==e.messageId||binding.requestRevision!==e.messageRevision)continue;
  if(typeof e?.messageId!=='string'||!e.messageRevision)continue;
  const item=inbox.find(x=>x.id===e.sourceId);if(!item||item.triage?.requestMessageId!==e.messageId)continue;
  const m=(Array.isArray(item.messages)?item.messages:[]).find((x:any)=>x.id===e.messageId);
  if(m&&messageRevision(m)===e.messageRevision&&inboxAttention(item).surface==='decision')return item;
 }
}

export function inboxAttention(item:InboxItem):InboxAttention{
 const it:any=item,status=String(it.status||''),t=it.triage,ok=t?.status==='succeeded',d=dispositionOf(item);
 // Real outbound and generation outcomes come first and are never hidden or waved away.
 if(status==='sending'||status==='send_unknown')return view('execution','insight',status,false);
 if(status==='failed'||status==='send_failed')return view('execution','insight','send_failed',true);
 if(it.draftPreparation?.status==='unknown')return view('execution','insight','draft_unknown',false);
 if(snoozeActive(it))return view('quiet','none','snoozed',false);
 if(CLOSED_STATUSES.includes(status)){
  if(status==='recalled'||!d.recoveryReasons.includes('context_unknown'))return view('quiet','none',d.primaryReason,false);
  if(ok&&closureTimeUnknown(it,t))return d.reasons.includes('expired')?view('quiet','none','expired',false):view('actionable','insight','closure_unverified',true,true);
  // Age comes first: the closed branch must honour the same expiry as everything else, and every card has an exit.
  if(ok&&(hasPositiveRequest(t)||t.resolution==='open'))return d.reasons.includes('expired')?view('quiet','none','expired',false):view('actionable','insight','new_request',true,true);
  if(ok)return view('quiet','none','no_action',false);
  return t?.status==='failed'?view('system_error','none','judgment_failed',false,true):view('reevaluating','none',t?.status==='running'?'judgment_running':'judgment_unknown',false);
 }
 // A forwarded request lives on its own round; this record must not be a second surface for it.
 if(ok&&it.forwardedRequestId&&it.forwardedRequestId===t.requestMessageId)return view('quiet','none','forwarded',true);
 if(d.placement==='pending')return view('actionable','decision',d.primaryReason,true,true);
 if((it.draft&&(it.editedByUser||it.manualDraft))||it.draftCandidate)return view('actionable','insight','manual_draft',true);
 if(it.approved===true&&it.draft)return view('actionable','insight','approval',true);
 if(d.placement==='history'||d.placement==='quiet')return view('quiet','none',d.primaryReason,false);
 if(it.sensitive)return view('actionable','insight','sensitive',true,true);
 if(!ok){
  // The prior judgment is gone, but the exact request it identified has not been answered by anything known.
  const prior=it.lastOpenRequest;
  if(prior&&hasMessage(it,prior.requestMessageId))return view('actionable','decision','reevaluating_open',true,true); // Stays on its surface while a sibling's feedback re-judges it.
  if(d.primaryReason==='source_unavailable'||it.sourceUnavailable)return view('system_error','none','source_unavailable',false);
  if(t?.status==='failed')return view('system_error','none','judgment_failed',false,true);
  return view('reevaluating','none',t?.status==='running'?'judgment_running':'judgment_unknown',false);
 }
 const positive=hasPositiveRequest(t),reasons:string[]=d.recoveryReasons;
 if(reasons.includes('source_unavailable'))return positive?view('actionable','insight','source_unavailable',true):view('system_error','none','source_unavailable',false);
 if(reasons.includes('processing_failed'))return positive?view('actionable','insight','processing_failed',true,true):view('system_error','none','processing_failed',false,true);
 if(reasons.includes('draft_failed'))return positive?view('actionable','insight','draft_failed',true):view('quiet','none','draft_failed',false);
 if(!positive)return view('quiet','none',t.route==='no_reply'||t.actionType==='none'?'no_action':'low_signal',false);
 if(d.primaryReason==='time_unknown')return view('actionable','insight','time_unknown',true,true);
 if((t.missingContext??0)>=.5)return missingContextView(it,t,true);
 return view('actionable','insight','context_unknown',true,true);
}

/** Why a record cannot be dismissed, if any. Sensitive items may be dismissed individually by an explicit user action. */
export function dismissalBlock(item:any):string|undefined{
 if(LOCKED.includes(item.status))return 'outbound_state';
 if(item.draftPreparation?.status==='unknown')return 'draft_unknown';
}
export function buildDismissal(item:any,id:string,operationId:string,sourceVersion:string|undefined,at:string):AttentionDismissal{
 const prior=item.status==='dismissed'?item.attentionDismissal:undefined;
 const t=item.triage;
 return {id,operationId,...(t?.status==='succeeded'&&t.requestMessageId?{requestMessageId:t.requestMessageId}:{}),...(sourceVersion?{sourceVersion}:{}),
  knownMessages:Object.fromEntries((Array.isArray(item.messages)?item.messages:[]).filter((m:any)=>typeof m?.id==='string').slice(-MAX_KNOWN_MESSAGES).map((m:any)=>[m.id,messageRevision(m)])),
  priorStatus:prior?.priorStatus||(item.status==='dismissed'?'pending':String(item.status||'pending')),
  ...(prior?.priorClosedAt||(!prior&&item.closedAt)?{priorClosedAt:prior?.priorClosedAt||item.closedAt}:{}),dismissedAt:at};
}
/** A recalled reply is a known outcome, but the matter behind it is not resolved. */
export const RESOLVED_STATUSES=['sent','delivered','done','dismissed','cancelled','archived'];
function matterQuiet(id:string,inbox:any[]){
 const row=inbox.find(x=>x.id===id);if(!row||!RESOLVED_STATUSES.includes(String(row.status)))return false;
 // A container can stay dismissed while its source holds a newer request, or while that is still undecided.
 if(inbox.some(x=>x.sourceParentInboxId===id&&!RESOLVED_STATUSES.includes(String(x.status))))return false;
 try{const a=inboxAttention(row);return a.state==='quiet'&&a.surface==='none'}catch{return false}
}
/** Display suppression only: every exact link is a quiet, resolved matter. It never marks the idea done. */
export function ideaSourcesClosed(idea:{sourceIds?:string[]},inbox:any[]){
 const ids=Array.isArray(idea.sourceIds)?idea.sourceIds:[];
 return ids.length>0&&ids.every(id=>matterQuiet(id,inbox));
}
