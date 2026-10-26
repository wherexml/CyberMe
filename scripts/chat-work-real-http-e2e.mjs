import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base='http://127.0.0.1:46640',out=resolve(root,'output/chat-work-real-20261023','http-'+Date.now());await mkdir(out,{recursive:true});
const checks=[],ids={proposal:randomUUID(),selection:randomUUID(),conversationId:'chat-work-public-primary'};
await writeFile(resolve(out,'ids.json'),JSON.stringify(ids,null,2));
async function request(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,value:await r.json()};}
function check(name,value){assert.ok(value,name);checks.push({name,status:'PASS'});console.log(name);}
async function poll(path,terminal){const end=Date.now()+180000;while(Date.now()<end){const r=await request(path);if(r.status!==200)throw Error('Read failed '+r.status);if(terminal.includes(r.value.status))return r.value;await new Promise(r=>setTimeout(r,700));}throw Error('Polling timeout');}
try{
 const body={operationId:ids.proposal,conversationId:ids.conversationId,sourceIds:['cw-public-plan','cw-public-discussion'],message:'请对比这两份公开评审资料，先给我不同的整理方向，选定后创建整理任务并生成真实 Markdown 评审文档。未确定的时间和主持人请写待确认。'};
 const started=await request('/api/chat/work/proposals',body);check('Proposal is persisted before model completion',started.status===202&&started.value.panel.status==='preparing');ids.panelId=started.value.panel.id;
 const replay=await request('/api/chat/work/proposals',body);check('Repeated proposal keeps the same panel',replay.value.panel.id===ids.panelId&&replay.value.replayed);
 const conflict=await request('/api/chat/work/proposals',{...body,message:'Different payload'});check('Same operation with changed payload is rejected',conflict.status===409);
 const panel=await poll('/api/chat/work/panels/'+ids.panelId,['ready','failed','retired']);await writeFile(resolve(out,'panel.json'),JSON.stringify(panel,null,2));check('Real model generates at least two source-grounded choices',panel.status==='ready'&&panel.options.length>=2&&panel.options.every(x=>x.sourceIds.length));check('Real Jev evaluation succeeds',panel.jev?.status==='succeeded'&&!!panel.jev.model);
 const selected=panel.options.find(x=>x.recommended)||panel.options[0];const choice={operationId:ids.selection,conversationId:ids.conversationId,revision:panel.revision,optionId:selected.id};
 const wrong=await request('/api/chat/choices/'+ids.panelId+'/select',{...choice,operationId:randomUUID(),conversationId:'other'});check('Choice cannot be consumed from another conversation',wrong.status===409);
 const [a,b]=await Promise.all([request('/api/chat/choices/'+ids.panelId+'/select',choice),request('/api/chat/choices/'+ids.panelId+'/select',choice)]);check('Concurrent duplicate selection returns one work item',a.status===202&&b.status===202&&a.value.work.id===b.value.work.id);ids.workId=a.value.work.id;ids.taskId=a.value.work.task.id;
 const other=await request('/api/chat/choices/'+ids.panelId+'/select',{...choice,operationId:randomUUID()});check('Consumed panel cannot create a second task',other.status===409);
 const work=await poll('/api/chat/work/items/'+ids.workId,['succeeded','failed','cancelled','file_failed','interrupted']);await writeFile(resolve(out,'work.json'),JSON.stringify(work,null,2));check('Document run completes with a verified artifact',work.status==='succeeded'&&work.artifacts.length===1&&work.artifacts[0].verified);
 const file=work.artifacts[0],res=await fetch(base+'/files/'+file.id),bytes=Buffer.from(await res.arrayBuffer());check('Downloaded bytes match the registered SHA-256',res.status===200&&createHash('sha256').update(bytes).digest('hex')===file.sha256);const md=bytes.toString('utf8');check('Document contains actual selected-source evidence',md.includes('MINT-7319')&&md.includes('待确认')&&md.length>200);await writeFile(resolve(out,'generated.md'),bytes);ids.artifactId=file.id;
 const task=await request('/api/tasks/'+ids.taskId);check('Task completion is backed by the actual saved artifact',task.value.completed===true&&task.value.artifactIds?.includes(file.id));
 const op=await request('/api/chat/work/operations/'+ids.selection);check('Original operation resolves to the same task and artifact',op.value.work.task.id===ids.taskId&&op.value.work.artifacts[0].id===file.id);
 const read=await request('/api/chat/work/conversations/'+ids.conversationId);check('Conversation projection includes the persisted result',read.value.works.some(w=>w.id===ids.workId&&w.artifacts[0]?.id===file.id));
}catch(e){checks.push({name:'Real HTTP flow',status:'FAIL',error:e.message});process.exitCode=1;console.error(e.message);}
finally{await writeFile(resolve(out,'ids.json'),JSON.stringify(ids,null,2));await writeFile(resolve(out,'result.json'),JSON.stringify({at:new Date().toISOString(),checks},null,2));console.log(out);}
