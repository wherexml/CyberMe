import type {InboxItem} from './types';
export function isQuietInbox(item: InboxItem) {
 const a=item.triage;
 // Explicit source exclusions are reversible; uncertain or consequential items stay visible.
 if(item.sourceRule?.active && !item.attentionOverride && !item.sensitive && !item.draft && !['sending','send_unknown','failed','send_failed'].includes(item.status) && !['failed','blocked','interrupted'].includes(item.sourceProcessing?.status) && a?.status==='succeeded' && a.route!=='review' && a.risk<=.25 && a.needsOwner<=.25 && a.missingContext<=.25)return true;
 return !['failed','blocked','interrupted'].includes(item.sourceProcessing?.status) && !item.attentionOverride && !item.sensitive && !item.draft && !['sending','send_unknown','failed','send_failed'].includes(item.status) && a?.status==='succeeded' && a.route==='no_reply' && (a.method==='rule'||(a.needsOwner<=.25 && a.risk<=.25 && a.missingContext<=.25));
}
export function needsInboxAttention(item:InboxItem) {
 return !['sent','delivered','done','dismissed','recalled','cancelled'].includes(item.status) && !isQuietInbox(item);
}
