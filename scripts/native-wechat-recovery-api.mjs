// Fixed public b8bd scope only, qualified current production source; no private profile or auth.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..');
const scope='b8bd7f05-ab31-4efe-b0be-599ade946ee3';
assertArgs();
function assertArgs(){if(process.argv.slice(2).some(a=>a!=='--verify-startup-cleanup'))throw Error('unknown_mode');}
const verifyStartupCleanup=process.argv.includes('--verify-startup-cleanup');
const work=path.join(root,'.local/acceptance/wechat-valid-media',scope);
const out=path.join(root,'output/native-parity-20261003/wechat-valid-media/gui-v43-recovery');
const assert=(c,s)=>{if(!c)throw Error(s)};
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const old=JSON.parse(fs.readFileSync(path.join(root,'output/native-parity-20261003/wechat-valid-media/gui-v25/ready.json')));
const expected={...old.sourceHashes,'server/src/index.ts':'1d04fa13f02045a0097f3ce08a0388fdcf5af5d363429fa30cef419158fbd285'};
function contained(p){assert(p.startsWith(root+path.sep),'outside_project');for(let current=p;current!==root;current=path.dirname(current)){const s=fs.lstatSync(current);assert(!s.isSymbolicLink()&&fs.realpathSync(current)===current&&s.uid===process.getuid()&&(s.mode&0o022)===0,'unsafe_scope_path');}}
for(const p of [work,path.join(work,'server'),path.join(work,'native'),path.join(work,'private'),out])contained(p);
for(const [p,h] of Object.entries(expected))assert(sha(path.join(root,p))===h,'source_drift_'+p);
assert(sha(path.join(work,'public-api-entry.mjs'))===old.runtimeHashes.entrySHA256,'original_entry_drift');
const binding=path.join(work,'private/wechat-attachment-runtime.json');contained(binding);assert(sha(binding)===old.runtimeHashes.bindingSHA256,'noncredential_binding_drift');
const databaseFile=path.join(work,'server/opstwin-advance.db');
for(const p of [databaseFile,databaseFile+'-wal',databaseFile+'-shm']) {
 let present;try{fs.lstatSync(p);present=true;}catch(error){if(error.code==='ENOENT')present=false;else throw error;}
 if(present)contained(p);
}
const db=new DatabaseSync(databaseFile,{readOnly:true});const settings=JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('settings').value);assert(settings.identity.name==='OPSADV-QA VALID MEDIA '+scope&&settings.autonomy.holdSending===true&&(settings.channels.feishu===undefined||settings.channels.feishu.enabled===false)&&(settings.channels.email===undefined||settings.channels.email.enabled===false),'public_scope_policy_mismatch');db.close();
for(const port of [46228,46229])await new Promise((ok,fail)=>{const server=createServer();server.once('error',fail);server.listen(port,'127.0.0.1',()=>server.close(ok));});
const entry=path.join(work,'public-api-entry-v43.mjs');
const source=`import {serve} from '@hono/node-server';import {app} from ${JSON.stringify(path.join(root,'server/src/index.ts'))};
const reads=new Set(['/api/health','/api/native/version','/api/native/events','/api/conversations/primary','/api/inbox/query','/api/bootstrap','/api/settings','/api/settings/models','/api/connections','/api/tasks','/api/ideas','/api/inbox','/api/chat/conversations','/api/voice/status','/api/wechat/chats','/api/wechat/messages','/api/wechat/capabilities']);
const writes=new Set(['/api/wechat/connect','/api/wechat/attachment','/api/wechat/messages/search','/api/wechat/message','/api/wechat/contacts','/api/connections/wechat-sync-local/disconnect']);
const server=serve({hostname:'127.0.0.1',port:46228,fetch:r=>{const p=new URL(r.url).pathname;const allow=r.method==='GET'&&(reads.has(p)||/^\\/api\\/wechat\\/attachments\\/[\\w-]{1,128}$/.test(p)||/^\\/api\\/(memories|chat\\/conversations)\\/[\\w-]+(?:\\/messages|\\/unresolved)?$/.test(p))||r.method==='POST'&&writes.has(p);return allow?app.fetch(r):new Response(JSON.stringify({error:'public_route_blocked'}),{status:403,headers:{'content-type':'application/json'}});}});process.on('SIGTERM',()=>server.close());\n`;
if(fs.existsSync(entry)){contained(entry);assert(fs.readFileSync(entry,'utf8')===source,'new_entry_drift');}else fs.writeFileSync(entry,source,{flag:'wx',mode:0o600});
const env={...process.env,OPSTWIN_API_PORT:'46228',OPSTWIN_WEB_PORT:'46229',OPSTWIN_DATA_DIR:path.join(work,'server'),OPSTWIN_PRIVATE_DIR:path.join(work,'private'),OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'};delete env.OPSTWIN_WECHAT_CLI;delete env.OPSTWIN_WECHAT_ATTACHMENT_SHA256;
const report={scope,api:'http://127.0.0.1:46228',sourceHashes:expected,runtimeHashes:{...old.runtimeHashes,entrySHA256:sha(entry)},entry,qualification:'fresh production health and exact CLI public scope; GUI NOT_RUN',status:'STARTING',persistErrors:[]};
const logHash=createHash('sha256');
const persistSafely=()=>{try{fs.writeFileSync(path.join(out,'ready.json'),JSON.stringify(report,null,2));return true;}catch(error){report.persistErrors.push(String(error.code||'write_failed'));report.persistErrors=report.persistErrors.slice(-8);return false;}};
let child=spawn(process.execPath,['--import','tsx',entry],{cwd:root,env,stdio:['ignore','pipe','pipe']});
report.apiPID=child.pid;report.managerPID=process.pid;
let startupFailed=false,spawnError;
child.on('error',error=>{spawnError=String(error.code||'spawn_failed');report.spawnError=spawnError;});
child.stdout.on('data',b=>logHash.update(b));child.stderr.on('data',b=>logHash.update(b));
const closed=new Promise(resolve=>child.once('close',(code,signal)=>{
 report.status=startupFailed?'FAILED_CLEANED_OWNED':'STOPPED_OWNED';report.exitCode=code;report.signal=signal;report.logSha256=logHash.digest('hex');
 const terminalPersisted=persistSafely();resolve();
 console.log(JSON.stringify({status:report.status,apiPID:report.apiPID,terminalPersisted,persistErrors:report.persistErrors,spawnError}));
}));
const stop=()=>{if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try {
 assert(persistSafely(),'ready_persist_failed');
 if(verifyStartupCleanup)throw Error('qa_owned_startup_failure');
 for(let n=0;n<100;n++){assert(!spawnError&&child.exitCode===null,'child_exited');try{const r=await fetch(report.api+'/api/health',{signal:AbortSignal.timeout(2000)});const v=await r.json();if(r.ok&&v.ok&&v.database==='independent'){report.healthHTTP=r.status;report.status='READY';break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(report.status==='READY','health_timeout');assert(persistSafely(),'ready_persist_failed');console.log(JSON.stringify({status:'READY',apiPID:child.pid,scope}));
} catch(error) {
 startupFailed=true;report.startupError=String(error);stop();
 let timeout;const ended=await Promise.race([closed.then(()=>true),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),4000);})]);clearTimeout(timeout);
 if(!ended){if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
 report.status='FAILED_CLEANED_OWNED';const terminalPersisted=persistSafely();process.exitCode=1;console.log(JSON.stringify({status:report.status,apiPID:report.apiPID,error:report.startupError,terminalPersisted,persistErrors:report.persistErrors}));
}
