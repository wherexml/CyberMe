// Visual publication journeys (docs/public/insight-visuals.md, 2026-11-14) against scripts/insight-reliability-fixture.mjs (46891/46892).
// Owns its fixture PID and scope (same lifecycle rules as insight-reliability-http-e2e.mjs). Controlled faults only; no real inference.
// Artifacts: output/insight-reliability-visual-<date>/<ts>/http.json (fields, codes and counts; no prompt, source or generated text).
// Expected on the frozen baseline: V0–V7 fail (the V8 success path may pass). A real high-reasoning visual still needs local real-model verification.
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const base='http://127.0.0.1:46891';
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=`output/insight-reliability-visual-${stamp.slice(0,10).replace(/-/g,'')}/${stamp}`;
const checks=[],evidence={};let child,scope,phase='setup';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const req=(path,body,method=body!==undefined?'POST':'GET',ms=600000)=>new Promise((ok,fail)=>{
 const payload=body!==undefined?JSON.stringify(body):undefined;
 const r=httpRequest(base+path,{method,agent:false,headers:{'content-type':'application/json',connection:'close',...(payload?{'content-length':Buffer.byteLength(payload)}:{})},timeout:ms},res=>{let text='';res.setEncoding('utf8');res.on('data',d=>text+=d);res.on('end',()=>{let data;try{data=JSON.parse(text)}catch{data=text}ok({http:res.statusCode,data})});res.on('error',fail)});
 r.on('timeout',()=>r.destroy(Object.assign(Error('request_timeout'),{code:'REQUEST_TIMEOUT'})));
 r.on('error',e=>fail(Object.assign(Error('request_failed '+method+' '+path.split('?')[0]),{cause:e})));
 if(payload)r.write(payload);r.end();
});
async function start(env={}){
 child=spawn(process.execPath,['--import','tsx','scripts/insight-reliability-fixture.mjs'],{env:{...process.env,...env},stdio:['ignore','pipe','inherit']});const me=child;
 const ready=await new Promise((ok,fail)=>{let buf='';const t=setTimeout(()=>fail(Error('fixture_start_timeout')),60000);me.stdout.on('data',d=>{buf+=d;const line=buf.split('\n').find(l=>l.startsWith('{"ready"'));if(line){clearTimeout(t);ok(JSON.parse(line))}});me.once('exit',c=>{clearTimeout(t);fail(Error('fixture_exit_'+c))})});
 let healthy=false;for(let i=0;i<40&&!healthy;i++){try{const h=await req('/__fixture/health',undefined,'GET',2000);healthy=h.http===200&&h.data?.pid===ready.pid}catch{await sleep(250)}}
 if(!healthy)throw Error('fixture_not_ready');scope=ready.scope;return ready;
}
async function stop(){if(!child||child.exitCode!==null||child.signalCode)return;const me=child,done=new Promise(r=>me.once('exit',r));me.kill('SIGTERM');await Promise.race([done,sleep(5000)]);if(me.exitCode===null&&!me.signalCode){me.kill('SIGKILL');await Promise.race([done,sleep(5000)])}}
const fx=(name,body)=>req('/__fixture/'+name,body).then(r=>r.data);
const ev=()=>fx('evidence'),caps=since=>fx('captures?since='+since),row=id=>fx('visual-row/'+id);
const generate=(ids,retry=false)=>req('/api/ideas/visuals/generate',{ids,...(retry?{retry:true}:{})});
const projection=async id=>(await req('/api/ideas/visuals')).data?.items?.[id];
const check=(id,name,pass,detail)=>{checks.push({id,name,pass:!!pass,...(detail!==undefined?{detail}:{})})};
const until=async(fn,ms=30000)=>{const end=Date.now()+ms;for(;;){const v=await fn();if(v)return v;if(Date.now()>end)throw Error('wait_timeout');await sleep(200)}};
const mins=r=>r?.retryAfter?Math.round((Date.parse(r.retryAfter)-Date.now())/60000):null;
const HIGH={contextWindow:200000,maxTokens:7000,reasoning:true,vision:false};

try{
 await start();
 await fx('seed',{relevant:{}});await fx('config',{model:'x/deepseek-test',modelOptions:HIGH});
 phase='V0';// recent OLDER-analysis legacy failure: never selected automatically, no footer state, attempts untouched.
 {await fx('visual-seed',{id:'vis-old',legacy:true,cohort:false});const before=await row('vis-old'),n=(await ev()).modelCalls;
  await fx('visual-background',{pollMs:300});await sleep(3000);await fx('visual-background',{stop:true});const after=await row('vis-old');
  check('V0','recent older-analysis legacy failure is not replayed by the background',(await ev()).modelCalls===n&&after.attempts===2&&!after.legacyProviderRecovery&&after.status==='failed',{before,after});
  check('V0','older-analysis card gets no footer publication state',!(await projection('vis-old'))?.publication);}
 phase='V1';// reasoning-only cut reported as error text: classified, audited bounded reserve, explicit thinking enabled.
 {await fx('visual-seed',{id:'vis-a'});await fx('fault',{clear:true});await fx('fault',{kind:'reasoning_error_text',count:4});const n=(await ev()).modelCalls;
  const g=await generate(['vis-a']);const c=(await caps(n)).filter(x=>!x.ideas),r=await row('vis-a');
  check('V1','visual request uses the audited 16000 reserve (not the 7000 default) with reasoning_effort high and explicit thinking enabled',c.length>0&&c.every(x=>x.maxTokens===16000&&x.reasoningEffort==='high'&&x.thinking?.type==='enabled'),c.map(x=>({maxTokens:x.maxTokens,reasoningEffort:x.reasoningEffort,thinking:x.thinking})));
  const run=r?.runIds?.length?await fx('run/'+r.runIds.at(-1)):null;
  check('V1','run records outputBudget rule, cap and configured ceiling',run?.outputBudget?.rule==='insight_visual_reasoning_reserve'&&run.outputBudget.capTokens===16000&&run.outputBudget.configuredMaxTokens===7000&&run.outputBudget.registeredMaxTokens===16000,run?.outputBudget);
  check('V1','reasoning-only failure is classified reasoning_exhausted, consumes one attempt, schedules one automatic retry',r?.status==='failed'&&r.cause==='reasoning_exhausted'&&r.attempts===1&&mins(r)>=14&&mins(r)<=15,{http:g.http,row:r});
  const p=await projection('vis-a');check('V1','withheld idea exposes a retryable publication state with cause code only',p?.publication?.retryable===true&&p.publication.cause==='reasoning_exhausted');
  const b=await req('/api/bootstrap?include=insightVisuals');check('V1','bootstrap withholds the card but carries the publication state',!b.data.ideas.some(i=>i.id==='vis-a')&&b.data.insightVisuals?.['vis-a']?.publication?.retryable===true);}
 phase='V2';// transient connection failure does not consume the attempt; backoff 5 min.
 {await fx('fault',{clear:true});await fx('fault',{kind:'connection',count:4});const g=await generate(['vis-a'],true);const r=await row('vis-a');
  check('V2','connection error → provider_connection, attempt refunded, transientFailures 1, retry after 5 min',r?.cause==='provider_connection'&&r.attempts===1&&r.transientFailures===1&&mins(r)>=4&&mins(r)<=5,{http:g.http,row:r});
  check('V2','still retryable in the App',(await projection('vis-a'))?.publication?.retryable===true);}
 phase='V3';// second real attempt exhausts: terminal, no footer action.
 {await fx('fault',{clear:true});await fx('fault',{kind:'reasoning_error_text',count:4});await generate(['vis-a'],true);const r=await row('vis-a');const n=(await ev()).modelCalls;await generate(['vis-a'],true);
  check('V3','two counted attempts end the input: no further model call; publication stays visible and not retryable',r?.attempts===2&&(await ev()).modelCalls===n&&(await projection('vis-a'))?.publication?.retryable===false,{row:r});}
 phase='V4';// legacy unclassified provider_failed at the limit: exactly one recovery, then final.
 {await fx('visual-seed',{id:'vis-legacy',legacy:true});check('V4','legacy row is retryable once',(await projection('vis-legacy'))?.publication?.retryable===true);
  await fx('fault',{clear:true});await fx('fault',{kind:'reasoning_error_text',count:4});await generate(['vis-legacy'],true);const r=await row('vis-legacy');const n=(await ev()).modelCalls;await generate(['vis-legacy'],true);
  check('V4','one recovery attempt (3) marked; second request makes no model call',r?.legacyProviderRecovery===true&&r.attempts===3&&r.cause==='reasoning_exhausted'&&(await ev()).modelCalls===n&&(await projection('vis-legacy'))?.publication?.retryable===false,{row:r});}
 phase='V5';// quota still pauses (regression of the existing contract) and other runs keep their own controls.
 {await fx('visual-seed',{id:'vis-quota'});await fx('fault',{clear:true});await fx('fault',{kind:'429',count:4});await generate(['vis-quota']);const st=(await req('/api/ideas/visuals/status')).data;const r=await row('vis-quota');
  check('V5','429 → quota with 30-minute pause',r?.error==='quota'&&!!st.quotaUntil,{row:r});
  await fx('fault',{clear:true});await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周三，请按新日期准备。'});const n=(await ev()).modelCalls;await req('/api/ideas/refresh',{});const c=(await caps(n)).filter(x=>x.ideas);
  check('V5','ideas_refresh on the same reasoning:true config still sends thinking disabled with the configured 7000 ceiling',c.length&&c.every(x=>x.thinking?.type==='disabled'&&x.maxTokens<=7000),c.map(x=>({thinking:x.thinking,maxTokens:x.maxTokens})));}
 phase='V6';// negative control: reasoning:true on a non-DeepSeek model keeps the configured ceiling and prior budget, no thinking field.
 {await fx('visual-quota-clear',{});await fx('config',{model:'public-other',modelOptions:HIGH});await fx('visual-seed',{id:'vis-ctl'});await fx('fault',{clear:true});await fx('fault',{kind:'5xx',count:4});const n=(await ev()).modelCalls;
  await generate(['vis-ctl']);const c=(await caps(n)).filter(x=>!x.ideas),r=await row('vis-ctl'),run=r?.runIds?.length?await fx('run/'+r.runIds.at(-1)):null;
  check('V6','non-DeepSeek high-reasoning visual keeps maxTokens 7000, no thinking field, no outputBudget override',c.length>0&&c.every(x=>x.maxTokens===7000&&x.thinking===null)&&run&&!run.outputBudget,{requests:c.map(x=>({maxTokens:x.maxTokens,thinking:x.thinking,reasoningEffort:x.reasoningEffort})),outputBudget:run?.outputBudget});
  await fx('config',{model:'x/deepseek-test',modelOptions:HIGH});}
 phase='V7';// held AUTOMATIC retry: prior failure stays visible (running, no action) across reads; no client POST; reviewed success clears it.
 {await fx('visual-seed',{id:'vis-auto'});await fx('fault',{clear:true});await fx('fault',{kind:'connection',count:4});await generate(['vis-auto']);
  const posts0=(await ev()).posts.filter(p=>p.path==='/api/ideas/visuals/generate').length;
  await fx('visual-expire/vis-auto',{});await fx('fault',{clear:true});await fx('fault',{kind:'hold',then:'visual_success'});await fx('fault',{kind:'visual_success',count:6});
  await fx('visual-background',{pollMs:300});await until(async()=>(await ev()).held>=1,60000);
  const p1=await projection('vis-auto'),b1=await req('/api/bootstrap?include=insightVisuals'),p2=await projection('vis-auto');
  check('V7','running automatic retry keeps the prior cause, running=true, retryable=false (stable across reads)',p1?.publication?.running===true&&p1.publication.retryable===false&&p1.publication.cause==='provider_connection'&&JSON.stringify(p1)===JSON.stringify(p2)&&b1.data.insightVisuals?.['vis-auto']?.publication?.running===true,{p1});
  await fx('release',{});await until(async()=>(await row('vis-auto'))?.status==='ready',120000);await fx('visual-background',{stop:true});
  const p3=await projection('vis-auto'),b2=await req('/api/bootstrap?include=insightVisuals');
  check('V7','reviewed ready result clears the failure and publishes the card',p3?.state==='ready'&&!p3.publication&&b2.data.ideas.some(i=>i.id==='vis-auto')&&!(await row('vis-auto')).lastFailure,{state:p3?.state});
  check('V7','no client POST during the automatic retry',(await ev()).posts.filter(p=>p.path==='/api/ideas/visuals/generate').length===posts0);}
 phase='V8';// explicit success after a failure: actual controlled generation + production parseReview; config unchanged.
 {await fx('visual-seed',{id:'vis-ok'});await fx('fault',{clear:true});await fx('fault',{kind:'reasoning_error_text',count:4});await generate(['vis-ok']);
  check('V8','failure visible before success',(await projection('vis-ok'))?.publication?.retryable===true);
  await fx('fault',{clear:true});await fx('fault',{kind:'visual_success',count:6});const n=(await ev()).modelCalls;const g=await generate(['vis-ok'],true);const c=(await caps(n)).filter(x=>!x.ideas);
  const p=await projection('vis-ok'),b=await req('/api/bootstrap?include=insightVisuals'),e=await ev();
  check('V8','generation then independent review both ran and the reviewed graph is ready',g.data?.results?.['vis-ok']==='ready'&&c.length>=2&&p?.state==='ready'&&!p.publication,{http:g.http,result:g.data?.results,requests:c.length});
  check('V8','bootstrap includes the published card; exact config unchanged',b.data.ideas.some(i=>i.id==='vis-ok')&&e.config.model==='x/deepseek-test'&&JSON.stringify(e.config.modelOptions)===JSON.stringify(HIGH));}
 {const e=await ev();check('scope','no sends, no chat messages',e.sends===0&&e.messages===0);evidence.malformedModelRequests=e.malformed;}
}catch(e){checks.push({id:'harness',name:String(e?.message||e),pass:false,phase,cause:e?.cause?.code||e?.code||null})}
finally{await stop();if(scope&&scope.startsWith(resolve('.local/acceptance')+'/insight-reliability-'))await rm(scope,{recursive:true,force:true})}
const files=['server/src/agent.ts','server/src/insight-visuals.ts','web/src/v6/InsightFooter.tsx','scripts/insight-reliability-fixture.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
await mkdir(out,{recursive:true});await writeFile(out+'/http.json',JSON.stringify({scope:'production HTTP/SDK/SQLite, controlled model faults, synthetic data',sourceHashes,checks,evidence},null,2));
const failed=checks.filter(c=>!c.pass);console.log(JSON.stringify({out,total:checks.length,failed:failed.map(c=>c.id+' '+c.name)}));if(failed.length)process.exitCode=1;
