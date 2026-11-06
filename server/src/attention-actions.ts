// Typed, version-bound actions under messages and cards. Every operation is durably recorded before it runs,
// so a repeat returns the recorded result and a restart reports `unknown` instead of replaying anything.
import type {Hono} from 'hono';
import {inboxAttention} from '../../shared/inbox-attention';
import {ATTENTION_ACTIONS,DELIVERY_STRATEGIES,ideaProvenance} from '../../shared/attention-actions';
import {inboxTimestamp} from '../../shared/inbox-surfacing';
import {db,get,put,list,now,hash,activity,publicValue} from './store';
import {sources} from './ideas-background';
import {ApiError} from './integrations';
import {inboxMatter} from './attention-delivery';
import {dismissInboxAttention,snoozeInboxAttention,undoInboxSnooze} from './inbox-attention-actions';
import {generateInboxDraft} from './drafts';
import {withdrawIdeaReminders,restoreDismissedReminders} from './ideas-chat';
import {suppressDesktopNotification} from './desktop-notifications';

const OPERATION=/^[\w-]{1,160}$/,UNDO_WINDOW_MS=20000,MAX_SNOOZE_MS=30*864e5;
const operationOf=(input:any)=>{if(typeof input?.operationId!=='string'||!OPERATION.test(input.operationId))throw new ApiError(400,'invalid_operation','operationId 无效');return input.operationId as string};
const inTransaction=<T>(work:()=>T):T=>{db.exec('BEGIN IMMEDIATE');try{const value=work();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}};

/** Ignore, snooze, undo and restore share one record: a card, reminder, notification and context all follow it. */
export function ideaAttention(id:string,input:any){
 const idea=get('ideas',id);if(!idea)throw new ApiError(404,'not_found','对象不存在');
 const operationId=operationOf(input),action=input.action,record=idea.attentionAction;
 if(action==='dismiss'||action==='snooze'){
  if(record?.operationId===operationId&&!record.undoneAt)return {idea,replayed:true};
  if(!['new','deferred'].includes(idea.status))throw new ApiError(409,'idea_closed','这条灵感已结束');
  // A background rewording must not defeat an explicit ignore; only different evidence is a real conflict.
  if(input.baseUpdatedAt!==idea.updatedAt&&input.baseProvenanceKey!==ideaProvenance(idea))throw new ApiError(409,'edit_conflict','这条灵感有了新证据，请先查看',{updatedAt:idea.updatedAt});
  const until=action==='snooze'?Date.parse(String(input.until||'')):undefined;
  if(action==='snooze'&&(!Number.isFinite(until)||until!<=Date.now()||until!-Date.now()>MAX_SNOOZE_MS))throw new ApiError(400,'invalid_until','推迟时间无效');
  const saved=inTransaction(()=>{
   const {deferredUntil:_d,...rest}=idea;
   const value=put('ideas',{...rest,status:action==='dismiss'?'dismissed':'deferred',...(action==='snooze'?{deferredUntil:new Date(until!).toISOString()}:{}),attentionAction:{operationId,kind:action,priorStatus:idea.status,at:now()}});
   withdrawIdeaReminders(idea.id,action==='dismiss'?'dismissed':'inactive',operationId);
   return value;
  });
  activity(`${action==='dismiss'?'忽略':'推迟'}灵感：${saved.title}`,'surfacing','succeeded',undefined,saved.id);
  return {idea:saved};
 }
 if(action==='undo'){
  if(!record||record.operationId!==operationId)throw new ApiError(409,'action_superseded','这次操作已被新的状态替代');
  if(record.undoneAt)return {idea,replayed:true};
  if(idea.status!==(record.kind==='dismiss'?'dismissed':'deferred'))throw new ApiError(409,'action_superseded','这次操作已被新的状态替代');
  // Only the exact dismissal, inside the server's own window, may bring a reminder back; a snooze restores the card only.
  if(record.kind==='dismiss'&&Date.now()-Date.parse(record.at)>UNDO_WINDOW_MS)throw new ApiError(409,'undo_expired','已超过撤销时间，可在“已处理”中恢复');
  return inTransaction(()=>{
   const {deferredUntil:_d,...rest}=idea;
   const value=put('ideas',{...rest,status:record.priorStatus==='deferred'?'new':record.priorStatus||'new',attentionAction:{...record,undoneAt:now()}});
   const restored=record.kind==='dismiss'?restoreDismissedReminders(idea.id,operationId):[];
   for(const messageId of restored)suppressDesktopNotification(messageId);
   return {idea:value,restored};
  });
 }
 if(action==='restore'){
  if(!['dismissed','deferred'].includes(idea.status))return {idea,replayed:true};
  const {deferredUntil:_d,...rest}=idea;
  return {idea:put('ideas',{...rest,status:'new',restoredAt:now(),attentionAction:record?{...record,undoneAt:now()}:undefined})};
 }
 throw new ApiError(400,'invalid_action','动作无效');
}

const requestText=(item:any,id?:string)=>String((Array.isArray(item.messages)?item.messages:[]).find((m:any)=>m.id===id)?.body||item.body||'').slice(0,2000);
function checkBinding(input:any){
 if(input.entityKind==='inbox'){
  const item=get('inbox',String(input.entityId||''));if(!item)throw new ApiError(404,'not_found','对象不存在');
  if(item.sourceUnavailable||inboxAttention(item).surface==='none')throw new ApiError(409,'action_stale','事项已处理或暂不可用，请查看最新内容');
  const matter=inboxMatter(item);
  if(input.requestMessageId!==matter.requestMessageId||input.requestRevision!==matter.requestRevision)throw new ApiError(409,'action_stale','来源已更新，这个动作已失效，请查看最新内容');
  return {item,matter};
 }
 if(input.entityKind==='idea'){
  const idea=get('ideas',String(input.entityId||''));if(!idea)throw new ApiError(404,'not_found','对象不存在');
  if(idea.status!=='new')throw new ApiError(409,'action_stale','灵感状态已改变，请查看最新内容');
  if(input.provenanceKey!==ideaProvenance(idea))throw new ApiError(409,'action_stale','来源已更新，这个动作已失效，请查看最新内容');
  return {idea};
 }
 throw new ApiError(400,'invalid_entity','对象类型无效');
}
async function execute(input:any,invalidate:(id:string)=>void){
 const target:any=checkBinding(input),{type,operationId}=input;
 if(target.item){
  const {item,matter}=target;
  if(type==='draft_reply'){const r:any=await generateInboxDraft(item.id,{requestId:operationId,mode:'auto',baseUpdatedAt:item.updatedAt});return {itemId:item.id,draftRequestId:r?.requestId||operationId};}
  if(type==='create_task'){
   // One task per exact request revision, whichever button or retry created it.
   const key=hash(['inbox',item.id,matter.requestMessageId||'',matter.requestRevision]),existing=list('tasks').find(t=>t.attentionKey===key);
   if(existing)return {taskId:existing.id};
   return {taskId:put('tasks',{id:'task-'+key.slice(0,32),title:item.title,notes:requestText(item,matter.requestMessageId),status:'active',inboxId:item.id,sourceInboxId:item.id,attentionKey:key}).id};
  }
  if(type==='snooze'){snoozeInboxAttention(item.id,{operationId,baseUpdatedAt:item.updatedAt,until:input.until});return {itemId:item.id};}
  if(type==='dismiss'){const row:any=dismissInboxAttention(item.id,{operationId,baseUpdatedAt:item.updatedAt},invalidate).item;return {itemId:item.id,dismissalId:(row.attentionAck?.operationId===operationId?row.attentionAck:row.attentionDismissal)?.id};}
 }else{
  const {idea}=target;
  if(type==='dismiss'||type==='snooze'){ideaAttention(idea.id,{action:type,operationId,baseUpdatedAt:idea.updatedAt,until:input.until});return {ideaId:idea.id};}
  if(type==='create_task'){
   // Same outcome as the idea's existing task action: a real task exists, nothing further has been carried out.
   return inTransaction(()=>{const key=hash(['idea',idea.id,ideaProvenance(idea)]),task=list('tasks').find(t=>t.attentionKey===key)||put('tasks',{id:'task-'+key.slice(0,32),title:idea.title,notes:idea.description,status:'active',ideaId:idea.id,attentionKey:key});if(idea.status!=='executed')put('ideas',{...idea,status:'executed',executedAt:now(),result:{task}});withdrawIdeaReminders(idea.id,'executed',operationId);return {taskId:task.id}});
  }
 }
 throw new ApiError(400,'invalid_action','这个对象不支持该动作');
}
/** Read-only facts for an idea's detail view: a live check against current sources, and the last real rewrite if one exists. */
function ideaFacts(id:string){
 const idea=get('ideas',id);if(!idea)throw new ApiError(404,'not_found','对象不存在');
 const fresh=new Map(sources().map(x=>[x.id,x])),ids:string[]=Array.isArray(idea.sourceIds)?idea.sourceIds:[];
 const unreadable=ids.filter(x=>!fresh.has(x)).length,changed=ids.filter(x=>fresh.has(x)&&fresh.get(x)!.fingerprint!==idea.sourceFingerprints?.[x]).length;
 const events=ids.map(x=>fresh.get(x)?.eventAt).filter(v=>inboxTimestamp(v)!==undefined) as string[];
 const rows=(db.prepare("SELECT data FROM entities WHERE type='idea_history' AND deleted=0 AND json_extract(data,'$.ideaId')=?").all(id) as any[]).map(r=>JSON.parse(r.data)).filter(r=>r.reason==='updated'&&r.previous).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const prior=rows.find(r=>r.previous.title!==idea.title||r.previous.description!==idea.description)?.previous;
 return {checkedAt:now(),sourceCount:ids.length,changed,unreadable,sourceUpdatedAt:events.sort((a,b)=>inboxTimestamp(b)!-inboxTimestamp(a)!)[0],before:prior?{title:prior.title,description:prior.description,at:prior.refreshedAt||prior.createdAt}:undefined};
}
export function mountAttention(app:Hono,invalidate:(id:string)=>void){
 // An operation still running at start-up was interrupted: its outcome is unknown and it is never replayed.
 for(const op of list('attention_ops'))if(op.status==='running')put('attention_ops',{...op,status:'unknown',error:'server_interrupted',completedAt:now()});
 app.post('/api/attention/actions',async c=>{
  const input=await c.req.json(),operationId=operationOf(input),type=input.type;
  if(!ATTENTION_ACTIONS.includes(type)||type==='discuss')throw new ApiError(400,'invalid_action','动作无效');
  const fingerprint=hash([type,input.entityKind,input.entityId,input.requestMessageId,input.requestRevision,input.provenanceKey,input.until]),existing=get('attention_ops',operationId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new ApiError(409,'operation_conflict','同一操作编号对应不同动作');return c.json(publicValue({...existing,replayed:true}));}
  checkBinding(input); // A stale action is refused before anything is recorded.
  const op=put('attention_ops',{id:operationId,fingerprint,type,entityKind:input.entityKind,entityId:input.entityId,status:'running',startedAt:now()});
  try{const result=await execute(input,invalidate);return c.json(publicValue(put('attention_ops',{...op,status:'succeeded',result,completedAt:now()})));}
  catch(e:any){put('attention_ops',{...op,status:'failed',error:e?.code||'action_failed',completedAt:now()});throw e;}
 });
 app.get('/api/attention/actions/:id',c=>{const op=get('attention_ops',c.req.param('id'));if(!op)throw new ApiError(404,'not_found','操作不存在');return c.json(publicValue(op));});
 app.post('/api/attention/strategy',async c=>{
  const input=await c.req.json();if(!DELIVERY_STRATEGIES.includes(input.strategy))throw new ApiError(400,'invalid_strategy','提醒方式无效');
  const type=input.entityKind==='idea'?'ideas':input.entityKind==='inbox'?'inbox':'';const row=type?get(type,String(input.entityId||'')):undefined;
  if(!row)throw new ApiError(404,'not_found','对象不存在');
  return c.json(publicValue(put(type,{...row,deliveryStrategy:input.strategy})));
 });
 app.get('/api/ideas/:id/facts',c=>c.json(publicValue(ideaFacts(c.req.param('id')))));
 app.post('/api/ideas/:id/attention',async c=>c.json(publicValue(ideaAttention(c.req.param('id'),await c.req.json()))));
 app.post('/api/inbox/:id/attention-snooze',async c=>c.json(publicValue(snoozeInboxAttention(c.req.param('id'),await c.req.json()))));
 app.post('/api/inbox/:id/attention-snooze/undo',async c=>c.json(publicValue(undoInboxSnooze(c.req.param('id'),await c.req.json()))));
}
