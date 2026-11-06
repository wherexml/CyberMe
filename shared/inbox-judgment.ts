import type {InboxTriage} from './types';

/** Optional politeness is not an outstanding request. Keep the provider's raw
 * answers for diagnosis, but do not let an independent reply/depth score invent
 * work after a complete, low-risk no-action judgment. Unknowns stay unknown. */
export function normalizeNoActionJudgment<T extends InboxTriage>(triage:T):T {
 const low=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=.25;
 if(triage.status!=='succeeded'||triage.actionType!=='none'||triage.resolution!=='none'||triage.priority!=='low'
  ||!['acknowledgement','fyi','other_recipient'].includes(triage.reason||'')
  ||!low(triage.needsOwner)||!low(triage.risk)
  ||typeof triage.needsReply!=='number'||!Number.isFinite(triage.needsReply)||triage.needsReply<0||triage.needsReply>1)return triage;
 return {...triage,route:'no_reply',needsReply:0,needsDeepThink:0,missingContext:0};
}
