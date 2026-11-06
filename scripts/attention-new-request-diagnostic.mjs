// Read-only counts for the `new_request` card paths. Opens the database read-only and prints counts only: never message text, titles or IDs.
// Repeat: OPSTWIN_DB=/path/opstwin-advance.db node --import tsx scripts/attention-new-request-diagnostic.mjs
// Boundary: reads the stored judgment without re-checking its source version, so these are upper bounds, not a live projection.
import {DatabaseSync} from 'node:sqlite';
import {inboxDisposition,inboxTimestamp,closureStamp} from '../shared/inbox-surfacing.ts';
import {inboxAttention} from '../shared/inbox-attention.ts';
const path=process.env.OPSTWIN_DB;if(!path)throw Error('Set OPSTWIN_DB to the database path');
const db=new DatabaseSync(path,{readOnly:true}),rows=type=>db.prepare('SELECT id,data FROM entities WHERE type=? AND deleted=0').all(type);
const triages=new Map(rows('inbox_triages').map(r=>[r.id,JSON.parse(r.data)])),counts={};
const bump=key=>{counts[key]=(counts[key]||0)+1};
for(const row of rows('inbox')){
 const raw=JSON.parse(row.data),item={...raw,triage:triages.get(row.id)};
 let attention;try{item.disposition=inboxDisposition(item);attention=inboxAttention(item)}catch{bump('projection_error');continue}
 const closureUnverified=item.disposition.recoveryReasons.includes('context_unknown')&&['sent','delivered','done','dismissed','cancelled'].includes(item.status);
 if(!closureUnverified)continue;
 const request=(item.messages||[]).find(m=>m.id===item.triage?.requestMessageId),at=inboxTimestamp(request?.sentAt),age=at===undefined?'unknown':Date.now()-at>7*864e5?'over7d':'within7d';
 bump(['card='+attention.reason,'status='+item.status,'closedAt='+(inboxTimestamp(item.closedAt)!==undefined?'parses':item.closedAt?'unparseable':'missing'),'closure='+(closureStamp(item)===undefined?'none':'known'),'binding='+!!item.attentionDismissal,'requestFound='+!!request,'requestId='+!!item.triage?.requestMessageId,'forwarded='+!!item.forwardedRequestId,'age='+age,'expired='+item.disposition.reasons.includes('expired')].join(' '));
}
console.log(JSON.stringify(counts,null,1));db.close();
