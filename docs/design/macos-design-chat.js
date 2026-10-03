/* Real Agent requests with durable IDs. Draft input is separate from idea execution. */
(() => {
 const key='opstwins-design-chat-v1';let records=[];const active=new Set();let changed=()=>{};
 try{const saved=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(saved))records=saved.filter(x=>x&&typeof x.requestId==='string'&&typeof x.message==='string')}catch{}
 const entries=()=>records;
 function persist(){try{localStorage.setItem(key,JSON.stringify(records));return true}catch{return false}}
 function update(row,patch){const before=JSON.stringify(row);Object.assign(row,patch);const ok=persist();if(!ok)row.persistenceError=true;if(before!==JSON.stringify(row))changed();return ok}
 async function transport(path,body){
  const config=window.OPSTWINS_CHAT_CAPABILITY;
  if(!config?.token)throw Error('capability_missing');
  const response=await fetch(config.url+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-OpsTwins-Chat':config.token},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(body?150000:12000)});
  let result;try{result=await response.json()}catch{throw Error('invalid_response')}
  return {ok:response.ok,code:response.status,result};
 }
 function payload(row){return {message:row.message,requestId:row.requestId,preservePrimary:true,...(row.conversationId?{conversationId:row.conversationId}:{}),...(row.contextIds?.length?{contextIds:row.contextIds}:{}),...(row.readOnly?{readOnly:true}:{})}}
 function settle(row,result){
  const state=result.status;
  if(state==='succeeded'&&result.result?.assistantMessage?.content){update(row,{status:'succeeded',result:result.result,conversationId:result.conversationId,error:undefined});return true}
  if(state==='partial'){update(row,{status:'partial',error:'已有部分操作完成，请检查结果后继续',runId:result.runId});return true}
  if(state==='failed'){update(row,{status:'failed',error:'任务执行失败，可重试',runId:result.runId});return true}
  if(state==='running'){update(row,{status:'running',conversationId:result.conversationId,runId:result.runId,error:undefined});return false}
  update(row,{status:'unknown',error:'暂时无法确认运行结果，请重新检查'});return true;
 }
 async function poll(row){
  for(let n=0;n<80;n++){
   const response=await transport('/requests/'+encodeURIComponent(row.requestId));
   if(response.code===404){update(row,{status:'failed',error:'请求尚未开始，可重试'});return}
   if(!response.ok)throw Error('status_unavailable');
   if(settle(row,response.result))return;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  update(row,{status:'unknown',error:'仍在处理中，稍后检查结果'});
 }
 async function recover(row){
  if(active.has(row.requestId))return;active.add(row.requestId);
  try{await poll(row)}catch{update(row,{status:'unknown',error:'无法连接本机服务，请恢复服务后检查结果'})}finally{active.delete(row.requestId)}
 }
 async function execute(row){
  if(active.has(row.requestId)||row.status==='partial'||row.status==='succeeded')return;
  if(!persist()){row.status='failed';row.error='无法保存请求，请允许本机存储后重试';changed();return}
  active.add(row.requestId);update(row,{status:'running',error:undefined});
  try{
   if(row.conversationId?.startsWith('ui-side-')){
    const created=await transport('/sessions',{id:row.conversationId,title:row.sessionTitle||'新会话'});
    if(!created.ok){update(row,{status:'failed',error:'侧会话创建失败，请重试'});return}
   }
   const response=await transport('/chat',payload(row)),r=response.result;
   if(response.ok&&r.assistantMessage?.content)update(row,{status:'succeeded',result:r,conversationId:r.conversationId,error:undefined});
   else if(r.error==='partial_run_requires_review')update(row,{status:'partial',error:'已有部分操作完成，请检查结果后继续',runId:r.detail?.run?.id});
   else if(['request_in_progress','conversation_busy'].includes(r.error)){
    if(r.error==='conversation_busy')update(row,{status:'failed',error:'此对话正在处理其他任务，请稍后重试'});
    else await poll(row);
   }else if(r.error==='bridge_unavailable'||response.code>=500){await poll(row)}
   else update(row,{status:'failed',error:r.error==='capability_required'?'本机连接已更新，请刷新后重试':'请求未开始，请重试'});
  }catch{
   // Lost POST responses must be checked; never resend here.
   try{await poll(row)}catch{update(row,{status:'unknown',error:'无法确认执行结果，请恢复本机服务后检查'})}
  }finally{active.delete(row.requestId)}
 }
 function start(input){
  const pending=records.find(x=>input.ideaId&&x.ideaId===input.ideaId&&['running','unknown'].includes(x.status));
  if(pending){changed();return pending}
  const row={...input,requestId:'design-'+crypto.randomUUID(),status:'running',createdAt:new Date().toISOString()};records.push(row);
  if(!persist()){records.pop();throw Error('无法保存请求，请允许本机存储后重试')}
  changed();void execute(row);return row;
 }
 async function retry(row){
  if(active.has(row.requestId)||!['failed','unknown'].includes(row.status))return;
  active.add(row.requestId);let submit=false;
  // Hold the recovery lock while GET is pending, including repeated button clicks.
  try{
   const r=await transport('/requests/'+encodeURIComponent(row.requestId));
   if(r.ok){if(r.result.status==='failed')submit=true;else if(!settle(row,r.result))await poll(row)}
   else if(r.code===404)submit=true;else throw Error('status_unavailable');
  }catch{update(row,{status:'unknown',error:'无法确认执行结果，请先恢复本机服务'})}
  finally{active.delete(row.requestId)}
  if(submit)void execute(row);
 }
 function connect(callback){changed=callback;for(const row of records)if(['running','unknown'].includes(row.status))void recover(row)}
 window.OpsTwinsDesignChat=Object.freeze({entries,start,retry,recover,connect});
})();
