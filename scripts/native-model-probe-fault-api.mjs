// Public model-probe GUI scope only. Failure inventory must precede execution.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'output/native-parity-20261003/model-probe-faults-20261004');
if(process.argv.length!==2)throw Error('no_runtime_overrides');
const assert=(value,message)=>{if(!value)throw Error(message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function contained(p){for(let at=p;at!==root;at=path.dirname(at)){assert(at.startsWith(root+path.sep),'outside_project');const s=fs.lstatSync(at);assert(!s.isSymbolicLink()&&fs.realpathSync(at)===at&&s.uid===process.getuid()&&(s.mode&0o022)===0,'unsafe_path');}}
contained(out);assert(fs.existsSync(path.join(out,'failure-inventory-before-code.md')),'failure_inventory_missing');
for(const port of [46254,46255])await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(port,'127.0.0.1',()=>s.close(ok));});
const scope=randomUUID(),work=path.join(root,'.local/acceptance/model-probe-faults-20261004',scope),sql=path.join(work,'server'),native=path.join(work,'native');
for(const p of [work,sql,native]){fs.mkdirSync(p,{recursive:true,mode:0o700});contained(p);}
const db=new DatabaseSync(path.join(sql,'opstwin-advance.db'));
db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');
db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'OPSADV-QA MODEL RECOVERY '+scope,language:'en',instructions:'Public isolated recovery acceptance'},autonomy:{holdSending:true,levels:{ack:'observe',meet:'observe',docs:'observe',commit:'draft',boss:'draft',sensitive:'observe'},files:[]},channels:{feishu:{enabled:false},email:{enabled:false}}}));db.close();fs.chmodSync(path.join(sql,'opstwin-advance.db'),0o600);
const entry=path.join(work,'entry.mjs');
const source=`import {serve} from '@hono/node-server';import {app} from ${JSON.stringify(path.join(root,'server/src/index.ts'))};
const get=new Set(['/api/health','/api/bootstrap','/api/settings/models','/api/conversations/primary','/api/tasks','/api/inbox','/api/ideas','/api/chat/conversations','/api/voice/status','/api/native/version','/api/native/events','/api/settings']);
const server=serve({hostname:'127.0.0.1',port:46254,fetch:r=>{const p=new URL(r.url).pathname;const allowed=!r.headers.has('origin')&&(r.method==='GET'&&(get.has(p)||/^\\/api\\/settings\\/models\\/tests\\/[\\w-]{1,128}$/.test(p))||r.method==='POST'&&p==='/api/settings/models/test');return allowed?app.fetch(r):new Response('{"error":"qa_route_blocked"}',{status:403,headers:{'content-type':'application/json'}});}});process.on('SIGTERM',()=>server.close());\n`;
fs.writeFileSync(entry,source,{flag:'wx',mode:0o600});
const sourceHashes={};for(const file of ['server/src/index.ts','server/src/store.ts','server/src/model-probes.ts','server/src/model-settings.ts','server/src/private-paths.ts','server/src/agent.ts','scripts/native-model-probe-fault-api.mjs'])sourceHashes[file]=sha(fs.readFileSync(path.join(root,file)));
// Private model configuration is read only by the production server; never copied.
const env={...process.env,OPSTWIN_API_PORT:'46254',OPSTWIN_WEB_PORT:'46255',OPSTWIN_DATA_DIR:sql,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'};delete env.OPSTWIN_PRIVATE_DIR;
const report={scope,work,sql,native,entry,entrySHA256:sha(Buffer.from(source)),sourceHashes,privateConfiguration:'default existing server-only; no writes/copy',status:'STARTING',persistErrors:[]};
function save(){try{fs.writeFileSync(path.join(out,'ready.json'),JSON.stringify(report,null,2));return true;}catch(error){report.persistErrors.push(String(error.code||'write_failed'));report.persistErrors=report.persistErrors.slice(-8);return false;}}
const child=spawn(process.execPath,['--import','tsx',entry],{cwd:root,env,stdio:['ignore','pipe','pipe']});report.apiPID=child.pid;report.managerPID=process.pid;
let failed=false,spawnError,stopTimer,stopping=false;const digest=createHash('sha256');child.on('error',e=>{spawnError=String(e.code||'spawn_failed');});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>digest.update(b));
const closed=new Promise(resolve=>child.once('close',(code,signal)=>{clearTimeout(stopTimer);report.status=failed?'FAILED_CLEANED_OWNED':stopping?'STOPPED_OWNED':'UNEXPECTED_OWNED_EXIT';report.exitCode=code;report.signal=signal;report.logSHA256=digest.digest('hex');const terminalPersisted=save();resolve();console.log(JSON.stringify({status:report.status,terminalPersisted,apiPID:child.pid,persistErrors:report.persistErrors}));}));
const stop=()=>{stopping=true;if(child.pid&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');if(!stopTimer)stopTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},4000);}};process.on('SIGTERM',stop);process.on('SIGINT',stop);
try{
 assert(save(),'ready_persist_failed');
 for(let n=0;n<100;n++){assert(!stopping&&!spawnError&&child.exitCode===null&&child.signalCode===null,'owned_child_exited');try{const r=await fetch('http://127.0.0.1:46254/api/health',{signal:AbortSignal.timeout(2000)});const v=await r.json();if(r.ok&&v.ok&&v.database==='independent'){report.status='READY';break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(report.status==='READY','health_timeout');assert(save(),'ready_persist_failed');console.log(JSON.stringify({status:'READY',scope,apiPID:child.pid,native}));
}catch(error){failed=true;report.failure=String(error);stop();let timer;const ended=await Promise.race([closed.then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),4000);})]);clearTimeout(timer);if(!ended){if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}report.status='FAILED_CLEANED_OWNED';const terminalPersisted=save();process.exitCode=1;console.log(JSON.stringify({status:report.status,terminalPersisted}));}
