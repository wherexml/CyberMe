import {db,get,list,put,remove,restore,meta,setMeta,now,hash,settings} from './store';
import {dispositionOf} from '../../shared/inbox-surfacing';
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
function project(item:any){
 if(!item)return;
 const t=item.triage,p=item.draftPreparation,d=dispositionOf(item);
 const uncertain=['sending','send_unknown'].includes(item.status)||p?.status==='unknown'||item.sourceProcessing?.status==='interrupted';
 if(item.sourceAttentionExcluded&&!uncertain)return;
 const en=settings().identity.language==='en',say=(zh:string,english:string)=>en?english:zh;
 // Uncertain attempts retain original-ID recovery; never suggest a fresh send.
 if(uncertain){
  const summary=['sending','send_unknown'].includes(item.status)?say(item.status==='sending'?'发送中，请勿重复发送':'发送结果未确认，请回查原记录',item.status==='sending'?'Sending; do not send again':'Delivery unconfirmed; check the original record'):say('上次生成未确认，请回查原记录','Previous preparation unconfirmed; check the original record');
  return {content:item.sourceUnavailable?summary:[line(item.title||item.sender),summary].filter(Boolean).join('\n\n'),itemId:item.id,state:'unknown',sourceVersion:t?.sourceVersion,requestId:p?.requestId,runId:item.draftRunId||item.sourceProcessing?.runId};
 }
 if(item.sourceUnavailable||d.placement!=='pending'||t?.status!=='succeeded'||t.resolution!=='open'||!['reply','decision'].includes(t.actionType)||['fyi','acknowledgement','other_recipient','self_test','own_message','unclear'].includes(t.reason))return;
 const request=requestText(item);if(!meaningful(request))return;
 // Draft progress/failures stay in Inbox; the actionable request stays stable.
 const decision=t.actionType==='decision',who=line(item.sender||item.title),excerpt=line(request).slice(0,500);
 const parts=[say(`${who}提到：“${excerpt}”${decision?'这件事需要你定一下。':'这件事还需要答复。'}`,`${who} asked: “${excerpt}” ${decision?'This needs your decision.':'This still needs a reply.'}`)];
 if(meaningful(item.draft)&&!item.draftCandidate)parts.push(say('回复已经准备好了：','The reply is ready:')+'\n\n'+String(item.draft));
 return {content:parts.filter(Boolean).join('\n\n'),itemId:item.id,sourceVersion:t.sourceVersion,state:meaningful(item.draft)&&!item.draftCandidate?'ready':'review',triageStatus:t.status,preparationStatus:p?.status,requestId:p?.requestId,runId:item.draftRunId||item.sourceProcessing?.runId};
}
export function syncInboxChat(){
 const primaryId=meta<string|undefined>('primaryConversationId',undefined),primary=primaryId?get('conversations',primaryId):undefined;
 if(!primary||primary.sideChat||primary.archived)return;
 const existing=list('messages').filter(m=>m.inboxAnalysis?.kind===kind),byItem=new Map(existing.filter(m=>!m.inboxAnalysis.aggregate).map(m=>[m.inboxAnalysis.itemId,m]));
 const items=list('inbox'),ids=new Set(items.map(i=>i.id));let changed=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  // Retire old generic digests and orphaned derived messages. Canonical records
  // and all ordinary user/assistant messages stay untouched.
  for(const old of existing)if(old.inboxAnalysis.aggregate||!ids.has(old.inboxAnalysis.itemId)){remove('messages',old.id);changed++;}
  for(const item of items){
   const old=byItem.get(item.id),value=project(item);
   if(!value){if(old){remove('messages',old.id);changed++;}continue;}
   const {content,...metadata}=value,inboxAnalysis={kind,...metadata};
   if(old&&old.content===content&&hash(old.inboxAnalysis)===hash(inboxAnalysis))continue;
   const id=old?.id||'inbox-analysis-'+hash(item.id).slice(0,32),retired=!old?get('messages',id,true):undefined;
   put('messages',{...retired,...old,id,conversationId:old?.conversationId||retired?.conversationId||primary.id,role:'assistant',content,inboxAnalysis,contextIds:[item.id]});if(retired)restore('messages',id);changed++;
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
 return changed;
}
export function startInboxChat(){
 if(!meta('inboxChatEnabledAt',null))setMeta('inboxChatEnabledAt',now());
 let scheduled=false;
 const run=()=>{scheduled=false;try{syncInboxChat()}catch{console.error(JSON.stringify({event:'inbox_chat_projection_failed'}))}};
 const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(run)}};
 onEntityChange(type=>{if(['inbox','inbox_triages','conversations','inbox_source_rules','inbox_feedback','connections'].includes(type))schedule()});
 schedule();const timer=setInterval(run,3000);timer.unref();return timer;
}
