#!/usr/bin/env node
// Real running Agent/continuation journey. No external sends or private data.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const api=process.env.OPSTWIN_API||'http://127.0.0.1:46110',root=fileURLToPath(new URL('../',import.meta.url));
const out=root+'.local/acceptance/native-chat-continuation/'+new Date().toISOString().replaceAll(':','-');
const session='ui-side-'+randomUUID(),request='native-run-'+randomUUID(),q1='native-qedit-'+randomUUID(),q2='native-qfinal-'+randomUUID(),steer='native-steer-'+randomUUID(),checks=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),fingerprint=v=>createHash('sha256').update(String(v||'')).digest('hex');
async function req(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(300000)});let data;try{data=await r.json()}catch{data={}}return {status:r.status,data};}
function check(name,ok,detail={}){checks.push({name,status:ok?'PASS':'FAIL',...detail});if(!ok)throw new Error(name);}
let original,active;
try {
 original=(await req('/api/conversations/primary')).data.conversationId;
 const created=await req('/api/conversations/side','POST',{id:session,title:'原生连续输入验收 '+request.slice(-8)});check('create isolated real continuation conversation',[200,201].includes(created.status));
 const invalid=await req('/api/chat/continuation','POST',{conversationId:session,requestId:'invalid-'+randomUUID(),message:'仅协议校验',delivery:'queue',readOnly:'true'});check('readOnly requires a boolean before delivery',invalid.status===400&&invalid.data.error==='invalid_read_only');
 const absent=await req('/api/chat/continuation/receipts/'+q1);check('unexecuted continuation receipt is explicit 404',absent.status===404&&absent.data.error==='not_found');
 active=req('/api/chat','POST',{conversationId:session,requestId:request,message:'这是纯只读产品验收。不调用任何工具，不读取文件、不创建任务或记录、不外发。请写一份800到1200字的中文产品验收指南，分五段讨论草稿保护、请求幂等、失败回查、时间标签、连续输入，给出每段具体例子。最后写 NATIVE_RUN_OK。',readOnly:true,preservePrimary:true});
 let running=false;
 for(let i=0;i<80;i++){const state=await req('/api/chat/requests/'+request);if(state.data.status==='running'){running=true;break;}await sleep(100);}
 check('GET observes real Agent running before continuation',running);
 const firstPayload={conversationId:session,requestId:q1,message:'这是只读队列验收，只回复 QUEUE_ORIGINAL_OK。不要调用工具或外发。',readOnly:true,delivery:'queue'};
 const first=await req('/api/chat/continuation','POST',firstPayload);check('queue persists during real Agent run',first.status===200&&first.data.status==='queued'&&first.data.id===q1,{requestId:q1});
 const queuedReceipt=await req('/api/chat/continuation/receipts/'+q1);check('queue has durable request receipt before execution',queuedReceipt.status===200&&queuedReceipt.data.id===q1&&queuedReceipt.data.fingerprint===first.data.fingerprint);
 const state=await req('/api/chat/continuation/'+session);check('GET active queue uses same conversation and request fingerprint',state.status===200&&state.data.running===true&&state.data.items.some(x=>x.id===q1&&x.conversationId===session&&x.fingerprint===first.data.fingerprint));
 const text='这是只读队列编辑验收，只回复 QUEUE_EDITED_OK。不要调用工具或外发。';
 const edited=await req('/api/chat/continuation/'+q1,'PATCH',{action:'edit',message:text,updatedAt:first.data.updatedAt});check('edit queued message before execution',edited.status===200&&edited.data.message===text&&edited.data.id===q1);
 const stale=await req('/api/chat/continuation/'+q1,'PATCH',{action:'edit',message:'仅只读的过期编辑',updatedAt:first.data.updatedAt});check('stale queue edit rejects 409 and preserves current draft',stale.status===409&&stale.data.error==='queue_changed');
 const replay=await req('/api/chat/continuation','POST',firstPayload);check('original continuation request replay retains saved edited row',replay.status===200&&replay.data.id===q1&&replay.data.message===text&&replay.data.fingerprint===first.data.fingerprint);
 const cancelled=await req('/api/chat/continuation/'+q1,'DELETE');check('queued message cancellation persists before execution',cancelled.status===200&&cancelled.data.status==='cancelled');
 const cancelledReceipt=await req('/api/chat/continuation/receipts/'+q1);check('cancelled terminal receipt remains readable',cancelledReceipt.status===200&&cancelledReceipt.data.status==='cancelled'&&cancelledReceipt.data.id===q1);
 const second=await req('/api/chat/continuation','POST',{conversationId:session,requestId:q2,message:'这是只读队列验收，只回复 QUEUE_FINAL_OK，不调用工具，不读取或写入资料，不外发。',readOnly:true,delivery:'queue'});check('second queue is pending behind real run',second.status===200&&second.data.status==='queued',{requestId:q2});
 const steered=await req('/api/chat/continuation','POST',{conversationId:session,requestId:steer,message:'补充只读要求：不要调用工具或进行任何写入、外发；原验收指南最后额外标记 STEER_OK。',readOnly:true,delivery:'steer'});
 check('real steering request is durably accepted',steered.status===200&&['inserted','queued'].includes(steered.data.status),{deliveryStatus:steered.data.status});
 const steerReplay=await req('/api/chat/continuation','POST',{conversationId:session,requestId:steer,message:'补充只读要求：不要调用工具或进行任何写入、外发；原验收指南最后额外标记 STEER_OK。',readOnly:true,delivery:'steer'});check('steering replay does not reinsert or change fingerprint',steerReplay.status===200&&steerReplay.data.id===steer&&steerReplay.data.fingerprint===steered.data.fingerprint);
 if(steered.data.status!=='inserted'){checks.push({name:'insertion into current engine',status:'BLOCKED',reason:'Real engine returned queued fallback'});await req('/api/chat/continuation/'+steer,'DELETE');}
 const insertedReceipt=await req('/api/chat/continuation/receipts/'+steer);check('steering durable receipt remains readable after delivery',insertedReceipt.status===200&&insertedReceipt.data.id===steer&&insertedReceipt.data.fingerprint===steered.data.fingerprint&&insertedReceipt.data.status===steered.data.status);
 const completed=await active;check('original real Agent reaches successful terminal receipt',completed.status===200&&completed.data.conversationId===session);
 let final;
 for(let i=0;i<180;i++){final=await req('/api/chat/requests/'+q2);if(['succeeded','partial','failed'].includes(final.data.status))break;await sleep(500);}
 check('queued message is consumed into actual same-session Agent run',final.status===200&&final.data.status==='succeeded'&&final.data.conversationId===session&&final.data.result?.assistantMessage?.content?.includes('QUEUE_FINAL_OK'));
 check('queued real Agent has readOnly capability and no write tools',final.data.result?.run?.readOnly===true&&Array.isArray(final.data.result?.run?.availableTools)&&!final.data.result.run.availableTools.some(name=>['app_action','write_record','send_message','update_record','delete_record'].includes(name)));
 const completeReceipt=await req('/api/chat/continuation/receipts/'+q2);check('successful terminal queue receipt remains readable',completeReceipt.status===200&&completeReceipt.data.status==='succeeded'&&completeReceipt.data.id===q2);
 const messages=await req('/api/conversations/'+session+'/messages?limit=100');check('cancelled queue never reaches chat history',messages.status===200&&!messages.data.items.some(m=>m.requestId===q1));
 check('queue and steering keep primary conversation pointer',fingerprint((await req('/api/conversations/primary')).data.conversationId)===fingerprint(original));
} catch(error){checks.push({name:'journey stopped',status:'FAIL',reason:String(error.message||error).slice(0,180)});if(active)await active.catch(()=>{});}
await mkdir(out,{recursive:true});
const artifact={schema:1,createdAt:new Date().toISOString(),api,sessionId:session,requestId:request,queueIds:[q1,q2],steerId:steer,primaryPointerHash:fingerprint(original),checks,passed:checks.every(x=>x.status==='PASS'),notRun:['native UI queue edit failure','native speech hardware','native restart','unknown/partial fault injection']};
await writeFile(out+'/result.json',JSON.stringify(artifact,null,2));console.log(JSON.stringify({artifact:out+'/result.json',passed:artifact.passed,checks:checks.length}));process.exitCode=artifact.passed?0:1;
