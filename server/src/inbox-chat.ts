import {db,get,list,put,remove,restore,meta,setMeta,now,hash,settings} from './store';
import {dispositionOf} from '../../shared/inbox-surfacing';
import {snoozeActive} from '../../shared/inbox-attention';
import {DIGEST_LINES,deliveryModes,digestDue,heldRows,inboxMatter,inboxTier,ledgerGet,ledgerPut,markDigest,planDelivery,type Tier} from './attention-delivery';
import {ideaReminderDeliverable} from './ideas-chat';
import {onEntityChange} from './entity-events';

// A main-chat reminder is a user action, not an Inbox status feed.
const kind='inbox-analysis-v1';
const line=(text:any)=>String(text||'').replace(/[\r\n]+/g,' ').replace(/[\\`*_[\]<>#]/g,'\\$&');
function meaningful(text:unknown){
 const value=String(text||'').trim();
 if(!/[\p{L}\p{N}]/u.test(value))return false;
 const compact=value.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
 return !/^(ok(ay)?|k|yes|no|thanks?(you)?|thankyou|received|noted|gotit|好[的啊呀]?|嗯[嗯好]?|哦|是的|不是|收到[了]?|知道[了]?|明白[了]?|了解[了]?|谢谢[你您]?|感谢|辛苦[了]?|[哈呵]+|\[?(图片|视频|语音|文件|表情|image|video|audio|file|sticker)\]?)$/u.test(compact);
}
function requestText(item:any){
 const messages=Array.isArray(item.messages)?item.messages:[],id=item.triage?.requestMessageId;
 // Never substitute a newer unrelated message or a display name for evidence.
 const request=messages.length?messages.find((m:any)=>m.id===id&&!m.deleted&&!m.recalled&&m.isMine!==true&&m.direction!=='outgoing'):undefined;
 return String(messages.length?(request?.body||''):(item.body||'')).trim();
}
const clip=(text:string,max:number)=>{const chars=Array.from(text);return chars.length>max?chars.slice(0,max).join('')+'…':text};
const SEND_RECOVERY=['send_unknown','failed','send_failed'];
function project(item:any){
 if(!item)return;
 const t=item.triage,p=item.draftPreparation,d=dispositionOf(item);
 // Routine `sending` stays a status on the item: no chat push, and age alone never turns it into failed or unknown.
 const uncertain=SEND_RECOVERY.includes(item.status)||p?.status==='unknown'||item.sourceProcessing?.status==='interrupted';
 if(item.sourceAttentionExcluded&&!uncertain)return;
 const en=settings().identity.language==='en',say=(zh:string,english:string)=>en?english:zh;
 // Uncertain attempts retain original-ID recovery; never suggest a fresh send.
 if(uncertain){
  const recovery=item.status==='send_unknown'?'send_unknown':['failed','send_failed'].includes(item.status)?'send_failed':'draft_unknown';
  const summary={send_unknown:say('发送结果未确认，请回查原记录','Delivery unconfirmed; check the original record'),send_failed:say('发送失败，请查看原记录','Send failed; check the original record'),draft_unknown:say('上次生成未确认，请回查原记录','Previous preparation unconfirmed; check the original record')}[recovery]!;
  const attempt=String(p?.requestId||item.sendAttemptId||item.sendIntentKey||item.draftRunId||item.sourceProcessing?.runId||'');
  return {tier:'recovery' as Tier,deliveryId:hash([item.id,'recovery',recovery,attempt]),matterKey:hash([item.id,'recovery',recovery,attempt]),revision:'r',content:item.sourceUnavailable?summary:[clip(line(item.title||item.sender),40),summary].filter(Boolean).join(' · '),itemId:item.id,state:'unknown',recovery,sourceVersion:t?.sourceVersion,requestId:p?.requestId,runId:item.draftRunId||item.sourceProcessing?.runId,actions:[] as string[]};
 }
 if(snoozeActive(item)||item.sourceUnavailable||d.placement!=='pending'||t?.status!=='succeeded'||t.resolution!=='open'||!['reply','decision'].includes(t.actionType)||['fyi','acknowledgement','other_recipient','self_test','own_message','unclear'].includes(t.reason))return;
 const request=requestText(item);if(!meaningful(request))return;
 // One conclusion in chat; drafts and evidence belong to the detail view, and draft progress stays in Inbox.
 const decision=t.actionType==='decision',who=clip(line(item.sender||item.title),16),excerpt=line(clip(request.replace(/\s+/g,' '),72)),ready=meaningful(item.draft)&&!item.draftCandidate,matter=inboxMatter(item);
 const content=say(`${who}：“${excerpt}”${decision?'需要你定一下。':'还需要答复。'}${ready?'回复草稿已备好，等你确认。':''}`,`${who}: “${excerpt}” ${decision?'Needs your decision.':'Still needs a reply.'}${ready?' A draft is ready for your review.':''}`);
 return {tier:inboxTier(item),deliveryId:hash([item.id,matter.requestMessageId||'',matter.requestRevision]),matterKey:matter.key,revision:matter.requestRevision,content,itemId:item.id,requestMessageId:matter.requestMessageId,requestRevision:matter.requestRevision,occurredAt:matter.occurredAt,sourceVersion:t.sourceVersion,state:ready?'ready':'review',triageStatus:t.status,preparationStatus:p?.status,requestId:p?.requestId,runId:item.draftRunId||item.sourceProcessing?.runId,actions:[decision?'create_task':ready?'create_task':'draft_reply','snooze','dismiss']};
}
function digestLine(row:any,en:boolean){
 if(row.kind==='idea'){const idea=get('ideas',row.entityId);return idea?{occurredAt:idea.occurredAt,line:clip(line(idea.title),48)}:undefined}
 const item=get('inbox',row.entityId),value:any=project(item);if(!value||value.tier==='recovery')return;
 return {occurredAt:value.occurredAt,line:clip(line(item.sender||item.title),16)+(en?': ':'：')+clip(line(requestText(item).replace(/\s+/g,' ')),36)};
}
const entryLive=(e:any)=>{
 if(e.kind==='idea')return ideaReminderDeliverable(e.entityId);
 const item=get('inbox',e.entityId);if(item?.attention?.reason==='reevaluating_open')return inboxMatter(item).requestRevision===e.revision;
 const v:any=project(item);return !!v&&v.matterKey===e.matterKey&&v.revision===e.revision;
};
function digestText(entries:any[],more:number,en:boolean){
 const total=entries.length+more;
 return [en?`${total} item${total===1?'':'s'} waiting for you:`:`有 ${total} 件事等你看：`,...entries.map(e=>'- '+e.line),...(more?[en?`${more} more in Decisions.`:`另有 ${more} 件在决策里。`]:[])].join('\n');
}
function syncDigests(conversationId:string){
 let changed=0;const en=settings().identity.language==='en',modes=deliveryModes();
 // Every line is rechecked: a resolved, snoozed or changed matter leaves the digest, and an empty digest is withdrawn.
 for(const m of list('messages').filter(x=>x.inboxAnalysis?.kind===kind&&x.inboxAnalysis.digest)){
  const entries=m.inboxAnalysis.entries||[],live=entries.filter(entryLive);if(live.length===entries.length)continue;
  if(!live.length){remove('messages',m.id);changed++;continue}
  put('messages',{...m,content:digestText(live,m.inboxAnalysis.more||0,en),inboxAnalysis:{...m.inboxAnalysis,entries:live}});changed++;
 }
 const ready:any[]=[];
 for(const row of heldRows()){
  const item=row.kind==='inbox'?get('inbox',row.entityId):undefined;
  // A snoozed or re-judged matter keeps waiting; held work is never dropped while it is still open.
  if(item&&(snoozeActive(item)||item.attention?.reason==='reevaluating_open'))continue;
  const value:any=row.kind==='inbox'?project(item):undefined,valid=row.kind==='idea'?ideaReminderDeliverable(row.entityId):!!value&&value.matterKey===row.matterKey&&value.revision===row.revision;
  if(!valid){ledgerPut(row.matterKey,row.revision,{kind:row.kind,entityId:row.entityId,tier:row.tier,decision:'suppressed',reason:'no_longer_valid'});changed++;continue}
  ready.push(row);
 }
 if(!ready.length||!digestDue(modes))return changed;
 ready.sort((a,b)=>Number(b.tier==='urgent')-Number(a.tier==='urgent')||String(a.at).localeCompare(String(b.at))||String(a.id).localeCompare(String(b.id)));
 const entries=ready.slice(0,DIGEST_LINES).flatMap(row=>{const l=digestLine(row,en);return l?[{kind:row.kind,entityId:row.entityId,matterKey:row.matterKey,revision:row.revision,...l}]:[]});
 if(!entries.length)return changed;
 const more=ready.length-entries.length,at=now(),id='inbox-digest-'+hash(entries.map(e=>[e.matterKey,e.revision])).slice(0,32);
 put('messages',{id,conversationId,role:'assistant',content:digestText(entries,more,en),inboxAnalysis:{kind,digest:true,entries,more,surfacedAt:at}});
 for(const e of entries){const row=ready.find(r=>r.matterKey===e.matterKey&&r.revision===e.revision);ledgerPut(e.matterKey,e.revision,{kind:e.kind,entityId:e.entityId,tier:row.tier,decision:'digested',reason:row.reason,digestId:id});}
 markDigest();return changed+1;
}
export function syncInboxChat(){
 const primaryId=meta<string|undefined>('primaryConversationId',undefined),primary=primaryId?get('conversations',primaryId):undefined;
 if(!primary||primary.sideChat||primary.archived)return;
 const existing=list('messages').filter(m=>m.inboxAnalysis?.kind===kind),byItem=new Map<string,any>();
 for(const m of existing)if(!m.inboxAnalysis.aggregate&&!m.inboxAnalysis.digest&&!byItem.has(m.inboxAnalysis.itemId))byItem.set(m.inboxAnalysis.itemId,m);
 const items=list('inbox'),ids=new Set(items.map(i=>i.id)),modes=deliveryModes();let changed=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  // Retire old generic digests and orphaned derived messages. Canonical records
  // and all ordinary user/assistant messages stay untouched.
  for(const old of existing)if(old.inboxAnalysis.aggregate||(!old.inboxAnalysis.digest&&!ids.has(old.inboxAnalysis.itemId))){remove('messages',old.id);changed++;}
  for(const item of items){
   const old=byItem.get(item.id),value:any=project(item);
   if(!value){
    // A sibling's feedback re-judges this item; the reminder stays while the same open request is re-evaluated.
    if(old&&item.attention?.reason!=='reevaluating_open'){remove('messages',old.id);changed++;}
    continue;
   }
   const {content,tier,matterKey,revision,...metadata}=value,id='inbox-analysis-'+value.deliveryId.slice(0,32),inboxAnalysis={kind,presentationVersion:4,...metadata};
   // Migration: an existing reminder keeps its words and position; only new deliveries follow the new rules.
   if(old&&!old.inboxAnalysis.deliveryId&&tier!=='recovery'){
    put('messages',{...old,inboxAnalysis:{...old.inboxAnalysis,...inboxAnalysis}});ledgerPut(matterKey,revision,{kind:'inbox',entityId:item.id,tier,decision:'chat',reason:'existing_reminder'});changed++;continue;
   }
   if(old&&old.inboxAnalysis.deliveryId===value.deliveryId){
    if(old.content!==content&&old.id===id||hash(old.inboxAnalysis)!==hash({...old.inboxAnalysis,...inboxAnalysis})){put('messages',{...old,content:old.id===id?content:old.content,inboxAnalysis:{...old.inboxAnalysis,...inboxAnalysis}});changed++;}
    continue;
   }
   if(old){remove('messages',old.id);changed++;}
   const entry=ledgerGet(matterKey,revision),plan=planDelivery(tier,item.deliveryStrategy,modes);
   // A digested or held matter does not get a second delivery. Only an explicit strategy change lifts it to chat.
   const deliver=plan==='chat'&&(tier==='recovery'||!entry||entry.decision==='chat'||item.deliveryStrategy==='immediate'||entry.decision==='suppressed');
   if(!deliver){
    if(!entry||(entry.decision==='suppressed'&&plan==='hold')||(entry.decision==='held'&&plan==='none')){ledgerPut(matterKey,revision,{kind:'inbox',entityId:item.id,tier,decision:plan==='none'?'suppressed':'held',reason:plan==='none'?'quiet_strategy':'digest'});changed++;}
    continue;
   }
   const retired=get('messages',id,true);
   put('messages',{...retired,id,conversationId:retired?.conversationId||primary.id,role:'assistant',content,inboxAnalysis,contextIds:[item.id]});if(retired&&!get('messages',id))restore('messages',id);
   ledgerPut(matterKey,revision,{kind:'inbox',entityId:item.id,tier,decision:'chat',reason:tier});changed++;
  }
  changed+=syncDigests(primary.id);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
 return changed;
}
export function startInboxChat(){
 if(!meta('inboxChatEnabledAt',null))setMeta('inboxChatEnabledAt',now());
 let scheduled=false;
 const run=()=>{scheduled=false;try{syncInboxChat()}catch{console.error(JSON.stringify({event:'inbox_chat_projection_failed'}))}};
 // Source sync commits many records across async reads. Coalesce them and let
 // pending HTTP/health requests run before projecting the full Inbox again.
 const schedule=()=>{if(!scheduled){scheduled=true;setTimeout(run,1000).unref()}};
 onEntityChange(type=>{if(['inbox','inbox_triages','conversations','inbox_source_rules','inbox_feedback','connections','attention_ledger'].includes(type))schedule()});
 schedule();const timer=setInterval(run,3000);timer.unref();return timer;
}
