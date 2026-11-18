import type {Hono} from 'hono';
import {db,get,list,put,now,hash,publicValue} from './store';
import {ApiError} from './integrations';
import {editPendingInput,cancelPendingInput,setPendingDelivery} from './chat-inputs';

function receipt(item:any){
 const row=db.prepare('SELECT state,data FROM chat_requests WHERE id=?').get(item.id) as any;if(!row||item.status==='cancelled')return item;
 const saved=JSON.parse(row.data);const inserted=item.delivery==='steer'&&!!saved.parentRunId;
 return {...item,status:inserted?'inserted':row.state,processingStatus:row.state,consumedAt:saved.consumedAt,runId:saved.runId,delivered:inserted};
}

export function chatContinuation(conversationId:string){
 return {running:list('runs').some(r=>r.conversationId===conversationId&&r.status==='running'),items:list('chat_queue').filter(q=>q.conversationId===conversationId&&['queued','running','inserting','failed','interrupted'].includes(receipt(q).status)).reverse().map(receipt)};
}
export function installChatContinuation(app:Hono){
 app.get('/api/chat/conversations/state',c=>{
  const ids=(c.req.query('ids')||'').split(',').filter(Boolean);
  if(!ids.length||ids.length>200||ids.some(id=>!/^[\w-]{1,128}$/.test(id)))throw new ApiError(400,'invalid_conversation_ids','会话ID列表无效');
  const states=new Map(ids.map(id=>[id,{id,found:!!get('conversations',id),running:false,partial:false,pending:0,locked:false}]));
  for(const row of db.prepare("SELECT state,data FROM chat_requests WHERE state IN ('queued','running','partial')").all() as any[]){
   const value=JSON.parse(row.data);const state=states.get(value.conversationId);if(!state)continue;
   if(row.state==='running')state.running=true;else if(row.state==='queued')state.pending++;else state.partial=true;
  }
  for(const run of list('runs')){const state=states.get(run.conversationId);if(state&&run.status==='running')state.running=true;}
  for(const item of list('chat_queue')){const state=states.get(item.conversationId);if(state&&!db.prepare('SELECT id FROM chat_requests WHERE id=?').get(item.id)&&['queued','running','inserting','failed','interrupted'].includes(item.status))state.pending++;}
  for(const state of states.values())state.locked=!state.found||state.running||state.partial||state.pending>0;
  return c.json({items:[...states.values()]});
 });
 // A receipt includes terminal queue/steer outcomes. The conversation list
 // intentionally omits those and cannot prove that a lost response was unsent.
 app.get('/api/chat/continuation/receipts/:id',c=>{
  const item=get('chat_queue',c.req.param('id'));
  if(!item)throw new ApiError(404,'not_found','补充请求尚未执行');
  return c.json(publicValue(receipt(item)));
 });
 app.get('/api/chat/continuation/:id',c=>c.json(publicValue(chatContinuation(c.req.param('id')))));
 app.post('/api/chat/continuation',async c=>{
  let input:any;try{input=await c.req.json()}catch{throw new ApiError(400,'invalid_json','消息参数必须为 JSON')}if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_continuation','消息参数无效');
  for(const key of ['attachmentIds','contextIds'])if(input[key]!==undefined&&(!Array.isArray(input[key])||input[key].length>100||input[key].some((id:unknown)=>typeof id!=='string')))throw new ApiError(400,'invalid_continuation','资料 ID 必须为字符串数组');
  if(input.readOnly!==undefined&&typeof input.readOnly!=='boolean')throw new ApiError(400,'invalid_read_only','readOnly必须是布尔值');
  const message=String(input.message||'').trim();
  if(!message||message.length>80000||!['steer','queue'].includes(input.delivery)||typeof input.conversationId!=='string'||!get('conversations',input.conversationId)||!(/^[\w-]{1,128}$/).test(input.requestId||''))throw new ApiError(400,'invalid_continuation','补充消息参数无效');
  const fingerprint=hash({message,conversationId:input.conversationId,delivery:input.delivery,attachmentIds:input.attachmentIds||[],contextIds:input.contextIds||[],...(input.readOnly===true?{readOnly:true}:{})});
  const old=get('chat_queue',input.requestId);
  if(old){if(old.fingerprint!==fingerprint)throw new ApiError(409,'request_conflict','请求 ID 已使用');return c.json(publicValue(receipt(old)));}
  const item=put('chat_queue',{id:input.requestId,fingerprint,conversationId:input.conversationId,message,delivery:input.delivery,attachmentIds:input.attachmentIds||[],contextIds:input.contextIds||[],...(input.readOnly===true?{readOnly:true}:{}),status:'queued'});
  const response=await app.request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,message,queueCurrent:true,preservePrimary:true,appendDelivery:input.delivery==='steer'?'steer':'followUp'})});
  if(!response.ok){const error:any=await response.json();put('chat_queue',{...item,status:'failed',error:error.message});}
  return c.json(publicValue(receipt(get('chat_queue',item.id))));
 });
 app.patch('/api/chat/continuation/:id',async c=>{
  let input:any;try{input=await c.req.json()}catch{throw new ApiError(400,'invalid_json','消息参数必须为 JSON')}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_continuation','消息参数无效');
  const item=get('chat_queue',c.req.param('id'));
  if(!item)throw new ApiError(404,'not_found','消息不存在');
  const current=receipt(item);
  if(input.action==='insert'&&current.status==='inserted')return c.json(publicValue(current));
  if(current.status!=='queued')throw new ApiError(409,'queue_locked','消息已经开始处理，不能再修改');
  if(!['edit','insert'].includes(input.action))throw new ApiError(400,'invalid_action','消息操作无效');
  const message=typeof input.message==='string'?input.message.trim():'';
  if(input.action==='edit'&&(!message||message.length>80000))throw new ApiError(400,'invalid_continuation','消息内容不能为空或超过 80000 字符');
  if(input.action==='edit'&&message===item.message)return c.json(publicValue(current));
  if(input.updatedAt!==item.updatedAt)throw new ApiError(409,'queue_changed','消息已变化，请检查当前内容后重试');
  if(input.action==='edit'){editPendingInput(item.id,message);return c.json(publicValue(receipt(put('chat_queue',{...item,message}))));}
  setPendingDelivery(item.id,'steer');return c.json(publicValue(receipt(put('chat_queue',{...item,delivery:'steer'}))));
 });
 app.delete('/api/chat/continuation/:id',c=>{const item=get('chat_queue',c.req.param('id'));if(!item||!['queued','failed','interrupted'].includes(receipt(item).status))throw new ApiError(409,'queue_locked','消息已经开始处理');if(receipt(item).status==='queued')cancelPendingInput(item.id);return c.json(put('chat_queue',{...item,status:'cancelled'}));});
 // Historical adapter receipts remain readable; only chat_requests dispatches new work.
 for(const item of list('chat_queue')){const row=db.prepare('SELECT id FROM chat_requests WHERE id=?').get(item.id);if(!row&&['queued','running','inserting'].includes(item.status))put('chat_queue',{...item,status:'interrupted',error:'旧补充请求未确认；未自动重发'});}
}
