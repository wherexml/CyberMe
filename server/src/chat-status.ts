// Read-only recovery for idempotent chat requests; never starts or retries a run.
import type {Hono} from 'hono';
import {db, get, publicValue} from './store';
import {ApiError} from './integrations';
export function mountChatStatus(app:Hono){
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
   ...(status==='failed'?{error:'agent_failed'}:{}),runStatus:run?.status}));
 });
}
