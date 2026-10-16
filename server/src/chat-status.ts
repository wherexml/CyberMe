// Read-only recovery for idempotent chat requests; never starts or retries a run.
import type {Hono} from 'hono';
import {db, get, publicValue, revision} from './store';
import {ApiError} from './integrations';
export function mountChatStatus(app:Hono){
 // Discovery is independent of local outgoing state and loaded history pages.
 // Return only bounded intent metadata, never the original prompt or tool payloads.
 app.get('/api/chat/conversations/:id/unresolved',c=>{
  const id=c.req.param('id'),query=c.req.query();
  if(!/^[\w-]{1,128}$/.test(id))throw new ApiError(400,'invalid_conversation_id','会话 ID 无效');
  if(!get('conversations',id))throw new ApiError(404,'conversation_not_found','会话不存在');
  const rawLimit=query.limit??'100',limit=Number(rawLimit);
  if(!/^\d+$/.test(rawLimit)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new ApiError(400,'invalid_pagination','limit 必须为1–100');
  const currentRevision=revision();
  if(query.revision!==undefined){
   if(!/^\d+$/.test(query.revision)||!Number.isSafeInteger(Number(query.revision)))throw new ApiError(400,'invalid_revision','revision 必须为非负整数');
   if(Number(query.revision)!==currentRevision)throw new ApiError(409,'recovery_revision_changed','运行状态已变更，请重新读取。 / Run state changed. Reload.');
  }
  const filter="json_valid(data) AND json_extract(data,'$.conversationId')=? AND state IN ('running','partial')";
  let anchor:{id:string;updated_at:string}|undefined;
  if(query.before!==undefined){
   if(!/^[\w-]{1,128}$/.test(query.before))throw new ApiError(400,'invalid_before','请求游标无效');
   anchor=db.prepare("SELECT id,updated_at FROM chat_requests WHERE id=? AND json_valid(data) AND json_extract(data,'$.conversationId')=?").get(query.before,id) as typeof anchor;
   if(!anchor)throw new ApiError(400,'invalid_before','游标不属于此会话');
  }
  const rows=(anchor?db.prepare(`SELECT id,state,data,updated_at FROM chat_requests WHERE ${filter} AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT ?`).all(id,anchor.updated_at,anchor.updated_at,anchor.id,limit+1):db.prepare(`SELECT id,state,data,updated_at FROM chat_requests WHERE ${filter} ORDER BY updated_at DESC,id DESC LIMIT ?`).all(id,limit+1)) as {id:string;state:string;data:string;updated_at:string}[];
  const counts=db.prepare(`SELECT count(*) AS total,sum(state='partial') AS partialCount FROM chat_requests WHERE ${filter}`).get(id) as {total:number;partialCount:number|null};
  const hasMore=rows.length>limit;
  const items=rows.slice(0,limit).map(row=>{
   const saved=JSON.parse(row.data),run=saved.runId?get('runs',saved.runId):undefined;
   return {requestId:row.id,conversationId:id,status:row.state==='running'&&run?.status==='failed'?'failed':row.state,
    runId:typeof saved.runId==='string'?saved.runId:null,runStatus:run?.status??null,userMessageId:typeof saved.userMessage?.id==='string'?saved.userMessage.id:null,
    completedWriteCount:Array.isArray(saved.completedWrites)?saved.completedWrites.length:null,updatedAt:row.updated_at};
  });
  c.header('Cache-Control','no-store');
  return c.json({conversationId:id,revision:currentRevision,total:counts.total,partialCount:counts.partialCount||0,items,hasMore,nextBefore:hasMore?items.at(-1)?.requestId:null});
 });
 app.get('/api/chat/requests/:id',c=>{
  const id=c.req.param('id');if(!/^[\w-]{1,128}$/.test(id))throw new ApiError(400,'invalid_request_id','请求 ID 无效');
  const row=db.prepare('SELECT state,data FROM chat_requests WHERE id=?').get(id) as {state:string;data:string}|undefined;
  if(!row)throw new ApiError(404,'request_not_found','此请求尚未开始');
  const saved=JSON.parse(row.data),run=get('runs',saved.runId);
  // Legacy/restarted processes may leave a running row with a terminal run.
  const status=row.state==='running'&&run?.status==='failed'?'failed':row.state;
  return c.json(publicValue({requestId:id,status,conversationId:saved.conversationId,runId:saved.runId,
   userMessage:saved.userMessage,...(status==='succeeded'?{result:saved.result}:{}),
   ...(status==='partial'?{completedWrites:saved.completedWrites}:{}),
   ...(status==='failed'?{error:'agent_failed',failureCode:/GoUsageLimitError|usage limit exceeded|insufficient_quota/i.test(String(run?.error||''))?'model_quota_exceeded':'agent_failed'}:{}),runStatus:run?.status}));
 });
}
