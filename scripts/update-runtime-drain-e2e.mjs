// Failure cases recorded first in output/update-wait-20261113/FAILURE-CASES.md.
// Actual production HTTP/SQLite + OS process trees. No unit mocks, signature bypass or production ports.
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=resolve('.'),scope=resolve('.local/acceptance/update-drain-'+randomUUID()),app=scope+'/CyberMe.app',runtime=app+'/Contents/Resources/runtime',ports=[47531,47532],out=resolve('output/update-wait-20261113');
await fs.mkdir(runtime+'/bin',{recursive:true});await fs.mkdir(runtime+'/server/src',{recursive:true});await fs.mkdir(runtime+'/scripts',{recursive:true});await fs.symlink(process.execPath,runtime+'/bin/node');await fs.symlink(root+'/node_modules',runtime+'/node_modules');await fs.writeFile(runtime+'/package.json','{"type":"module"}');
const backend=`import{spawn}from'node:child_process';import fs from'node:fs';await import(${JSON.stringify(root+'/server/src/index.ts')});const child=spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'started');const done=()=>{require('node:fs').writeFileSync(process.argv[2],'DRAINED');process.exit(0)};if(process.argv[3]==='hold'){setInterval(()=>{if(require('node:fs').existsSync(process.argv[4]))done()},25)}else setTimeout(done,Number(process.argv[3]))",${JSON.stringify(scope+'/started')},${JSON.stringify(scope+'/drained')},process.env.PUBLIC_DRAIN_DELAY||'2500',${JSON.stringify(scope+'/release')}],{stdio:'ignore'});`;
await fs.writeFile(runtime+'/server/src/index.ts',backend);await fs.writeFile(runtime+'/scripts/mygo-workspace-gateway.mjs',`import{createServer}from'node:http';const s=createServer((q,r)=>r.end('public'));s.listen(${ports[1]},'127.0.0.1');process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`);
await fs.mkdir(scope+'/data');await fs.writeFile(scope+'/config.json','{}');const checks=[],children=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),check=(name,ok)=>{checks.push({name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name)};
const exists=p=>fs.access(p).then(()=>true,()=>false),api=async(path,method='GET',body)=>fetch('http://127.0.0.1:'+ports[0]+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
let backendProc,gateway,extra;
async function start(delay=2500){
 await fs.rm(scope+'/started',{force:true});await fs.rm(scope+'/drained',{force:true});await fs.rm(scope+'/release',{force:true});
 backendProc=spawn(runtime+'/bin/node',['--import','tsx','server/src/index.ts'],{cwd:runtime,env:{...process.env,PUBLIC_DRAIN_DELAY:String(delay),OPSTWIN_DATA_DIR:scope+'/data',OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(ports[0]),OPSTWIN_NO_LISTEN:'0',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'},stdio:'ignore'});children.push(backendProc);
 gateway=spawn(runtime+'/bin/node',['scripts/mygo-workspace-gateway.mjs'],{cwd:runtime,stdio:'ignore'});children.push(gateway);
 for(let i=0;i<100;i++){try{if((await api('/api/health')).ok&&await exists(scope+'/started'))return}catch{}await sleep(100)}throw Error('fixture startup');
}
try{
 const installer=await import('./cyberme-updater.mjs');
 await start();
 const owned=await installer.idle(app,{ports});check('idle Agent permits preparation despite live background child',owned.some(p=>p.pid===backendProc.pid));
 const started=Date.now();await installer.stopServices(app,{ports});check('normal shutdown waits for actual child completion',await exists(scope+'/drained'));check('bounded drain completes before deadline',Date.now()-started<10000);check('API really stopped',await api('/api/health').then(()=>false,()=>true));
 // A genuine running Agent still blocks, without signalling the backend.
 await start();const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(scope+'/data/opstwin-advance.db');const run={id:'public-running-run',kind:'chat',status:'running',startedAt:new Date().toISOString()};db.prepare('INSERT OR REPLACE INTO entities(type,id,data,deleted) VALUES(?,?,?,?)').run('runs',run.id,JSON.stringify(run),0);db.close();
 let reason;try{await installer.idle(app,{ports})}catch(e){reason=e.message}check('genuine running Agent blocks install',reason==='runtime_busy');check('busy backend remains alive',(await api('/api/health')).ok);
 const d=new DatabaseSync(scope+'/data/opstwin-advance.db');run.status='succeeded';d.prepare('UPDATE entities SET data=? WHERE type=? AND id=?').run(JSON.stringify(run),'runs',run.id);d.close();
 // Unknown bundle runtime processes remain blocked even though the Agent is idle.
 await fs.writeFile(runtime+'/scripts/unrecognized.mjs','setInterval(()=>{},1000)');extra=spawn(runtime+'/bin/node',['scripts/unrecognized.mjs'],{cwd:runtime,stdio:'ignore'});children.push(extra);await sleep(150);reason=undefined;try{await installer.idle(app,{ports})}catch(e){reason=e.message}check('unknown runtime process blocks install',reason==='runtime_process_busy');extra.kill('SIGTERM');await new Promise(r=>extra.once('exit',r));
 await installer.stopServices(app,{ports});check('normal retry can drain after Agent completes',await exists(scope+'/drained'));
 await start('hold');reason=undefined;try{await installer.stopServices(app,{ports,drainMs:50})}catch(e){reason=e.message}console.log({slowDrainReason:reason||'no_error'});check('slow child makes bounded shutdown fail instead of force killing',reason==='runtime_exit_timeout');await fs.writeFile(scope+'/release','done');for(let i=0;i<100&&!await exists(scope+'/drained');i++)await sleep(100);check('unforced child still finishes its own effect',await exists(scope+'/drained'));
 extra=spawn(process.execPath,['-e',`require('node:http').createServer((q,r)=>r.end('foreign')).listen(${ports[1]},'127.0.0.1')`],{stdio:'ignore'});children.push(extra);await sleep(150);reason=undefined;try{await installer.idle(app,{ports})}catch(e){reason=e.message}check('foreign listener remains protected',reason==='foreign_runtime');check('foreign process was not stopped',extra.exitCode===null&&extra.signalCode===null);
}catch(e){await fs.writeFile(out+'/drain-error.txt',String(e.stack));process.exitCode=1;console.error(e.message)}
finally{await fs.writeFile(scope+'/release','done');for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGTERM');await fs.writeFile(out+'/drain-result.json',JSON.stringify({checks,scope,ports,boundary:'Actual production HTTP/SQLite and real isolated OS process shutdown. No installed app changes.'},null,2));}
