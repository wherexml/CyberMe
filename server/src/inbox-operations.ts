import {needsInboxAttention} from '../../shared/inbox-surfacing';
import {get,list,put,hash,uid,now,publicValue} from './store';
import {ApiError} from './integrations';
import {applicationRequest} from './agent-capabilities';

function timestamp(value:any):number|undefined{
 if(value===undefined||value===null||value==='')return;
 const numeric=typeof value==='number'||/^\d{10,13}(?:\.\d+)?$/.test(String(value));
 const n=numeric?Number(value)*(Number(value)<1e11?1000:1):Date.parse(String(value));
 return Number.isFinite(n)&&n>0&&Number.isFinite(new Date(n).getTime())?n:undefined;
}
export function inboxEventAt(item:any){
 const values=[item.receivedAt,item.sentAt,...(item.messages||[]).map((m:any)=>m.sentAt)].map(timestamp).filter((n):n is number=>n!==undefined);
 // Local entries with no source provenance may explicitly carry a message eventAt.
 const explicit=timestamp(item.eventAt);if(explicit)values.push(explicit);
 return values.length?new Date(Math.max(...values)).toISOString():undefined;
}
export function inboxSummary(item:any){return publicValue({id:item.id,title:item.title,sender:item.sender,status:item.status,channel:item.channel,body:String(item.body||'').slice(0,2200),draft:item.draft,sourceId:item.sourceId,eventAt:inboxEventAt(item),timeKnown:!!inboxEventAt(item),createdAt:item.createdAt,updatedAt:item.updatedAt,receivedAt:item.receivedAt,sourceUpdatedAt:item.sourceUpdatedAt,surfacing:item.surfacing,sensitive:!!item.sensitive});}
const queryFields=['query','channel','status','ids','includeQuiet','includeDone','before','olderThanDays','offset','limit'];
function validateQuery(input:any){
 if(Object.keys(input).some(k=>!queryFields.includes(k)))throw new ApiError(400,'invalid_query','Unsupported Inbox query');
 for(const k of ['includeQuiet','includeDone'])if(input[k]!==undefined&&!['true','false',true,false].includes(input[k]))throw new ApiError(400,'invalid_query',k+' must be boolean');
 if(input.ids!==undefined&&(!Array.isArray(input.ids)||input.ids.length>1000||input.ids.some((id:any)=>typeof id!=='string')))throw new ApiError(400,'invalid_query','ids must be strings');
 for(const k of ['offset','limit','olderThanDays'])if(input[k]!==undefined&&(!Number.isInteger(Number(input[k]))||Number(input[k])<(k==='offset'?0:1)||Number(input[k])>(k==='olderThanDays'?36500:10000)))throw new ApiError(400,'invalid_query','Invalid '+k);
 if(input.before!==undefined&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.before)||timestamp(input.before)===undefined))throw new ApiError(400,'invalid_query','before needs an ISO timestamp with timezone');
 if(input.before&&input.olderThanDays!==undefined)throw new ApiError(400,'invalid_query','Choose before or olderThanDays');
}
function candidates(input:any){
 const yes=(v:any)=>v===true||v==='true';const q=String(input.query||'').toLowerCase();
 return list('inbox').filter(i=>!input.ids||input.ids.includes(i.id)).filter(i=>!input.channel||i.channel===input.channel).filter(i=>!input.status||i.status===input.status).filter(i=>input.status||yes(input.includeDone)||(!['sent','delivered','done','dismissed','recalled','cancelled'].includes(i.status))).filter(i=>yes(input.includeQuiet)||input.status||yes(input.includeDone)||needsInboxAttention(i)).filter(i=>!q||[i.title,i.sender,i.body].some(v=>String(v||'').toLowerCase().includes(q)));
}
export function queryInbox(input:any={}){
 validateQuery(input);const at=now(),cutoff=input.before|| (input.olderThanDays!==undefined?new Date(Date.parse(at)-Number(input.olderThanDays)*86400000).toISOString():undefined);
 const source=candidates(input),unknown=source.filter(i=>!inboxEventAt(i));
 const matched=source.filter(i=>!cutoff||(!!inboxEventAt(i)&&inboxEventAt(i)!<cutoff)).sort((a,b)=>(inboxEventAt(b)||'').localeCompare(inboxEventAt(a)||'')||a.id.localeCompare(b.id));
 const offset=Number(input.offset)||0,limit=Math.min(Number(input.limit)||50,200),items=matched.slice(offset,offset+limit).map(inboxSummary);
 return {items,total:matched.length,offset,limit,hasMore:offset+items.length<matched.length,nextOffset:offset+items.length,unknownTimeCount:unknown.length,cutoff,evaluatedAt:at,timeZone:'Asia/Singapore',timeBasis:'latest_source_message_or_mail_received_at; importedAt/createdAt/sourceUpdatedAt are not event times'};
}
function skipReason(item:any,target:string){
 if(!item)return 'not_found';if(item.status===target)return 'already_in_target_status';
 if(['sending','sent','recalled','send_unknown'].includes(item.status))return 'outbound_locked';
 if(target!=='pending'){
  if(item.sensitive)return 'sensitive';
  if(['failed','send_failed'].includes(item.status)||['failed','blocked','interrupted','queued','running'].includes(item.sourceProcessing?.status))return 'failed_or_active_processing';
 }
}
const active=new Set<string>();
export async function bulkInboxStatus(input:any,onCommit?:(row:any)=>void,runId?:string){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_batch','Batch input must be an object');
 if(input.preview===true){
  if(Object.keys(input).some(k=>!['preview','status',...queryFields].includes(k)))throw new ApiError(400,'invalid_batch','Unsupported preview field');
  if(!['pending','done','dismissed'].includes(input.status))throw new ApiError(400,'invalid_status','Use pending/done/dismissed');
  const {preview,status,...query}=input;delete query.offset;delete query.limit;
  // status refers to target status here, not a query status.
  const summary=queryInbox({...query,limit:200});const matching=candidates(query).filter(i=>!summary.cutoff||(inboxEventAt(i)&&inboxEventAt(i)!<summary.cutoff));
  const snapshots=matching.map(i=>({id:i.id,updatedAt:i.updatedAt,eventAt:inboxEventAt(i),reason:skipReason(i,status)}));
  const previewId=uid('inbox-preview');put('inbox_batch_previews',{id:previewId,target:status,query,cutoff:summary.cutoff,snapshots,expiresAt:new Date(Date.now()+10*60000).toISOString()});
  return {previewId,status,matched:snapshots.length,eligible:snapshots.filter(i=>!i.reason).length,skipped:snapshots.filter(i=>i.reason).length,unknownTimeCount:summary.unknownTimeCount,cutoff:summary.cutoff,timeZone:summary.timeZone,items:snapshots,preview:true};
 }
 if(Object.keys(input).some(k=>!['previewId','operationId'].includes(k))||typeof input.previewId!=='string'||typeof input.operationId!=='string'||!(/^[\w-]{1,160}$/).test(input.operationId))throw new ApiError(400,'invalid_batch','Execution requires previewId and operationId only');
 const prior=get('inbox_batches',input.operationId);if(prior&&prior.previewId!==input.previewId)throw new ApiError(409,'request_conflict','Operation id already belongs to a different preview');
 if(prior?.status==='succeeded'||prior?.status==='partial')return {...prior.result,replayed:true};
 if(active.has(input.operationId))throw new ApiError(409,'batch_busy','Batch is executing');
 const preview=get('inbox_batch_previews',input.previewId);if(!preview)throw new ApiError(404,'preview_not_found','Preview not found');
 if(!prior&&Date.parse(preview.expiresAt)<Date.now())throw new ApiError(409,'preview_expired','Preview expired; inspect current matches again');
 active.add(input.operationId);let results:any[]=prior?.results||[];
 put('inbox_batches',{id:input.operationId,previewId:preview.id,runId:runId||prior?.runId,status:'running',results});
 try{
  for(const snapshot of preview.snapshots){
   if(results.some(r=>r.id===snapshot.id))continue;
   const current=get('inbox',snapshot.id);const reason=snapshot.reason||skipReason(current,preview.target)||(current?.updatedAt!==snapshot.updatedAt||inboxEventAt(current)!==snapshot.eventAt?'changed_since_preview':undefined);
   let row:any;
   if(reason)row={id:snapshot.id,status:'skipped',reason};
   else try{const saved=await applicationRequest('/api/inbox/'+encodeURIComponent(snapshot.id),'PATCH',{status:preview.target,baseUpdatedAt:snapshot.updatedAt});const read=get('inbox',snapshot.id);if(read?.status!==preview.target)throw new ApiError(409,'readback_mismatch','State changed before readback');row={id:snapshot.id,status:'changed',from:current.status,to:saved.status,updatedAt:read.updatedAt,readback:true};}
   catch(e){row={id:snapshot.id,status:e instanceof ApiError&&e.status===409?'skipped':'failed',reason:e instanceof ApiError?e.code:'operation_failed'};}
   results.push(row);put('inbox_batches',{id:input.operationId,previewId:preview.id,runId:runId||prior?.runId,status:'running',results});if(row.status==='changed')onCommit?.(row);
  }
  const result={operationId:input.operationId,previewId:preview.id,target:preview.target,changed:results.filter(r=>r.status==='changed').length,skipped:results.filter(r=>r.status==='skipped').length,failed:results.filter(r=>r.status==='failed').length,unknownTimeCount:queryInbox({...preview.query,limit:1}).unknownTimeCount,results,readback:true};
  put('inbox_batches',{id:input.operationId,previewId:preview.id,runId:runId||prior?.runId,status:result.failed||result.skipped?'partial':'succeeded',results,result,completedAt:now()});return result;
 }finally{active.delete(input.operationId);}
}
