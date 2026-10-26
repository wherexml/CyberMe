// Run prepare, terminate only the isolated service, restart it, then run verify.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base='http://127.0.0.1:46640',dir=resolve(root,'output/chat-work-real-20261023'),pointer=resolve(dir,'restart-current.json');
const db=new DatabaseSync(resolve(root,'.local/chat-work-real-20261023/data/opstwin-advance.db'));
const count=()=>db.prepare("SELECT type,count(*) n FROM entities WHERE type IN ('runs','tasks','artifacts') GROUP BY type ORDER BY type").all();
async function req(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
if(process.argv[2]==='prepare'){
 const out=resolve(dir,'restart-'+Date.now());await mkdir(out,{recursive:true});
 const good=JSON.parse(await readFile(resolve(dir,'browser-1792752104479/work.json'),'utf8'));
 const cid='ui-side-'+randomUUID();assert.ok([200,201].includes((await req('/api/conversations/side',{id:cid,title:'重启恢复公开验收'})).status));
 const operationId=randomUUID(),r=await req('/api/chat/work/proposals',{operationId,conversationId:cid,sourceIds:['cw-public-plan'],message:'请根据所选资料给出整理方向，选择后再生成文档。'});assert.equal(r.status,202);assert.equal(r.body.panel.status,'preparing');
 const state={out,good,operationId,panelId:r.body.panel.id,cid,counts:count()};await writeFile(pointer,JSON.stringify(state,null,2));await writeFile(resolve(out,'before.json'),JSON.stringify(state,null,2));console.log(JSON.stringify({prepared:true,panelId:state.panelId,out}));
}else{
 const s=JSON.parse(await readFile(pointer,'utf8')),checks=[],check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});console.log(name)};
 try{
  const p=await req('/api/chat/work/panels/'+s.panelId);check('Interrupted proposal becomes explicit failed state after restart',p.body.status==='failed'&&p.body.errorCode==='server_interrupted');
  const op=await req('/api/chat/work/operations/'+s.operationId);check('Original operation remains discoverable after restart',op.body.panel.id===s.panelId);
  const work=(await req('/api/chat/work/items/'+s.good.id)).body;check('Completed task and artifact retain the same IDs',work.task.id===s.good.task.id&&work.artifacts[0].id===s.good.artifacts[0].id&&work.artifacts[0].verified);
  const bytes=Buffer.from(await (await fetch(base+'/files/'+work.artifacts[0].id)).arrayBuffer());check('Existing file bytes survive the service restart',createHash('sha256').update(bytes).digest('hex')===s.good.artifacts[0].sha256);
  check('Restart creates no extra runs tasks or artifacts',JSON.stringify(count())===JSON.stringify(s.counts));
 }catch(e){checks.push({name:'Restart recovery',status:'FAIL',error:e.message});process.exitCode=1;console.error(e.message)}
 await writeFile(resolve(s.out,'result.json'),JSON.stringify({checks},null,2));console.log(s.out);
}db.close();
