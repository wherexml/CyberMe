// Per-source Inbox rule modes (docs/public/chat-time-budgets.md, section B).
// Pure helpers shared by the store projection, insight sources and the rule writer.
export type InboxSourceMode='all'|'mentions'|'exclude';
export type MentionGate='mentioned'|'not_mentioned'|'unknown';
export const INBOX_SOURCE_MODES:InboxSourceMode[]=['all','mentions','exclude'];

/** Old rules carry only `active`; they keep their meaning (true = exclude). */
export function ruleMode(rule:any):InboxSourceMode{
 if(INBOX_SOURCE_MODES.includes(rule?.mode))return rule.mode;
 return rule?.active===true?'exclude':'all';
}
const incoming=(m:any)=>m&&m.isMine!==true&&m.direction!=='outgoing'&&!m.deleted&&!m.recalled;
const mentionId=(x:any)=>typeof x?.id==='object'?x.id?.open_id:x?.id;
/**
 * Owner mention from trusted connector metadata only: Feishu `mentionsSelf` / structured
 * `mentions[].id` bound to the item's `selfId`, WeChat CLI-derived `mentionsOwner`.
 * Message text is never searched for "@name" substrings.
 */
export function ownerMention(item:any,m:any):boolean|undefined{
 if(m?.mentionsSelf===true||m?.mentionsOwner===true)return true;
 const self=item?.selfId;
 if(self&&Array.isArray(m?.mentions)&&m.mentions.some((x:any)=>mentionId(x)===self))return true;
 if(m?.mentionsSelf===false||m?.mentionsOwner===false)return false;
 if(self&&Array.isArray(m?.mentions))return false;
 return undefined;
}
/**
 * Mention state of the CURRENT request only. A durable round is bound to `requestRoundId`; otherwise the
 * succeeded triage's exact `requestMessageId`. Other (older/neighbouring) messages never qualify it.
 * Without a binding, only the latest incoming message counts, and disagreement stays unknown.
 */
export function mentionGate(item:any,requestMessageId?:string):MentionGate{
 const rows=(Array.isArray(item?.messages)?item.messages:[]);
 const bound=item?.requestRoundId||requestMessageId;
 if(bound){
  const m=rows.find((x:any)=>x?.id===bound);
  if(!m||!incoming(m))return 'unknown';
  const s=ownerMention(item,m);return s===true?'mentioned':s===false?'not_mentioned':'unknown';
 }
 const live=rows.filter(incoming);
 if(!live.length)return 'unknown';
 const states=live.map((m:any)=>ownerMention(item,m));
 if(states.at(-1)===true)return 'mentioned';
 return states.every((x:any)=>x===false)?'not_mentioned':'unknown';
}
const OUTBOUND_KEPT=['sending','send_unknown','send_failed','failed'];
/** A draft the user wrote or edited; a generated default draft alone does not keep a non-mentioned request. */
const humanDraft=(item:any)=>!!String(item?.draft||'').trim()&&(item.manualDraft===true||item.editedByUser===true||!(item.draftRunId||item.draftPreparation?.status==='succeeded'));
/**
 * Projection of a stored rule onto one item. `active` means "the rule asks to quiet this item".
 * Mentions-only: a verified non-mentioned current request is quiet even with stale/failed analysis;
 * real in-flight/unknown outbound and human drafts keep attention; raw messages are never touched.
 */
export function projectSourceRule(rule:any,item:any,requestMessageId?:string){
 if(!rule)return undefined;
 const mode=ruleMode(rule);
 if(mode==='all')return undefined;
 if(mode==='exclude')return {id:rule.id,name:rule.name,active:true,mode,reason:'source_excluded'};
 const gate=mentionGate(item,requestMessageId),bound=item?.requestRoundId||requestMessageId;
 const outbound=OUTBOUND_KEPT.includes(item?.status)||item?.draftPreparation?.status==='unknown',drafted=humanDraft(item);
 const active=gate==='not_mentioned'&&!outbound&&!drafted;
 return {id:rule.id,name:rule.name,active,mode,mentionGate:gate,boundRequest:!!bound,reason:active?'mentions_only':outbound?'outbound_kept':drafted?'draft_kept':gate==='mentioned'?'owner_mentioned':'mention_unknown'};
}
