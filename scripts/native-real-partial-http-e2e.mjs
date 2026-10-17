#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,copyFile,chmod,realpath} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),port=46218,api='http://127.0.0.1:'+port;
const pause=ms=>new Promise(r=>setTimeout(r,ms)),sha=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
await new Promise((ok,no)=>{const s=createServer();s.once('error',()=>no(Error('46218 already occupied; no mutation')));s.listen(port,'127.0.0.1',()=>s.close(ok));});
const stamp=new Date().toISOString().replaceAll(':','-'),id=randomUUID(),marker='OPSADV-QA-PARTIAL-'+id;
const out=join(root,'output/native-parity-20261003/real-partial',stamp),data=join(root,'.local/acceptance/native-real-partial',stamp),privateDir=join(root,'.local/private-runtime/native-real-partial-'+id);
await mkdir(out,{recursive:true});await mkdir(data,{recursive:true,mode:0o700});await mkdir(privateDir,{recursive:true,mode:0o700});
if(!(await realpath(privateDir)).startsWith((await realpath(join(root,'.local')))+'/'))throw Error('private runtime outside local');
const configSource=process.env.OPSTWIN_QA_CONFIG||join(root,'.local/config.json');
const mainHash=sha(await readFile(configSource));
await copyFile(configSource,join(privateDir,'config.json'));await chmod(join(privateDir,'config.json'),0o600);
const seed=new DatabaseSync(join(data,'opstwin-advance.db'));seed.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');seed.close();
const harness=join(data,'server.ts'),deny=join(data,'deny-external.mjs');
await writeFile(deny,'#!/usr/bin/env node\nprocess.exit(89);\n',{mode:0o700});
await writeFile(harness,`import {patchSettings} from '${root}/server/src/store.ts';\npatchSettings({identity:{name:'OPSADV-QA Public Partial Owner',role:'Public E2E',about:'',instructions:'Only public QA data. No external sends or authorizations.',language:'zh-CN'},autonomy:{holdSending:true}});\nawait import('${root}/server/src/index.ts');\n`,{mode:0o600});
const requestId='native-'+randomUUID(),conversationId='ui-side-'+randomUUID(),checks=[];
const report={schema:1,scope:'real model and real SQLite tool write, actual isolated process kill and restart; native GUI NOT_RUN',status:'RUNNING',api,dataDirectory:data,privateRuntime:privateDir,marker,requestId,conversationId,checks,externalSends:0,calendarWrites:0,guiStatus:'NOT_RUN',sourceHashes:{}};
const sources=['scripts/native-real-partial-http-e2e.mjs','server/src/index.ts','server/src/agent.ts','server/src/agent-effects.ts','server/src/chat-status.ts'];
for(const p of sources)report.sourceHashes[p]=sha(await readFile(join(root,p)));
async function save(){await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2));}
function check(name,ok,extra={}){checks.push({name,status:ok?'PASS':'FAIL',...extra});if(!ok)throw Error(name);}
let child,output='',db,post;
async function req(path,method='GET',body,timeout=10000){const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});return{status:r.status,data:await r.json()};}
async function start(){output='';child=spawn(process.execPath,['--import','tsx',harness],{cwd:root,env:{...process.env,OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:privateDir,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'0',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_LARK_CLI:deny,OPSTWIN_WECHAT_CLI:deny},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);for(let n=0;n<150;n++){try{if((await req('/api/health')).status===200)return;}catch{}if(child.exitCode!==null)break;await pause(100);}throw Error('isolated API unavailable; output hash '+sha(output));}
async function stop(signal='SIGTERM'){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill(signal);await ended;}}
function count(type){return db.prepare('SELECT COUNT(*) n FROM entities WHERE type=? AND deleted=0').get(type).n;}
try{
 await start();db=new DatabaseSync(join(data,'opstwin-advance.db'),{readOnly:true});
 const side=await req('/api/conversations/side','POST',{id:conversationId,title:'公开验收：真实部分执行恢复'});check('fresh public side conversation created',side.status===201||side.status===200);
 const payload={conversationId,requestId,preservePrimary:true,mode:'chat',message:`请先在本项目创建且只创建一个任务，标题必须逐字为「${marker}」，备注为「公开本地恢复验收，无外部动作」。先用 create_task 工具真实保存，不要只是描述。任务保存后，只进行只读长篇分析：用至少3000字分30条解释公开任务管理与执行审计的设计。除此任务外不要写任何数据，不发送消息，不建立自动化，不操作连接，不生成文件。`};
 // Stable recovery payload remains in isolated private acceptance data, not output.
 await writeFile(join(data,'request.json'),JSON.stringify(payload),{mode:0o600});await save();
 post=req('/api/chat','POST',payload,240000).then(x=>({http:x.status}),()=>({disconnected:true}));
 let observed;
 for(let n=0;n<9000;n++){
  const ledger=db.prepare('SELECT state,data FROM chat_requests WHERE id=?').get(requestId);
  if(ledger){const intent=JSON.parse(ledger.data),runRow=db.prepare("SELECT data FROM entities WHERE type='runs' AND id=?").get(intent.runId),run=runRow&&JSON.parse(runRow.data);
   const writes=(run?.tools||[]).filter(t=>t.effect==='write'&&t.status==='succeeded');
   const tasks=db.prepare("SELECT id,data FROM entities WHERE type='tasks' AND deleted=0").all().filter(t=>JSON.parse(t.data).title===marker);
   if(ledger.state==='running'&&writes.length&&tasks.length===1){observed={runId:run.id,taskId:tasks[0].id,writeCount:writes.length,taskDataHash:sha(tasks[0].data),requestState:ledger.state};break;}
   if(ledger.state!=='running')break;
  }
  await pause(20);
 }
 if(!observed){report.status='NOT_TRIGGERED';report.post=await post;throw Error('real write still-running interruption window was not observed');}
 report.beforeKill=observed;report.killedChildPid=child.pid;await save();await stop('SIGKILL');report.originalPost=await post;
 check('actual isolated process killed after real SQL task and write evidence',true,observed);
 await start();
 const read=await req('/api/chat/requests/'+requestId);report.recovered={http:read.status,status:read.data.status,runId:read.data.runId,runStatus:read.data.runStatus,completedWriteCount:read.data.completedWrites?.length||0};
 check('startup classifies original real write as partial',read.status===200&&read.data.status==='partial'&&read.data.completedWrites?.length>0,report.recovered);
 const task=await req('/api/tasks/'+observed.taskId);check('exact original task remains durable',task.status===200&&task.data.title===marker&&count('tasks')===1,{taskId:task.data.id});
 const before={tasks:count('tasks'),runs:count('runs'),messages:count('messages')};
 const replay=await req('/api/chat','POST',payload);check('original POST refuses partial without new model or SQL writes',replay.status===409&&replay.data.error==='partial_run_requires_review'&&sha(before)===sha({tasks:count('tasks'),runs:count('runs'),messages:count('messages')}),{http:replay.status,errorCode:replay.data.error,counts:before});
 const state=await req('/api/chat/conversations/state?ids='+conversationId);const item=state.data.items?.find(x=>x.id===conversationId);check('partially written conversation remains locked',state.status===200&&item?.partial===true&&item?.locked===true,{state:item});
 check('main model config and no outbound ledgers unchanged',mainHash===sha(await readFile(configSource))&&db.prepare('SELECT COUNT(*) n FROM send_intents').get().n===0&&db.prepare('SELECT COUNT(*) n FROM calendar_intents').get().n===0);
 report.status='PASS';report.keepServer=process.argv.includes('--keep-server');if(report.keepServer)report.runningChildPid=child.pid;
}catch(e){if(report.status!=='NOT_TRIGGERED')report.status='FAIL';report.error=String(e.message);process.exitCode=1;}
finally{
 if(!report.keepServer)await stop();db?.close();report.mainUnchanged=mainHash===sha(await readFile(configSource));report.pass=checks.filter(x=>x.status==='PASS').length;report.fail=checks.filter(x=>x.status==='FAIL').length;report.outputHash=sha(output);await save();console.log(JSON.stringify({status:report.status,pass:report.pass,fail:report.fail,manifest:join(out,'manifest.json'),keepServer:report.keepServer||false}));
}
if(report.keepServer){process.on('SIGTERM',async()=>{await stop();process.exit(0);});await once(child,'exit');}
