import type {Hono} from 'hono';
import {db,get,list,put,now,hash,publicValue} from './store';
import {ApiError} from './integrations';
import {steerChat} from './agent';

export function chatContinuation(conversationId:string){
 return {running:list('runs').some(r=>r.conversationId===conversationId&&r.status==='running'),items:list('chat_queue').filter(q=>q.conversationId===conversationId&&['queued','running','inserting','failed','interrupted'].includes(q.status)).reverse()};
}
export function installChatContinuation(app:Hono){
 app.get('/api/chat/conversations/state',c=>{
  const ids=(c.req.query('ids')||'').split(',').filter(Boolean);
  if(!ids.length||ids.length>200||ids.some(id=>!/^[\w-]{1,128}$/.test(id)))throw new ApiError(400,'invalid_conversation_ids','会话ID列表无效');
  const states=new Map(ids.map(id=>[id,{id,found:!!get('conversations',id),running:false,partial:false,pending:0,locked:false}]));
  for(const row of db.prepare("SELECT state,data FROM chat_requests WHERE state IN ('running','partial')").all() as any[]){
   const value=JSON.parse(row.data);const state=states.get(value.conversationId);if(!state)continue;
   if(row.state==='running')state.running=true;else state.partial=true;
  }
  for(const run of list('runs')){const state=states.get(run.conversationId);if(state&&run.status==='running')state.running=true;}
  for(const item of list('chat_queue')){const state=states.get(item.conversationId);if(state&&['queued','running','inserting','failed','interrupted'].includes(item.status))state.pending++;}
  for(const state of states.values())state.locked=!state.found||state.running||state.partial||state.pending>0;
  return c.json({items:[...states.values()]});
 });
 // A receipt includes terminal queue/steer outcomes. The conversation list
 // intentionally omits those and cannot prove that a lost response was unsent.
 app.get('/api/chat/continuation/receipts/:id',c=>{
  const item=get('chat_queue',c.req.param('id'));
  if(!item)throw new ApiError(404,'not_found','补充请求尚未执行');
  return c.json(publicValue(item));
 });
 app.get('/api/chat/continuation/:id',c=>c.json(publicValue(chatContinuation(c.req.param('id')))));
 app.post('/api/chat/continuation',async c=>{
  let input:any;try{input=await c.req.json()}catch{throw new ApiError(400,'invalid_json','消息参数必须为 JSON')}if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_continuation','消息参数无效');
  for(const key of ['attachmentIds','contextIds'])if(input[key]!==undefined&&(!Array.isArray(input[key])||input[key].length>100||input[key].some((id:unknown)=>typeof id!=='string')))throw new ApiError(400,'invalid_continuation','资料 ID 必须为字符串数组');
  if(input.readOnly!==undefined&&typeof input.readOnly!=='boolean')throw new ApiError(400,'invalid_read_only','readOnly必须是布尔值');
  const message=String(input.message||'').trim();
  if(!message||message.length>80000||!['steer','queue'].includes(input.delivery)||typeof input.conversationId!=='string'||!get('conversations',input.conversationId)||!(/^[\w-]{1,128}$/).test(input.requestId||''))throw new ApiError(400,'invalid_continuation','补充消息参数无效');
  if(input.delivery==='steer'&&((input.attachmentIds||[]).length||(input.contextIds||[]).length))throw new ApiError(400,'queue_required','带资料的消息请选择等待完成后发送');
  const fingerprint=hash({message,conversationId:input.conversationId,delivery:input.delivery,attachmentIds:input.attachmentIds||[],contextIds:input.contextIds||[],...(input.readOnly===true?{readOnly:true}:{})});
  const old=get('chat_queue',input.requestId);
  if(old){if(old.fingerprint!==fingerprint)throw new ApiError(409,'request_conflict','请求 ID 已使用');return c.json(publicValue(old));}
  // Persist before delivery; an interrupted steering request must never be silently replayed.
  let item=put('chat_queue',{id:input.requestId,fingerprint,conversationId:input.conversationId,message,delivery:input.delivery,attachmentIds:input.attachmentIds||[],contextIds:input.contextIds||[],...(input.readOnly===true?{readOnly:true}:{}),status:input.delivery==='queue'?'queued':'inserting'});
  if(input.delivery==='steer'){
   try{const runId=await steerChat(input.conversationId,message);const current=get('chat_queue',item.id);if(current?.status!=='inserting')return c.json(publicValue(current||item));item=current;if(runId){put('messages',{conversationId:input.conversationId,role:'user',content:message,requestId:input.requestId,runId});item=put('chat_queue',{...item,status:'inserted',runId});}else item=put('chat_queue',{...item,status:'queued'});}
   catch(e){item=put('chat_queue',{...item,status:'failed',error:String(e)});}
  }
  return c.json(publicValue(item));
 });
 app.patch('/api/chat/continuation/:id',async c=>{
  let input:any;try{input=await c.req.json()}catch{throw new ApiError(400,'invalid_json','消息参数必须为 JSON')}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_continuation','消息参数无效');
  const item=get('chat_queue',c.req.param('id'));
  if(!item)throw new ApiError(404,'not_found','消息不存在');
  if(input.action==='insert'&&item.status==='inserted')return c.json(publicValue(item));
  if(item.status!=='queued')throw new ApiError(409,'queue_locked','消息已经开始处理，不能再修改');
  if(!['edit','insert'].includes(input.action))throw new ApiError(400,'invalid_action','消息操作无效');
  const message=typeof input.message==='string'?input.message.trim():'';
  if(input.action==='edit'&&(!message||message.length>80000))throw new ApiError(400,'invalid_continuation','消息内容不能为空或超过 80000 字符');
  // A replayed save is harmless. Otherwise reject edits based on an outdated row.
  if(input.action==='edit'&&message===item.message)return c.json(publicValue(item));
  if(input.updatedAt!==item.updatedAt)throw new ApiError(409,'queue_changed','消息已变化，请检查当前内容后重试');
  if(input.action==='edit')return c.json(publicValue(put('chat_queue',{...item,message})));
  if(item.attachmentIds?.length||item.contextIds?.length)throw new ApiError(400,'queue_required','带资料的消息将在当前任务完成后处理');
  // Claim the existing row before awaiting Pi, so the worker cannot also consume it.
  let saved=put('chat_queue',{...item,status:'inserting'});
  try{const runId=await steerChat(item.conversationId,item.message);const current=get('chat_queue',item.id);if(current?.status!=='inserting')return c.json(publicValue(current||saved));saved=current;
   if(runId){put('messages',{conversationId:item.conversationId,role:'user',content:item.message,requestId:item.id,runId});saved=put('chat_queue',{...saved,status:'inserted',runId});}
   else saved=put('chat_queue',{...saved,status:'queued'});
  }catch(e){saved=put('chat_queue',{...saved,status:'interrupted',error:String(e)});}
  return c.json(publicValue(saved));
 });
 app.delete('/api/chat/continuation/:id',c=>{const item=get('chat_queue',c.req.param('id'));if(!item||!['queued','failed','interrupted'].includes(item.status))throw new ApiError(409,'queue_locked','消息已经开始处理');return c.json(put('chat_queue',{...item,status:'cancelled'}));});
 for(const item of list('chat_queue').filter(q=>['running','inserting'].includes(q.status)))put('chat_queue',{...item,status:'interrupted',error:'服务重启，请检查对话结果后重新发送'});
 const working=new Set<string>();
 const timer=setInterval(()=>{
  for(const item of list('chat_queue').reverse().filter(q=>q.status==='queued')){
   if(working.has(item.conversationId)||chatContinuation(item.conversationId).running)continue;
   working.add(item.conversationId);put('chat_queue',{...item,status:'running',startedAt:now()});
   void (async()=>{try{
    const response=await app.request('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:item.conversationId,message:item.message,requestId:item.id,attachmentIds:item.attachmentIds,contextIds:item.contextIds,...(item.readOnly===true?{readOnly:true}:{})})});const result:any=await response.json();
    put('chat_queue',{...(get('chat_queue',item.id)||item),status:response.ok?'succeeded':result.error==='conversation_busy'?'queued':'failed',error:response.ok?undefined:result.message,runId:result.run?.id,completedAt:now()});
   }catch(e){put('chat_queue',{...item,status:'failed',error:String(e)});}finally{working.delete(item.conversationId);}})();
  }
 },500);timer.unref();
}
