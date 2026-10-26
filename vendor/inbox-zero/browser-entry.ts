// Local Mock adapter; upstream LICENSE applies to the imported source.
import {meetsDraftReplyConfidenceRequirement} from './upstream/apps/web/utils/ai/reply/draft-confidence';
import {DraftReplyConfidence} from './mock-enums';
import {getMaxLengthForThreadStatusMessage} from './thread-budget';

export function draftEligibility(confidence: unknown) {
  const known = typeof confidence === 'string' && Object.values(DraftReplyConfidence).includes(confidence as DraftReplyConfidence);
  if (!known) return {eligible:false, reason:'unknown', confidence:null, minimumConfidence:'STANDARD'};
  const eligible = meetsDraftReplyConfidenceRequirement({
    draftConfidence:confidence as DraftReplyConfidence,
    minimumConfidence:DraftReplyConfidence.STANDARD,
  });
  return {eligible,reason:eligible?'eligible':'low-confidence',confidence,minimumConfidence:'STANDARD'};
}

// Plain-text source adaptation. Never parse mail HTML or mutate original messages.
export function prepareThreadContext(input: unknown) {
  const all = Array.isArray(input) ? input : [];
  const selected = all.length > 64 ? [all[0], ...all.slice(-63)] : all;
  let truncatedCount = 0;
  const messages = selected.map((row, index) => {
    const text = Array.isArray(row) && typeof row[1] === 'string' ? row[1] : '';
    const role = Array.isArray(row) && row[0] === 'me' ? 'me' : 'other';
    const maxLength = getMaxLengthForThreadStatusMessage({index,totalMessages:selected.length});
    const chars = Array.from(text);
    const truncated = chars.length > maxLength;
    if (truncated) truncatedCount++;
    const marker = '\n[内容已截断]\n';
    // Latest message retains its end as in upstream keepTailLength=1000.
    const tail = index === selected.length - 1 ? Math.min(1000,maxLength-marker.length) : 0;
    const body = !truncated ? text : chars.slice(0,maxLength-marker.length-tail).join('') + marker + (tail?chars.slice(-tail).join(''):'');
    return {role,text:body,truncated};
  });
  return {messages,truncatedCount,omittedCount:all.length-selected.length};
}
