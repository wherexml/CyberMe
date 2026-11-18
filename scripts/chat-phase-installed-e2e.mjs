// LOCAL-ONLY post-install acceptance for the durable chat phase watchdog with the REAL saved model, through the
// installed desktop workspace gateway. Run by the local coordinator after installing; never remotely:
//   node scripts/chat-phase-installed-e2e.mjs
// - Reads the private gateway connection (port + pilot token) and keeps the token in memory only; never printed.
// - Creates ONE clearly marked QA side conversation ("[QA] …", preservePrimary:true); never touches the primary
//   conversation, original business requests, the saved model or user settings; no external messages.
// - The workflow is benign and synthetic: sequential run_command steps (each ≤60s) that write marker lines into a
//   private isolated directory, then one readback. Stable operation IDs, ONE POST, GET-only recovery; an unknown
//   outcome is reported, never replayed.
// - Evidence contains booleans, counts, durations, statuses, hashes and the safe identifiers needed for exact GET-only
//   recovery (requestId, conversationId, runId, gateway port, installed build) — never the token, prompt, outputs or config.
//   The IDs are written as soon as the POST is accepted, so an interrupted run can be recovered by GET.
// Env: CYBERME_GATEWAY_CONNECTION, PHASE_INSTALLED_OUT, PHASE_INSTALLED_STEPS (3), PHASE_INSTALLED_STEP_MS (45000).
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {request} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve} from 'node:path';

const connFile=process.env.CYBERME_GATEWAY_CONNECTION||resolve(homedir(),'Library/Application Support/OpsTwins/.local/mygo-desktop/connection.json');
const OUT=(process.env.PHASE_INSTALLED_OUT||'/Users/steve/Projects/cyberme/output/chat-phase-watchdog-20261113')+'/installed-'+new Date().toISOString().replace(/[:.]/g,'-');
const STEPS=Number(process.env.PHASE_INSTALLED_STEPS||3),STEP_MS=Number(process.env.PHASE_INSTALLED_STEP_MS||45000);
if(!(STEPS>=2&&STEPS<=5)||!(STEP_MS>=1000&&STEP_MS<=55000))throw Error('steps must be 2..5 and step ms ≤55000 (run_command max 60s)');
await mkdir(OUT+'/markers',{recursive:true,mode:0o700});
const sha=s=>createHash('sha256').update(String(s)).digest('hex');
const checks=[];let failed=false;
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(pass?{}:{detail})});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)failed=true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const conn=JSON.parse(await readFile(connFile,'utf8'));
if(!Number.isInteger(conn.port)||typeof conn.token!=='string'||conn.token.length!==64)throw Error('connection_invalid');
function send(method,path,body){
 return new Promise((ok,fail)=>{
  const data=body===undefined?undefined:Buffer.from(JSON.stringify(body));
  const headers={'x-opstwins-client':'chat-phase-installed-e2e','x-opstwins-pilot':conn.token,...(data?{'content-type':'application/json','content-length':String(data.length)}:{})};
  const req=request({host:'127.0.0.1',port:conn.port,method,path,headers,timeout:60000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{let json=null;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{}ok({status:res.statusCode,json})})});
  req.on('timeout',()=>req.destroy(Error('timeout')));req.on('error',fail);if(data)req.write(data);req.end();
 });
}

const id='phase'+Date.now().toString(36),dir=OUT+'/markers',node=JSON.stringify(process.execPath);
await writeFile(dir+'/step.mjs',`import fs from 'node:fs';const [id,step,ms]=process.argv.slice(2);fs.appendFileSync(id+'.log','start '+step+'\\n');setTimeout(()=>{fs.appendFileSync(id+'.log','end '+step+'\\n');console.log('STEP_OK '+id+' '+step)},Number(ms)||0);`,{mode:0o600});
const steps=Array.from({length:STEPS},(_,i)=>`${i+1}. run_command：command \`${node} step.mjs ${id} ${i+1} ${STEP_MS}\`，cwd \`${dir}\`，timeoutMs 60000，operationId \`${id}-${i+1}\``).join('\n');
const message=`请实际执行这个公开合成验收流程（仅本机隔离目录，不联网、不发送任何消息、不修改其他文件）。依次执行，每一步等待结束后再执行下一步，每一步只执行一次，不要重复已返回的步骤：\n${steps}\n${STEPS+1}. run_command：command \`cat ${id}.log\`，cwd \`${dir}\`，operationId \`${id}-readback\`，确认有 ${STEPS} 行 start 和 ${STEPS} 行 end。\n最后用一句话报告结果。`;
const appPlist=process.env.CYBERME_APP_PLIST||'/Applications/CyberMe.app/Contents/Info.plist';
const plist=await readFile(appPlist,'utf8').catch(()=>'');const plistValue=k=>plist.match(new RegExp('<key>'+k+'</key>\\s*<string>([^<]*)</string>'))?.[1]||null;
const result={gateway:{port:conn.port},installed:{build:plistValue('CFBundleVersion'),version:plistValue('CFBundleShortVersionString')},ids:{},steps:STEPS,stepMs:STEP_MS,markerDirHash:sha(dir),messageHash:sha(message),checks,boundary:'Installed app, real saved model, private gateway; synthetic marker steps in an isolated directory; one QA side conversation. Not a test of other skills or business actions.'};
try{
 const health=await send('GET','/api/health');check('installed service reachable through the gateway',health.status===200,{status:health.status});
 result.service={runtimeMode:health.json?.runtimeMode||null,revision:health.json?.revision??null};
 const primaryBefore=await send('GET','/api/conversations/primary');const primaryId=primaryBefore.json?.conversationId||null;
 result.primary={readable:primaryBefore.status===200,idHash:primaryId?sha(primaryId):null};
 const sideId='ui-side-'+randomUUID();
 const side=await send('POST','/api/conversations/side',{id:sideId,title:'[QA] 阶段计时验收 '+new Date().toISOString().slice(0,16)});
 check('QA side conversation created',[200,201].includes(side.status)&&side.json?.id===sideId,{status:side.status});
 const rid='qa-phase-'+randomUUID(),t0=Date.now();
 const posted=await send('POST','/api/chat',{conversationId:sideId,message,mode:'chat',requestId:rid,queueCurrent:true,preservePrimary:true});
 check('one durable queued POST accepted (202)',posted.status===202,{status:posted.status});
 result.ids={requestId:rid,conversationId:sideId,runId:posted.json?.runId||null};await writeFile(OUT+'/result.json',JSON.stringify({...result,pending:true},null,2));
 let q;for(;;){q=(await send('GET','/api/chat/requests/'+rid)).json||{};if(q.status&&!['queued','running','prepared'].includes(q.status))break;if(Date.now()-t0>20*60000)throw Error('request did not settle (GET-only; not replayed)');await sleep(3000)}
 const run=(await send('GET','/api/runs/'+q.runId)).json||{},a=run.timeBudget?.answer||{};
 const log=await readFile(dir+'/'+id+'.log','utf8').catch(()=>'');const lines=log.split('\n').filter(Boolean);
 const starts=lines.filter(l=>l.startsWith('start ')),ends=lines.filter(l=>l.startsWith('end '));
 result.observed={status:q.status,failureCode:q.failureCode||null,wallMs:Date.now()-t0,answer:{elapsedMs:a.elapsedMs,endedBy:a.endedBy,mode:a.mode,watchdog:a.watchdog,phases:a.phases,steps:a.steps,attempts:a.attempts,retries:a.retries,toolCalls:a.toolCalls,maxParallelTools:a.maxParallelTools,toolErrors:a.toolErrors,deltas:a.deltas,progressEvents:a.progressEvents,providerRequests:a.providerRequests,hardMs:a.hardMs},timeout:[...(run.events||[])].reverse().find(e=>e.type==='timeout')?{budget:[...run.events].reverse().find(e=>e.type==='timeout').budget}:null,markerStarts:starts.length,markerEnds:ends.length,runCommands:(run.tools||[]).filter(x=>x.name==='run_command').map(x=>x.status)};
 check('phase watchdog audit present',a.mode==='progress'&&a.watchdog==='phase'&&!!a.phases,{mode:a.mode,watchdog:a.watchdog});
 check('real workflow ran longer than the old 110s window',a.elapsedMs>110000,a.elapsedMs);
 check('request succeeded and ended by completion',q.status==='succeeded'&&a.endedBy==='completed',{status:q.status,endedBy:a.endedBy});
 check('each synthetic step ran exactly once',starts.length===STEPS&&ends.length===STEPS&&new Set(starts).size===STEPS,{starts:starts.length,ends:ends.length});
 check('provider requests stayed under the unchanged ceiling',a.providerRequests>0&&a.providerRequests<=60,a.providerRequests);
 result.ids.runId=q.runId||result.ids.runId;
 const primaryAfter=await send('GET','/api/conversations/primary');
 if(primaryBefore.status===200)check('primary conversation binding preserved',primaryAfter.status===200&&primaryAfter.json?.conversationId===primaryId&&primaryId!==sideId,{before:!!primaryId,after:primaryAfter.status});
}catch(e){check('installed journey completed',false,String(e?.message||e).slice(0,200))}
finally{result.pass=!failed;await writeFile(OUT+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:checks.length,out:OUT}))}
if(failed){process.exitCode=1;throw Error('chat phase installed E2E failed (no replay attempted)')}
