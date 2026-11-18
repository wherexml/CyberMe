// Actions under a derived chat message and digest lines. Each action is typed and version-bound on the server;
// doing nothing is always safe, and a draft is never a send.
import React from 'react';
import type {Ctx} from './App';
import {Hv} from './ui';
import {attentionActionLabel,ideaProvenance,type AttentionActionType,type AttentionBinding} from '../../../shared/attention-actions';
import {tomorrowMorning,useDraftCooling} from './attention';
import {canOfferReplyDraft} from '../../../shared/inbox-attention';
import {useTypedActions,pendingLabel} from './attention-action-state';
import {fmtStamp,taskStatus} from './model';
import {UNRESOLVED} from './store';
import {FollowUpControls} from './FollowUp';

const chip:React.CSSProperties={minHeight:26,padding:'3px 10px',border:'1px dashed var(--lineStrong)',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text)',font:'inherit',fontSize:12,cursor:'pointer',textAlign:'left'};
const plainBtn:React.CSSProperties={...chip,border:'none',color:'var(--text2)'};

export function ActionRow({ctx,binding,types}:{ctx:Ctx;binding:AttentionBinding;types:AttentionActionType[]}){
 // Discussion is read-only: it only prepares the composer and never becomes a typed operation or a POST.
 const {zh,T}=ctx,typedTypes=types.filter(t=>t!=='discuss'),ta=useTypedActions(ctx,binding,typedTypes);
 // Same cooling wait as the insight card: only starting a new draft waits; a cooling refusal is never silent or red.
 const item:any=binding.entityKind==='inbox'?ctx.ws.inbox.find(x=>x.id===binding.entityId):undefined;
 const cooling=useDraftCooling(ctx,item);
 const draftCurrent=!!item?.draft?.trim()&&!item?.draftStale,task=types.includes('create_task')?ta.task():undefined;
 const feedback=typedTypes.map(t=>ta.view(t)).find(v=>v.error);
 const discuss=(e:any)=>{
  const row:any=binding.entityKind==='idea'?ctx.ws.ideas.find(x=>x.id===binding.entityId):item;
  const quote=[row?.title,row?.description||row?.body].filter(Boolean).join('\n\n');
  const ask=zh?'请结合这条洞察的完整内容和来源，帮我分析判断与下一步。':'Help me assess this insight and its next steps using the full context and sources.';
  ctx.toComposer(e,quote,ask,{k:'ctx',id:binding.entityId,i:-1,label:ask});
 };
 return <div data-message-actions style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6}}>
  {types.map(type=>{
   if(type==='discuss')return <Hv key={type} data-action="discuss" onClick={discuss} style={chip} hover={{background:'var(--hover)'}}>{attentionActionLabel(type,zh)}</Hv>;
   const v=ta.view(type),running=v.phase==='pending',unresolved=['unknown','missing','not_saved'].includes(v.phase||'');
   const viewDraft=type==='draft_reply'&&draftCurrent&&!running&&!unresolved,viewTask=type==='create_task'&&!!task&&!running&&!unresolved;
   // An unsettled judgment never starts a new draft; its receipts and a current draft stay reachable.
   if(type==='draft_reply'&&!viewDraft&&!running&&!unresolved&&binding.entityKind==='inbox'&&!canOfferReplyDraft(item))return null;
   const waiting=type==='draft_reply'&&!viewDraft&&!running&&!unresolved&&cooling.waiting;
   const label=running?(zh?'处理中…':'Working…'):unresolved?pendingLabel(v,zh,''):viewDraft?(zh?'查看草稿':'View draft'):viewTask?(zh?'查看任务 · ':'View task · ')+T.ts[taskStatus(task)]:waiting?(zh?'等待消息稳定':'Waiting for messages to settle'):attentionActionLabel(type,zh);
   return <Hv key={type} data-action={type} data-phase={v.phase} data-waiting={waiting?'cooling':undefined} disabled={(ta.anyBusy&&!unresolved)||running||waiting} aria-busy={running||undefined} onClick={()=>{
    if(waiting||running)return;
    if(viewDraft)return ctx.openDetail({type:'dec',id:binding.entityId});
    if(viewTask)return ctx.openDetail({type:'task',id:task!.id});
    ta.act(type,type==='snooze'?{until:tomorrowMorning()}:undefined);
   }} style={type==='dismiss'?plainBtn:chip} hover={{background:'var(--hover)'}}>{label}</Hv>})}
  {feedback?<span role="alert" data-action-feedback={feedback.phase} style={{fontSize:12,color:feedback.tone==='warn'?'var(--warnText)':'var(--errText)'}}>{feedback.error}</span>:null}
 </div>;
}

/** Binding from the record's own metadata for Inbox, or the Idea's current source versions. Nothing shown for a closed Idea. */
export function MessageActions({ctx,message}:{ctx:Ctx;message:any}){
 const a=message.inboxAnalysis,idea=message.ideaAnalysis;
 if(message.derivedKind==='follow-up-v1'&&message.taskId)return <FollowUpControls ctx={ctx} taskId={message.taskId} boundRevision={message.followUpRevision}/>;
 if(a&&!a.digest&&Array.isArray(a.actions)&&a.actions.length&&a.deliveryId)return <ActionRow ctx={ctx} types={a.actions} binding={{entityKind:'inbox',entityId:a.itemId,requestMessageId:a.requestMessageId,requestRevision:a.requestRevision}}/>;
 if(idea){const id=idea.currentIdeaId||idea.ideaId,row:any=ctx.ws.ideas.find(x=>x.id===id);if(row?.status==='new')return <ActionRow ctx={ctx} types={[['information','delegation'].includes(row.intent)?'discuss':'create_task','snooze','dismiss']} binding={{entityKind:'idea',entityId:row.id,provenanceKey:ideaProvenance(row)}}/>;
  // A closed idea keeps only the check/retry entry of its own unresolved typed receipts (original ID and binding), so a canonical
  // refresh cannot hide the only recovery path. No fresh action is offered; once settled the entry disappears.
  const open=Object.values(ctx.ui.actions||{}).filter(r=>r.binding.entityKind==='idea'&&r.binding.entityId===id&&UNRESOLVED.includes(r.phase)&&r.type!=='discuss');
  if(open.length)return <ActionRow ctx={ctx} types={open.map(r=>r.type as AttentionActionType)} binding={open[0].binding as AttentionBinding}/>;}
 return null;
}

export function DigestBody({ctx,message}:{ctx:Ctx;message:any}){
 const {zh}=ctx,a=message.inboxAnalysis,entries:any[]=a.entries||[];
 return <div data-digest style={{display:'flex',flexDirection:'column',gap:6}}>
  <span>{zh?'最新动态':'Updates'}</span>
  {entries.map(e=><Hv key={e.matterKey+e.revision} onClick={()=>ctx.openDetail({type:e.kind==='idea'?'ins':'dec',id:e.entityId})} style={{all:'unset',cursor:'pointer',display:'flex',alignItems:'baseline',gap:8,minWidth:0}} hover={{color:'var(--accentText)'}}><span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{String(e.line).replace(/\\(.)/g,'$1')}</span>{e.occurredAt?<span style={{flex:'none',fontSize:12,color:'var(--text3)'}}>{fmtStamp(e.occurredAt,zh)}</span>:null}</Hv>)}
 </div>;
}
