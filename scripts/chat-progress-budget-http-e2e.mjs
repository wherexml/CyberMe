// Durable queued chat progress budget: real HTTP/SDK/SQLite/run_command journey against a freshly spawned
// scripts/chat-progress-budget-fixture.mjs (scaled budgets: idle 2s, hard 20s unless a case lowers it).
//   node scripts/chat-progress-budget-http-e2e.mjs
// Env: PROGRESS_API_PORT (47561), PROGRESS_MODEL_PORT (47562), PROGRESS_OUT (absolute evidence directory).
// Evidence: <out>/http-<time>/result.json (ignored output). Failed checks are recorded, then the process exits nonzero.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const port=Number(process.env.PROGRESS_API_PORT||47561),modelPort=Number(process.env.PROGRESS_MODEL_PORT||47562),base=`http://127.0.0.1:${port}`;
const OUT=(process.env.PROGRESS_OUT||'/Users/steve/Projects/cyberme/output/chat-phase-watchdog-20261113')+'/http-'+new Date().toISOString().replace(/[:.]/g,'-');
await mkdir(OUT,{recursive:true});
const scope=resolve('.local/acceptance/chat-progress-budget-'+randomUUID());
// SCALED CLOCK (fixture env): legacy answer budget 2s; durable headers 2s, first content 2s, stream silence 1.5s,
// tool grace 1s, tool fallback 4s, hard cap 20s unless a case lowers it.
const IDLE=2000,HEAD=2000,FIRST=2000,SILENCE=1500,EVIDENCE='请实际在公开隔离目录运行合成步骤脚本并回读标记';
const checks=[];let failed=false;
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(pass?{}:{detail})});console.log((pass?'PASS ':'FAIL ')+name+(pass?'':' '+JSON.stringify(detail??null).slice(0,600)));if(!pass)failed=true;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

let child;
async function startFixture(){
 child=spawn(process.execPath,['--import','tsx','scripts/chat-progress-budget-fixture.mjs'],{cwd:resolve('.'),stdio:['ignore','ignore','inherit'],env:{...process.env,PROGRESS_SCOPE:scope,PROGRESS_API_PORT:String(port),PROGRESS_MODEL_PORT:String(modelPort)}});
 for(let i=0;i<300;i++){try{if((await fetch(base+'/fixture/state')).ok)return}catch{}await sleep(100)}throw Error('fixture did not start');
}
async function stopFixture(signal='SIGTERM'){if(!child)return;child.kill(signal);for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);child=undefined;await sleep(300)}
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});return {status:r.status,data:await r.json().catch(()=>({}))}};
const env=b=>api('POST','/fixture/env',b),envReset=()=>api('POST','/fixture/env/reset');
const state=async()=>(await api('GET','/fixture/state')).data;
const markers=async id=>(await api('GET','/fixture/markers/'+id)).data.lines;
const conv=async title=>(await api('POST','/api/conversations',{title,mode:'chat',status:'active'})).data.id;
const msg=(kind,id)=>`/skill:progress-demo ${EVIDENCE} #${kind}:${id}`;
const queued=(conversationId,message,extra={})=>api('POST','/api/chat',{conversationId,message,mode:'chat',requestId:extra.requestId||randomUUID(),queueCurrent:true,preservePrimary:true,...extra});
const request=async id=>(await api('GET','/api/chat/requests/'+id)).data;
const runOf=async id=>(await api('GET','/api/runs/'+id)).data;
const terminal=async(id,timeout=60000)=>{const end=Date.now()+timeout;for(;;){const r=await request(id);if(r.status&&!['queued','running','prepared'].includes(r.status))return r;if(Date.now()>end)throw Error('request did not settle '+id);await sleep(200)}};
const timeoutEvent=run=>[...(run.events||[])].reverse().find(e=>e.type==='timeout');
const ans=run=>run.timeBudget?.answer||{};
const tools=(run,name)=>(run.tools||[]).filter(t=>t.name===name);
const startsOf=lines=>lines.filter(l=>l.startsWith('start ')),endsOf=lines=>lines.filter(l=>l.startsWith('end '));
const writesOf=t=>Array.isArray(t.completedWrites)?t.completedWrites.length:0;
// index.ts keeps a request partial whenever the stopped run left write receipts (arbitrary commands are conservatively
// writes/unknown); only a stop with no write receipt yields a cancelled request.
const stopOutcome=(t,run,code)=>writesOf(t)>0?t.status==='partial'&&t.failureCode===code:t.status==='cancelled'&&!tools(run,'run_command').some(x=>x.status==='succeeded');
const pidAlive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const dbRows=(runId,requestId)=>{const db=new DatabaseSync(scope+'/opstwin-advance.db',{readOnly:true});try{return JSON.stringify({run:db.prepare("SELECT * FROM entities WHERE type='runs' AND id=?").get(runId),req:db.prepare('SELECT * FROM chat_requests WHERE id=?').get(requestId),ops:db.prepare("SELECT type,id,data FROM entities WHERE type IN ('command_operations','agent_operations') ORDER BY type,id").all()})}finally{db.close()}};
const caseRun=async(name,fn)=>{try{await envReset();await fn()}catch(e){check(name+' (case completed)',false,String(e?.stack||e))}};

const result={base,scope,scaledClock:{legacyAnswerMs:IDLE,headersMs:HEAD,firstContentMs:FIRST,streamSilenceMs:SILENCE,toolGraceMs:1000,toolFallbackMs:4000},checks,boundary:'Production server app (HTTP, Pi SDK persistent session, SQLite, real run_command child processes) with a controlled SSE provider and scaled budgets. Not real-model or installed-app evidence.'};
try{
 await startFixture();

 await caseRun('replay',async()=>{
  // The reported shape, scaled: slow read ~0.9 idle, six commands, several provider rounds, final stream; total > 3 idle.
  await env({CYBERME_CHAT_DURABLE_MAX_PROVIDER_REQUESTS:'100'});
  const id='replay'+Date.now().toString(36),c=await conv('replay'),rid=randomUUID();
  const r=await queued(c,msg('replay',id),{requestId:rid});check('queued chat returns 202',r.status===202,r);
  const t=await terminal(rid);const run=await runOf(t.runId);const lines=await markers(id);
  check('scaled replay succeeds past the old answer timer',t.status==='succeeded'&&ans(run).elapsedMs>3*IDLE,{status:t.status,elapsed:ans(run).elapsedMs,failureCode:t.failureCode});
  check('replay ended by completion in progress mode',ans(run).mode==='progress'&&ans(run).endedBy==='completed'&&ans(run).progressEvents>0,ans(run));
  check('env cannot raise the provider ceiling above 60',ans(run).maxProviderRequests===60,ans(run).maxProviderRequests);
  check('each step ran exactly once',startsOf(lines).length===7&&endsOf(lines).length===7&&new Set(startsOf(lines).map(l=>l.split(' ')[1])).size===7,lines);
  check('seven successful run_command receipts',tools(run,'run_command').filter(x=>x.status==='succeeded').length===7,tools(run,'run_command').map(x=>x.status));
  check('no timeout event on success',!timeoutEvent(run));
  check('phase audit recorded once with counters',ans(run).watchdog==='phase'&&ans(run).toolCalls===7&&ans(run).steps>=8&&ans(run).phases?.headersMs===HEAD&&ans(run).idleMs===null,ans(run));
 });

 await caseRun('legacy synchronous baseline and historical mapping',async()=>{
  // Fast steps complete real writes before the single 2s answer timer fires, so the production protection applies.
  const id='legacy'+Date.now().toString(36),c=await conv('legacy'),rid=randomUUID();
  const r=await api('POST','/api/chat',{conversationId:c,message:msg('loop',id),mode:'chat',requestId:rid});
  check('synchronous timeout after writes keeps the protective 409 partial_run_requires_review',r.status===409&&JSON.stringify(r.data).includes('partial_run_requires_review'),{status:r.status,data:JSON.stringify(r.data).slice(0,300)});
  const t=await terminal(rid);const run=await runOf(t.runId);const ev=timeoutEvent(run);
  check('legacy request is a partial receipt with completed writes',t.status==='partial'&&Array.isArray(t.completedWrites)&&t.completedWrites.length>0,t);
  check('legacy timeout recorded as the single whole-answer budget',ev?.budget==='answer'&&!ans(run).mode&&ans(run).status==='timed_out'&&ans(run).budgetMs===IDLE,{ev,answer:ans(run)});
  check('legacy timeout after tool work maps to processing_deadline at read time',t.failureCode==='processing_deadline',t);
  const before=dbRows(t.runId,rid);await request(rid);await request(rid);const after=dbRows(t.runId,rid);
  check('GET-only mapping leaves run, request and operation rows byte-identical',before===after);
  result.legacyRequest={requestId:rid,conversationId:c,runId:t.runId,status:t.status};
 });

 await caseRun('header stall',async()=>{
  const id='hdr'+Date.now().toString(36),c=await conv('hdr'),rid=randomUUID();await queued(c,msg('hdrstall',id),{requestId:rid});
  const t=await terminal(rid);const run=await runOf(t.runId);const ev=timeoutEvent(run);const st=await state();const last=st.provider.filter(p=>p.id===id).at(-1);
  check('provider header stall ends at the headers window as model_timeout',ev?.budget==='headers'&&ev.phase==='awaiting_headers'&&t.failureCode==='model_timeout',{ev,t});
  check('header stall bounded by one headers window per step',ans(run).elapsedMs<HEAD*2+2500,ans(run));
  check('stalled provider request was aborted',last&&last.closed&&!last.headers,last);
 });

 await caseRun('stream stall',async()=>{
  // An endless but VALID stream is live, not idle: it outlives every phase window and only the hard cap ends it.
  await env({CYBERME_CHAT_DURABLE_HARD_CAP_MS:'5000'});
  const id='str'+Date.now().toString(36),c=await conv('str'),rid=randomUUID();await queued(c,msg('streamstall',id),{requestId:rid});
  const t=await terminal(rid);const run=await runOf(t.runId);const ev=timeoutEvent(run);
  check('endless valid stream is bounded only by the hard cap',ev?.budget==='hard'&&ans(run).endedBy==='hard'&&ans(run).elapsedMs>=4500&&ans(run).elapsedMs<7000&&t.failureCode==='processing_deadline',{ev,t,answer:ans(run)});
 });

 await caseRun('tool stall',async()=>{
  // run_command keeps its own 60s executor limit (+grace): no model/phase window cuts it; the hard cap still bounds it.
  await env({CYBERME_CHAT_DURABLE_HARD_CAP_MS:'5000'});
  const id='tool'+Date.now().toString(36),c=await conv('tool'),rid=randomUUID();await queued(c,msg('toolstall',id),{requestId:rid});
  const t=await terminal(rid);const run=await runOf(t.runId);const ev=timeoutEvent(run);
  check('running tool is not cut by a model window; hard cap ends it as processing',ev?.budget==='hard'&&ev.phase==='tool'&&t.failureCode==='processing_deadline'&&ans(run).elapsedMs>=4500,{ev,t,answer:ans(run)});
  await sleep(3000);const lines=await markers(id);const pid=Number(startsOf(lines)[0]?.split(' ')[2]);
  check('stalled command process actually terminated, no end marker',startsOf(lines).length===1&&!endsOf(lines).length&&pid>0&&!pidAlive(pid),{lines,pid});
  check('stalled command is not reported as completed',!tools(run,'run_command').some(x=>x.status==='succeeded'),tools(run,'run_command').map(x=>x.status));
 });

 const ok=async(kind,title,extra)=>{const id=kind+Date.now().toString(36),c=await conv(kind),rid=randomUUID();await queued(c,msg(kind,id),{requestId:rid});const t=await terminal(rid);const run=await runOf(t.runId);return {id,c,rid,t,run,a:ans(run),ev:timeoutEvent(run),seen:(await state()).provider.filter(p=>p.id===id)}};
 await caseRun('long valid text stream',async()=>{const r=await ok('longstream');
  check('8s text stream outlives old 2s idle and 1.5s silence windows',r.t.status==='succeeded'&&r.a.elapsedMs>3*IDLE&&r.a.deltas>=15&&!r.ev,{status:r.t.status,answer:r.a});});
 await caseRun('long reasoning stream',async()=>{const r=await ok('longthink');
  check('8s reasoning (thinking_delta) stream counts as liveness',r.t.status==='succeeded'&&r.a.elapsedMs>3*IDLE&&!r.ev,{status:r.t.status,answer:r.a,ev:r.ev});});
 await caseRun('long tool-argument stream',async()=>{const r=await ok('longargs');const lines=await markers(r.id);
  check('8s streamed tool arguments count as liveness and the tool runs once',r.t.status==='succeeded'&&!r.ev&&startsOf(lines).length===1&&endsOf(lines).length===1,{status:r.t.status,answer:r.a,lines});});
 await caseRun('first-content stall with keepalives',async()=>{const r=await ok('firststall');
  check('200 + SSE keepalives without content ends at first-content window',r.ev?.budget==='first_content'&&r.t.failureCode==='model_timeout'&&r.a.elapsedMs<FIRST+2500,{ev:r.ev,t:r.t,answer:r.a});});
 await caseRun('empty frames',async()=>{const r=await ok('emptyframes');
  check('empty deltas never count as content',r.ev?.budget==='first_content'&&r.a.deltas===0&&r.a.elapsedMs<FIRST+2500,{ev:r.ev,answer:r.a});});
 await caseRun('post-content silence',async()=>{const r=await ok('silence');
  check('content then pings only ends at stream silence',r.ev?.budget==='stream_silence'&&r.t.failureCode==='model_timeout'&&r.a.elapsedMs<SILENCE+FIRST+2500,{ev:r.ev,answer:r.a});});
 await caseRun('late-start tool',async()=>{const r=await ok('latetool');const lines=await markers(r.id);
  check('tool started near a headers deadline gets its own full allowance',r.t.status==='succeeded'&&!r.ev&&endsOf(lines).length===1,{status:r.t.status,ev:r.ev,lines});});
 await caseRun('overlapping tools',async()=>{const r=await ok('parallel');const lines=await markers(r.id);
  check('both overlapping tools finish separately; first end does not cut the other',r.t.status==='succeeded'&&endsOf(lines).length===2&&tools(r.run,'run_command').filter(x=>x.status==='succeeded').length===2&&r.a.toolCalls===2,{status:r.t.status,lines,answer:r.a});
  result.parallelObserved=r.a.maxParallelTools;});
 await caseRun('finite SDK retry',async()=>{const r=await ok('retry');
  check('one SDK retry after a 500 succeeds with exactly two provider requests',r.t.status==='succeeded'&&r.seen.length===2&&r.a.retries===1,{status:r.t.status,seen:r.seen.length,answer:r.a});});
 await caseRun('retry exhausted',async()=>{const r=await ok('retryfail');
  check('persistent 500 stops after the bounded retry chain (2 requests)',r.t.status==='failed'&&r.seen.length===2,{status:r.t.status,seen:r.seen.length,ev:r.ev});});
 await caseRun('repeated identical tool errors',async()=>{const r=await ok('repeaterr');
  // Round 3: a missing cwd is rejected BEFORE any process starts (run_command_rejected), so there are no run_command
  // execution receipts to count; the stop must come from 3 identical rejections with no effect.
  const lines=await markers(r.id);
  check('identical tool+args+error 3 times stops as no_progress (processing)',r.ev?.budget==='no_progress'&&r.t.failureCode==='processing_deadline'&&r.seen.length===3,{ev:r.ev,t:r.t,seen:r.seen.length});
  check('exactly 3 rejections, counted as tool errors and calls',tools(r.run,'run_command_rejected').length===3&&r.a.toolErrors===3&&r.a.toolCalls===3,{rejected:tools(r.run,'run_command_rejected').length,answer:r.a});
  check('rejected commands never started a process or left an effect',!tools(r.run,'command_started').length&&!lines.length,{started:tools(r.run,'command_started').length,lines});});
 await caseRun('successful read with a business code field',async()=>{const r=await ok('getentity');
  check('identical successful get_entity reads (entity has code) are progress, not errors',r.t.status==='succeeded'&&!r.ev&&r.a.toolErrors===0&&r.a.progressEvents>=3&&tools(r.run,'get_entity').length===3,{status:r.t.status,ev:r.ev,answer:r.a});});
 await caseRun('structured wrapper errors',async()=>{const r=await ok('structerr');
  check('identical {error,code} results stop as no_progress after exactly 3 calls',r.ev?.budget==='no_progress'&&r.t.failureCode==='processing_deadline'&&r.a.toolErrors===3&&r.seen.length===3,{ev:r.ev,t:r.t,answer:r.a,seen:r.seen.length});});
 await caseRun('nonzero command receipts',async()=>{const r=await ok('cmdfail');
  // Round 3: the identical operationId replays the ONE failed receipt (no re-execution). progressEvents also counts
  // successful assistant tool-call messages, so it is bounded by model requests rather than zero.
  check('three failed command returns stop as no_progress',r.ev?.budget==='no_progress'&&r.t.failureCode==='processing_deadline'&&r.a.toolErrors===3&&r.a.toolCalls===3&&r.seen.length===3,{ev:r.ev,answer:r.a,seen:r.seen.length});
  check('exactly ONE real failed command execution; identical operationId replayed without executing again',tools(r.run,'command_started').length===1,tools(r.run,'command_started').map(x=>({status:x.status,commitState:x.commitState})));
  check('failed command returns are not counted as successful tool results',!tools(r.run,'run_command').some(x=>x.status==='succeeded')&&r.a.progressEvents<=r.seen.length,{receipts:tools(r.run,'run_command').map(x=>x.status),progressEvents:r.a.progressEvents,modelRequests:r.seen.length});});
 await caseRun('unknown command receipt',async()=>{const r=await ok('cmdunknown');const lines=await markers(r.id);
  check('executor-timeout run_command yields one unknown receipt counted as an error',r.a.toolErrors===1&&tools(r.run,'command_started').length===1&&tools(r.run,'command_started')[0].commitState==='unknown'&&startsOf(lines).length===1&&!endsOf(lines).length,{answer:r.a,lines,started:tools(r.run,'command_started').map(x=>({status:x.status,commitState:x.commitState}))});
  check('business taskOutcome is not succeeded while the operation is unknown',r.run.taskOutcome?.status&&r.run.taskOutcome.status!=='succeeded',r.run.taskOutcome);
  await sleep(3500);const later=await markers(r.id),pid=Number(startsOf(later)[0]?.split(' ')[2]);
  check('unknown command was not completed or replayed later, and its process is gone',startsOf(later).length===1&&!endsOf(later).length&&pid>0&&!pidAlive(pid),{later,pid});
  // Round 3: after an honest final reply the existing route (index.ts) stores the CHAT request as succeeded even though
  // run.taskOutcome is pending/not_executed. Prove that this is the unchanged route contract with the legacy synchronous path.
  const sid='cmdunknownsync'+Date.now().toString(36),sc=await conv('cmdunknown-sync'),srid=randomUUID();
  const sync=await api('POST','/api/chat',{conversationId:sc,message:msg('cmdunknown',sid),mode:'chat',requestId:srid});
  const st=await terminal(srid),srun=await runOf(st.runId);
  check('durable request status matches the unchanged synchronous route contract',sync.status===200&&st.status===r.t.status&&srun.taskOutcome?.status===r.run.taskOutcome?.status,{durable:r.t.status,sync:{http:sync.status,status:st.status},taskOutcome:{durable:r.run.taskOutcome?.status,sync:srun.taskOutcome?.status}});
  check('synchronous baseline keeps the same protective unknown receipt',tools(srun,'command_started').length===1&&tools(srun,'command_started')[0].commitState==='unknown',tools(srun,'command_started').map(x=>x.commitState));
  // Same-ID reply replay must not start another command or model call.
  const seenBefore=(await state()).provider.filter(p=>p.id===r.id).length,startsBefore=startsOf(await markers(r.id)).length;
  const again=await queued(r.c,msg('cmdunknown',r.id),{requestId:r.rid});await sleep(2000);
  check('same-ID replay starts no command and no model call',(await state()).provider.filter(p=>p.id===r.id).length===seenBefore&&startsOf(await markers(r.id)).length===startsBefore&&(await request(r.rid)).status===r.t.status,{again:again.status,again_data:JSON.stringify(again.data).slice(0,200)});});
 await caseRun('fallback for a tool without an own limit',async()=>{
  // Production app_read connection_read against a delayed local REST endpoint (inner 12s fetch, no watchdog-known own
  // limit). Fallback lowered to 500ms; the endpoint answers after 2s. The read ignores abort, so the run must WAIT for the
  // real settlement and must not dispatch anything afterwards.
  await env({CYBERME_CHAT_TOOL_FALLBACK_MS:'500',PROGRESS_SLOW_MS:'2000'});const before=(await state()).slow;
  const r=await ok('fallback');const after=(await state()).slow;
  check('tool over its fallback ends as tool timeout (processing)',r.ev?.budget==='tool'&&r.ev?.toolName==='app_read'&&r.t.failureCode==='processing_deadline'&&r.t.status!=='succeeded',{ev:r.ev,t:r.t});
  check('the abort-insensitive read settled before the request became terminal (no premature terminal state)',after.hits===before.hits+1&&after.completed===before.completed+1,{before,after,answerElapsedMs:r.a.elapsedMs});
  check('no model request after the tool timeout',r.seen.length===1,r.seen.length);});

 await caseRun('next request on the same SDK session',async()=>{
  const c=await conv('next'),id1='nx1'+Date.now().toString(36),id2='nx2'+Date.now().toString(36),r1=randomUUID(),r2=randomUUID();
  await queued(c,msg('replay',id1),{requestId:r1});const t1=await terminal(r1);await queued(c,msg('longstream',id2),{requestId:r2});const t2=await terminal(r2);
  const a2=ans(await runOf(t2.runId));
  check('next request gets a fresh watchdog (no stale timer/state from the previous one)',t1.status==='succeeded'&&t2.status==='succeeded'&&a2.toolCalls===0&&a2.steps>=1&&!timeoutEvent(await runOf(t2.runId)),{t1:t1.status,t2:t2.status,a2});});

 await caseRun('hard cap with endless fast progress',async()=>{
  await env({CYBERME_CHAT_DURABLE_HARD_CAP_MS:'5000',CYBERME_CHAT_DURABLE_MAX_PROVIDER_REQUESTS:'60'});
  const id='loop'+Date.now().toString(36),c=await conv('loop'),rid=randomUUID();await queued(c,msg('loop',id),{requestId:rid});
  const t=await terminal(rid);const run=await runOf(t.runId);
  check('endless progress ends at the non-renewable hard cap',ans(run).endedBy==='hard'&&ans(run).elapsedMs<5000+2000&&t.failureCode==='processing_deadline',{answer:ans(run),t});
  check('hard-cap receipt is partial with exact completed writes',t.status==='partial'&&Array.isArray(t.completedWrites),t);
  const a=await markers(id);await sleep(2000);const b=await markers(id);
  check('no command starts after the hard cap',startsOf(a).length===startsOf(b).length,{before:startsOf(a).length,after:startsOf(b).length});
  // Round 3: the final process can be spawned and killed before it writes its first marker, so app markers are not
  // atomic with OS spawn. Stronger invariants instead of marker-start == receipt equality:
  const started=tools(run,'command_started'),receipts=tools(run,'run_command'),done=receipts.filter(x=>x.status==='succeeded');
  check('every started command has exactly one settled receipt',started.length===receipts.length&&started.length>0,{started:started.length,receipts:receipts.length});
  check('successful commands match end markers exactly',done.length===endsOf(b).length,{succeeded:done.length,ends:endsOf(b).length});
  check('application starts bounded by real attempts (only the final uncertain attempt may lack a marker)',startsOf(b).length<=started.length&&startsOf(b).length>=started.length-1,{starts:startsOf(b).length,started:started.length});
  check('the uncertain final attempt is accounted as not completed',startsOf(b).length===started.length||started.at(-1)?.commitState==='unknown'||started.at(-1)?.status!=='succeeded',started.at(-1));
  check('no matching child process remains',startsOf(b).every(l=>{const pid=Number(l.split(' ')[2]);return !(pid>0&&pidAlive(pid))}),startsOf(b));
 });

 await caseRun('provider request ceiling',async()=>{
  await env({CYBERME_CHAT_DURABLE_MAX_PROVIDER_REQUESTS:'5'});
  const id='limit'+Date.now().toString(36),c=await conv('limit'),rid=randomUUID();await queued(c,msg('loop',id),{requestId:rid});
  const t=await terminal(rid);const run=await runOf(t.runId);const reqs=(await state()).provider.filter(p=>p.id===id);
  check('turn ceiling ends the run as processing_deadline',ans(run).endedBy==='turn_limit'&&t.failureCode==='processing_deadline',{answer:ans(run),t});
  check('provider saw at most the ceiling (over-limit request never dispatched)',reqs.length<=5&&ans(run).providerRequests<=5,{seen:reqs.length,counted:ans(run).providerRequests});
  await sleep(2000);check('no provider request after the ceiling ended the run',(await state()).provider.filter(p=>p.id===id).length===reqs.length);
 });

 await caseRun('append renews idle only',async()=>{
  await env({CYBERME_CHAT_DURABLE_HARD_CAP_MS:'5000'});
  const id='app'+Date.now().toString(36),c=await conv('append'),rid=randomUUID();await queued(c,msg('append',id),{requestId:rid});
  const appendIds=[];for(let i=0;i<8;i++){await sleep(600);const a=randomUUID();appendIds.push(a);await queued(c,'补充：继续当前合成步骤 '+i,{requestId:a,appendDelivery:'steer'})}
  const t=await terminal(rid);const run=await runOf(t.runId);
  check('appended inputs never extend the hard cap',ans(run).endedBy==='hard'&&ans(run).elapsedMs<5000+2000,{answer:ans(run),t:t.status});
  for(const a of appendIds)await terminal(a,90000);
  check('appended requests settle (no request left running)',true);
 });

 await caseRun('stop during work',async()=>{
  const id='stop'+Date.now().toString(36),c=await conv('stop'),rid=randomUUID();await queued(c,msg('stop',id),{requestId:rid});
  await sleep(1500);await api('POST','/api/chat',{conversationId:c,message:'STOP_MARKER 停止',mode:'chat',requestId:randomUUID(),interruptCurrent:true});
  const t=await terminal(rid);const run=await runOf(t.runId);
  check('interrupted run is cancelled, endedBy cancelled, budget closed, no timeout event',run.status==='cancelled'&&ans(run).endedBy==='cancelled'&&ans(run).status==='cancelled'&&!timeoutEvent(run),{run:run.status,answer:ans(run),ev:timeoutEvent(run)});
  check('request keeps partial protection when write receipts exist, cancelled only without them',stopOutcome(t,run,'chat_interrupted'),{status:t.status,failureCode:t.failureCode,writes:t.completedWrites?.length,receipts:tools(run,'run_command').map(x=>x.status)});
  const a=await markers(id);await sleep(2000);const b=await markers(id);
  check('no command starts after stop',startsOf(a).length===startsOf(b).length,{a:startsOf(a).length,b:startsOf(b).length});
 });

 await caseRun('stop racing a deadline',async()=>{
  // Interrupt around the hard cap from both sides; whichever wins, status, failure code and endedBy must agree.
  for(const offset of [-300,0,300]){
   await env({CYBERME_CHAT_DURABLE_HARD_CAP_MS:'3000'});
   const id='race'+Math.abs(offset)+Date.now().toString(36),c=await conv('race'),rid=randomUUID();await queued(c,msg('stop',id),{requestId:rid});
   await sleep(3000+offset);await api('POST','/api/chat',{conversationId:c,message:'STOP_MARKER 停止',mode:'chat',requestId:randomUUID(),interruptCurrent:true});
   const t=await terminal(rid);const run=await runOf(t.runId);const a=ans(run);
   // Interruption won: run cancelled + endedBy cancelled; request partial(chat_interrupted) with writes, else cancelled.
   // Deadline won: run failed + endedBy hard + timed_out; request partial/failed with processing_deadline.
   const consistent=a.status!=='running'&&(run.status==='cancelled'
    ?a.endedBy==='cancelled'&&a.status==='cancelled'&&stopOutcome(t,run,'chat_interrupted')
    :run.status==='failed'&&a.endedBy==='hard'&&a.status==='timed_out'&&t.failureCode==='processing_deadline'&&(writesOf(t)>0?t.status==='partial':t.status==='failed'));
   check(`stop/deadline race (${offset}ms) metadata consistent`,consistent,{run:run.status,status:t.status,failureCode:t.failureCode,endedBy:a.endedBy,budget:a.status,writes:writesOf(t)});
   const m1=startsOf(await markers(id)).length;await sleep(1500);check(`no command starts after race end (${offset}ms)`,startsOf(await markers(id)).length===m1);
  }
 });

 await caseRun('restart and same-ID recovery',async()=>{
  const id='rst'+Date.now().toString(36),c=await conv('restart'),rid=randomUUID(),message=msg('loop',id);await queued(c,message,{requestId:rid});
  await sleep(1500);await stopFixture('SIGKILL');const before=startsOf(await (async()=>{await startFixture();return markers(id)})()).length;
  const t=await terminal(rid,30000);check('restart leaves a terminal original state',['failed','partial'].includes(t.status),t);
  const again=await queued(c,message,{requestId:rid});await sleep(3000);
  const after=startsOf(await markers(id)).length,reqs=(await state()).provider.filter(p=>p.id===id);
  check('same requestId is not replayed after restart',after===before&&reqs.length===0&&(await request(rid)).status===t.status,{before,after,providerAfterRestart:reqs.length,again:again.status});
 });

 await caseRun('internal job budget unchanged',async()=>{
  await env({PROGRESS_PROBE_HOLD_MS:'4000'});
  const version=(await api('GET','/api/settings/models')).data.version,t0=Date.now();
  const r=await api('POST','/api/settings/models/test',{role:'standard',version});
  check('model probe keeps the single bounded timer',r.status===504&&JSON.stringify(r.data).includes('llm_timeout')&&Date.now()-t0<IDLE+2500,{status:r.status,ms:Date.now()-t0});
 });

 await writeFile(OUT+'/legacy-request.json',JSON.stringify(result.legacyRequest||null,null,2));
}catch(e){check('suite completed',false,String(e?.stack||e))}
finally{
 await stopFixture().catch(()=>{});
 result.pass=!failed;await writeFile(OUT+'/result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({pass:result.pass,checks:checks.length,failed:checks.filter(c=>!c.pass).map(c=>c.name),out:OUT}));
}
if(failed){process.exitCode=1;throw Error('chat progress budget HTTP E2E failed')}
