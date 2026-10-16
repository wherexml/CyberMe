/* Production replacement for the design Chat transport; same rendering contract, real receipts. */
(() => {
 const api=(...a)=>window.OpsTwinsDesktop.api(...a),KEY='opstwins-design-chat-v1';let records=[];let changed=()=>{};const posts=new Set(),polls=new Set();
 try{records=JSON.parse(localStorage.getItem(KEY)||'[]').filter(r=>r?.requestId&&r.message)}catch{}
 const persist=()=>localStorage.setItem(KEY,JSON.stringify(records));
 function update(r,p){const before=JSON.stringify(r);Object.assign(r,p);if(before!==JSON.stringify(r)){try{persist()}catch{r.persistenceError=true}changed()}}
 function settle(r,value){const status=value.status;r.missing=false;if(['succeeded','partial','cancelled','failed'].includes(r.status)&&['running','unknown'].includes(status))return true;if(status==='succeeded')update(r,{status,result:value.result,conversationId:value.conversationId||r.conversationId,error:undefined,runId:value.runId});else if(status==='partial')update(r,{status,runId:value.runId,error:'已有部分操作完成，请查看原记录，不能重新执行'});else if(status==='running')update(r,{status,runId:value.runId,error:undefined});else if(status==='cancelled')update(r,{status:'cancelled',runId:value.runId,error:'已停止'});else if(status==='failed')update(r,{status,runId:value.runId,error:value.failureCode==='model_quota_exceeded'?'模型渠道额度已耗尽，请在设置中更换模型或恢复额度后重试':'执行失败，请查看记录'});else update(r,{status:'unknown',error:'结果未确认，请回查原请求'});return !['running'].includes(status)}
 async function one(r){try{const value=await api('GET','/api/chat/requests/'+encodeURIComponent(r.requestId));settle(r,value);return value}catch(e){if(!['succeeded','partial','cancelled','failed'].includes(r.status))update(r,{status:'unknown',missing:e.status===404,error:e.status===404?'原请求尚未登记，可明确使用原请求重试':'无法确认原请求；不会自动重发'});throw e}}
 async function recover(r){if(polls.has(r.requestId))return;polls.add(r.requestId);try{for(let i=0;i<90;i++){const value=await one(r);if(value.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,1600))}}catch{}finally{polls.delete(r.requestId)}}
 async function execute(r){if(posts.has(r.requestId)||['partial','succeeded','cancelled'].includes(r.status))return;posts.add(r.requestId);try{
  await window.OpsTwinsDesktop.durable();
  if(r.conversationId?.startsWith('ui-side-'))await api('POST','/api/conversations/side',{id:r.conversationId,title:r.sessionTitle||'新会话'});
  update(r,{status:'prepared',error:'正在确认请求'});
  const body={requestId:r.requestId,message:r.message,conversationId:r.conversationId,mode:r.mode||'chat',contextIds:r.contextIds||[],attachmentIds:r.attachmentIds||[],preservePrimary:true,interruptCurrent:true,...(r.readOnly?{readOnly:true}:{})};
  // Poll is independent of the long POST. Only server-confirmed running animates.
  const poll=setInterval(()=>void one(r).catch(()=>{}),1600);
  try{const result=await api('POST','/api/chat',body);update(r,{status:'succeeded',result,runId:result.run?.id,conversationId:result.conversationId,error:undefined})}catch{await one(r).catch(()=>{})}finally{clearInterval(poll)}
 }catch(e){update(r,{status:'unknown',error:'请求未提交或未确认：'+e.message})}finally{posts.delete(r.requestId);if(r.status==='running')void recover(r)}}
 function start(input){const prior=records.find(r=>input.ideaId&&r.ideaId===input.ideaId&&['prepared','running','unknown','partial'].includes(r.status));if(prior){changed();return prior}const row={...input,requestId:'desktop-'+crypto.randomUUID(),status:'prepared',createdAt:new Date().toISOString()};records.push(row);try{persist()}catch(e){records.pop();throw e}changed();void execute(row);return row}
 async function retry(r){if(posts.has(r.requestId)||r.status==='partial')return;try{const value=await one(r);if(value.status==='failed')void execute(r)}catch(e){if(e.status===404&&r.message)void execute(r)}}
 function connect(callback){changed=callback;for(const r of records)if(['prepared','running','unknown'].includes(r.status))void recover(r)}
 window.OpsTwinsDesignChat=Object.freeze({entries:()=>records,start,retry,recover,connect});
})();
