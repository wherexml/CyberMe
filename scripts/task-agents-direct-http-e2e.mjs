// Real HTTP/native-CLI journeys. No fake provider, credentials, private history text or unit mocks.
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const scope=join(root,'.local/task-agents-e2e',randomUUID());mkdirSync(scope,{recursive:true,mode:0o700});
const out=join(root,'output/task-agents-direct-20261017');mkdirSync(out,{recursive:true});
const artifact=join(out,'http-'+Date.now()+'.json'),port=46414,base=`http://127.0.0.1:${port}/api/task-agents/`;
const client=randomUUID(),headers={'content-type':'application/json','x-opstwins-client':client,'x-opstwins-agent':'direct'};
const report={scope:scope.slice(root.length+1),checks:[],runs:[],result:'RUNNING',sourceHashes:Object.fromEntries(['server/src/executors/native.ts','server/src/executors/http.ts','server/src/executors/ledger.ts'].map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]))};
const save=()=>writeFileSync(artifact,JSON.stringify(report,null,2)+'\n');save();
let server;const pause=n=>new Promise(r=>setTimeout(r,n));
async function start(){server=spawn(process.execPath,['scripts/opstwins-mock-server.mjs'],{cwd:root,detached:true,env:{...process.env,OPSTWIN_MOCK_PORT:String(port),OPSTWIN_TASK_AGENT_DIR:join(scope,'requests'),OPSTWIN_MOCK_CHAT_DIR:join(scope,'chat')},stdio:['ignore','pipe','pipe']});server.stderr.on('data',()=>{});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('service_start_timeout')),15000);server.stdout.on('data',b=>{if(String(b).includes('OpsTwins product mock')){clearTimeout(t);resolve()}});server.once('exit',()=>{clearTimeout(t);reject(Error('service_exited'))})})}
async function stop(signal='SIGTERM'){if(!server||server.exitCode!==null)return;const processRef=server;process.kill(-processRef.pid,signal);await Promise.race([new Promise(r=>processRef.once('exit',r)),pause(7000)]);if(processRef.exitCode===null){try{process.kill(-processRef.pid,'SIGKILL')}catch{}}}
async function http(path,body,extra={}){const r=await fetch(base+path,{headers:{...headers,...extra},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:r.status,data:await r.json()}}
function check(name,ok,details={}){report.checks.push({name,status:ok?'PASS':'FAIL',...details});save();if(!ok)throw Error(name)}
async function poll(id,predicate=r=>['succeeded','failed','unknown','partial','stopped'].includes(r.status)){for(let n=0;n<210;n++){const r=await http('requests/'+id);if(predicate(r.data))return r.data;await pause(1000)}throw Error('poll_timeout')}
async function submit(engine,prompt,sourceSessionId,access='read-only'){const id=randomUUID(),input={engine,taskId:'public-direct-e2e',access,prompt,...(engine==='claude'?{model:process.env.OPSTWIN_E2E_CLAUDE_MODEL||'claude-opus-5-5'}:{}),...(sourceSessionId?{sourceSessionId}:{})};report.runs.push({engine,requestId:id,sourceSessionId,requestedModel:input.model,access});save();const r=await http('requests/'+id,input);check(engine+'_post_'+report.runs.length,r.status===202);return {id,input}}
try{
 await start();
 const auth=await http('status');report.authentication=auth.data;check('native_auth_both',auth.status===200&&auth.data.executors.every(x=>x.authenticated));
 check('cross_origin_rejected',(await http('status',undefined,{origin:'https://example.com'})).status===403);
 await Promise.all(['codex','claude'].map(async engine=>{
  const list=await http('sessions/'+engine);check(engine+'_history_found',list.status===200&&list.data.sessions.length>0,{count:list.data.sessions.length,hasMore:!!list.data.nextCursor});
  const read=await http('sessions/'+engine+'/'+list.data.sessions[0].id);check(engine+'_existing_history_read',read.status===200&&Array.isArray(read.data.messages),{messageCount:read.data.messages?.length,bounded:read.data.bounded});
 }));
 const seeds=await Promise.all(['codex','claude'].map(async engine=>{
  const marker='OPSTWINS_NATIVE_'+engine.toUpperCase()+'_'+randomUUID().slice(0,8);
  const req=await submit(engine,'Public read-only E2E. Do not use tools or read files. Remember this marker in this conversation and reply with it exactly: '+marker);
  const done=await poll(req.id),item=report.runs.find(x=>x.requestId===req.id);Object.assign(item,{status:done.status,code:done.code,nativeSessionId:done.nativeSessionId,nativeCalls:done.nativeCalls,markerMatched:done.text?.includes(marker),outputHash:createHash('sha256').update(done.text||'').digest('hex')});save();
  check(engine+'_real_model',done.status==='succeeded'&&done.text.includes(marker));
  const replay=await http('requests/'+req.id,req.input);check(engine+'_same_id_no_replay',replay.status===200&&replay.data.nativeSessionId===done.nativeSessionId&&replay.data.nativeCalls===1);
  check(engine+'_conflict',(await http('requests/'+req.id,{...req.input,prompt:req.input.prompt+' different'})).status===409);
  check(engine+'_client_isolation',(await http('requests/'+req.id,undefined,{'x-opstwins-client':randomUUID()})).status===404);
  return {engine,marker,id:done.nativeSessionId};
 }));
 await Promise.all(seeds.map(async seed=>{
  const req=await submit(seed.engine,'Do not use tools. What is the exact public marker I asked you to remember earlier in this conversation? Reply with that marker only.',seed.id);
  const done=await poll(req.id),item=report.runs.find(x=>x.requestId===req.id);Object.assign(item,{status:done.status,code:done.code,nativeSessionId:done.nativeSessionId,contextMarkerMatched:done.text?.includes(seed.marker)});save();
  check(seed.engine+'_native_history_fork',done.status==='succeeded'&&done.nativeSessionId!==seed.id&&done.text.includes(seed.marker));
 }));
 const fileDir=join(out,'public-files-'+randomUUID());mkdirSync(fileDir,{mode:0o700});
 const content='OPSTWINS_PUBLIC_APPROVAL_'+randomUUID();
 for(const decision of ['deny','allow']){
  const file=join(fileDir,decision+'.txt');
  const req=await submit('claude',`This is a public approval E2E. Use only the Write tool, once, to write the exact file ${file} with exactly this content (no newline): ${content}. Do not use Bash or any other tool.`,undefined,'edit');
  const pending=await poll(req.id,r=>r.status==='awaiting_approval'||['succeeded','failed','unknown','partial'].includes(r.status));
  check(decision+'_native_write_approval',pending.status==='awaiting_approval'&&pending.approval?.tool==='Write'&&pending.approval.detail?.file_path===file&&pending.approval.detail?.content===content);
  const approve=await http('requests/'+req.id+'/approvals/'+pending.approval.id,{decision});check(decision+'_approval_receipt',approve.status===200);
  check(decision+'_stale_approval_rejected',(await http('requests/'+req.id+'/approvals/'+pending.approval.id,{decision})).status===409);
  if(decision==='deny')await http('requests/'+req.id+'/stop',{});
  const done=await poll(req.id);check(decision+'_actual_file_boundary',decision==='deny'?!existsSync(file):done.status==='succeeded'&&readFileSync(file,'utf8')===content);
  if(decision==='allow')report.approvedArtifact={path:file.slice(root.length+1),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')};
 }
 const req=await submit('codex','Do not use tools. Explain incremental compilation in 5000 words.');
 await poll(req.id,r=>!!r.nativeSessionId||['failed','unknown','stopped'].includes(r.status));
 check('stop_accepted',(await http('requests/'+req.id+'/stop',{})).status===200);
 const stopped=await poll(req.id);check('owned_run_stopped',stopped.status==='stopped');
 const pending=await submit('codex','Do not use tools. Explain compiler architecture in 10000 words.');
 await poll(pending.id,r=>!!r.nativeSessionId||['failed','unknown'].includes(r.status));
 await stop('SIGKILL');await start();
 const recovered=await http('requests/'+pending.id);check('restart_preserves_unknown',recovered.status===200&&['unknown','partial'].includes(recovered.data.status));
 const noReplay=await http('requests/'+pending.id,pending.input);check('restart_same_id_never_resubmits',noReplay.status===200&&noReplay.data.nativeCalls===1&&noReplay.data.status===recovered.data.status);
 report.result='PASS';
}catch(e){report.result='FAIL';report.failure=e.message;process.exitCode=1}
finally{await stop();report.completedAt=new Date().toISOString();save();console.log(JSON.stringify({result:report.result,artifact,failed:report.failure}))}
