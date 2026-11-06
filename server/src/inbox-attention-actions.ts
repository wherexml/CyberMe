// Direct, version-checked user disposition. Reuses canonical status:'dismissed' so classic and V6 agree.
import {buildDismissal,dismissalBlock,inboxAttention} from '../../shared/inbox-attention';
import {messageRevision,inboxTimestamp} from '../../shared/inbox-surfacing';
import {inboxMatter,inboxTier,ledgerGet,ledgerPut} from './attention-delivery';
import {get,put,uid,now,activity,inboxTriageVersion,recordInboxFeedback} from './store';
import {ApiError} from './integrations';

const OPERATION=/^[\w-]{1,160}$/;
function need(id:string){const item=get('inbox',id);if(!item)throw new ApiError(404,'not_found','对象不存在');return item;}
function checkBase(item:any,base:unknown){if(!base||base!==item.updatedAt)throw new ApiError(409,'edit_conflict','事项已更新，请读取最新状态',{updatedAt:item.updatedAt});}

/** The binding every path to status:'dismissed' records, including classic PATCH and Agent tools. */
export function dismissalBinding(item:any,operationId=uid('dismissal-op')){return buildDismissal(item,uid('dismissal'),operationId,inboxTriageVersion(item),now());}

export function dismissInboxAttention(id:string,input:any,invalidate:(id:string)=>void){
 const item=need(id);
 if(typeof input?.operationId!=='string'||!OPERATION.test(input.operationId))throw new ApiError(400,'invalid_operation','operationId 无效');
 if(item.status==='dismissed'&&item.attentionDismissal?.operationId===input.operationId)return {item,replayed:true};
 if(item.attentionAck?.operationId===input.operationId)return {item,replayed:true};
 // A closed record's status and receipts are real outcomes: clearing a new-request card records an acknowledgement beside them.
 if(['sent','delivered','done','cancelled'].includes(item.status)&&['new_request','closure_unverified'].includes(inboxAttention(item).reason)){
  checkBase(item,input.baseUpdatedAt);
  const id=item.triage?.requestMessageId,request=(item.messages||[]).find((m:any)=>m.id===id);
  const saved=put('inbox',{...item,attentionAck:{id:uid('dismissal'),operationId:input.operationId,requestMessageId:id,requestRevision:request?messageRevision(request):undefined,at:now()}});
  activity(`清除新请求：${saved.title}`,'surfacing','succeeded',undefined,saved.id);
  return {item:get('inbox',saved.id)};
 }
 checkBase(item,input.baseUpdatedAt);
 const blocked=dismissalBlock(item);if(blocked)throw new ApiError(409,'dismiss_blocked','发送或生成结果未确认的事项不能忽略，请先回查',{reason:blocked});
 // A new request on an already dismissed record rebinds; any other repeat changes nothing.
 if(item.status==='dismissed'&&!inboxAttention(item).canDismiss)return {item,replayed:true};
 if(item.status!=='dismissed'&&['done','cancelled','archived'].includes(item.status))throw new ApiError(409,'already_closed','事项已结束');
 const saved=put('inbox',{...item,status:'dismissed',closedAt:now(),attentionDismissal:dismissalBinding(item,input.operationId)});
 recordInboxFeedback(item,saved);invalidate(item.id);activity(`忽略事项：${saved.title}`,'surfacing','succeeded',undefined,saved.id);
 return {item:get('inbox',saved.id)};
}

export function undoInboxDismissal(id:string,input:any,invalidate:(id:string)=>void){
 const item=need(id);
 if(typeof input?.dismissalId!=='string'||!input.dismissalId)throw new ApiError(400,'invalid_dismissal','dismissalId 无效');
 if(item.attentionAck?.id===input.dismissalId){const {attentionAck:_ack,...rest}=item;const saved=put('inbox',rest);return {item:get('inbox',saved.id)};}
 if(item.attentionDismissalUndone?.id===input.dismissalId&&item.status!=='dismissed')return {item,replayed:true};
 if(item.attentionDismissalUndone?.id===input.dismissalId&&item.attentionDismissal?.id!==input.dismissalId)throw new ApiError(409,'dismissal_superseded','这次忽略已被新的状态替代');
 checkBase(item,input.baseUpdatedAt);
 const dismissal=item.attentionDismissal;
 if(item.status!=='dismissed'||dismissal?.id!==input.dismissalId)throw new ApiError(409,'dismissal_superseded','这次忽略已被新的状态替代');
 // The later request already lives on its own round, with its own approval and send keys.
 if(item.forwardedRequestId)throw new ApiError(409,'dismissal_forwarded','新的请求已单独进入待处理，不能撤销这次忽略');
 const {attentionDismissal:_binding,closedAt:_closed,...rest}=item;
 const saved=put('inbox',{...rest,status:dismissal.priorStatus,...(dismissal.priorClosedAt?{closedAt:dismissal.priorClosedAt}:{}),attentionDismissalUndone:{id:dismissal.id,at:now()}});
 recordInboxFeedback(item,saved);invalidate(item.id);activity(`撤销忽略：${saved.title}`,'surfacing','succeeded',undefined,saved.id);
 return {item:get('inbox',saved.id)};
}

const MAX_SNOOZE_MS=30*864e5;
/** Hidden everywhere and delivery held; waking uses one digest line, never a second alert. */
export function snoozeInboxAttention(id:string,input:any){
 const item=need(id);
 if(typeof input?.operationId!=='string'||!OPERATION.test(input.operationId))throw new ApiError(400,'invalid_operation','operationId 无效');
 if(item.attentionSnooze?.operationId===input.operationId)return {item,replayed:true};
 checkBase(item,input.baseUpdatedAt);
 const blocked=dismissalBlock(item);if(blocked)throw new ApiError(409,'snooze_blocked','发送或生成结果未确认的事项不能推迟，请先回查',{reason:blocked});
 const until=inboxTimestamp(input.until),at=Date.now();
 if(until===undefined||until<=at||until-at>MAX_SNOOZE_MS)throw new ApiError(400,'invalid_until','推迟时间无效');
 const matter=inboxMatter(item),prior=ledgerGet(matter.key,matter.requestRevision);
 const saved=put('inbox',{...item,attentionSnooze:{id:uid('snooze'),operationId:input.operationId,until:new Date(until).toISOString(),requestMessageId:matter.requestMessageId,requestRevision:matter.requestRevision,priorDecision:prior?.decision,at:now()}});
 ledgerPut(matter.key,matter.requestRevision,{kind:'inbox',entityId:item.id,tier:inboxTier(item),decision:'held',reason:'snooze_wake'});
 activity(`推迟事项：${saved.title}`,'surfacing','succeeded',undefined,saved.id);
 return {item:get('inbox',saved.id)};
}
export function undoInboxSnooze(id:string,input:any){
 const item=need(id),s=item.attentionSnooze;
 if(!s)return {item,replayed:true};
 if(s.operationId!==input?.operationId)throw new ApiError(409,'snooze_superseded','这次推迟已被新的状态替代');
 const {attentionSnooze:_s,...rest}=item,saved=put('inbox',rest);
 if(s.priorDecision)ledgerPut(inboxMatter(item).key,s.requestRevision,{kind:'inbox',entityId:item.id,tier:inboxTier(item),decision:s.priorDecision,reason:'snooze_undone'});
 return {item:get('inbox',saved.id)};
}
