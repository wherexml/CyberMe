import type {InboxItem} from './types';
export const INBOX_PENDING_POLICY='pending-v1-7d';
export const INBOX_WINDOW_MS=7*24*60*60*1000;
export type InboxPlacement='pending'|'quiet'|'history'|'verify';
export interface InboxDisposition {policyVersion:string;placement:InboxPlacement;primaryReason:string;reasons:string[];recoveryReasons:string[];evaluatedAt:string;actionableAt?:string;expiresAt?:string;priority?:string;actionType?:string;canRestore:boolean}
export const inboxReasonLabels:Record<string,string>={wechat_other:'微信其他类不分析',wechat_category_unknown:'微信分类待确认',group_mentions_only:'群聊仅关注最近@我',expired:'已超过7天',no_reply:'无需回复',low_priority:'低优先级',replied:'已回复',completed:'已完成',dismissed:'已忽略',source_rule:'来源已安静记录',source_unavailable:'来源连接不可用，请恢复连接后核实',time_unknown:'消息时间待核实',judgment_unknown:'等待判断',judgment_failed:'判断失败',priority_unknown:'优先级待核实',context_unknown:'上下文待核实',sensitive:'敏感事项待核实',sending:'发送中',send_unknown:'发送结果待核实',send_failed:'发送失败',processing_failed:'处理失败',draft_unknown:'生成结果待核实',draft_failed:'草稿生成失败',action:'需要处理',manual:'已恢复待处理'};
export function inboxTimestamp(value:unknown):number|undefined {
 if(value===undefined||value===null||value==='')return;
 // Source dates must carry a timezone. Never reinterpret local ambiguous dates.
 const numeric=typeof value==='number'||/^\d{10,13}(?:\.\d+)?$/.test(String(value));
 if(!numeric&&!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value)))return;
 const n=numeric?Number(value)*(Number(value)<1e11?1000:1):Date.parse(String(value));
 return Number.isFinite(n)&&n>0&&Number.isFinite(new Date(n).getTime())?n:undefined;
}
// Small deterministic hash: this file also runs in the browser, and the value is only compared for equality.
export function textHash(text:string){let a=0xdeadbeef,b=0x41c6ce57;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,2654435761);b=Math.imul(b^c,1597334677);}a=Math.imul(a^(a>>>16),2246822507)^Math.imul(b^(b>>>13),3266489909);b=Math.imul(b^(b>>>16),2246822507)^Math.imul(a^(a>>>13),3266489909);return (b>>>0).toString(36)+(a>>>0).toString(36);}
const refId=(x:any)=>typeof x==='string'?x:x?.id||x?.fileKey||x?.key||x?.openId||x?.name||x?.filename||'';
/** What a message says, not how it was synced: avatars, display names, direction and sync timestamps are excluded. */
export function messageRevision(m:any){
 const list=(v:any)=>Array.isArray(v)?v.map(refId).sort():[];
 return textHash(JSON.stringify([m?.text||m?.content||m?.body||'',m?.replyToId||'',m?.rootId||'',m?.threadId||'',list(m?.mentions),!!m?.mentionsSelf,list(m?.attachments),!!m?.deleted,!!m?.recalled]));
}
/** Has the user not seen this exact message, in this exact revision, as of their dismissal? */
export function dismissalUnseen(item:any,id:unknown){
 const dismissal=item?.attentionDismissal;if(!dismissal||typeof id!=='string')return false;
 const seen=dismissal.knownMessages?.[id];
 if(seen===undefined)return id!==dismissal.requestMessageId;
 const current=(Array.isArray(item.messages)?item.messages:[]).find((m:any)=>m.id===id);
 return !!current&&messageRevision(current)!==seen;
}
/** First close time that parses: an unparseable closedAt must not hide a usable sentAt or receipt time. */
export function closureStamp(item:any):number|undefined{for(const value of [item?.closedAt,item?.sentAt,item?.receipt?.at]){const stamp=inboxTimestamp(value);if(stamp!==undefined)return stamp}return undefined}
/** The exact open request this closed record still holds, unless it was already cleared or forwarded at this revision. */
function openRequestOnClosed(item:any,t:any){
 if(t?.status!=='succeeded'||t.resolution!=='open'||!t.requestMessageId)return;
 const request=(Array.isArray(item?.messages)?item.messages:[]).find((m:any)=>m.id===t.requestMessageId);
 if(!request)return; // A judgment naming a message we no longer hold cannot be shown or forwarded.
 const ack=item.attentionAck;if(ack&&ack.requestMessageId===t.requestMessageId&&ack.requestRevision===messageRevision(request))return;
 return request;
}
/** One answer for display and forwarding: is the exact open request proven newer than this record's closure? */
export function requestAfterClosure(item:any,t:any):boolean{
 const request=openRequestOnClosed(item,t);if(!request)return false;
 if(item.status==='dismissed'&&item.attentionDismissal)return dismissalUnseen(item,t.requestMessageId);
 const closed=closureStamp(item),at=inboxTimestamp(request.sentAt);
 return closed!==undefined&&at!==undefined&&at>closed;
}
/** A missing close time proves nothing. Such a record is not reopened or called new; it only needs verifying. */
export function closureTimeUnknown(item:any,t:any):boolean{
 if(!['sent','delivered','done','dismissed','cancelled'].includes(item?.status)||(item.status==='dismissed'&&item.attentionDismissal))return false;
 const request=openRequestOnClosed(item,t);if(!request||closureStamp(item)!==undefined)return false;
 return !(t.requestMessageId===item.forwardedRequestId&&(!item.forwardedRequestRevision||messageRevision(request)===item.forwardedRequestRevision));
}
/** A round needs a dated request unless a bound dismissal proved it unseen, and an expired request opens nothing. */
export function canForwardRequest(item:any,t:any,now=Date.now()):boolean{
 if(!requestAfterClosure(item,t))return false;
 const request=item.messages.find((m:any)=>m.id===t.requestMessageId),at=inboxTimestamp(request.sentAt);
 if(at!==undefined&&now>=at+INBOX_WINDOW_MS)return false;
 return at!==undefined||(item.status==='dismissed'&&!!item.attentionDismissal);
}
export function hasNoReplyDecision(item: InboxItem) {return item.triage?.status==='succeeded'&&item.triage.route==='no_reply'&&!item.attentionOverride;}
export function inboxDisposition(item:InboxItem,at=Date.now()):InboxDisposition {
 if(item.sourceAttentionExcluded&&!['sending','send_unknown'].includes(item.status)&&item.draftPreparation?.status!=='unknown')return {policyVersion:INBOX_PENDING_POLICY,placement:'quiet',primaryReason:item.sourceAttentionReason||'group_mentions_only',reasons:[item.sourceAttentionReason||'group_mentions_only'],recoveryReasons:[],evaluatedAt:new Date(at).toISOString(),canRestore:false};
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
 const closedStamp=closureStamp(item);
 // A dismissal is bound to message identity; records without a binding keep the original time comparison.
 const dismissal=item.status==='dismissed'?(item as any).attentionDismissal:undefined;
 const unseen=(id:unknown)=>dismissalUnseen(item,id);
 const unseenIncoming=messages.some((m:any)=>m.isMine!==true&&m.direction!=='outgoing'&&!m.deleted&&!m.recalled&&unseen(m.id));
 // A later edit of an already forwarded request is new evidence again until reevaluation forwards that revision.
 const forwardedRevision=(item as any).forwardedRequestRevision;
 const forwarded=ok&&!!t.requestMessageId&&t.requestMessageId===item.forwardedRequestId&&(!forwardedRevision||!request||messageRevision(request)===forwardedRevision);
 const newOpen=ok&&!forwarded&&requestAfterClosure(item,t);
 const changedClosed=!ok&&(dismissal?unseenIncoming:messages.some((m:any)=>m.isMine!==true&&m.direction!=='outgoing'&&(closedStamp===undefined||inboxTimestamp(m.sentAt)!>closedStamp)));
 // New evidence with a strong request signal but no identifiable origin must not stay suppressed forever.
 const unidentified=!!dismissal&&ok&&!t.requestMessageId&&unseenIncoming&&t.resolution==='unknown'&&(t.needsReply??0)>=.75;
 const closureUnverified=['sent','delivered','done','dismissed','cancelled'].includes(item.status)&&(newOpen||changedClosed||unidentified||closureTimeUnknown(item,t));
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

/** All is the daily working set; quiet/history remain explicitly browseable. */
export function matchesInboxFilter(item:InboxItem,filter:string){
 const d=dispositionOf(item),verify=needsInboxVerification(item);
 if(filter==='verify')return verify;
 if(filter==='quiet')return d.placement==='quiet'||d.placement==='history';
 if(filter==='all')return verify||d.placement==='pending';
 return d.placement==='pending';
}
