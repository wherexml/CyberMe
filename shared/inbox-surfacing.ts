import type {InboxItem} from './types';
export const INBOX_PENDING_POLICY='pending-v1-7d';
export const INBOX_WINDOW_MS=7*24*60*60*1000;
export type InboxPlacement='pending'|'quiet'|'history'|'verify';
export interface InboxDisposition {policyVersion:string;placement:InboxPlacement;primaryReason:string;reasons:string[];recoveryReasons:string[];evaluatedAt:string;actionableAt?:string;expiresAt?:string;priority?:string;actionType?:string;canRestore:boolean}
export const inboxReasonLabels:Record<string,string>={expired:'已超过7天',no_reply:'无需回复',low_priority:'低优先级',replied:'已回复',completed:'已完成',dismissed:'已忽略',source_rule:'来源已安静记录',source_unavailable:'来源连接不可用，请恢复连接后核实',time_unknown:'消息时间待核实',judgment_unknown:'等待判断',judgment_failed:'判断失败',priority_unknown:'优先级待核实',context_unknown:'上下文待核实',sensitive:'敏感事项待核实',sending:'发送中',send_unknown:'发送结果待核实',send_failed:'发送失败',processing_failed:'处理失败',draft_unknown:'生成结果待核实',draft_failed:'草稿生成失败',action:'需要处理',manual:'已恢复待处理'};
export function inboxTimestamp(value:unknown):number|undefined {
 if(value===undefined||value===null||value==='')return;
 // Source dates must carry a timezone. Never reinterpret local ambiguous dates.
 const numeric=typeof value==='number'||/^\d{10,13}(?:\.\d+)?$/.test(String(value));
 if(!numeric&&!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value)))return;
 const n=numeric?Number(value)*(Number(value)<1e11?1000:1):Date.parse(String(value));
 return Number.isFinite(n)&&n>0&&Number.isFinite(new Date(n).getTime())?n:undefined;
}
export function hasNoReplyDecision(item: InboxItem) {return item.triage?.status==='succeeded'&&item.triage.route==='no_reply'&&!item.attentionOverride;}
export function inboxDisposition(item:InboxItem,at=Date.now()):InboxDisposition {
 const t=item.triage,ok=t?.status==='succeeded',messages=Array.isArray(item.messages)?item.messages:[];
 const request=ok&&t.requestMessageId?messages.find((m:any)=>m.id===t.requestMessageId):undefined;
 // Jev selects the current request, not the latest unrelated conversation event.
 const raw=request?.sentAt??(messages.length===0?(item.receivedAt??item.eventAt??item.sentAt):undefined);
 let stamp=inboxTimestamp(raw);
 // Without a judgment, an entirely old conversation can still expire safely.
 if(stamp===undefined&&messages.length){const times=messages.map((m:any)=>inboxTimestamp(m.sentAt));if(times.every((v:any)=>v!==undefined)&&times.every((v:any)=>v<=at-INBOX_WINDOW_MS))stamp=Math.max(...times as number[]);}
 const validTime=stamp!==undefined&&stamp<=at;
 const expired=validTime&&at>=stamp!+INBOX_WINDOW_MS;
 const recoveryReasons:string[]=[];
 if(item.sourceUnavailable)recoveryReasons.push('source_unavailable');
 if(['sending','send_unknown','send_failed','failed'].includes(item.status))recoveryReasons.push(item.status==='failed'?'send_failed':item.status);
 if(['failed','blocked','interrupted'].includes(item.sourceProcessing?.status))recoveryReasons.push('processing_failed');
 if(item.draftPreparation?.status==='unknown')recoveryReasons.push('draft_unknown');
 if(item.draftError||item.draftPreparation?.status==='failed')recoveryReasons.push('draft_failed');
 const reasons:string[]=[];
 const resolved=item.status!=='recalled'&&ok&&t.resolution==='replied'&&!!t.replyMessageId&&messages.some((m:any)=>m.id===t.replyMessageId&&(m.isMine===true||(m.isMine!==false&&m.direction==='outgoing'))&&!m.deleted&&!m.recalled&&inboxTimestamp(m.sentAt)!> (stamp??Infinity));
 const closedStamp=inboxTimestamp(item.closedAt||item.sentAt||item.receipt?.at);
 const newOpen=ok&&t.resolution==='open'&&!!t.requestMessageId&&t.requestMessageId!==item.forwardedRequestId&&(closedStamp===undefined||(stamp!==undefined&&stamp>closedStamp));
 const changedClosed=!ok&&messages.some((m:any)=>m.isMine!==true&&m.direction!=='outgoing'&&(closedStamp===undefined||inboxTimestamp(m.sentAt)!>closedStamp));
 const closureUnverified=['sent','delivered','done','dismissed','cancelled'].includes(item.status)&&(newOpen||changedClosed);
 if(closureUnverified)recoveryReasons.push('context_unknown');
 if((['sent','delivered'].includes(item.status)&&!closureUnverified)||resolved)reasons.push('replied');
 if(['done','cancelled','archived'].includes(item.status)&&!closureUnverified)reasons.push('completed');
 if(item.status==='dismissed'&&!closureUnverified)reasons.push('dismissed');
 if(expired)reasons.push('expired');
 if(ok&&t.route==='no_reply'&&t.actionType!=='decision')reasons.push('no_reply');
 if(ok&&t.priority==='low')reasons.push('low_priority');
 if(item.sourceRule?.active)reasons.push('source_rule');
 let placement:InboxPlacement='verify',primaryReason='judgment_unknown';
 const ended=reasons.find(r=>['replied','completed','dismissed'].includes(r));
 const override=!!item.attentionOverride;
 if(ended){placement=ended==='replied'?'quiet':'history';primaryReason=ended;}
 else if(expired){placement='quiet';primaryReason='expired';}
 else if(!validTime)primaryReason='time_unknown';
 else if(!ok)primaryReason=t?.status==='failed'?'judgment_failed':'judgment_unknown';
 else if(recoveryReasons.length)primaryReason=recoveryReasons[0];
 else if(item.status==='recalled')primaryReason='context_unknown';
 else if(override){placement='pending';primaryReason='manual';}
 else if(item.sensitive&&t.actionType!=='decision')primaryReason='sensitive';
 else if((t.missingContext??0)>=.5)primaryReason='context_unknown';
 else if(reasons.includes('no_reply')&&(t.needsOwner??0)<.75){placement='quiet';primaryReason='no_reply';}
 else if(t.resolution==='unknown'||t.actionType==='unknown'||reasons.includes('no_reply'))primaryReason='context_unknown';
 else if(t.priority==='low'&&((t.needsOwner??0)>=.75||(t.risk??0)>=.75||t.actionType==='decision'))primaryReason='context_unknown';
 else if(reasons.includes('low_priority')){placement='quiet';primaryReason='low_priority';}
 else if(reasons.includes('source_rule')&&(t.risk??1)<=.25&&(t.needsOwner??1)<=.25){placement='quiet';primaryReason='source_rule';}
 else if(!['high','medium'].includes(t.priority))primaryReason='priority_unknown';
 else if(['reply','decision'].includes(t.actionType)&&t.resolution==='open'){placement='pending';primaryReason='action';}
 else primaryReason='context_unknown';
 if(placement==='verify'&&!recoveryReasons.includes(primaryReason))recoveryReasons.push(primaryReason);
 if(!reasons.includes(primaryReason))reasons.unshift(primaryReason);
 return {policyVersion:INBOX_PENDING_POLICY,placement,primaryReason,reasons,recoveryReasons,evaluatedAt:new Date(at).toISOString(),...(validTime?{actionableAt:new Date(stamp!).toISOString(),expiresAt:new Date(stamp!+INBOX_WINDOW_MS).toISOString()}:{}),priority:t?.priority,actionType:override?'reply':t?.actionType,canRestore:validTime&&!expired&&!ended&&!recoveryReasons.length&&ok};
}
// HTTP consumers use the server's snapshot. Server projection explicitly calls
// inboxDisposition on stripped data; time passage is refreshed by GET, not writes.
export function dispositionOf(item:InboxItem):InboxDisposition {return item.disposition?.policyVersion===INBOX_PENDING_POLICY?item.disposition:inboxDisposition(item);}
export function needsNoReply(item:InboxItem){return hasNoReplyDecision(item);}
export function isQuietInbox(item:InboxItem){return dispositionOf(item).placement==='quiet';}
export function needsInboxAttention(item:InboxItem){return dispositionOf(item).placement==='pending';}
export function needsInboxVerification(item:InboxItem){const d=dispositionOf(item);return d.placement==='verify'||d.recoveryReasons.length>0;}
export function compareInboxAttention(a:InboxItem,b:InboxItem){const x=dispositionOf(a),y=dispositionOf(b);return Number(y.priority==='high')-Number(x.priority==='high')||(inboxTimestamp(a.dueAt)??Infinity)-(inboxTimestamp(b.dueAt)??Infinity)||(y.actionableAt||'').localeCompare(x.actionableAt||'')||a.id.localeCompare(b.id);}
