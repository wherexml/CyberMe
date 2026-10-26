import {esc,icon,button,markdown} from './ui.js';
const activeStatuses=['prepared','queued','running','unknown','partial'];
export const chatBusy=s=>activeStatuses.includes(s.chatRequest?.status)&&!s.chatRequest?.closed;
function safeQuote(q){return {id:q.id,text:q.text,type:q.type,sourceId:q.sourceId,sessionId:q.sessionId||'',sourceTitle:q.sourceTitle}}
export function modelRunMarkup(s){
 const r=s.chatRequest;if(!r)return '';
 if(['prepared','queued','running'].includes(r.status))return `${r.text?`<article class="message assistant"><div class="bubble">${markdown(r.text,{streaming:true})}</div></article>`:''}<div class="model-progress" role="status">${r.status==='running'?'<span class="thinking"><i></i><i></i><i></i></span>':'连接模型中…'}</div>`;
 if(r.closed)return '';
 if(r.status==='succeeded')return r.saveError?`<div class="model-recovery" role="status">回答尚未保存 ${button('重试保存','chat-save','subtle')}</div>`:'';
 return `<div class="model-recovery" role="status">${r.text?`<div class="model-partial">${markdown(r.text)}</div>`:''}<p>${esc(r.error||({unknown:'原请求结果尚未确认',partial:'回答尚未完整',failed:'模型未能完成回答'})[r.status])}</p><div>${button('查看原请求','chat-lookup','subtle','refresh')}${r.missing?button('重试原请求','chat-retry','subtle'):''}${r.status==='failed'?button('恢复问题到草稿','chat-restore','subtle'):button('保留记录并继续','chat-dismiss','subtle')}${r.saveError?button('重试保存','chat-save','subtle'):''}</div></div>`;
}
export function createChatModel({getState,getUI,save,render,changed,toast}){
 const workers=new Map();
 function session(id){return getState().sessions.find(x=>x.id===id)}
 function headers(){return {'Content-Type':'application/json','X-OpsTwins-Mock':'chat','X-OpsTwins-Client':getState().modelClientId}}
 function owned(scope,s,r){return getState()===scope&&session(s.id)===s&&s.chatRequest===r}
 function store(s,r){const user=s.messages.find(m=>m.requestId===r.id&&m.role==='user');if(user){if(['failed','unknown','partial'].includes(r.status))user.modelStatus=r.status;else delete user.modelStatus}r.saveError=false;if(!save())r.saveError=true;changed(s)}
 function integrate(scope,s,r,data){
  if(!owned(scope,s,r)||data.requestId!==r.id||data.sessionId!==s.id)throw Error('stale_result');
  if(!['queued','running','succeeded','failed','unknown','partial'].includes(data.status)||typeof data.text!=='string')throw Error('invalid_result');
  const before=JSON.stringify([r.status,r.text,r.error,r.missing]);
  Object.assign(r,{status:data.status,text:data.text,error:data.error||'',missing:false,model:data.model,upstreamCalls:data.upstreamCalls,httpStatus:data.httpStatus,historyMessageCount:data.historyMessageCount,quoteCount:data.quoteCount});
  if(r.status==='succeeded'&&!s.messages.some(m=>m.requestId===r.id&&m.role==='assistant'))s.messages.push({id:r.id+'-answer',role:'assistant',text:r.text,requestId:r.id,model:r.model});
  if(before!==JSON.stringify([r.status,r.text,r.error,r.missing])||r.saveError)store(s,r);
 }
 async function lookup(scope,s,r){
  const res=await fetch('/api/mock-chat/requests/'+r.id,{headers:headers(),signal:AbortSignal.timeout(12000)});
  if(!owned(scope,s,r))return;
  if(res.status===404){Object.assign(r,{status:'unknown',missing:true,error:'服务端尚未查到原请求，请保持同一请求核实'});store(s,r);return}
  if(!res.ok)throw Error('lookup_failed');integrate(scope,s,r,await res.json());
 }
 async function watch(scope,s,r){
  const token={};workers.set(s.id,token);
  try{while(owned(scope,s,r)&&workers.get(s.id)===token){await lookup(scope,s,r);if(!['queued','running'].includes(r.status))break;await new Promise(resolve=>setTimeout(resolve,650))}}
  catch{if(owned(scope,s,r)){Object.assign(r,{status:r.text?'partial':'unknown',error:'暂时无法确认模型结果，请回查原请求'});store(s,r)}}
  finally{if(workers.get(s.id)===token)workers.delete(s.id)}
 }
 async function post(scope,s,r){
  try{
   const res=await fetch('/api/mock-chat/requests/'+r.id,{method:'POST',headers:headers(),body:JSON.stringify(r.payload),signal:AbortSignal.timeout(12000)});
   if(!owned(scope,s,r))return;
   if(!res.ok){if(res.status===409){Object.assign(r,{status:'unknown',error:'原请求内容不一致，请保留原记录核实'});store(s,r);return}if([400,413,415,429].includes(res.status)){Object.assign(r,{status:'failed',error:res.status===429?'模型正在处理其他请求，请稍后再试':'本轮内容无法提交，请保留原文并检查长度'});store(s,r);return}throw Error('post_failed')}
   integrate(scope,s,r,await res.json());
  }catch{if(!owned(scope,s,r))return;Object.assign(r,{status:r.text?'partial':'unknown',error:'请求结果尚未确认，正在回查原请求'});store(s,r)}
  if(owned(scope,s,r))await watch(scope,s,r);
 }
 function send(){
  const scope=getState(),s=session(getUI().session),text=s?.draft?.trim();
  if(!text){if(s?.draftQuotes?.length)toast('请填写追问');return}
  if(getUI().scenario!=='normal'){toast('输入与引用已保留，请先处理当前运行状态');return}
  if(chatBusy(s)){toast('请先查看当前请求结果，输入已保留');return}
  const history=s.messages.map(m=>({role:m.role,text:m.text+(m.modelStatus?'\n[该次模型回复状态：'+m.modelStatus+'，不能视为完成]':''),quotes:(m.quotes||[]).map(safeQuote)}));
  const id=crypto.randomUUID(),payload={requestId:id,clientId:scope.modelClientId||crypto.randomUUID(),sessionId:s.id,history,question:text,quotes:(s.draftQuotes||[]).map(safeQuote)};
  if(history.length>120||history.some(m=>m.text.length>30000)||text.length>20000||JSON.stringify(payload).length>180000){toast('这段会话内容过长，请保留草稿并新建会话整理上下文');return}
  const old={draft:s.draft,quotes:s.draftQuotes,request:s.chatRequest,client:scope.modelClientId};scope.modelClientId=payload.clientId;
  const r={id,status:'prepared',text:'',error:'',payload};s.chatRequest=r;s.messages.push({id:id+'-question',role:'user',text,quotes:structuredClone(s.draftQuotes||[]),requestId:id});s.draft='';s.draftQuotes=[];
  if(!save()){s.messages.pop();Object.assign(s,{draft:old.draft,draftQuotes:old.quotes,chatRequest:old.request});scope.modelClientId=old.client;render();return}
  render();requestAnimationFrame(()=>{const t=document.querySelector('.timeline');if(t)t.scrollTop=t.scrollHeight;document.querySelector('[name=message]')?.focus()});void post(scope,s,r);
 }
 const current=()=>session(getUI().session);
 return {send,resume(){const scope=getState();for(const s of scope.sessions)if(s.chatRequest&&scope.modelClientId&&!workers.has(s.id)&&['prepared','queued','running'].includes(s.chatRequest.status))void watch(scope,s,s.chatRequest)},actions:{
  'chat-lookup':()=>{const s=current();if(s?.chatRequest&&!workers.has(s.id))void watch(getState(),s,s.chatRequest)},
  'chat-retry':()=>{const s=current(),r=s?.chatRequest;if(!r?.missing||workers.has(s.id))return;const before={missing:r.missing,status:r.status};r.missing=false;r.status='prepared';if(!save()){Object.assign(r,before);return}render();void post(getState(),s,r)},
  'chat-save':()=>{const s=current();if(s?.chatRequest){s.chatRequest.saveError=false;if(!save())s.chatRequest.saveError=true;changed(s)}},
  'chat-dismiss':()=>{const s=current(),r=s?.chatRequest;if(!r||!['unknown','partial'].includes(r.status))return;const user=s.messages.find(m=>m.requestId===r.id&&m.role==='user');if(user)user.modelStatus=r.status;if(r.text&&!s.messages.some(m=>m.id===r.id+'-partial'))s.messages.push({id:r.id+'-partial',role:'assistant',text:r.text,requestId:r.id,modelStatus:'partial'});r.closed=true;save();render()},
  'chat-record':async id=>{try{const res=await fetch('/api/mock-chat/requests/'+id,{headers:headers(),signal:AbortSignal.timeout(12000)});if(!res.ok){toast('原请求暂时无法读取');return}const d=await res.json();toast(({succeeded:'回答已完成',failed:'模型请求失败',unknown:'原请求结果未确认',partial:'回答未完整',running:'模型仍在回答',queued:'请求已保存'})[d.status]||'原请求已保留')}catch{toast('原请求暂时无法读取')}},
  'chat-restore':()=>{const s=current(),r=s?.chatRequest;if(r?.status!=='failed')return;if(s.draft?.trim()||s.draftQuotes?.length){toast('当前草稿已有内容，请先保留它');return}s.draft=r.payload.question;s.draftQuotes=structuredClone(s.messages.find(m=>m.requestId===r.id&&m.role==='user')?.quotes||[]);save();render()},
 }};
}
