import {db,get,list,put,meta,setMeta,now,hash,inboxTriageVersion,settings} from './store';
import {dispositionOf} from '../../shared/inbox-surfacing';
import {onEntityChange} from './entity-events';

// Presentation of existing canonical work, never a model scheduler or send path.
const kind='inbox-analysis-v1';
const line=(text:any)=>String(text||'').replace(/[\r\n]+/g,' ').replace(/[\\`*_[\]<>#]/g,'\\$&');
function project(item:any,old:any,enabledAt:string){
 if((!item||item.sourceUnavailable)&&!old)return;
 const en=settings().identity.language==='en',say=(zh:string,english:string)=>en?english:zh;
 if(!item||item.sourceUnavailable)return {content:say('来源暂不可用','Source unavailable'),state:'unavailable',itemId:old.inboxAnalysis.itemId};
 const version=inboxTriageVersion(item),t=item.triage,p=item.draftPreparation,d=dispositionOf(item);
 const wasCurrent=old?.inboxAnalysis?.sourceVersion===version;
 const closed=['quiet','history'].includes(d.placement);
 const considered=!!t||!!p||!!item.sourceProcessing||!!item.draftRunId;
 if(!old&&(!considered||closed))return;
 // Backfill current actionable results; historical provider failures are not new alerts.
 const changedAt=t?.updatedAt||item.updatedAt;
 if(!old&&d.placement!=='pending'&&String(changedAt||'')<enabledAt)return;
 let state='waiting',summary=say('等待分析','Waiting for analysis');
 if(closed){state='closed';summary=say(d.primaryReason==='no_reply'?'无需回复':d.primaryReason==='replied'?'已回复':d.primaryReason==='expired'?'待处理已到期':'已结束',d.primaryReason==='no_reply'?'No reply needed':d.primaryReason==='replied'?'Replied':d.primaryReason==='expired'?'Pending item expired':'Closed');}
 else if(item.status==='send_unknown'||item.status==='sending'){state='unknown';summary=say(item.status==='sending'?'发送中，请勿重复发送':'发送结果未确认，请回查原记录',item.status==='sending'?'Sending; do not send again':'Delivery unconfirmed; check the original record');}
 else if(t?.status==='running'){state='analyzing';summary=say('正在分析','Analyzing');}
 else if(t?.status==='failed'){state='failed';summary=/额度|HTTP 402/.test(t.error||'')?say('Jev额度不足，分析未完成','Jev credits exhausted; analysis incomplete'):say('分析失败，请在收件箱核实','Analysis failed; review in Inbox');}
 else if(t?.status==='succeeded'){
  state='review';summary=say(t.actionType==='decision'?'需要你决策':t.route==='review'?'需要核实判断':'需要回复',t.actionType==='decision'?'Your decision is needed':t.route==='review'?'Review needed':'Reply needed');
  if(p?.status==='running'||item.sourceProcessing?.status==='running'){state='drafting';summary+=say(' · 正在准备回复',' · Preparing reply');}
  else if(p?.status==='queued'){state='queued';summary+=say(' · 回复排队中',' · Reply queued');}
  else if(p?.status==='unknown'||item.sourceProcessing?.status==='interrupted'){state='unknown';summary+=say(' · 上次生成未确认，请回查原记录',' · Previous preparation unconfirmed; check the original record');}
  else if(item.draftCandidate){state='review';summary+=say(' · 候选待审阅，未替换当前草稿',' · Candidate awaits review; current draft retained');}
  else if(item.draftError||p?.status==='failed'||['failed','blocked'].includes(item.sourceProcessing?.status)){state='failed';summary+=say(' · 回复准备失败',' · Reply preparation failed');}
  else if(item.draft?.trim()){state='ready';}
 }else if(old&&(!wasCurrent||old.inboxAnalysis.state==='stale')){state='stale';summary=say('来源已更新，等待重新分析','Source changed; awaiting analysis');}
 const parts=[line(item.title||item.sender),summary];
 // Only current judgment can present the canonical draft as a current pending reply.
 if(!closed&&!['sending','send_unknown'].includes(item.status)&&t?.status==='succeeded'&&String(item.draft||'').trim())parts.push(say(item.editedByUser?'待回复（已编辑）':'待回复',item.editedByUser?'Reply draft (edited)':'Reply draft')+'\n'+String(item.draft).split('\n').map((s:string)=>'> '+s).join('\n'));
 return {content:parts.join('\n\n'),itemId:item.id,sourceVersion:version,state,triageStatus:t?.status,preparationStatus:p?.status,requestId:p?.requestId,runId:item.draftRunId||item.sourceProcessing?.runId};
}
export function syncInboxChat(){
 const primaryId=meta<string|undefined>('primaryConversationId',undefined),primary=primaryId?get('conversations',primaryId):undefined;
 if(!primary||primary.sideChat||primary.archived)return;
 const enabledAt=meta('inboxChatEnabledAt',now());
 const existing=list('messages').filter(m=>m.inboxAnalysis?.kind===kind),byItem=new Map(existing.map(m=>[m.inboxAnalysis.itemId,m]));
 const items=list('inbox'),ids=new Set(items.map(i=>i.id));let changed=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const item of [...items,...existing.filter(m=>!ids.has(m.inboxAnalysis.itemId)).map(m=>({id:m.inboxAnalysis.itemId,missing:true}))]){
   const old=byItem.get(item.id),value=project(item.missing?undefined:item,old,enabledAt);if(!value)continue;
   const {content,...metadata}=value,inboxAnalysis={kind,...metadata};
   if(old&&old.content===content&&hash(old.inboxAnalysis)===hash(inboxAnalysis))continue;
   // Stable identity/time, independently updated from source/draft CAS leases.
   put('messages',{...old,id:old?.id||'inbox-analysis-'+hash(item.id).slice(0,32),conversationId:old?.conversationId||primary.id,role:'assistant',content,inboxAnalysis,contextIds:item.missing?[]:[item.id]});changed++;
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
