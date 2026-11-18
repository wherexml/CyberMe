// Real configured-model check for the durable queued chat progress budget. Run locally by the coordinator only:
//   node scripts/chat-progress-budget-real-e2e.mjs
// Uses ONLY the locally saved daily `llm` config (model, endpoint, protocol unchanged; read from the local app data,
// copied into an isolated private scope on this machine, never printed). Production server child on
// PROGRESS_REAL_PORT (default 47563) with a fresh synthetic data directory and one synthetic skill whose steps are
// local marker scripts. No Feishu, sub2api, production business commands or external sends.
// Default budgets are the real ones (phase windows: headers 50s, first content 60s, stream silence 30s, run_command own
// limit +5s; hard 600s; 60 requests). The workflow is sized to exceed the old 110s whole-answer
// timer while progressing: PROGRESS_REAL_STEPS (4) x PROGRESS_REAL_STEP_MS (35000) plus real model rounds.
// Proof established on success: a real provider multi-step skill workflow longer than 110s completes on the durable
// path with exact once-only marker effects. It does not prove idle/hard/turn-limit expiry (see the HTTP E2E).
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

const port=Number(process.env.PROGRESS_REAL_PORT||47563),base=`http://127.0.0.1:${port}`;
const STEPS=Number(process.env.PROGRESS_REAL_STEPS||4),STEP_MS=Number(process.env.PROGRESS_REAL_STEP_MS||35000);
const OUT=(process.env.PROGRESS_OUT||'/Users/steve/Projects/cyberme/output/chat-phase-watchdog-20261113')+'/real-'+new Date().toISOString().replace(/[:.]/g,'-');
await mkdir(OUT,{recursive:true});
const scope=resolve('.local/acceptance/chat-progress-real-'+randomUUID());await mkdir(scope,{recursive:true,mode:0o700});
const checks=[];let failed=false;
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(pass?{}:{detail})});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)failed=true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const put=async(p,s)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,s,{mode:0o600})};
const sha=s=>createHash('sha256').update(s).digest('hex');

const configPath=process.env.PROGRESS_REAL_CONFIG||resolve(homedir(),'Library/Application Support/OpsTwins/.local/config.json');
const saved=JSON.parse(await readFile(configPath,'utf8'));if(!saved?.llm?.model||!saved?.llm?.baseUrl)throw Error('no saved llm config');
await put(scope+'/config.json',JSON.stringify({llm:saved.llm}));
{const seed=new DatabaseSync(scope+'/opstwin-advance.db');seed.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');seed.close();}
const id='real'+Date.now().toString(36),skillDir=scope+'/skills/progress-real',node=JSON.stringify(process.execPath);
const TASK='请实际在公开隔离目录依次运行全部合成步骤脚本并回读标记';
await put(skillDir+'/scripts/step.mjs',`import fs from 'node:fs';const [id,step,ms]=process.argv.slice(2);fs.mkdirSync('markers',{recursive:true});fs.appendFileSync('markers/'+id+'.log','start '+step+' '+process.pid+'\\n');setTimeout(()=>{fs.appendFileSync('markers/'+id+'.log','end '+step+'\\n');console.log('STEP_OK '+id+' '+step)},Number(ms)||0);`);
await put(skillDir+'/SKILL.md',`---\nname: progress-real\ndescription: 合成多步骤本机标记流程，仅用于处理时限验收。\n---\n# Synthetic multi-step marker flow\nThis is a public synthetic acceptance workflow on an isolated directory. For the user's explicit request:\n${Array.from({length:STEPS},(_,i)=>`${i+1}. run_command once with command \`${node} scripts/step.mjs ${id} ${i+1} ${STEP_MS}\`, cwd \`${skillDir}\`, timeoutMs 60000, operationId \`${id}-${i+1}\`, evidence = the user's exact sentence. Wait for it to finish before the next step.`).join('\n')}\n${STEPS+1}. run_command once to print markers/${id}.log (cwd \`${skillDir}\`) and confirm ${STEPS} start and ${STEPS} end lines.\nRun each step exactly once; never repeat a step that returned. Never contact any service or send messages.\n`);

let child;
const start=async()=>{child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:resolve('.'),stdio:['ignore','ignore','ignore'],env:{...process.env,OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_LISTEN:'0',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',CYBERME_SKILL_ROOTS:JSON.stringify([scope+'/skills'])}});
 for(let i=0;i<300;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await sleep(100)}throw Error('API did not start')};
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});return {status:r.status,data:await r.json().catch(()=>({}))}};
const result={port,scope,steps:STEPS,stepMs:STEP_MS,checks,modelHash:sha(String(saved.llm.model)),endpointHash:sha(String(saved.llm.baseUrl)),protocol:saved.llm.api||null,
 boundary:'Real locally configured model (unchanged), production server, isolated synthetic skill/markers. Proves a >110s progressing durable skill workflow completes; expiry paths are covered by the controlled HTTP E2E.'};
try{
 await start();
 const used=JSON.parse(await readFile(scope+'/config.json','utf8')).llm;
 check('model, endpoint and protocol exactly the saved ones',used.model===saved.llm.model&&used.baseUrl===saved.llm.baseUrl&&(used.api||null)===(saved.llm.api||null));
 const c=(await api('POST','/api/conversations',{title:'处理时限真实验收',mode:'chat',status:'active'})).data.id,rid=randomUUID();
 const t0=Date.now();const r=await api('POST','/api/chat',{conversationId:c,message:`/skill:progress-real ${TASK}`,mode:'chat',requestId:rid,queueCurrent:true,preservePrimary:true});
 check('durable queued request accepted with 202',r.status===202,r.status);
 let q;for(;;){q=(await api('GET','/api/chat/requests/'+rid)).data;if(q.status&&!['queued','running','prepared'].includes(q.status))break;if(Date.now()-t0>20*60000)throw Error('request did not settle');await sleep(2000)}
 const run=(await api('GET','/api/runs/'+q.runId)).data,a=run.timeBudget?.answer||{};
 const lines=(await readFile(skillDir+'/markers/'+id+'.log','utf8').catch(()=>'')).split('\n').filter(Boolean);
 const starts=lines.filter(l=>l.startsWith('start ')),ends=lines.filter(l=>l.startsWith('end '));
 result.observed={status:q.status,failureCode:q.failureCode||null,answerElapsedMs:a.elapsedMs,endedBy:a.endedBy,mode:a.mode,watchdog:a.watchdog,phases:a.phases,steps:a.steps,attempts:a.attempts,retries:a.retries,toolCalls:a.toolCalls,maxParallelTools:a.maxParallelTools,toolErrors:a.toolErrors,deltas:a.deltas,progressEvents:a.progressEvents,providerRequests:a.providerRequests,timeout:[...(run.events||[])].reverse().find(e=>e.type==='timeout')||null,markerStarts:starts.length,markerEnds:ends.length,commandReceipts:(run.tools||[]).filter(x=>x.name==='run_command').map(x=>x.status)};
 check('durable phase watchdog was used',a.mode==='progress'&&a.watchdog==='phase'&&a.phases?.headersMs>=50000&&a.phases?.streamSilenceMs===30000,a);
 check('real workflow outlasted the old 110s answer timer',a.elapsedMs>110000,a.elapsedMs);
 check('request succeeded, ended by completion',q.status==='succeeded'&&a.endedBy==='completed',result.observed);
 check('each synthetic step ran exactly once',starts.length===STEPS&&ends.length===STEPS&&new Set(starts.map(l=>l.split(' ')[1])).size===STEPS,lines);
}catch(e){check('real journey completed',false,String(e?.message||e))}
finally{
 child?.kill('SIGTERM');await sleep(500);
 result.pass=!failed;await writeFile(OUT+'/result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({pass:result.pass,checks:checks.length,out:OUT}));
}
if(failed){process.exitCode=1;throw Error('chat progress budget real E2E failed')}
