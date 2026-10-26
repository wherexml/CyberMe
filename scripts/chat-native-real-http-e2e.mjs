// Actual native CLI executions against the isolated acceptance service, with public inputs only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base='http://127.0.0.1:46650',out=resolve(root,'output/chat-native-work-20261023','http-'+Date.now());await mkdir(out,{recursive:true});
const checks=[],ids={};
async function req(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});return {status:r.status,value:await r.json()};}
function check(name,ok){assert.ok(ok,name);checks.push({name,status:'PASS'});console.log(name);}
async function run(engine){
 const cid='ui-side-'+randomUUID(),operationId=randomUUID();ids[engine]={cid,operationId};await writeFile(resolve(out,'ids.json'),JSON.stringify(ids,null,2));
 check(engine+' side conversation created',[200,201].includes((await req('/api/conversations/side',{id:cid,title:engine+' 真实成果验收'})).status));
 const body={operationId,conversationId:cid,engine,access:'full',model:engine==='codex'?'gpt-6.1-sol':'opus',sourceIds:['cw-public-plan','cw-public-discussion'],message:'请仅用所选公开资料生成一份 result.md 评审摘要，正文写出 MINT-7319、PAPER-2846、方案 A/B 的差异和未确定的时间/主持人。请直接写真实文件和成果清单，勿执行测试、构建或读取其他项目文件。'};
 const started=await req('/api/chat/work/native',body);check(engine+' native request persisted',started.status===202&&!!started.value.work?.native?.requestId);ids[engine].workId=started.value.work.id;ids[engine].requestId=started.value.work.native.requestId;
 const replay=await req('/api/chat/work/native',body);check(engine+' duplicate POST preserves task/request',replay.value.replayed&&replay.value.work.id===ids[engine].workId&&replay.value.work.native.requestId===ids[engine].requestId);
 check(engine+' changed duplicate rejected',(await req('/api/chat/work/native',{...body,message:'changed'})).status===409);
 let work;const until=Date.now()+230000;while(Date.now()<until){work=(await req('/api/chat/work/items/'+ids[engine].workId)).value;if(!['queued','running','awaiting_approval','cancelling'].includes(work.status))break;await new Promise(r=>setTimeout(r,900));}
 await writeFile(resolve(out,engine+'-work.json'),JSON.stringify(work,null,2));check(engine+' native finishes with verified file',work.status==='succeeded'&&work.artifacts.length===1&&work.artifacts[0].verified);
 check(engine+' exactly one native dispatch',work.native.receipt.nativeCalls===1&&!!work.native.receipt.nativeSessionId);
 const a=work.artifacts[0],r=await fetch(base+'/files/'+a.id),bytes=Buffer.from(await r.arrayBuffer());check(engine+' download matches registered digest',r.status===200&&createHash('sha256').update(bytes).digest('hex')===a.sha256);check(engine+' selected-source evidence is in real file',bytes.toString().includes('MINT-7319')&&bytes.toString().includes('PAPER-2846'));
 await writeFile(resolve(out,engine+'-result.md'),bytes);const task=(await req('/api/tasks/'+work.task.id)).value;check(engine+' task complete only after file registration',task.completed&&task.artifactIds.includes(a.id));
 const op=(await req('/api/chat/work/operations/'+operationId)).value;check(engine+' original operation recovers same artifact',op.work.artifacts[0].id===a.id&&op.work.native.requestId===ids[engine].requestId);
 const again=(await req('/api/chat/work/items/'+work.id)).value;check(engine+' repeated GET imports no duplicate',again.artifacts.length===1&&again.artifacts[0].id===a.id&&again.native.receipt.nativeCalls===1);
}
const results=await Promise.allSettled(['codex','claude'].map(run));for(let i=0;i<results.length;i++)if(results[i].status==='rejected'){checks.push({name:['codex','claude'][i]+' native flow',status:'FAIL',error:results[i].reason.message});process.exitCode=1;console.error(results[i].reason.message);}
await writeFile(resolve(out,'ids.json'),JSON.stringify(ids,null,2));await writeFile(resolve(out,'result.json'),JSON.stringify({at:new Date().toISOString(),checks},null,2));console.log(out);
