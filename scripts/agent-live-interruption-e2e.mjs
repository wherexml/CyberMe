// Real model Chat, actual process interruption after a committed write, real restart/readback.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),stamp='agent-live-interruption-'+Date.now(),out=join(root,'output',stamp),data=join(root,'data',stamp),port=Number(process.env.OPSTWIN_QA_API_PORT||46310),base='http://127.0.0.1:'+port;
mkdirSync(out,{recursive:true});mkdirSync(data,{recursive:true});const seed=new DatabaseSync(join(data,'opstwin-advance.db'));seed.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');seed.close();
let server,log='';const proof={stamp,base,isolatedDatabase:true,realModel:true,interruption:'controlled real process SIGKILL after observed tool commit; no injected ledger',externalSends:0};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,method='GET',input,expected=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});const v=await r.json();assert.equal(r.status,expected,JSON.stringify({error:v.error,message:v.message}));return v;}
function launch(){server=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port-10),OPSTWIN_DATA_DIR:data,OPSTWIN_NO_BACKGROUND:'1'},stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);}
async function ready(){for(let i=0;i<100;i++){try{await request('/api/health');return;}catch{await pause(100);}}throw new Error('Server not ready');}
async function stop(signal='SIGTERM'){if(server.exitCode===null){const s=server;const exited=new Promise(r=>s.once('exit',r));s.kill(signal);await exited;}}
try{
 launch();await ready();const conversation=await request('/api/conversations','POST',{title:stamp},201);const input={conversationId:conversation.id,requestId:randomUUID(),message:'请创建本地任务 '+stamp+'-task。创建成功后再读取能力目录和任务列表，保存知识记录 '+stamp+'-memory，正文为 Synthetic interruption QA，然后逐项回读。全部只操作本地，不对外发送。'};
 const submitted=request('/api/chat','POST',input).then(r=>({completed:true,runId:r.run.id}),()=>({connectionInterrupted:true}));let committed;
 for(let i=0;i<240;i++){const runs=await request('/api/runs');committed=runs.find(r=>r.conversationId===conversation.id&&r.status==='running'&&r.tools?.some(t=>t.name==='application_operation_committed'&&t.status==='succeeded'));if(committed)break;await pause(250);}
 assert.ok(committed,'No running real Chat with observed write commit; refusing to claim interruption acceptance');proof.beforeKill={runId:committed.id,status:committed.status,policy:committed.agentPolicy,tools:committed.tools.map(t=>({name:t.name,status:t.status,effect:t.effect,commitState:t.commitState,action:t.input?.action}))};proof.killedAt=new Date().toISOString();await stop('SIGKILL');proof.originalRequest=await submitted;assert.ok(proof.originalRequest.connectionInterrupted);
 launch();await ready();const recovered=await request('/api/runs/'+committed.id);assert.equal(recovered.status,'failed');assert.equal(recovered.error,'server_interrupted');const read=await request('/api/tasks');const owned=read.filter(t=>t.title===stamp+'-task');assert.equal(owned.length,1);const retry=await request('/api/chat','POST',input,409);assert.equal(retry.error,'partial_run_requires_review');const after=await request('/api/tasks');assert.equal(after.filter(t=>t.title===stamp+'-task').length,1);proof.afterRestart={runId:recovered.id,status:recovered.status,error:recovered.error,taskId:owned[0].id,taskCount:1,retryStatus:409,retryError:retry.error,duplicateCount:0};proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}
finally{await stop();writeFileSync(join(out,'server.log'),log);writeFileSync(join(out,'manifest.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,artifact:join(out,'manifest.json'),error:proof.error}));}
