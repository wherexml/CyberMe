// Start the isolated service first. Production agent/API with a controlled local model.
import {writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const base='http://127.0.0.1:46466',out='output/mygo-chat-stop-20261019',checks=[];
async function req(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});return {http:r.status,...await r.json()}}
function check(name,pass){checks.push({name,pass});assert.ok(pass,name)}
const body=id=>({requestId:id,message:id,conversationId:'stop-e2e',mode:'chat',contextIds:[],attachmentIds:[],preservePrimary:true,interruptCurrent:true,readOnly:true});
try{
 for(const [id,status] of [['legacy-stop','cancelled'],['legacy-failure','failed'],['legacy-partial','partial']])check(id,(await req('/api/chat/requests/'+id)).status===status);
 const baseline=(await req('/evidence')).held;const first=body('public-stop-'+Date.now());const pending=req('/api/chat',first);
 for(let i=0;i<100;i++){if((await req('/evidence')).held>baseline)break;await new Promise(r=>setTimeout(r,50))}
 const next=await req('/api/chat',body('public-next-'+Date.now()));const old=await pending;
 check('new message succeeds',next.http===200&&next.run.status==='succeeded');
 const stopped=await req('/api/chat/requests/'+first.requestId);
 check('interrupted request is cancelled',old.error==='chat_interrupted'&&stopped.status==='cancelled');
 const original=await req('/api/runs/'+stopped.runId);check('run records cancellation',original.status==='cancelled'&&original.stopReason==='new_message');
 check('new agent waits for original terminal',Date.parse(next.run.events.find(e=>e.type==='agent_started').at)>=Date.parse(original.completedAt));
 const calls=(await req('/evidence')).calls;check('cancelled request cannot replay',(await req('/api/chat',first)).error==='chat_interrupted');check('replay guard makes no provider call',(await req('/evidence')).calls===calls);
 const fail={...body('public-failure-'+Date.now()),message:'真实失败'};const failed=await req('/api/chat',fail);check('provider error remains failed',failed.http>=400&&(await req('/api/chat/requests/'+fail.requestId)).status==='failed');
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}
await mkdir(out,{recursive:true});await writeFile(out+'/http.json',JSON.stringify({scope:'isolated production HTTP + controlled streaming provider; no private data',checks},null,2));console.log(checks);
