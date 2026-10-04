#!/usr/bin/env node
// Failure inventory FIRST: docs/journeys/native-wechat-gui.md.
// Public SQLite -> actual immutable CLI -> production API. No GUI / private profile.
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,chmod,lstat,realpath,readdir,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicAttachmentFixture} from './lib/greenbubbles-public-attachment-fixture.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),port=46226,adjacent=46227,api=`http://127.0.0.1:${port}`;
const scope='OPSADV-QA Green GUI',artifactRoot=join(root,'output/native-parity-20261003/wechat-gui-service'),readyFile=join(artifactRoot,'ready.json');
const sha=x=>createHash('sha256').update(x).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(condition,code)=>{if(!condition)throw Error(code)};
const emit=value=>console.log(JSON.stringify(value));
const request=async(path,method='GET',body)=>{
 const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});
 let value;try{value=await r.json()}catch{}return{status:r.status,value};
};
async function contained(path){
 assert(resolve(path)===path&&path.startsWith(root+sep),'unsafe_project_path');
 let current=root;for(const part of path.slice(root.length+1).split(sep)){current=join(current,part);const s=await lstat(current);assert(!s.isSymbolicLink()&&await realpath(current)===current,'unsafe_path_link');}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function safeAncestors(path,allowMissing=false){
 assert(typeof path==='string'&&resolve(path)===path&&path.startsWith(root+sep),'unsafe_project_path');
 let current=sep;
 for(const part of path.slice(1).split(sep)){
  current=join(current,part);let s;
  try{s=await lstat(current)}catch(error){if(error.code==='ENOENT'&&allowMissing)return;throw error;}
  assert(!s.isSymbolicLink()&&await realpath(current)===current,'unsafe_path_link');
  if(current===root||current.startsWith(root+sep))assert(s.uid===process.getuid()&&(s.mode&0o022)===0,'unsafe_path_owner');
 }
}
function tokenPath(runId){assert(uuid.test(runId),'invalid_run_id');return join(artifactRoot,'restart-tokens-'+runId+'.json');}
async function validateRun(ready){
 assert(ready?.schema==='opsadv.wechat-gui-service.v1'&&uuid.test(ready.runId)&&ready.scope===scope&&ready.api===api&&ready.marker===scope+' '+ready.runId,'invalid_owned_scope');
 const work=join(root,'.local/acceptance/wechat-gui-service',ready.runId);
 const expected={dataDir:join(work,'server'),sql:join(work,'server/opstwin-advance.db'),nativeState:join(work,'native'),privateDir:join(root,'.local/private-runtime/wechat-gui-service-'+ready.runId),commandCounts:join(work,'public-cli-counts.json'),saveTargets:join(work,'explicit-save-targets'),noOverwriteTarget:join(work,'explicit-save-targets/OPSADV-QA-no-overwrite.pdf')};
 for(const [key,path] of Object.entries(expected)){assert(ready[key]===path,'invalid_owned_path_'+key);await safeAncestors(path);}
 for(const name of ['config.json','wechat-attachment-runtime.json'])await safeAncestors(join(expected.privateDir,name));
 assert(dirname(ready.serverEntry)===work&&/^public-service-entry(?:-[a-f0-9-]{36})?\.mjs$/.test(ready.serverEntry.slice(work.length+1)),'invalid_owned_entry');await safeAncestors(ready.serverEntry);
 assert(Array.isArray(ready.messageRecords)&&ready.messageRecords.length===4&&new Set(ready.messageRecords.map(m=>m.serverId)).size===4&&ready.messageRecords.every(m=>[3002,3003,3004,3005].includes(m.serverId)&&typeof m.messageId==='string'&&m.messageId.length<4096&&/^[a-f0-9]{64}$/.test(m.sha256)),'invalid_owned_messages');
 await safeAncestors(artifactRoot);await safeAncestors(tokenPath(ready.runId),true);
 return work;
}
async function restartEvidence(runId){
 const path=tokenPath(runId);await safeAncestors(path);
 const s=await lstat(path);assert(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o7777)===0o600&&s.size<=65536,'invalid_restart_token_file');
 const value=JSON.parse(await readFile(path,'utf8'));
 assert(value.schema==='opsadv.wechat-gui-restart-tokens.v1'&&value.runId===runId&&Number.isInteger(value.apiPID)&&value.apiPID>0&&Array.isArray(value.tokens)&&value.tokens.length===4&&new Set(value.tokens.map(t=>t.serverId)).size===4&&value.tokens.every(t=>[3002,3003,3004,3005].includes(t.serverId)&&/^[a-f0-9-]{36}$/.test(t.attachmentId)&&/^[a-f0-9]{64}$/.test(t.sha256)&&t.verifiedReadable===true),'invalid_restart_tokens');
 return value;
}
async function storeRestartEvidence(value){
 const path=tokenPath(value.runId),temp=path+'.'+randomUUID()+'.tmp';
 await safeAncestors(path,true);await safeAncestors(temp,true);
 let existing;try{existing=await lstat(path)}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing)assert(existing.isFile()&&existing.nlink===1&&existing.uid===process.getuid()&&(existing.mode&0o7777)===0o600,'invalid_restart_token_file');
 try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await safeAncestors(path,true);await rename(temp,path);}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function immutable(path,digest){
 await contained(path);assert(path===join(root,'.local/greenbubbles-attachment-candidate/bin',digest,'greenbubbles'),'unsafe_candidate_archive');
 const s=await lstat(path);assert(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o222)===0&&(s.mode&0o100)!==0&&sha(await readFile(path))===digest,'candidate_digest_or_owner');
}
async function available(p){await new Promise((ok,fail)=>{const s=createServer();s.once('error',()=>fail(Error('port_occupied_'+p)));s.listen(p,'127.0.0.1',()=>s.close(ok));});}
async function sourceHashes(){
 const paths=['scripts/native-wechat-gui-service.mjs','scripts/lib/greenbubbles-public-attachment-fixture.mjs'];
 async function walk(path){for(const entry of await readdir(join(root,path),{withFileTypes:true})){const p=path+'/'+entry.name;if(entry.isDirectory())await walk(p);else if(entry.isFile()&&/\.(ts|json)$/.test(entry.name))paths.push(p);}}
 await walk('server/src');await walk('shared');
 return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(join(root,p)))])));
}
async function priorReady(){try{return JSON.parse(await readFile(readyFile,'utf8'))}catch{return null;}}
async function verifyExisting(ready){
 assert(ready?.status==='READY_PUBLIC_HTTP'&&ready.api===api&&ready.scope===scope,'scope_not_reusable');
 await validateRun(ready);
 const health=await request('/api/health'),settings=await request('/api/settings');
 assert(health.status===200&&settings.status===200&&settings.value?.identity?.name===ready.marker&&settings.value?.autonomy?.holdSending===true,'existing_identity_mismatch');
 await immutable(ready.candidateCli,ready.candidateSHA256);await immutable(ready.wrapperCli,ready.wrapperSHA256);
 const current=await sourceHashes();assert(JSON.stringify(Object.keys(current).sort())===JSON.stringify(Object.keys(ready.sourceHashes).sort())&&Object.keys(current).every(p=>current[p]===ready.sourceHashes[p]),'existing_source_hash_changed');
 const cliCounts=await readFile(ready.commandCounts,'utf8');assert(JSON.parse(cliCounts).denied===0,'existing_unknown_cli_command');
 return ready;
}
await safeAncestors(readyFile,true);
const old=await priorReady();
if(process.argv.includes('--stop')){
 assert(old?.status==='READY_PUBLIC_HTTP'&&old.api===api&&old.scope===scope,'no_owned_ready');
 await validateRun(old);
 const settings=await request('/api/settings');assert(settings.status===200&&settings.value?.identity?.name===old.marker,'owned_marker_mismatch');
 const assertManagerOwned=()=>{
  const p=spawnSync('ps',['-p',String(old.managerPID),'-o','command='],{encoding:'utf8'}),ppid=spawnSync('ps',['-p',String(old.apiPID),'-o','ppid='],{encoding:'utf8'}),cwd=spawnSync('lsof',['-a','-p',String(old.managerPID),'-d','cwd','-Fn'],{encoding:'utf8'});
  const script=join(root,'scripts/native-wechat-gui-service.mjs'),commands=['node',process.execPath].flatMap(exe=>[`${exe} ${script}`,`${exe} scripts/native-wechat-gui-service.mjs`]);
  assert(p.status===0&&commands.some(c=>p.stdout.trim()===c||p.stdout.trim()===c+' --resume')&&ppid.status===0&&Number(ppid.stdout.trim())===old.managerPID&&cwd.status===0&&cwd.stdout.split('\n').includes('n'+root),'manager_ownership_mismatch');
 };assertManagerOwned();
 // Capture only this scope's four public references while still readable.
 const list=await request('/api/wechat/chats?limit=10');assert(list.status===200&&list.value?.items?.some(c=>c.id===old.conversationId),'owned_public_conversation_unavailable');
 const tokens=[];
 for(const m of old.messageRecords){
  const result=await request('/api/wechat/attachment','POST',{conversation:old.conversationId,message:m.messageId});
  assert(result.status===200&&result.value?.sha256===m.sha256&&result.value?.bytes===m.bytes&&result.value?.kind===m.kind,'owned_stop_token_metadata');
  const r=await fetch(api+result.value.url,{signal:AbortSignal.timeout(50000)}),bytes=Buffer.from(await r.arrayBuffer());
  assert(r.status===200&&bytes.length===m.bytes&&sha(bytes)===m.sha256,'owned_stop_token_bytes');
  tokens.push({messageId:m.messageId,serverId:m.serverId,attachmentId:result.value.attachmentId,sha256:m.sha256,bytes:m.bytes,expiresAt:result.value.expiresAt,verifiedReadable:true});
 }
 const evidence={schema:'opsadv.wechat-gui-restart-tokens.v1',runId:old.runId,apiPID:old.apiPID,capturedAt:new Date().toISOString(),capturedBy:'owned-stop-readable',tokens};
 await storeRestartEvidence(evidence);assertManagerOwned();
 process.kill(old.managerPID,'SIGTERM');emit({status:'OWNED_SIGTERM_REQUESTED',managerPID:old.managerPID,apiPID:old.apiPID});process.exit(0);
}
if(old&&!process.argv.includes('--resume')){try{await verifyExisting(old);emit({status:'READY_REUSED',ready:readyFile,managerPID:old.managerPID,apiPID:old.apiPID});process.exit(0);}catch(error){
 try{const h=await request('/api/health');if(h.status===200)throw Error('occupied_service_not_reusable');}catch(e){if(e.message==='occupied_service_not_reusable')throw e;}
}}
await available(port);await available(adjacent);
const resume=process.argv.includes('--resume');
if(resume)assert(old?.status==='STOPPED_OWNED'&&old.api===api&&old.scope===scope,'resume_requires_owned_stopped_scope');
if(resume)await validateRun(old);
const runId=resume?old.runId:randomUUID(),stamp=new Date().toISOString().replaceAll(':','-'),out=join(artifactRoot,stamp),work=resume?dirname(old.dataDir):join(root,'.local/acceptance/wechat-gui-service',runId),priv=resume?old.privateDir:join(root,'.local/private-runtime/wechat-gui-service-'+runId);
const priorTokens=resume?await restartEvidence(runId):undefined;
if(resume)assert(priorTokens.tokens.every(t=>old.messageRecords.some(m=>m.serverId===t.serverId&&m.messageId===t.messageId&&m.sha256===t.sha256&&m.bytes===t.bytes)),'restart_tokens_wrong_scope');
for(const p of [artifactRoot,out,work,priv])await safeAncestors(p,true);
for(const p of [artifactRoot,out,work,priv])await mkdir(p,{recursive:true,mode:0o700});
const nativeState=join(work,'native'),data=join(work,'server'),saveTargets=join(work,'explicit-save-targets');
if(resume){for(const p of [work,priv,nativeState,data,saveTargets])await contained(p);}else{
 for(const p of [nativeState,data,saveTargets])await mkdir(p,{mode:0o700});
 await writeFile(join(saveTargets,'OPSADV-QA-no-overwrite.pdf'),'OPSADV-QA original must remain',{mode:0o600,flag:'wx'});
}
const noOverwriteSHA256=sha(await readFile(join(saveTargets,'OPSADV-QA-no-overwrite.pdf')));
if(resume)assert(noOverwriteSHA256===old.noOverwriteSHA256&&nativeState===old.nativeState,'resume_original_state_changed');
const before=await sourceHashes(),readyBytes=await readFile(join(root,'output/native-parity-20261003/wechat-attachment-cli/candidate-ready.json')),candidateReady=JSON.parse(readyBytes);
assert(candidateReady.status==='PASS_BUILD'&&candidateReady.archiveVerified&&candidateReady.compiledHash==='2b3a9a917ab84eea265f09a176f598c8d7748e0d8f1099199b206ce8d0dd7cfd','candidate_provenance');
const candidate=candidateReady.candidateCli;await immutable(candidate,candidateReady.compiledHash);
const fixtureRoot=join(work,'fixture');
const f=resume?{conversation:old.conversationId,databaseRoot:join(fixtureRoot,'account/db_storage'),accountRoot:join(fixtureRoot,'account'),fixtureSchemaHash:old.fixtureSchemaHash,expectedBytes:{voice:Buffer.from('\x02#!SILK_V3synthetic-lossless-voice','binary'),video:Buffer.from('\x00\x00\x00\x18ftypmp42synthetic-video','binary'),documents:[Buffer.from('%PDF-1.7 OPSADV-QA document A'),Buffer.from('%PDF-1.7 OPSADV-QA document B')]}}:createPublicAttachmentFixture(fixtureRoot),counts=join(work,'public-cli-counts.json');
if(resume){await contained(f.databaseRoot);await contained(f.accountRoot);assert(JSON.parse(await readFile(counts,'utf8')).denied===0,'resume_cli_count_invalid');}else await writeFile(counts,JSON.stringify({delegated:0,denied:0}),{mode:0o600,flag:'wx'});
const wrapperSource=`#!/usr/bin/env node
import{spawn}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const a=process.argv.slice(2),candidate=${JSON.stringify(candidate)},db=${JSON.stringify(f.databaseRoot)},account=${JSON.stringify(f.accountRoot)},counts=${JSON.stringify(counts)};
const c=JSON.parse(readFileSync(counts,'utf8'));let b;
if(a[0]==='chats')b=['conversations','list',db,'--decrypted',...a.slice(1)];
else if(['source','contacts','messages','message','attachment'].includes(a[0])&&['status','list','search','get','inspect','materialize'].includes(a[1]))b=[...a.slice(0,2),a[0]==='attachment'?account:db,'--decrypted',...a.slice(2)];
else{c.denied++;writeFileSync(counts,JSON.stringify(c));process.exit(90);}
c.delegated++;writeFileSync(counts,JSON.stringify(c));const child=spawn(candidate,b,{stdio:'inherit',shell:false});child.once('error',()=>process.exit(91));child.once('exit',code=>process.exit(code??92));
`;
const wrapperHash=sha(wrapperSource),wrapperDir=join(root,'.local/greenbubbles-attachment-candidate/bin',wrapperHash),wrapper=join(wrapperDir,'greenbubbles');
if(resume)assert(wrapper===old.wrapperCli&&wrapperHash===old.wrapperSHA256,'resume_wrapper_changed');else{await mkdir(wrapperDir,{recursive:true,mode:0o700});await writeFile(wrapper,wrapperSource,{mode:0o500,flag:'wx'});await chmod(wrapper,0o500);}await immutable(wrapper,wrapperHash);
if(!resume)await writeFile(join(priv,'config.json'),'{}',{mode:0o600,flag:'wx'});else assert((await readFile(join(priv,'config.json'),'utf8'))==='{}','resume_private_config_changed');
if(!resume)await writeFile(join(priv,'wechat-attachment-runtime.json'),JSON.stringify({schema:'opstwins.wechat-attachment-runtime.v1',cliPath:wrapper,sha256:wrapperHash}),{mode:0o600,flag:'wx'});else{const binding=JSON.parse(await readFile(join(priv,'wechat-attachment-runtime.json'),'utf8'));assert(binding.schema==='opstwins.wechat-attachment-runtime.v1'&&binding.cliPath===wrapper&&binding.sha256===wrapperHash,'resume_binding_changed');}
const sql=join(data,'opstwin-advance.db'),marker=scope+' '+runId;
if(!resume){const db=new DatabaseSync(sql);db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');
db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:marker,role:'Public fixture owner',about:'',instructions:'',language:'en'},autonomy:{holdSending:true,levels:{ack:'observe',meet:'observe',docs:'observe',commit:'draft',boss:'draft',sensitive:'observe'},deepThink:[],files:[],quietFrom:'23:00',quietUntil:'07:00',alerts:'none',transparency:true},channels:{feishu:{enabled:false},email:{enabled:false},wechat:{enabled:true}},appearance:{fontSize:15}}));db.close();}else{const db=new DatabaseSync(sql,{readOnly:true});const existing=JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('settings').value);assert(existing.identity.name===marker&&existing.autonomy.holdSending===true,'resume_SQL_identity_mismatch');db.close();}
const entry=join(work,'public-service-entry-'+randomUUID()+'.mjs');
await writeFile(entry,`import{serve}from'@hono/node-server';import{app}from ${JSON.stringify(join(root,'server/src/index.ts'))};
const writes=new Set(['/api/wechat/connect','/api/wechat/attachment','/api/wechat/contacts','/api/wechat/messages/search','/api/wechat/message','/api/connections/wechat-sync-local/disconnect']);
const server=serve({hostname:'127.0.0.1',port:46226,fetch:(request)=>{const path=new URL(request.url).pathname;if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!(request.method==='POST'&&writes.has(path)))return new Response(JSON.stringify({error:'public_gui_write_blocked',message:'Public read-only GUI fixture'}),{status:403,headers:{'content-type':'application/json'}});return app.fetch(request);}});process.on('SIGTERM',()=>server.close());
`,{mode:0o600,flag:'wx'});
const env={...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(adjacent),OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:priv,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'};
delete env.OPSTWIN_WECHAT_CLI;delete env.OPSTWIN_WECHAT_ATTACHMENT_SHA256;
let child,stopping=false;const logHash=createHash('sha256'),checks=[];
const check=(id,ok,metadata={})=>{checks.push({id,status:ok?'PASS':'FAIL',...metadata});assert(ok,id)};
let manifest;
async function stopOwned(){
 if(stopping)return;stopping=true;
 if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(4000)]);}
 if(manifest){
  let tokens;try{tokens=await restartEvidence(runId)}catch{}
  if(!tokens||tokens.apiPID!==child.pid){tokens=manifest.initialTokens;await storeRestartEvidence(tokens);}
  manifest.restartTokens=tokens;
  const inspector=new DatabaseSync(sql,{readOnly:true});manifest.sendIntentCount=inspector.prepare('SELECT count(*) n FROM send_intents').get().n;inspector.close();manifest.status=child?.exitCode!==null||child?.signalCode!==null?'STOPPED_OWNED':'STOP_TIMEOUT';manifest.stoppedAt=new Date().toISOString();manifest.serverLogHash=logHash.copy().digest('hex');await safeAncestors(join(out,'manifest.json'),true);await safeAncestors(readyFile,true);await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(readyFile,JSON.stringify(manifest,null,2)+'\n');emit({status:manifest.status,apiPID:child?.pid,sendIntentCount:manifest.sendIntentCount});
 }
}
process.once('SIGTERM',()=>{stopOwned().then(()=>process.exit(0)).catch(()=>process.exit(1))});process.once('SIGINT',()=>{stopOwned().then(()=>process.exit(0)).catch(()=>process.exit(1))});
try{
 child=spawn(process.execPath,['--import','tsx',entry],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>logHash.update(b));child.stderr.on('data',b=>logHash.update(b));
 let healthy=false;for(let n=0;n<100;n++){try{healthy=(await request('/api/health')).status===200;if(healthy)break}catch{}if(child.exitCode!==null)break;await pause(100)}check('OWNED-PRODUCTION-HEALTH',healthy);
 const settings=await request('/api/settings');check('PUBLIC-IDENTITY-HOLD',settings.status===200&&settings.value?.identity?.name===marker&&settings.value?.autonomy?.holdSending===true);
 const blocked=await request('/api/chat','POST',{});check('CHAT-WRITES-BLOCKED',blocked.status===403&&blocked.value?.error==='public_gui_write_blocked');
 if(resume){for(const token of priorTokens.tokens){const expired=await request('/api/wechat/attachments/'+token.attachmentId);check('RESTART-OLD-TOKEN-EXPIRED-'+token.serverId,expired.status===404&&expired.value?.error==='wechat_attachment_expired',{http:expired.status,capturedBy:priorTokens.capturedBy});}}
 const connection=await request('/api/wechat/connect','POST',{});check('ACTUAL-CLI-CONNECTION',connection.status===200&&connection.value?.ok===true);
 const caps=await request('/api/wechat/capabilities');check('PERSISTED-SELECTOR-EXACT',caps.status===200&&caps.value?.attachments?.mode==='verified-exact-cli'&&caps.value?.send===false&&caps.value?.attachments?.businessMediaVerified===false);
 const chats=await request('/api/wechat/chats?limit=10');check('PUBLIC-EXACT-CONVERSATION',chats.status===200&&chats.value?.items?.length===1&&chats.value.items[0].id===f.conversation);
 const messages=await request('/api/wechat/messages?conversation='+encodeURIComponent(f.conversation)+'&limit=16');check('FOUR-EXACT-SAME-SECOND',messages.status===200&&messages.value?.items?.length===4&&messages.value.items.every(m=>m.at===200));
 const query='report-';
 const cliSearch=spawnSync(candidate,['messages','search',f.databaseRoot,'--decrypted','--query-stdin','--conversation',f.conversation,'--limit','16','--json'],{input:query,encoding:'utf8',timeout:30000,maxBuffer:8000000});let cliSearchValue;try{cliSearchValue=JSON.parse(cliSearch.stdout)}catch{}
 check('ACTUAL-CLI-SEARCH-REFERENCE',cliSearch.status===0&&cliSearchValue?.schema==='greenbubbles.query.v1'&&cliSearchValue?.items?.length===2,{count:cliSearchValue?.items?.length,queryHash:sha(query),coverageComplete:cliSearchValue?.consistency?.coverageComplete===true,warningCount:cliSearchValue?.warnings?.length||0});
 const search=await request('/api/wechat/messages/search','POST',{conversation:f.conversation,query,limit:16});
 check('FORMAL-READONLY-SEARCH',search.status===200&&search.value?.readOnly===true&&search.value?.items?.length===2&&JSON.stringify(search.value.items.map(m=>m.id))===JSON.stringify(cliSearchValue.items.map(m=>m.id))&&search.value.coverageComplete===(cliSearchValue.consistency?.coverageComplete===true)&&search.value.hasWarnings===(cliSearchValue.warnings?.length>0)&&search.value.hasMore===(cliSearchValue.page?.hasMore===true),{http:search.status,count:search.value?.items?.length,queryHash:sha(query),readOnly:search.value?.readOnly,coverageComplete:search.value?.coverageComplete,warningCount:search.value?.warnings?.length||0});
 const exactMessage=await request('/api/wechat/message','POST',{conversation:f.conversation,message:messages.value.items[2].id});check('FORMAL-EXACT-MESSAGE',exactMessage.status===200&&exactMessage.value?.item?.id===messages.value.items[2].id&&exactMessage.value?.readOnly===true);
 const listing=spawnSync(candidate,['messages','list',f.databaseRoot,'--decrypted','--conversation',f.conversation,'--limit','16','--json'],{encoding:'utf8',timeout:30000,maxBuffer:8000000});let rows;try{rows=JSON.parse(listing.stdout).items}catch{}check('ACTUAL-CLI-PUBLIC-ROWS',listing.status===0&&rows?.length===4);
 const records=[];
 for(const m of rows){
  const kind=m.messageType===34?'voice':m.messageType===43?'video':'document',expected=kind==='voice'?f.expectedBytes.voice:kind==='video'?f.expectedBytes.video:f.expectedBytes.documents[m.serverId-3004];
  const meta=await request('/api/wechat/attachment','POST',{conversation:f.conversation,message:m.id});
  check('METADATA-'+m.serverId,meta.status===200&&meta.value?.kind===kind&&meta.value?.sha256===sha(expected)&&meta.value?.bytes===expected.length&&meta.value?.readOnly===true&&meta.value?.storage==='bounded-memory'&&meta.value?.formatValidation==='header-only',{http:meta.status,kind,bytes:meta.value?.bytes,sha256:meta.value?.sha256});
  const r=await fetch(api+meta.value.url),bytes=Buffer.from(await r.arrayBuffer());check('HTTP-BYTES-'+m.serverId,r.status===200&&bytes.equals(expected)&&r.headers.get('content-type')===meta.value.mime&&r.headers.get('cache-control')==='no-store'&&r.headers.get('x-content-type-options')==='nosniff',{http:r.status,bytes:bytes.length,sha256:sha(bytes)});
  records.push({messageId:m.id,serverId:m.serverId,kind,format:meta.value.format,mime:meta.value.mime,bytes:expected.length,sha256:sha(expected),attachmentId:meta.value.attachmentId,expiresAt:meta.value.expiresAt,verifiedReadable:true,sameSecondUnix:200,readOnly:true,usability:'NOT_RUN_SYNTHETIC_HEADER'});
 }
 const inspector=new DatabaseSync(sql,{readOnly:true});const sendCount=inspector.prepare('SELECT count(*) n FROM send_intents').get().n;inspector.close();check('ZERO-SEND-INTENTS',sendCount===0);
 const after=await sourceHashes();check('SOURCE-STABLE',JSON.stringify(before)===JSON.stringify(after));
 check('FROZEN-CLI-WRAPPER',sha(await readFile(candidate))===candidateReady.compiledHash&&sha(await readFile(wrapper))===wrapperHash);
 const cliCounts=JSON.parse(await readFile(counts,'utf8'));check('NO-DEFAULT-OR-UNKNOWN-COMMAND',cliCounts.denied===0,{delegated:cliCounts.delegated,denied:cliCounts.denied});
 manifest={schema:'opsadv.wechat-gui-service.v1',status:'READY_PUBLIC_HTTP',resumedSameRoots:resume,at:new Date().toISOString(),scope,runId,marker,api,adjacentReservedPort:adjacent,managerPID:process.pid,apiPID:child.pid,checks,sourceHashes:before,sourceStable:true,candidateCli:candidate,candidateSHA256:candidateReady.compiledHash,candidateManifestSHA256:sha(readyBytes),wrapperCli:wrapper,wrapperSHA256:wrapperHash,fixtureSchemaHash:f.fixtureSchemaHash,conversationId:f.conversation,messageRecords:records,nativeState,sql,dataDir:data,privateDir:priv,commandCounts:counts,saveTargets,noOverwriteTarget:join(saveTargets,'OPSADV-QA-no-overwrite.pdf'),noOverwriteSHA256,serverEntry:entry,serverEntrySHA256:sha(await readFile(entry)),envSummary:{OPSTWIN_API_PORT:port,OPSTWIN_WEB_PORT:adjacent,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',notificationDelivery:'off',autonomousDelivery:'off',wechatEnvOverrides:'absent; private startup binding'},nativeArgv:{executable:join(root,'.local/apps/OpsTwins.app/Contents/MacOS/opstwin'),environment:{OPSTWIN_API:api,OPSTWIN_DATA_DIR:nativeState}},nativeLaunchStatus:'NOT_RUN_GUI_NOT_OWNED',guiAcceptance:false,mediaPlaybackAcceptance:'NOT_RUN_SYNTHETIC_HEADER',externalSends:0,sendIntentCount:sendCount,serverLogHash:logHash.copy().digest('hex')};
 manifest.initialTokens={schema:'opsadv.wechat-gui-restart-tokens.v1',runId,apiPID:child.pid,capturedAt:new Date().toISOString(),capturedBy:'prepare-readable',tokens:records.map(m=>({messageId:m.messageId,serverId:m.serverId,attachmentId:m.attachmentId,sha256:m.sha256,bytes:m.bytes,expiresAt:m.expiresAt,verifiedReadable:true}))};
 manifest.restartTokenFile=tokenPath(runId);
 await safeAncestors(join(out,'manifest.json'),true);await safeAncestors(readyFile,true);
 await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(readyFile,JSON.stringify(manifest,null,2)+'\n');
 emit({status:manifest.status,checks:checks.length,managerPID:process.pid,apiPID:child.pid,ready:readyFile,nativeState});
 child.once('exit',async()=>{if(!stopping){manifest.status='OWNED_API_EXITED';manifest.serverLogHash=logHash.copy().digest('hex');await safeAncestors(readyFile,true);await writeFile(readyFile,JSON.stringify(manifest,null,2)+'\n');emit({status:'OWNED_API_EXITED',apiPID:child.pid});process.exit(child.exitCode||1)}});
}catch(error){
 const report={status:'PREPARE_FAIL',code:String(error.message),checks,sourceHashes:before,apiPID:child?.pid,apiExitCode:child?.exitCode,serverLogHash:logHash.copy().digest('hex'),guiAcceptance:false};await writeFile(join(out,'failure.json'),JSON.stringify(report,null,2)+'\n');emit({status:'PREPARE_FAIL',code:String(error.message),artifact:join(out,'failure.json')});await stopOwned();process.exitCode=1;
}
