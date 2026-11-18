// Repeatable HTTP journeys for docs/public/insight-reliability.md against scripts/insight-reliability-fixture.mjs (46891/46892).
// Owns its fixture process and scope: spawns it, restarts it into the same scope for durability cases, kills only that PID and
// removes only that .local/acceptance/insight-reliability-* scope. Artifacts: output/insight-reliability-<date>/<ts>/http.json
// (checks, captured request fields and counts, source hashes; no prompt, source or generated text).
// Run:   node scripts/insight-reliability-http-e2e.mjs [--slow]   (--slow adds the >45 s header-delay timeout case)
// Expected on the frozen baseline: H1–H9 (and H1b) fail (recorded as the failure-first evidence); H10 is the existing regression suite.
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const base='http://127.0.0.1:46891',slow=process.argv.includes('--slow');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=`output/insight-reliability-${stamp.slice(0,10).replace(/-/g,'')}/${stamp}`;
const checks=[],evidence={restarts:[],abandoned:[]};let child,scope,phase='setup';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Owned fixture lifecycle: one child PID at a time; ready = ready line AND an idempotent health read on a fresh connection.
async function start(env={}){
 const t0=Date.now();
 child=spawn(process.execPath,['--import','tsx','scripts/insight-reliability-fixture.mjs'],{env:{...process.env,...env},stdio:['ignore','pipe','inherit']});
 const me=child;
 const ready=await new Promise((ok,fail)=>{let buf='';const t=setTimeout(()=>fail(Error('fixture_start_timeout')),60000);me.stdout.on('data',d=>{buf+=d;const line=buf.split('\n').find(l=>l.startsWith('{"ready"'));if(line){clearTimeout(t);ok(JSON.parse(line))}});me.once('exit',c=>{clearTimeout(t);fail(Error('fixture_exit_'+c))})});
 // Idempotent readiness only; business requests are never retried.
 let healthy=false;for(let i=0;i<40&&!healthy;i++){try{const h=await req('/__fixture/health',undefined,'GET',2000);healthy=h.http===200&&h.data?.pid===ready.pid}catch{await sleep(250)}}
 if(!healthy)throw Error('fixture_not_ready');
 scope=ready.scope;evidence.restarts.push({phase,pid:ready.pid,readyMs:Date.now()-t0});return ready;
}
async function stop(){
 if(!child||child.exitCode!==null||child.signalCode)return;
 const me=child,done=new Promise(r=>me.once('exit',r));me.kill('SIGTERM');await Promise.race([done,sleep(5000)]);
 if(me.exitCode===null&&!me.signalCode){me.kill('SIGKILL');await Promise.race([done,sleep(5000)])}
}
// No connection pooling (agent:false): a restarted fixture can never receive a request on a socket of the previous process.
const req=(path,body,method=body!==undefined?'POST':'GET',ms=180000)=>new Promise((ok,fail)=>{
 const payload=body!==undefined?JSON.stringify(body):undefined;
 const r=httpRequest(base+path,{method,agent:false,headers:{'content-type':'application/json',connection:'close',...(payload?{'content-length':Buffer.byteLength(payload)}:{})},timeout:ms},res=>{let text='';res.setEncoding('utf8');res.on('data',d=>text+=d);res.on('end',()=>{let data;try{data=JSON.parse(text)}catch{data=text}ok({http:res.statusCode,data})});res.on('error',fail)});
 r.on('timeout',()=>r.destroy(Object.assign(Error('request_timeout'),{code:'REQUEST_TIMEOUT'})));
 r.on('error',e=>fail(Object.assign(Error('request_failed '+method+' '+path.split('?')[0]),{cause:e})));
 if(payload)r.write(payload);r.end();
});
const fx=(name,body)=>req('/__fixture/'+name,body).then(r=>r.data);
const ev=()=>fx('evidence'),bg=async()=>(await req('/api/ideas/background')).data,caps=since=>fx('captures?since='+since);
const refresh=()=>req('/api/ideas/refresh',{});
const until=async(fn,ms=30000)=>{const end=Date.now()+ms;for(;;){const v=await fn();if(v)return v;if(Date.now()>end)throw Error('wait_timeout');await sleep(150)}};
const check=(id,name,pass,detail)=>{checks.push({id,name,pass:!!pass,...(detail!==undefined?{detail}:{})})};
const minutes=s=>Math.round((Date.parse(s.nextAt)-Date.parse(s.lastFailedAt))/60000);
const runOf=async id=>fx('run/'+id);
const reset=async()=>{await fx('fault',{clear:true});await fx('release',{});await fx('env',{});};

try{
 await start();
 await fx('seed',{relevant:{}});
 phase='H1';// ---------- H1 explicit thinking off (namespaced DeepSeek on an IP route) and negative controls.
 {let n=(await ev()).modelCalls;await fx('config',{model:'x/deepseek-test'});const r=await refresh();const c=(await caps(n));
  check('H1','namespaced deepseek ideas request carries thinking disabled',c.length&&c.every(x=>x.thinking?.type==='disabled'),{http:r.http,thinking:c.map(x=>x.thinking)});
  const run=await runOf(r.data?.run?.id||(await bg()).runId);const pr=(run?.events||[]).filter(e=>e.type==='provider_request');
  check('H1','audit emittedThinking=disabled with thinkingControl',pr.length&&pr.every(e=>e.emittedThinking==='disabled'&&e.thinkingControl==='explicit_disabled'),pr.map(e=>({emittedThinking:e.emittedThinking,thinkingControl:e.thinkingControl})));
  n=(await ev()).modelCalls;await fx('config',{model:'public-other'});await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周四，请按新日期准备。'});await refresh();
  check('H1','non-deepseek model gets no thinking field',(await caps(n)).every(x=>x.thinking===null));
  n=(await ev()).modelCalls;await fx('config',{model:'x/deepseek-test',modelOptions:{contextWindow:200000,maxTokens:7000,reasoning:false,vision:false,thinkingFormat:'none'}});await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周五，请按新日期准备。'});await refresh();
  check('H1','explicit thinkingFormat opt-out sends nothing',(await caps(n)).every(x=>x.thinking===null));
  n=(await ev()).modelCalls;await fx('config',{model:'x/deepseek-test'});const ctl=await fx('chat-control',{});
  check('H1','ordinary chat run on the same model is unchanged (no thinking field)',(await caps(n)).every(x=>x.thinking===null),{ctl:{ok:ctl.ok,code:ctl.code}});
 }
 phase='H1b';// ---------- H1b small context: reserved envelope cannot fit → refused before any provider request; configured limits kept.
 {await reset();const opts={contextWindow:12000,maxTokens:7000,reasoning:false,vision:false};await fx('config',{model:'x/deepseek-test',modelOptions:opts});await fx('touch-source',{id:'rel-source',body:'公开试点安排 小窗口'});const n=(await ev()).modelCalls;const r=await refresh();const s=await bg();const run=await runOf(s.runId);
  check('H1b','12000-token window refuses with context_budget_exceeded and sends no model request',(r.data?.error||r.data?.code)==='context_budget_exceeded'&&(await ev()).modelCalls===n,{http:r.http,error:r.data?.error||r.data?.code,requests:(await ev()).modelCalls-n,firstTurnTokens:run?.inputBudget?.firstTurnTokens,reservedTokens:run?.inputBudget?.reservedTokens});
  check('H1b','no hidden minimum above the window; configured limits unchanged',run?.inputBudget&&run.inputBudget.firstTurnTokens<=12000-run.inputBudget.reservedTokens&&run.inputBudget.contextWindow===12000&&run.inputBudget.maxOutputTokens===7000&&JSON.stringify((await ev()).config.modelOptions)===JSON.stringify(opts));
  await fx('config',{model:'x/deepseek-test'});}
 phase='H2';// ---------- H2 reasoning-only length: classified before JSON, no repair, ideas byte-identical, lastError persisted.
 for(const [kind,code] of [['reasoning_length','reasoning_exhausted'],['truncated','output_exhausted'],['empty','empty_ai_response']]){
  await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排 '+kind});const before=(await ev()).ideasHash,n=(await ev()).modelCalls;
  await fx('fault',{kind});const r=await refresh();const c=await caps(n),s=await bg();
  check('H2',kind+' → '+code,r.data?.error===code||r.data?.code===code,{http:r.http,error:r.data?.error||r.data?.code});
  check('H2',kind+' sends no repair request',c.every(x=>!x.repair),{requests:c.length});
  check('H2',kind+' keeps ideas byte-identical',(await ev()).ideasHash===before);
  check('H2',kind+' persists lastError and sanitized failure',s.lastError===code&&s.failure?.cause===code&&typeof s.failure?.usage?.output==='number'&&!JSON.stringify(s).includes('公开思考'),{failure:s.failure});
 }
 phase='H5';// ---------- H5 provider faults keep their cause.
 for(const [kind,code,count] of [['incomplete','provider_stream_incomplete',3],['5xx','provider_unavailable',3],['context_overflow','context_overflow',3]]){
  await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排 '+kind});const n=(await ev()).modelCalls;await fx('fault',{kind,count});const r=await refresh();const c=await caps(n);
  check('H5',kind+' → '+code,(r.data?.error||r.data?.code)===code,{http:r.http,error:r.data?.error||r.data?.code,requests:c.length});
  check('H5',kind+' no repair and no compaction',c.every(x=>!x.repair)&&!((await runOf((await bg()).runId))?.events||[]).some(e=>e.type==='compaction_end'));
 }
 {const prev=(await runOf((await bg()).runId))?.inputBudget?.scale;await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排 缩小批次'});const x=await refresh();const next=(await runOf(x.data?.run?.id||(await bg()).runId))?.inputBudget?.scale;
  check('H5','context/output exhaustion halves the next batch (floor 1/8), success restores',typeof prev==='number'&&next===Math.max(0.125,prev/2)&&!(await bg()).lastError,{prev,next});}
 if(slow){await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排 超时'});await fx('fault',{kind:'hold_headers',delayMs:50000,count:3});const r=await refresh();check('H5','header delay beyond provider timeout → llm_timeout with phase',(r.data?.error||r.data?.code)==='llm_timeout'&&!!(await bg()).failure,{failure:(await bg()).failure})}
 phase='H6b';// ---------- H6b real-model sequence: missing retire + 2-char quote reported together; a correction that keeps the short quote stays failed.
 {await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周三上午，请按新日期准备。'});const before=(await ev()).ideasHash,n=(await ev()).modelCalls;
  await fx('fault',{kind:'missing_retire_short_quote',on:'answer'});await fx('fault',{kind:'short_quote',on:'answer'});const r=await refresh();const c=await caps(n),rep=c.filter(x=>x.repair);
  const first=c.find(x=>x.ideas&&x.firstTurn);
  check('H6b','first prompt states mandatory arrays and the 4–600 quote rule before the data (boolean marker only)',first?.contractStated===true);
  check('H6b','one repair lists missing retire and quote length (actual 2, 4–600) together',rep.length===1&&(rep[0].repairIssues||[]).some(i=>i.path==='retire'&&i.reason==='missing_array')&&(rep[0].repairIssues||[]).some(i=>i.reason==='quote_length'&&i.actualLength===2&&i.min===4&&i.max===600)&&rep[0].repairChecklistLines>=2&&rep[0].repairNamesArrays,{issues:rep[0]?.repairIssues,lines:rep[0]?.repairChecklistLines});
  check('H6b','correction keeping the short quote remains invalid_evidence; ideas unchanged; no second repair',(r.data?.error||r.data?.code)==='invalid_evidence'&&(await ev()).ideasHash===before&&rep.length===1,{http:r.http,error:r.data?.error||r.data?.code});
  check('H6b','failure audit keeps numeric constraints, not text',(await bg()).lastError==='invalid_evidence');
  await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周三下午，请按新日期准备。'});const n2=(await ev()).modelCalls;await fx('fault',{kind:'missing_retire_short_quote',on:'answer'});const ok=await refresh();const rep2=(await caps(n2)).filter(x=>x.repair);
  check('H6b','valid correction after missing retire + short quote succeeds',ok.http===200&&rep2.length===1&&!(await bg()).lastError,{http:ok.http,error:ok.data?.error});}
 phase='H6';// ---------- H6 repair: allowed once with room and no forced tool; gated by time and output room.
 {await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周一，请按新日期准备。'});const n=(await ev()).modelCalls;await fx('fault',{kind:'invalid_evidence',on:'answer'});const r=await refresh();const c=await caps(n),rep=c.filter(x=>x.repair);
  check('H6','invalid evidence then valid output succeeds',r.http===200,{http:r.http,error:r.data?.error});
  check('H6','exactly one repair request, max_tokens ≥ 2000, no forced tool_choice',rep.length===1&&rep[0].maxTokens>=2000&&rep[0].toolChoice===null,rep.map(x=>({maxTokens:x.maxTokens,toolChoice:x.toolChoice})));
  check('H6','success clears lastError and backoff',!(await bg()).lastError&&(await bg()).consecutiveFailures===0);
 }
 {await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周二，请按新日期准备。'});const n=(await ev()).modelCalls;await fx('fault',{kind:'invalid_evidence',on:'answer',promptTokens:195000});const r=await refresh();
  check('H6','no repair without output room',(await caps(n)).every(x=>!x.repair)&&(await bg()).failure?.repairSkipped==='output_room',{http:r.http,failure:(await bg()).failure});}
 {await reset();await fx('env',{answerBudgetMs:45000});await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周六，请按新日期准备。'});const n=(await ev()).modelCalls;await fx('fault',{kind:'invalid_evidence',on:'answer',delayMs:7000});const r=await refresh();
  check('H6','no repair with under 40 s left',(await caps(n)).every(x=>!x.repair)&&(await bg()).failure?.repairSkipped==='time',{http:r.http,failure:(await bg()).failure});await fx('env',{});}
 {await reset();await fx('touch-source',{id:'rel-source',body:'公开试点安排改到月底，请按新日期准备。'});await fx('fault',{kind:'hold',on:'answer'});const p=refresh();await until(async()=>(await ev()).held===1);await fx('touch-source',{id:'rel-source',body:'公开试点安排再次调整。'});await fx('release',{});const r=await p;const s=await bg();
  check('H6','source drift during inference → sources_changed, drift class, short retry, no provider backoff growth',(r.data?.error||r.data?.code)==='sources_changed'&&s.failureClass==='drift'&&minutes(s)<=1,{failure:s.failure,consecutiveFailures:s.consecutiveFailures});}
 phase='H3/H4';// ---------- H3 whole-prompt budget, H4 fairness, unseen omitted sources.
 {await reset();await refresh();// settle to success
  await fx('seed',{sources:[{prefix:'bulk',count:60,chars:6000}],ideas:100,people:16});const n=(await ev()).modelCalls;const r=await refresh();const c=(await caps(n)).filter(x=>x.ideas&&x.firstTurn);const first=c[0];
  const run=await runOf(r.data?.run?.id||(await bg()).runId);
  check('H3','first turn ≤ ~60k estimated tokens including instruction and tools',first&&first.estimatedTokens<=60000,{estimatedTokens:first?.estimatedTokens,contentChars:first?.contentChars,bodyChars:first?.bodyChars,budget:run?.inputBudget&&{firstTurnTokens:run.inputBudget.firstTurnTokens,estimatedTokens:run.inputBudget.estimatedTokens}});
  check('H3','coverage truncated with omitted sources',first?.coverage?.truncated===true&&first.coverage.omitted>0,first?.coverage);
  check('H3','no compaction events',!(run?.events||[]).some(e=>e.type==='compaction_end'));
  check('H3','existing ideas and people bounded',first&&first.existingIdeas<=100&&first.people<=16,{existingIdeas:first?.existingIdeas,people:first?.people});
  const seen=new Set(await fx('seen'));check('H3','omitted sources stay unseen',[...Array(60).keys()].map(i=>'bulk-'+String(i).padStart(3,'0')).filter(id=>!first?.sourceIds.includes(id)).every(id=>!seen.has(id)));
  // Research expansion: four broad searches stay within per-call and cumulative caps.
  for(const kind of ['research4','research_parallel']){const n2=(await ev()).modelCalls;await fx('touch-source',{id:'rel-source',body:'公开试点安排 检索预算 '+kind});await fx('fault',{kind,query:'公开资料'});const rr=await refresh();const last=(await caps(n2)).filter(x=>x.toolResultChars.length).at(-1);
   check('H3',kind+': complete tool results ≤ 16000 each and ≤ 48000 total',last&&last.toolResultChars.length>=1&&last.toolResultChars.every(x=>x<=16000)&&last.toolResultChars.reduce((a,b)=>a+b,0)<=48000,{http:rr.http,toolResultChars:last?.toolResultChars});}
  let runs=0;while((await bg()).coverage?.omitted>0&&runs<20){await refresh();runs++}
  const all=new Set(await fx('seen'));check('H3','remaining sources delivered on following runs',[...Array(60).keys()].every(i=>all.has('bulk-'+String(i).padStart(3,'0'))),{runs});
 }
 {await reset();await fx('seed',{sources:[{prefix:'old',count:30,chars:6000,eventAt:'2026-01-01T00:00:00.000Z',step:3600000}]});const pendingOld=new Set([...Array(30).keys()].map(i=>'old-'+String(i).padStart(3,'0')));
  let bound,runs=0;const delivered=new Set();
  while(pendingOld.size&&runs<20){runs++;await fx('seed',{sources:[{prefix:'new'+runs,count:30,chars:6000}]});const n=(await ev()).modelCalls;await refresh();const c=(await caps(n)).find(x=>x.ideas&&x.firstTurn);
   if(bound===undefined){const b=(await bg()).coverage?.drainBounds||[];bound=b.find(x=>x.items>=30)?.runs;evidence.drainBounds=b}for(const id of c?.sourceIds||[]){delivered.add(id);pendingOld.delete(id)}}
  check('H4','old backlog drained within the recorded cohort bound (min(k, ceil(chars/(quota−largest))))',typeof bound==='number'&&pendingOld.size===0&&runs<=bound,{runs,bound,remaining:pendingOld.size});
 }
 phase='H7/H8';// ---------- H7 persisted backoff, H8 failure retained while retry held.
 {await reset();await refresh();await fx('fault',{kind:'5xx',count:100});await fx('background',{pollMs:200,debounceMs:300,cooldownMs:0});await fx('touch-source',{id:'rel-source',body:'公开试点 退避1'});
  const s1=await until(async()=>{const s=await bg();return s.status==='failed'&&s.lastError==='provider_unavailable'&&s});
  check('H7','first automatic failure backs off 5 min',minutes(s1)===5,{nextAt:s1.nextAt,lastFailedAt:s1.lastFailedAt});
  const calls=(await ev()).modelCalls;await fx('touch-source',{id:'rel-source',body:'公开试点 新输入'});await sleep(2000);
  check('H7','new input does not reset backoff or call the model',(await ev()).modelCalls===calls&&(await bg()).consecutiveFailures===1);
  await fx('expire-backoff',{});const s2=await until(async()=>{const s=await bg();return s.status==='failed'&&s.consecutiveFailures===2&&s});check('H7','second → 15 min',minutes(s2)===15);
  await fx('expire-backoff',{});const s3=await until(async()=>{const s=await bg();return s.status==='failed'&&s.consecutiveFailures===3&&s});check('H7','third → 45 min',minutes(s3)===45);
  const c4=(await ev()).modelCalls;await fx('expire-backoff',{});const s4u=await until(async()=>{const s=await bg();return s.status==='failed'&&s.consecutiveFailures===4&&s});check('H7','fourth attempt, unchanged input, still calls the model → 120 min',minutes(s4u)===120&&(await ev()).modelCalls>c4,{requests:(await ev()).modelCalls-c4});
  const c5=(await ev()).modelCalls;await fx('expire-backoff',{});const s5u=await until(async()=>{const s=await bg();return s.status==='failed'&&s.consecutiveFailures===5&&s});check('H7','fifth attempt, unchanged input (old three-attempt stop removed) → 240 min, cap 360',minutes(s5u)===240&&(await ev()).modelCalls>c5,{requests:(await ev()).modelCalls-c5});
  await fx('background',{stop:true});
  // Restart into the same scope: nextAt, counters and lastError survive; no model call inside the window.
  await stop();await start({INSIGHT_RELIABILITY_SCOPE:scope,INSIGHT_RELIABILITY_BACKGROUND:'1'});await fx('fault',{kind:'5xx',count:100});await fx('touch-source',{id:'rel-source',body:'公开试点 重启后'});await sleep(2000);
  const s4=await bg();check('H7','backoff and failure persist across restart',s4.consecutiveFailures===5&&s4.lastError==='provider_unavailable'&&s4.nextAt===s5u.nextAt&&(await ev()).modelCalls===0,{s4:{consecutiveFailures:s4.consecutiveFailures,nextAt:s4.nextAt}});
  const manual=await refresh();check('H7','manual retry still runs during backoff',(await ev()).modelCalls>0,{http:manual.http});
  await fx('background',{stop:true});await reset();
  await fx('fault',{kind:'hold',on:'answer'});const p=refresh();await until(async()=>(await ev()).held===1);const running=await bg();
  check('H8','running retry keeps the previous failure visible',running.status==='running'&&running.lastError==='provider_unavailable'&&!!running.lastFailedRunId,{status:running.status,lastError:running.lastError});
  await fx('release',{});const done=await p;const after=await bg();
  check('H8','only an actual success clears lastError',done.http===200&&after.status==='succeeded'&&!after.lastError&&after.consecutiveFailures===0);
  // Restart mid-run: unknown/server_interrupted, previous failure kept, not success.
  await fx('fault',{kind:'5xx',count:3});await fx('touch-source',{id:'rel-source',body:'公开试点 中断前失败'});await refresh();
  await fx('fault',{kind:'hold',on:'answer'});const abandoned=refresh().then(r=>({http:r.http,error:r.data?.error||r.data?.code}),e=>({failed:true,cause:e?.cause?.code||e?.code||'unknown'}));await until(async()=>(await ev()).held===1);await stop();
  const lost=await abandoned;evidence.abandoned.push({phase,...lost});check('H8','request in flight at restart is reported as lost, never as success',lost.http!==200,lost);
  await start({INSIGHT_RELIABILITY_SCOPE:scope,INSIGHT_RELIABILITY_BACKGROUND:'1'});await fx('background',{stop:true});const u=await bg();
  check('H8','restart mid-run → unknown/server_interrupted, never success, lastError kept',u.status==='unknown'&&u.error==='server_interrupted'&&u.lastError==='provider_unavailable',{status:u.status,error:u.error,lastError:u.lastError});
 }
 phase='H9';// ---------- H9 both bootstrap forms.
 {const a=await req('/api/bootstrap'),b=await req('/api/bootstrap?include=insightVisuals');
  check('H9','bootstrap carries ideasBackground in both forms without secrets',!!a.data.ideasBackground&&!!b.data.ideasBackground&&!JSON.stringify([a.data.ideasBackground,b.data.ideasBackground]).includes('public-reliability-key'),{status:a.data.ideasBackground?.status});}
 // ---------- No business execution.
 {const e=await ev();check('scope','no business tasks beyond synthetic sources, no messages, no sends',e.sends===0&&e.messages===0,{tasks:e.tasks,sends:e.sends,messages:e.messages});
  evidence.malformedModelRequests=e.malformed;evidence.captures=await caps(0);}
}catch(e){checks.push({id:'harness',name:String(e?.message||e),pass:false,phase,cause:e?.cause?.code||e?.cause?.message||e?.code||null,stack:String(e?.stack||'').split('\n').slice(1,4).map(l=>l.trim().replace(/\(?\/[^)]*\//,'('))})}
finally{
 await stop();
 if(scope&&scope.startsWith(resolve('.local/acceptance')+'/insight-reliability-'))await rm(scope,{recursive:true,force:true});
}
const files=['server/src/agent.ts','server/src/ideas-background.ts','server/src/index.ts','web/src/v6/InsightFooter.tsx','scripts/insight-reliability-fixture.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
await mkdir(out,{recursive:true});
await writeFile(out+'/http.json',JSON.stringify({scope:'production HTTP/SDK/SQLite with controlled model, synthetic data only',ports:{api:46891,model:46892},slow,sourceHashes,checks,evidence},null,2));
const failed=checks.filter(c=>!c.pass);console.log(JSON.stringify({out,total:checks.length,failed:failed.map(c=>c.id+' '+c.name)}));
if(failed.length)process.exitCode=1;
