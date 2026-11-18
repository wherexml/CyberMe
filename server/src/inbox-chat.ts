import {db,get,list,put,remove,restore,meta,setMeta,now,hash,settings} from './store';
import {dispositionOf} from '../../shared/inbox-surfacing';
import {snoozeActive} from '../../shared/inbox-attention';
import {DIGEST_LINES,deliveryModes,digestDue,heldRows,inboxMatter,inboxTier,ledgerGet,ledgerPut,markDigest,planDelivery,type Tier} from './attention-delivery';
import {ideaReminderValidator} from './ideas-chat';
import {readyIdeaVisualFingerprint} from './insight-visuals';
import {onEntityChange} from './entity-events';

// Main-chat delivery combines actionable requests and read-only insight updates.
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
function digestLine(row:any,en:boolean,item:any){
 if(row.kind==='idea'){const idea=get('ideas',row.entityId);return idea?{occurredAt:idea.occurredAt,line:clip(line(idea.title),48)}:undefined}
 const value:any=project(item);if(!value||value.tier==='recovery')return;
 return {occurredAt:value.occurredAt,line:clip(line(item.sender||item.title),16)+(en?': ':'：')+clip(line(requestText(item).replace(/\s+/g,' ')),36)};
}
const entryLive=(e:any,item:any,ideaValid:ReturnType<typeof ideaReminderValidator>)=>{
 if(e.kind==='idea')return ideaValid(e.entityId,e.revision,e.visualFingerprint);
 if(item?.attention?.reason==='reevaluating_open')return inboxMatter(item).requestRevision===e.revision;
 const v:any=project(item);return !!v&&v.matterKey===e.matterKey&&v.revision===e.revision;
};
function digestText(entries:any[],more:number,en:boolean){
 return [en?'Updates':'最新动态',...entries.map(e=>'- '+e.line)].join('\n');
}
function syncDigests(conversationId:string,inbox:any[],items:Map<string,any>,existing:any[],modes:ReturnType<typeof deliveryModes>){
 let changed=0;const en=settings().identity.language==='en',due=digestDue(modes);
 // This synchronous pass only writes derived messages and ledger entries. Reuse
 // the current Inbox snapshot for held/delivered lines and idea eligibility.
 let validateIdea:ReturnType<typeof ideaReminderValidator>|undefined;
 const ideaValid=(id:string,revision?:string,visualFingerprint?:string)=>(validateIdea??=ideaReminderValidator(()=>inbox))(id,revision,visualFingerprint);
 // Every line is rechecked: a resolved, snoozed or changed matter leaves the digest, and an empty digest is withdrawn.
 for(const m of existing.filter(x=>x.inboxAnalysis.digest)){
  const entries=m.inboxAnalysis.entries||[],live=entries.filter((e:any)=>entryLive(e,items.get(e.entityId),ideaValid));if(live.length===entries.length)continue;
  if(!live.length){remove('messages',m.id);changed++;continue}
  put('messages',{...m,content:digestText(live,m.inboxAnalysis.more||0,en),inboxAnalysis:{...m.inboxAnalysis,entries:live}});changed++;
 }
 const ready:any[]=[];
 for(const row of heldRows()){
  const item=row.kind==='inbox'?items.get(row.entityId):undefined;
  // A snoozed or re-judged matter keeps waiting; held work is never dropped while it is still open.
  if(item&&(snoozeActive(item)||item.attention?.reason==='reevaluating_open'))continue;
  const value:any=row.kind==='inbox'?project(item):undefined,valid=row.kind==='idea'?ideaValid(row.entityId,row.revision):!!value&&value.matterKey===row.matterKey&&value.revision===row.revision;
  if(!valid){ledgerPut(row.matterKey,row.revision,{kind:row.kind,entityId:row.entityId,tier:row.tier,decision:'suppressed',reason:'no_longer_valid'});changed++;continue}
  if(!due)continue;
  const visualFingerprint=row.kind==='idea'?readyIdeaVisualFingerprint(get('ideas',row.entityId)):undefined;
  // A valid held insight can still be waiting for generation or a newer reviewed graph.
  if(row.kind==='idea'&&!visualFingerprint)continue;
  ready.push({...row,visualFingerprint});
 }
 if(!ready.length)return changed;
 // Withdrawal above remains immediate. A due background digest can wait
 // until the primary chat has finished; it is never part of the answer.
 if(db.prepare("SELECT 1 FROM chat_requests WHERE state='running' AND json_extract(data,'$.conversationId')=? LIMIT 1").get(conversationId))return changed;
 ready.sort((a,b)=>Number(b.tier==='urgent')-Number(a.tier==='urgent')||String(a.at).localeCompare(String(b.at))||String(a.id).localeCompare(String(b.id)));
 const entries=ready.slice(0,DIGEST_LINES).flatMap(row=>{const l=digestLine(row,en,items.get(row.entityId));return l?[{kind:row.kind,entityId:row.entityId,matterKey:row.matterKey,revision:row.revision,visualFingerprint:row.visualFingerprint,...l}]:[]});
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
 const inbox=list('inbox'),items=new Map(inbox.map(i=>[i.id,i])),modes=deliveryModes();let changed=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  // Retire old generic digests and orphaned derived messages. Canonical records
  // and all ordinary user/assistant messages stay untouched.
  for(const old of existing)if(old.inboxAnalysis.aggregate||(!old.inboxAnalysis.digest&&!items.has(old.inboxAnalysis.itemId))){remove('messages',old.id);changed++;}
  for(const item of inbox){
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
  changed+=syncDigests(primary.id,inbox,items,existing,modes);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
 return changed;
}
export function startInboxChat(){
 if(!meta('inboxChatEnabledAt',null))setMeta('inboxChatEnabledAt',now());
 let scheduled:ReturnType<typeof setTimeout>|undefined;
 const run=()=>{clearTimeout(scheduled);scheduled=undefined;try{syncInboxChat()}catch{console.error(JSON.stringify({event:'inbox_chat_projection_failed'}))}};
 // Source sync commits many records across async reads. Coalesce them and let
 // pending HTTP/health requests run before projecting the full Inbox again.
 const schedule=()=>{scheduled??=setTimeout(run,1000).unref()};
 onEntityChange(type=>{if(['inbox','inbox_triages','conversations','inbox_source_rules','inbox_feedback','connections','attention_ledger','insight_visuals'].includes(type))schedule()});
 schedule();const timer=setInterval(run,3000);timer.unref();return timer;
}
