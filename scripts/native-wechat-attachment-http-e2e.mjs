#!/usr/bin/env node
// Failure inventory FIRST: docs/journeys/native-wechat-attachment-api.md.
// Actual complete CLI processes + fresh public SQLite + production Hono API.
// Synthetic media proves byte transport, never private media usability or GUI.
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,chmod,lstat,realpath,readdir,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicAttachmentFixture} from './lib/greenbubbles-public-attachment-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),stamp=new Date().toISOString().replaceAll(':','-'),port=46230,api=`http://127.0.0.1:${port}`;
const naturalExpiry=process.argv.includes('--natural-expiry'),recovery=naturalExpiry||process.argv.includes('--recovery');
const sha=x=>createHash('sha256').update(x).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const out=join(root,'output/native-parity-20261003/wechat-attachment-http',stamp),work=join(root,'.local/acceptance/wechat-attachment-http',stamp),priv=join(root,'.local/private-runtime/wechat-attachment-http-'+randomUUID());
for(const p of [out,work,priv])await mkdir(p,{recursive:true,mode:0o700});
const readyBytes=await readFile(join(root,'output/native-parity-20261003/wechat-attachment-cli/candidate-ready.json'));
const ready=JSON.parse(readyBytes);
const candidate=await realpath(ready.candidateCli),candidateStat=await lstat(ready.candidateCli);
if(ready.status!=='PASS_BUILD'||!ready.archiveVerified||!candidate.startsWith(join(root,'.local/greenbubbles-attachment-candidate/bin/'))||candidateStat.isSymbolicLink()||!candidateStat.isFile()||candidateStat.uid!==process.getuid()||(candidateStat.mode&0o222)!==0||sha(await readFile(candidate))!==ready.compiledHash)throw Error('Immutable candidate provenance mismatch');
const fixture=createPublicAttachmentFixture(join(work,'fixture'));
const gate=join(work,'public-command-gate.json'),entered=join(work,'public-command-entered');
const commandCounts=join(work,'public-command-counts.json');
await writeFile(gate,JSON.stringify({delayMs:0}),{mode:0o600});
await writeFile(commandCounts,JSON.stringify({materialize:0}),{mode:0o600});
const listing=spawnSync(candidate,['messages','list',fixture.databaseRoot,'--decrypted','--conversation',fixture.conversation,'--limit','16','--json'],{encoding:'utf8',timeout:30000,maxBuffer:8000000});
const rows=JSON.parse(listing.stdout).items;
if(listing.status!==0||rows?.length!==4)throw Error('Public full CLI list failed');
// Fixed explicit public source injection; every command still runs the actual CLI.
// No protocol responses are fabricated. Unknown commands cannot reach a default profile.
const wrapperSource=`#!/usr/bin/env node
import{spawn}from'node:child_process';
import{readFileSync,writeFileSync}from'node:fs';
const a=process.argv.slice(2),candidate=${JSON.stringify(candidate)},db=${JSON.stringify(fixture.databaseRoot)},account=${JSON.stringify(fixture.accountRoot)};
let b;
if(a[0]==='chats')b=['conversations','list',db,'--decrypted',...a.slice(1)];
else if(['source','contacts','messages','message','attachment'].includes(a[0])&&['status','list','search','get','inspect','materialize'].includes(a[1]))b=[...a.slice(0,2),a[0]==='attachment'?account:db,'--decrypted',...a.slice(2)];
else process.exit(90);
// Public timing fault only: every response is still the real immutable CLI.
if(a[0]==='attachment'&&['materialize','inspect'].includes(a[1])){
 if(a[1]==='materialize'){const c=JSON.parse(readFileSync(${JSON.stringify(commandCounts)},'utf8'));c.materialize++;writeFileSync(${JSON.stringify(commandCounts)},JSON.stringify(c));}
 const g=JSON.parse(readFileSync(${JSON.stringify(gate)},'utf8'));
 if(g.delayMs>0&&(g.operation||'materialize')===a[1]){writeFileSync(${JSON.stringify(entered)},JSON.stringify({id:g.id}),{mode:0o600});await new Promise(r=>setTimeout(r,g.delayMs));}
}
const child=spawn(candidate,b,{stdio:'inherit',shell:false});child.once('error',()=>process.exit(91));child.once('exit',async code=>{
 const g=JSON.parse(readFileSync(${JSON.stringify(gate)},'utf8'));
 if(a[0]==='attachment'&&a[1]==='materialize'&&code===0&&g.operation==='after-materialize'&&g.delayMs>0){writeFileSync(${JSON.stringify(entered)},JSON.stringify({id:g.id,pid:process.pid,cliExit:code}),{mode:0o600});await new Promise(r=>setTimeout(r,g.delayMs));}
 process.exit(code??92);
});
`;
const wrapperHash=sha(wrapperSource),wrapperDir=join(root,'.local/greenbubbles-attachment-candidate/bin',wrapperHash),wrapper=join(wrapperDir,'greenbubbles');
await mkdir(wrapperDir,{recursive:true,mode:0o700});
await writeFile(wrapper,wrapperSource,{mode:0o500,flag:'wx'});await chmod(wrapper,0o500);
await writeFile(join(priv,'config.json'),'{}',{mode:0o600});
const sql=join(work,'server','opstwin-advance.db');await mkdir(join(work,'server'),{mode:0o700});
const db=new DatabaseSync(sql);db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'OPSADV-QA attachment HTTP',language:'en'},autonomy:{holdSending:true},channels:{}}));db.close();
const paths=['server/src/wechat-sync.ts','server/src/wechat-attachment-cli.ts','server/src/index.ts','scripts/native-wechat-attachment-http-e2e.mjs','scripts/lib/greenbubbles-public-attachment-fixture.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(join(root,p)))])));
const report={schema:1,at:new Date().toISOString(),scope:'public SQLite actual CLI + isolated production HTTP; synthetic bytes, no live/private/default-profile reads',recovery,naturalExpiry,compiledHash:ready.compiledHash,buildManifestHash:sha(readyBytes),wrapperHash,fixtureSchemaHash:fixture.fixtureSchemaHash,sourceHashes,checks:[],guiAcceptance:false,realNonimageUsability:'NOT_RUN_NO_CANDIDATE',externalSends:0};
const check=(id,ok,evidence={})=>report.checks.push({id,status:ok?'PASS':'FAIL',...evidence});
async function request(path,method='GET',body){const response=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});let data;try{data=await response.json()}catch{}return{status:response.status,data};}
async function delayMaterialize(operation='materialize',delayMs=1200){const id=randomUUID();await writeFile(gate,JSON.stringify({id,operation,delayMs}));return id;}
async function awaitEntered(id){for(let i=0;i<100;i++){try{if(JSON.parse(await readFile(entered,'utf8')).id===id)return;}catch{}await pause(50);}throw Error('Public timing gate was not reached');}
let child,log='';
async function startServer(){
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:'46231',OPSTWIN_DATA_DIR:join(work,'server'),OPSTWIN_PRIVATE_DIR:priv,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_WECHAT_CLI:wrapper,OPSTWIN_WECHAT_ATTACHMENT_SHA256:wrapperHash},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 let healthy=false;for(let i=0;i<100;i++){try{healthy=(await request('/api/health')).status===200;if(healthy)break;}catch{}await pause(100);}if(!healthy)throw Error('Isolated HTTP service unavailable');
}
async function stopServer(signal='SIGTERM'){
 const owned=child;if(!owned)return;owned.kill(signal);await Promise.race([new Promise(r=>owned.once('exit',r)),pause(3000)]);
 if(owned.exitCode===null&&owned.signalCode===null)throw Error('Owned test service did not exit');child=undefined;return owned.pid;
}
try{
 await new Promise((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});await startServer();
 const connected=await request('/api/wechat/connect','POST',{});check('CONNECT-FULL-CLI-PUBLIC-SOURCE',connected.status===200&&connected.data?.ok===true,{http:connected.status});
 const capabilities=await request('/api/wechat/capabilities');check('VERIFIED-CAPABILITIES-HONEST-SCOPE',capabilities.status===200&&capabilities.data?.attachments?.mode==='verified-exact-cli'&&capabilities.data?.attachments?.businessMediaVerified===false&&capabilities.data?.send===false);
 const chats=await request('/api/wechat/chats?limit=10');check('CURRENT-CONVERSATION-SAME-CLI',chats.status===200&&chats.data?.items?.some(c=>c.id===fixture.conversation));
 const messages=await request('/api/wechat/messages?conversation='+encodeURIComponent(fixture.conversation)+'&limit=16');check('FOUR-SAME-SECOND-MESSAGES',messages.status===200&&messages.data?.items?.length===4&&messages.data.items.every(m=>m.at===200));
 const tokens=[];
 for(const m of rows){
  const kind=m.messageType===34?'voice':m.messageType===43?'video':'document';
  const expected=kind==='voice'?fixture.expectedBytes.voice:kind==='video'?fixture.expectedBytes.video:fixture.expectedBytes.documents[m.serverId-3004];
  const result=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:m.id,kind:'image',path:'/OPSADV-QA-FORGED',candidate:'0'.repeat(64)});
  check('EXACT-'+kind+'-'+m.serverId,result.status===200&&result.data?.sha256===sha(expected)&&result.data?.bytes===expected.length&&/^[a-f0-9-]{36}$/.test(result.data?.attachmentId||'')&&result.data?.url==='/api/wechat/attachments/'+result.data?.attachmentId,{http:result.status,code:result.data?.error,bytes:result.data?.bytes});
  check('METADATA-BOUND-PRIVATE-'+m.serverId,result.status===200&&result.data?.kind===kind&&result.data?.readOnly===true&&result.data?.storage==='bounded-memory'&&result.data?.formatValidation==='header-only'&&!JSON.stringify(result.data).includes(work)&&!JSON.stringify(result.data).includes(priv));
  if(result.status===200&&typeof result.data?.url==='string'){
   const r=await fetch(api+result.data.url,{signal:AbortSignal.timeout(50000)}),bytes=Buffer.from(await r.arrayBuffer());
   check('BYTES-'+kind+'-'+m.serverId,r.status===200&&bytes.equals(expected)&&sha(bytes)===result.data.sha256&&r.headers.get('content-type')===result.data.mime&&r.headers.get('x-content-type-options')==='nosniff'&&r.headers.get('cache-control')==='no-store',{http:r.status,bytes:bytes.length,sha256:sha(bytes)});
   tokens.push(result.data.attachmentId);
  }
 }
 check('FOUR-DISTINCT-MESSAGE-TOKENS',tokens.length===4&&new Set(tokens).size===4);
 const wrong=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:'OPSADV-QA-WRONG'});check('WRONG-OPAQUE-MESSAGE-REFUSED',wrong.status>=400,{http:wrong.status});
 const guessed=await request('/api/wechat/attachment','POST',{conversation:'OPSADV-QA-UNSEEN',message:rows[0].id});check('UNSEEN-CONVERSATION-REFUSED',guessed.status===409&&guessed.data?.error==='wechat_conversation_unverified');
 const unknown=await request('/api/wechat/attachments/'+randomUUID());check('UNKNOWN-TOKEN-EXPIRED',unknown.status===404&&unknown.data?.error==='wechat_attachment_expired');
 const file=join(fixture.accountRoot,'msg/file',fixture.conversation,'2026-08/report-0.pdf');
 const original=await readFile(file);await writeFile(file,Buffer.from('%PDF-1.7 OPSADV-QA document X'));
 const stale=await request('/api/wechat/attachments/'+tokens[2]);check('MODIFIED-SOURCE-OLD-TOKEN-REFUSED',stale.status===409,{http:stale.status,code:stale.data?.error});
 await writeFile(file,original);
 const voice=rows.find(m=>m.messageType===34);
 const gateId=await delayMaterialize(),pending=request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});await awaitEntered(gateId);
 const competing=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});check('CONCURRENT-MATERIALIZE-REFUSED',competing.status===409&&competing.data?.error==='wechat_attachment_busy');
 const competingContent=await request('/api/wechat/attachments/'+tokens[0]);check('CONCURRENT-CONTENT-REFUSED',competingContent.status===409&&competingContent.data?.error==='wechat_attachment_busy');
 const completed=await pending;check('ORIGINAL-CONCURRENT-REQUEST-COMPLETES',completed.status===200&&completed.data?.sha256===sha(fixture.expectedBytes.voice));
 const disconnectGate=await delayMaterialize(),late=request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});await awaitEntered(disconnectGate);
 const disconnected=await request('/api/connections/wechat-sync-local/disconnect','POST',{});check('DISCONNECT',disconnected.status===200);
 const lateResult=await late;check('DISCONNECTED-INFLIGHT-NO-PUBLISH',lateResult.status===409&&!lateResult.data?.attachmentId,{http:lateResult.status,code:lateResult.data?.error});
 await writeFile(gate,JSON.stringify({delayMs:0}));
 for(const token of tokens){const r=await fetch(api+'/api/wechat/attachments/'+token);check('OLD-TOKEN-DISCONNECTED',r.status===409,{http:r.status});}
 const temp=join(priv,'wechat-attachment-temp');check('PRIVATE-OPERATION-TEMP-CLEANED',(await readdir(temp)).length===0);
 const reconnected=await request('/api/wechat/connect','POST',{});check('RECONNECT',reconnected.status===200);
 const old=await request('/api/wechat/attachments/'+tokens[0]);check('OLD-TOKEN-NOT-RESTORED',old.status===404&&old.data?.error==='wechat_attachment_expired');
 await request('/api/wechat/chats?limit=10');
 const refreshed=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});check('FRESH-READ-AFTER-RECONNECT',refreshed.status===200&&refreshed.data?.sha256===sha(fixture.expectedBytes.voice));
 // Failure face 3/11: inspect success after disconnect must not start a new read.
 const priorMaterialize=JSON.parse(await readFile(commandCounts,'utf8')).materialize;
 const inspectGate=await delayMaterialize('inspect'),inspecting=request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});await awaitEntered(inspectGate);
 const revoked=await request('/api/connections/wechat-sync-local/disconnect','POST',{});check('DISCONNECT-DURING-INSPECT',revoked.status===200);
 const inspected=await inspecting,afterMaterialize=JSON.parse(await readFile(commandCounts,'utf8')).materialize;
 check('REVOKED-INSPECT-NO-NEW-MATERIALIZE',inspected.status===409&&afterMaterialize===priorMaterialize&&!inspected.data?.attachmentId,{http:inspected.status,materializeDelta:afterMaterialize-priorMaterialize});
 await writeFile(gate,JSON.stringify({delayMs:0}));
 await request('/api/wechat/connect','POST',{});await request('/api/wechat/chats?limit=10');
 const bounded=[];for(let i=0;i<17;i++){const r=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});if(r.status===200)bounded.push(r.data.attachmentId);}
 check('SEVENTEEN-EXACT-READS',bounded.length===17&&new Set(bounded).size===17);
 const evicted=await request('/api/wechat/attachments/'+bounded[0]);check('SIXTEEN-ITEM-CACHE-EVICTS-OLDEST',evicted.status===404&&evicted.data?.error==='wechat_attachment_expired');
 const latest=await fetch(api+'/api/wechat/attachments/'+bounded.at(-1));check('LATEST-ITEM-STILL-READABLE',latest.status===200&&Buffer.from(await latest.arrayBuffer()).equals(fixture.expectedBytes.voice));
 // Actual public SQLite payloads, not fabricated CLI envelopes or cache internals.
 const mediaDb=new DatabaseSync(join(fixture.databaseRoot,'media/media_0.db'));
 const large=Buffer.alloc(24000000,65);fixture.expectedBytes.voice.copy(large);
 mediaDb.prepare('UPDATE VoiceInfo SET voice_data=? WHERE svr_id=3002').run(large);
 const budget=[];for(let i=0;i<3;i++){const r=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});if(r.status===200&&r.data.bytes===large.length&&r.data.sha256===sha(large))budget.push(r.data.attachmentId);}
 check('THREE-LARGE-VERIFIED-READS',budget.length===3);
 const oldestLarge=await request('/api/wechat/attachments/'+budget[0]);check('SIXTY-FOUR-MIB-CACHE-EVICTS-OLDEST',oldestLarge.status===404&&oldestLarge.data?.error==='wechat_attachment_expired');
 const latestLarge=await fetch(api+'/api/wechat/attachments/'+budget.at(-1));const latestLargeBytes=Buffer.from(await latestLarge.arrayBuffer());check('LATEST-LARGE-BYTES-EXACT',latestLarge.status===200&&latestLargeBytes.equals(large));
 const tooLarge=Buffer.alloc(25000001,65);fixture.expectedBytes.voice.copy(tooLarge);mediaDb.prepare('UPDATE VoiceInfo SET voice_data=? WHERE svr_id=3002').run(tooLarge);
 const beforeOversize=JSON.parse(await readFile(commandCounts,'utf8')).materialize;
 const over=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});const afterOversize=JSON.parse(await readFile(commandCounts,'utf8')).materialize;
 check('OVER-TWENTY-FIVE-MB-NO-MATERIALIZE',over.status===413&&over.data?.error==='wechat_attachment_too_large'&&beforeOversize===afterOversize,{http:over.status,materializeDelta:afterOversize-beforeOversize});
 mediaDb.prepare('UPDATE VoiceInfo SET voice_data=? WHERE svr_id=3002').run(fixture.expectedBytes.voice);mediaDb.close();large.fill(0);tooLarge.fill(0);
 if(recovery){
  const preRestart=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});
  const stopped=await stopServer();await startServer();
  const lost=await request('/api/wechat/attachments/'+preRestart.data?.attachmentId);check('NORMAL-RESTART-RAM-TOKEN-NOT-RESTORED',preRestart.status===200&&stopped>0&&lost.status===404&&lost.data?.error==='wechat_attachment_expired');
  await request('/api/wechat/chats?limit=10');
  const restartRead=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});check('NORMAL-RESTART-FRESH-EXACT-READ',restartRead.status===200&&restartRead.data?.sha256===sha(fixture.expectedBytes.voice));
  const crashGate=await delayMaterialize('after-materialize',120000);
  const crashPending=request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id}).catch(()=>({status:0}));await awaitEntered(crashGate);
  const marker=JSON.parse(await readFile(entered,'utf8')),crashPid=child.pid;
  const operations=(await readdir(temp)).filter(n=>n.startsWith('operation-'+crashPid+'-'));
  check('ACTUAL-CLI-OUTPUT-BEFORE-CRASH',marker.cliExit===0&&operations.length===1&&(await readdir(join(temp,operations[0]))).includes('output'));
  await stopServer('SIGKILL');const crashed=await crashPending;
  // Owned wrapper only; its actual CLI child has already exited.
  if(Number.isInteger(marker.pid)&&marker.pid>0)try{process.kill(marker.pid,'SIGTERM');}catch{}
  check('ACTUAL-API-CRASH-NO-SUCCESS-RECEIPT',crashed.status===0);
  await writeFile(gate,JSON.stringify({delayMs:0}));
  const liveOperation=join(temp,'operation-'+process.pid+'-OPSADVQA');await mkdir(liveOperation,{mode:0o700});await writeFile(join(liveOperation,'public-sentinel'),'OPSADV-QA live operation',{mode:0o600});
  await startServer();await request('/api/wechat/chats?limit=10');
  const recovered=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});check('CRASH-RESTART-FRESH-EXACT-READ',recovered.status===200&&recovered.data?.sha256===sha(fixture.expectedBytes.voice));
  const remaining=await readdir(temp);check('DEAD-PROCESS-OPERATIONS-CLEANED',operations.every(n=>!remaining.includes(n)));
  check('LIVE-PROCESS-OPERATION-PRESERVED',(await readFile(join(liveOperation,'public-sentinel'),'utf8'))==='OPSADV-QA live operation');await rm(liveOperation,{recursive:true});
  if(naturalExpiry&&recovered.status===200){
   const deadline=Date.parse(recovered.data.expiresAt),issued=deadline-600000;
   console.log(JSON.stringify({phase:'WAIT_REAL_TEN_MINUTE_EXPIRY',counts:{PASS:report.checks.filter(x=>x.status==='PASS').length,FAIL:report.checks.filter(x=>x.status==='FAIL').length},deadline:new Date(deadline).toISOString()}));
   while(Date.now()<=deadline)await pause(Math.min(30000,deadline-Date.now()+250));
   const expired=await request('/api/wechat/attachments/'+recovered.data.attachmentId);
   check('NATURAL-TEN-MINUTE-TOKEN-EXPIRY',expired.status===404&&expired.data?.error==='wechat_attachment_expired'&&Date.now()-issued>=600000,{elapsedMs:Date.now()-issued,http:expired.status});
   const reread=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});check('FRESH-EXACT-READ-AFTER-NATURAL-EXPIRY',reread.status===200&&reread.data?.sha256===sha(fixture.expectedBytes.voice));
  }
 }
 const inspect=new DatabaseSync(sql,{readOnly:true});check('ZERO-SEND-INTENTS',inspect.prepare('SELECT count(*) n FROM send_intents').get().n===0);inspect.close();
 check('FROZEN-CLI-AND-WRAPPER',sha(await readFile(candidate))===ready.compiledHash&&sha(await readFile(wrapper))===wrapperHash);
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,300)};check('HARNESS-COMPLETES',false);}
finally{
 if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);check('OWNED-SERVER-EXIT',child.exitCode!==null||child.signalCode!==null);}
 report.serverLogHash=sha(log);report.sourceStable=(await Promise.all(paths.map(async p=>sha(await readFile(join(root,p)))===sourceHashes[p]))).every(Boolean);
 check('SOURCE-STABLE',report.sourceStable);report.counts=Object.fromEntries(['PASS','FAIL'].map(s=>[s,report.checks.filter(c=>c.status===s).length]));report.status=report.counts.FAIL?'FAIL':'PASS_SCOPE';
 await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,counts:report.counts,manifest:join(out,'manifest.json')}));if(report.counts.FAIL)process.exitCode=1;
}
