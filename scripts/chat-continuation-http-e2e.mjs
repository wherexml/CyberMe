import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:46110/api';const marker=`OPSADV-QUEUE-${Date.now()}`;const evidence=[];
async function request(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();return {status:r.status,data};}
const {data:conversation}=await request('/conversations',{title:marker,mode:'chat',status:'active'});
const initial=request('/chat',{conversationId:conversation.id,message:`${marker} 用60个要点解释软件工程，不要调用工具或写数据。`,readOnly:true,requestId:`${marker}-initial`});
for(let i=0;i<100;i++){if((await request(`/chat/continuation/${conversation.id}`)).data.running)break;await new Promise(r=>setTimeout(r,100));}
const payload={conversationId:conversation.id,message:`${marker} cancelled`,delivery:'queue',requestId:`${marker}-cancel`};
const queued=await request('/chat/continuation',payload),replay=await request('/chat/continuation',payload),conflict=await request('/chat/continuation',{...payload,message:'different'}),cancel=await request(`/chat/continuation/${payload.requestId}`,undefined,'DELETE');
assert.equal(queued.data.id,replay.data.id);assert.equal(conflict.status,409);assert.equal(cancel.data.status,'cancelled');
evidence.push({case:'idempotence-conflict-cancel',queued,replay,conflict,cancel});
for(const n of [1,2])assert.equal((await request('/chat/continuation',{...payload,requestId:`${marker}-${n}`,message:`${marker}-${n} 只回复 QUEUE-${n}，不要调用工具。`})).status,200);
const first=await initial;assert.equal(first.status,200);
for(let i=0;i<180;i++){const state=(await request(`/chat/continuation/${conversation.id}`)).data;if(!state.running&&!state.items.length)break;await new Promise(r=>setTimeout(r,1000));}
const state=(await request('/bootstrap')).data;const messages=state.messages.filter(m=>m.conversationId===conversation.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
assert.equal(messages.filter(m=>m.role==='user').length,3);assert.ok(!messages.some(m=>m.content===payload.message));
const firstReply=messages.findIndex(m=>m.content.trim()==='QUEUE-1'&&m.role==='assistant');const secondRequest=messages.findIndex(m=>m.content.includes(`${marker}-2`)&&m.role==='user');assert.ok(firstReply>=0&&secondRequest>firstReply);assert.ok(messages.some(m=>m.role==='assistant'&&m.content.trim()==='QUEUE-2'));
evidence.push({case:'FIFO-and-cancel-no-execution',messages});
await request('/chat/continuation',{...payload,requestId:`${marker}-failure`,message:'读取附件',attachmentIds:['missing-e2e-attachment']});
let failed;for(let i=0;i<30;i++){failed=(await request(`/chat/continuation/${conversation.id}`)).data.items.find(q=>q.id===`${marker}-failure`);if(failed?.status==='failed')break;await new Promise(r=>setTimeout(r,500));}assert.equal(failed.status,'failed');evidence.push({case:'failed-message-retained',failed});
await request(`/chat/continuation/${marker}-failure`,undefined,'DELETE');
await fs.writeFile('output/chat-continuation/http-result.json',JSON.stringify({result:'PASS',marker,conversationId:conversation.id,evidence},null,2));console.log({result:'PASS',marker});
