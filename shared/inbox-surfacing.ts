import type {InboxItem} from './types';
export function hasNoReplyDecision(item: InboxItem) {
 return item.triage?.status==='succeeded' && item.triage.route==='no_reply';
}
/** A successful, low-risk no-reply decision retires automatic drafts, never user work. */
export function needsNoReply(item: InboxItem) {
 const a=item.triage;
 return !item.attentionOverride && !item.sensitive && !(item.editedByUser && item.draft)
  && !item.draftCandidate && !['sending','send_unknown','failed','send_failed'].includes(item.status)
  && !['failed','blocked','interrupted'].includes(item.sourceProcessing?.status)
  && a?.status==='succeeded' && a.route==='no_reply'
  && (a.method==='rule'||(a.needsOwner<=.25 && a.risk<=.25 && a.missingContext<=.25));
}
export function isQuietInbox(item: InboxItem) {
 const a=item.triage;
 // Explicit source exclusions are reversible; uncertain or consequential items stay visible.
 if(item.sourceRule?.active && !item.attentionOverride && !item.sensitive && !item.draft && !['sending','send_unknown','failed','send_failed'].includes(item.status) && !['failed','blocked','interrupted'].includes(item.sourceProcessing?.status) && a?.status==='succeeded' && a.route!=='review' && a.risk<=.25 && a.needsOwner<=.25 && a.missingContext<=.25)return true;
 return needsNoReply(item);
}
export function needsInboxAttention(item:InboxItem) {
 return !['sent','delivered','done','dismissed','recalled','cancelled'].includes(item.status) && !isQuietInbox(item);
}
