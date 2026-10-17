// Failure inventory (before harness implementation): incompatible SDK; model succeeds without
// SQL effects; readOnly tool escalation; interrupted provider survives/reorders; duplicate
// request replays; failed provider reported as success; restart loses original receipt.
// Real production HTTP + configured real model. Only the failure case uses a local HTTP 503.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createServer as createProbe} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replaceAll(':','-'),scope=join(root,'.local/acceptance/pi-upgrade',stamp),data=join(scope,'data'),out=join(root,'output/pi-upgrade',stamp),port=46460,base=`http://127.0.0.1:${port}`;
for(const p of [port,46461])await new Promise((ok,no)=>{const probe=createProbe();probe.once('error',()=>no(Error('E2E port occupied; no mutation: '+p)));probe.listen(p,'127.0.0.1',()=>probe.close(ok));});
await mkdir(data,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const configSource=process.env.OPSTWIN_QA_CONFIG||join(root,'.local/config.json');
const original=await readFile(configSource);await writeFile(join(scope,'config.json'),original,{mode:0o600});await chmod(scope,0o700);
const seed=new DatabaseSync(join(data,'opstwin-advance.db'));seed.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');seed.close();
const proof={status:'RUNNING',realModel:true,checks:[],externalSends:0,pi:JSON.parse(await readFile(join(root,'node_modules/@earendil-works/pi-coding-agent/package.json'))).version,scope,sourceHash:createHash('sha256').update(await readFile(join(root,'server/src/agent.ts'))).digest('hex')};
let child,upstream,log='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});return {http:r.status,data:await r.json()};}
async function wait(fn){for(let n=0;n<900;n++){if(await fn())return;await sleep(100);}throw Error('condition_timeout');}
function check(name,condition,detail={}){proof.checks.push({name,status:condition?'PASS':'FAIL',...detail});assert.ok(condition,name);}
async function start(){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);await wait(async()=>{try{return (await req('/api/health')).http===200;}catch{return false;}});}
async function stop(){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}}
const payload=(cid,message,extra={})=>({conversationId:cid,requestId:randomUUID(),message,preservePrimary:true,...extra});
try{
 await start();const c=await req('/api/conversations/side',{id:'ui-side-'+randomUUID(),title:'Pi upgrade public E2E'});assert.equal(c.http,201);const cid=c.data.id;
 const title='OPSADV-PI130-'+randomUUID();const p=payload(cid,`请用工具在本地创建且只创建一个任务，标题严格为 ${title}，然后使用工具读取这个任务确认保存。禁止外部发送、连接或其他写入。`);
 const r=await req('/api/chat',p);check('real model completes',r.http===200&&r.data.run?.status==='succeeded',{http:r.http,runId:r.data.run?.id,error:r.data.error});
 const tasks=(await req('/api/tasks')).data.filter(t=>t.title===title);check('real tool creates exactly one durable task',tasks.length===1&&r.data.run.tools.some(t=>t.effect==='write'&&t.status==='succeeded'),{taskIds:tasks.map(t=>t.id),tools:r.data.run.tools.map(t=>({name:t.name,status:t.status}))});
 const replay=await req('/api/chat',p);check('completed request readback no replay',replay.http===200&&replay.data.replayed===true&&replay.data.run.id===r.data.run.id);
 const ro=await req('/api/chat',payload(cid,'只读检查：请读取任务列表，告诉我当前任务数量，不创建或修改任何数据。',{readOnly:true}));check('real read-only tool execution',ro.http===200&&ro.data.run.tools.some(t=>['list_tasks','app_read','list_entities'].includes(t.name)&&t.status==='succeeded')&&!ro.data.run.availableTools.some(n=>['bash','read','write','edit','codemode','tool_search','app_action','create_task'].includes(n)),{runId:ro.data.run?.id,tools:ro.data.run?.availableTools});
 const long=payload(cid,'请直接写一篇至少6000字的中文文章，逐条解释通用任务管理设计，不使用工具，不操作任何数据。',{readOnly:true,interruptCurrent:true});const pending=req('/api/chat',long);
 let old;
 await wait(async()=>{const a=await req('/api/chat/requests/'+long.requestId);if(!a.data.runId)return false;old=(await req('/api/runs/'+a.data.runId)).data;return old.status==='running'&&old.events?.some(e=>e.type==='provider_headers');});
 const next=payload(cid,'只回复：升级打断恢复通过。不要使用工具。',{readOnly:true,interruptCurrent:true});const follow=req('/api/chat',next);const previous=await pending;const fresh=await follow;
 check('real upstream reply interrupted',previous.http===409&&previous.data.error==='chat_interrupted',{oldRunId:old.id,http:previous.http});check('new real model reply succeeds',fresh.http===200&&fresh.data.run?.status==='succeeded',{runId:fresh.data.run?.id});
 const oldRun=(await req('/api/runs/'+old.id)).data;const startedEvent=fresh.data.run.events.find(e=>e.type==='agent_started');check('new agent starts after old terminal',Date.parse(startedEvent.at)>=Date.parse(oldRun.completedAt),{oldCompletedAt:oldRun.completedAt,newStartedAt:startedEvent.at});
 await stop();await start();const saved=await req('/api/chat/requests/'+next.requestId);check('success survives service restart',saved.http===200&&saved.data.status==='succeeded'&&saved.data.runId===fresh.data.run.id);
 await stop();let failureCalls=0;upstream=createServer((q,s)=>{q.resume();failureCalls++;s.writeHead(503,{'content-type':'application/json'});s.end(JSON.stringify({error:{message:'Public upgrade failure fixture',type:'overloaded_error'}}));});await new Promise((r,j)=>{upstream.once('error',j);upstream.listen(46461,'127.0.0.1',r)});
 await writeFile(join(scope,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46461/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-failure-fixture'}}),{mode:0o600});await start();const bad=payload(cid,'公开故障测试，不使用工具。',{readOnly:true});const failed=await req('/api/chat',bad);const receipt=await req('/api/chat/requests/'+bad.requestId);check('HTTP 503 provider gives durable failed receipt',failed.http>=400&&receipt.data.status==='failed'&&failureCalls>0,{http:failed.http,requestId:bad.requestId,runId:receipt.data.runId,providerCalls:failureCalls});
 await stop();await writeFile(join(scope,'config.json'),original,{mode:0o600});await start();const after=await req('/api/chat/requests/'+bad.requestId);check('failed original remains failed after restart',after.data.status==='failed'&&after.data.runId===receipt.data.runId);
 const recovery=await req('/api/chat',payload(cid,'只回复：故障恢复通过。不要使用工具。',{readOnly:true}));check('explicit new request recovers on real provider',recovery.http===200&&recovery.data.run.status==='succeeded',{runId:recovery.data.run?.id});
 const db=new DatabaseSync(join(data,'opstwin-advance.db'),{readOnly:true});check('no send/calendar intents',db.prepare('SELECT COUNT(*) n FROM send_intents').get().n===0&&db.prepare('SELECT COUNT(*) n FROM calendar_intents').get().n===0);db.close();check('main config unchanged',(await readFile(configSource)).equals(original));proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}finally{await stop();if(upstream)await new Promise(r=>upstream.close(r));proof.logHash=createHash('sha256').update(log).digest('hex');await writeFile(join(out,'manifest.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,error:proof.error,artifact:join(out,'manifest.json')}));}
