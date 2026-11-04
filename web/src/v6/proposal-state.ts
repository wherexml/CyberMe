// Pure, read-only status of a V6 email proposal's canonical task, shared by the Tasks list, the chat task event and the
// task detail. It only reads recorded API outcomes; it never calls an API or changes persisted task status.
import type {InboxItem} from '../../../shared/types';
import type {Proposal} from './store';
import type {PillStatus} from './ui';

export const emailSteps=(zh:boolean)=>zh?['读取往来记录','起草邮件','等你确认','发送']:['Read the messages','Draft emails','Your review','Send'];

/** The created proposal whose canonical task id is exactly `taskId` (never a follow-up id, never a title match). */
export function proposalForTask(proposals:Proposal[],taskId:string):Proposal|undefined{
 return proposals.find(p=>!!p.created&&p.task?.status==='done'&&p.task.taskId===taskId);
}

/** Aggregate over every selected recipient id (`p.picked`), not only those still present in the Inbox: a recipient
 *  without a recorded `sent` receipt (missing item, unknown, sending, failed, recalled, not sent) keeps the task from done. */
export function proposalState(p:Proposal,inbox:InboxItem[]):{status:PillStatus;step:number}{
 const created=!!p.created&&p.task?.status==='done';const ids=p.picked;
 if(!created||!ids.length)return {status:'queued',step:0};
 const ss=ids.map(id=>p.sends[id]?.status),anySend=ss.some(Boolean);
 let status:PillStatus;
 if(anySend){const has=(s:string)=>ss.includes(s);const sent=ss.filter(s=>s==='sent').length;
  status=has('sending')?'sending':has('unknown')?'unknown':sent===ids.length?'done':ss.some(s=>s==='failed'||s==='not_sent')?(sent?'partial':'failed'):sent?'partial':'confirm';}
 else{const ds=ids.map(id=>p.drafts[id]?.status);
  const ready=ids.some(id=>{const it=inbox.find(x=>x.id===id);return !!it&&p.drafts[id]?.status==='succeeded'&&!!String(it.draft||'').trim()&&(((it as any).draftTone||'brief')===p.tone)});
  status=ds.some(d=>d==='running'||d==='starting')?'running':ds.some(d=>d==='failed'||d==='not_started')?'failed':ds.some(d=>d==='review')?'confirm':ds.some(d=>d&&d!=='succeeded')?'unknown':ready?'confirm':'queued';}
 // Four reference steps: Read, Draft, Your review, Send.
 const step=status==='done'?4:status==='queued'?0:status==='running'?1:status==='confirm'?2:status==='sending'?3:anySend?3:1;
 return {status,step};
}
