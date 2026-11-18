// One delivery decision for both projectors. Visibility is never budgeted; interruption always is.
// The ledger is durable, keyed by exact identity only: never by similar titles or a shared source.
import {messageRevision,inboxTimestamp} from '../../shared/inbox-surfacing';
import {get,put,list,meta,setMeta,now,hash} from './store';
import {notificationPreview,urgent} from './notifications';

export type Tier='recovery'|'urgent'|'decision'|'suggestion';
export type Plan='chat'|'hold'|'none';
export type LedgerDecision='chat'|'held'|'digested'|'suppressed'|'attached';
export const DIGEST_GAP_MS=3*3600e3,DIGEST_LINES=3;
const KEY='attention-delivery-v1',DAY=864e5;

export function deliveryModes(){const p:any=notificationPreview();return {mode:p.mode as string|undefined,quiet:!!p.quiet,blocked:p.action==='blocked'};}
export type Modes=ReturnType<typeof deliveryModes>;
/** Existing notification settings stay authoritative; `strategy` is the explicit per-matter override. */
export function planDelivery(tier:Tier,strategy:unknown,m:Modes):Plan{
 if(tier==='recovery')return 'chat';
 if(strategy==='quiet')return 'none';
 if(strategy==='immediate')return 'chat';
 if(strategy==='digest')return 'hold';
 if(m.blocked)return 'hold';
 if(tier==='suggestion')return m.mode==='every'?'chat':'hold';
 if(tier==='urgent')return m.mode==='digest'?'hold':'chat';
 return m.mode==='every'?'chat':'hold';
}
export function inboxTier(item:any):Tier{
 const due=inboxTimestamp(item.dueAt),at=Date.now();
 return item.triage?.priority==='high'||(due!==undefined&&due>at&&due-at<=DAY)||urgent(item)?'urgent':'decision';
}
export function inboxMatter(item:any){
 // While a sibling's feedback re-judges this record, the exact request it already identified remains its identity.
 const t=item.triage,id:string|undefined=t?.status==='succeeded'?t.requestMessageId:item.lastOpenRequest?.requestMessageId;
 const request=id?(Array.isArray(item.messages)?item.messages:[]).find((m:any)=>m.id===id):undefined;
 return {key:hash([item.sourceParentInboxId||item.id,id||'item']),requestMessageId:id,requestRevision:request?messageRevision(request):hash(String(item.body||'')).slice(0,16),occurredAt:inboxTimestamp(request?.sentAt)!==undefined?request.sentAt:undefined};
}
const rowId=(key:string,revision:string)=>hash(['ledger',key,revision]);
export const ledgerGet=(key:string,revision:string)=>get('attention_ledger',rowId(key,revision));
export function ledgerPut(key:string,revision:string,row:{kind:'inbox'|'idea';entityId:string;tier:Tier;decision:LedgerDecision;reason:string;[k:string]:unknown}){
 const old=ledgerGet(key,revision);
 if(old&&old.decision===row.decision&&old.reason===row.reason)return old;
 return put('attention_ledger',{...old,...row,id:rowId(key,revision),matterKey:key,revision,at:now()});
}
export const heldRows=()=>list('attention_ledger').filter(r=>r.decision==='held');

type DeliveryState={lastDigestAt?:string};
const state=()=>meta<DeliveryState>(KEY,{});
export function digestDue(m:Modes){const last=Date.parse(state().lastDigestAt||'');return !m.quiet&&!m.blocked&&(!Number.isFinite(last)||Date.now()-last>=DIGEST_GAP_MS);}
export const markDigest=()=>setMeta(KEY,{...state(),lastDigestAt:now()});
