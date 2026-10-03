#!/usr/bin/env node
// Read-only Agent and public synthetic side conversations. No private state or external sends.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const api=process.env.OPSTWIN_API||'http://127.0.0.1:46110',root=fileURLToPath(new URL('../',import.meta.url));
const out=root+'.local/acceptance/native-chat-state/'+new Date().toISOString().replaceAll(':','-');
const a='ui-side-'+randomUUID(),b='ui-side-'+randomUUID(),run='OPSADV-QA-run-'+randomUUID(),queued='OPSADV-QA-queue-'+randomUUID(),failed='OPSADV-QA-failed-'+randomUUID();
const checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=v=>createHash('sha256').update(String(v||'')).digest('hex');
async function req(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(300000)});let data;try{data=await r.json()}catch{data={}}return{status:r.status,data};}
const states=()=>req('/api/chat/conversations/state?ids='+encodeURIComponent([a,b].join(',')));
function check(name,ok,detail={}){checks.push({name,status:ok?'PASS':'FAIL',...detail});if(!ok)throw new Error(name);}
let original,active;
try{
 original=(await req('/api/conversations/primary')).data.conversationId;
 for(const [id,title] of [[a,'OPSADV-QA 会话 A'],[b,'OPSADV-QA 会话 B']]){const r=await req('/api/conversations/side','POST',{id,title});check('create '+title,[200,201].includes(r.status));}
 const invalid=await req('/api/chat/conversations/state?ids='+encodeURIComponent('../unsafe'));check('state rejects invalid conversation identifiers',invalid.status===400&&invalid.data.error==='invalid_conversation_ids');
 const absent=await req('/api/chat/conversations/state?ids=OPSADV-QA-absent-'+randomUUID());check('absent conversation is explicit locked unknown',absent.status===200&&absent.data.items[0].found===false&&absent.data.items[0].locked===true);
 let state=await states();check('both isolated idle sessions are unlocked',state.status===200&&state.data.items.length===2&&state.data.items.every(x=>x.found&&!x.locked));
 active=req('/api/chat','POST',{conversationId:a,requestId:run,preservePrimary:true,readOnly:true,message:'OPSADV-QA 纯只读验收，不调用任何工具，不读取任何资料，不写入偏好、任务、记录，不外发。请写800到1200字的中文操作指南，讨论草稿、请求回查、多会话与听写取消的具体操作。最后写 QA_STATE_OK。'});
 let running=false;for(let i=0;i<100;i++){const r=await req('/api/chat/requests/'+run);if(r.data.status==='running'){running=true;break}await sleep(100)}check('real Agent request reaches running',running);
 state=await states();check('unselected session A is locked while B remains idle',state.status===200&&state.data.items.find(x=>x.id===a)?.running===true&&state.data.items.find(x=>x.id===a)?.locked===true&&state.data.items.find(x=>x.id===b)?.locked===false);
 const q=await req('/api/chat/continuation','POST',{conversationId:a,requestId:queued,message:'OPSADV-QA 只读队列，请仅回复 QA_QUEUE_OK，不调用工具。',readOnly:true,delivery:'queue'});check('real pending queue accepted',q.status===200&&q.data.status==='queued');
 state=await states();check('aggregate includes pending queue lock',state.data.items.find(x=>x.id===a)?.pending>=1&&state.data.items.find(x=>x.id===a)?.locked===true);
 const cancelled=await req('/api/chat/continuation/'+queued,'DELETE');check('queued cancellation persists',cancelled.status===200&&cancelled.data.status==='cancelled');
 const done=await active;active=undefined;check('original real read-only Agent completes',done.status===200&&done.data.run?.readOnly===true);
 state=await states();check('terminal successful run and cancelled queue release session lock',state.data.items.find(x=>x.id===a)?.locked===false&&state.data.items.find(x=>x.id===a)?.pending===0);
 // Validation happens inside the actual Agent try/catch, before model/tools:
 // an empty attachment ID creates a durable failed request with no writes.
 const bad=await req('/api/chat/continuation','POST',{conversationId:b,requestId:failed,message:'OPSADV-QA 请求验证失败恢复，不调用工具。',readOnly:true,attachmentIds:[''],delivery:'queue'});check('invalid attachment queue durably accepted before Agent validation',bad.status===200);
 let receipt;for(let i=0;i<50;i++){receipt=await req('/api/chat/continuation/receipts/'+failed);if(receipt.data.status==='failed')break;await sleep(200)}check('actual failed queue retains durable failed receipt',receipt.status===200&&receipt.data.status==='failed');
 const status=await req('/api/chat/requests/'+failed);check('failed Agent request is GET-confirmed with no completed writes',status.status===200&&status.data.status==='failed'&&(status.data.completedWrites||[]).length===0);
 state=await states();check('failed pending item protects unselected B from hiding',state.data.items.find(x=>x.id===b)?.pending===1&&state.data.items.find(x=>x.id===b)?.locked===true);
 const removed=await req('/api/chat/continuation/'+failed,'DELETE');check('GET-confirmed failed queue is explicitly removable',removed.status===200&&removed.data.status==='cancelled');
 state=await states();check('confirmed failed removal releases lock without rerun',state.data.items.find(x=>x.id===b)?.locked===false);
 check('all actions preserve service primary pointer',hash((await req('/api/conversations/primary')).data.conversationId)===hash(original));
 await mkdir(out+'/gui-state',{recursive:true});
 await writeFile(out+'/gui-state/chat.json',JSON.stringify({selectedConversation:a,keepPanelVisible:false,conversations:{[a]:{title:'OPSADV-QA 会话 A'},[b]:{title:'OPSADV-QA 会话 B'}},drafts:{[a]:{text:'OPSADV-QA-A 独立草稿，禁止发送',attachments:[]},[b]:{text:'OPSADV-QA-B 独立草稿，禁止发送',attachments:[]}},draft:'OPSADV-QA-A 独立草稿，禁止发送',draftAttachments:[],outgoing:[]},null,2));
 await writeFile(out+'/gui-state/ui.json',JSON.stringify({lastPage:'chat',window:{x:160,y:60,width:1160,height:760,maximized:false}},null,2));
}catch(error){checks.push({name:'journey stopped',status:'FAIL',reason:String(error.message||error).slice(0,180)});if(active)await active.catch(()=>{});}
await mkdir(out,{recursive:true});
const artifact={schema:1,createdAt:new Date().toISOString(),api,sessionIds:[a,b],requestId:run,queueIds:[queued,failed],guiDataDir:out+'/gui-state',primaryPointerHash:hash(original),checks,passed:checks.every(x=>x.status==='PASS'),notRun:['native IME/upload/switch guards','native keyboard menus','native restart/drafts','native docked/narrow layout','hardware microphone cancellation','GET failure and partial protocol injection']};
await writeFile(out+'/result.json',JSON.stringify(artifact,null,2));console.log(JSON.stringify({artifact:out+'/result.json',passed:artifact.passed,checks:checks.length,guiDataDir:artifact.guiDataDir}));process.exitCode=artifact.passed?0:1;
