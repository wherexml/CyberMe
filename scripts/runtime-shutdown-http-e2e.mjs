// Failure cases: live SSE prevents exit; timers outlive closed listener; repeated
// signals race; SIGINT differs; restart loses durable data or replays requests.
// Actual production child/HTTP/SQLite only, isolated public fixture, no unit mocks.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),port=46374,base=`http://127.0.0.1:${port}`;
const dir=fs.mkdtempSync(path.join(root,'.local/runtime-shutdown-')),data=path.join(dir,'data');
fs.mkdirSync(data);fs.writeFileSync(path.join(dir,'config.json'),'{}',{mode:0o600});
const sql=path.join(data,'opstwin-advance.db'),db=new DatabaseSync(sql);
db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
const report={at:new Date().toISOString(),checks:[],sourceSHA256:createHash('sha256').update(fs.readFileSync(path.join(root,'server/src/index.ts'))).digest('hex')};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let child,stream;
function check(name,ok,detail={}){report.checks.push({name,status:ok?'PASS':'FAIL',...detail});if(!ok)throw Error(name);}
async function start(){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_PRIVATE_DIR:dir,OPSTWIN_DATA_DIR:data,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',()=>{});child.log=()=>log;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await pause(100);}throw Error('startup timeout');}
async function free(){await new Promise((res,rej)=>{const s=createServer();s.once('error',rej);s.listen(port,'127.0.0.1',()=>s.close(res));});}
try{
 await free();
 for(const signal of ['SIGTERM','SIGINT']){
  await start();check(signal+' health', (await fetch(base+'/api/health')).status===200);
  const d=new DatabaseSync(sql);d.prepare("INSERT OR REPLACE INTO meta VALUES('shutdown-public-sentinel','\"preserved\"')").run();d.close();
  stream=new AbortController();const r=await fetch(base+'/api/native/events',{signal:stream.signal});const reader=r.body.getReader();check(signal+' live SSE',r.ok&&!(await reader.read()).done);
  const began=Date.now();child.kill(signal);await pause(80);if(child.exitCode===null&&child.signalCode===null)child.kill(signal);
  for(let i=0;i<75&&child.exitCode===null&&child.signalCode===null;i++)await pause(100);
  check(signal+' bounded clean exit with SSE and workers',child.exitCode===0,{elapsedMs:Date.now()-began,exitCode:child.exitCode,signalCode:child.signalCode});
  stream.abort();stream=null;await free();check(signal+' port reusable',true);
  const read=new DatabaseSync(sql);check(signal+' durable marker retained',read.prepare("SELECT value FROM meta WHERE key='shutdown-public-sentinel'").get().value==='"preserved"');check(signal+' no new sends',read.prepare('SELECT count(*) n FROM send_intents').get().n===0);read.close();
 }
 await start();check('same database restart health',(await fetch(base+'/api/health')).ok);child.kill('SIGTERM');for(let i=0;i<75&&child.exitCode===null;i++)await pause(100);check('idle shutdown',child.exitCode===0);report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1;}
finally{stream?.abort();if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));}const out=path.join(root,'output/runtime-recovery-20261008',`shutdown-${Date.now()}.json`);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,artifact:out,checks:report.checks}));}
