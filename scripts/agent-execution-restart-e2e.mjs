// Actual API child, controlled model, OS command, SIGTERM and same-database restart.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile,access,readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const scope=resolve('.local/acceptance/execution-restart-'+randomUUID()),out=resolve('output/agent-execution-20261106/restart');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const port=46882,modelPort=46883,base=`http://127.0.0.1:${port}`,requestId=randomUUID(),checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const initial=new DatabaseSync(scope+'/opstwin-advance.db');initial.exec('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');initial.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');initial.close();
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-restart'}}),{mode:0o600});
let calls=0,child,log='';
const model=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);calls++;res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'restart',object:'chat.completion.chunk',created:1,model:'public-restart',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 if(input.messages.some(m=>m.role==='tool')){chunk({role:'assistant',content:'命令已停止，按原记录回查。'});chunk({},'stop')}
 else{const command=`${JSON.stringify(process.execPath)} - <<'PUBLIC_COMMAND'\nrequire('node:fs').writeFileSync('started.txt','started');setTimeout(()=>require('node:fs').writeFileSync('late.txt','forbidden'),4000);\nPUBLIC_COMMAND`;
 chunk({role:'assistant',tool_calls:[{index:0,id:'call',type:'function',function:{name:'run_command',arguments:JSON.stringify({command,cwd:scope,operationId:'shutdown',evidence:'请执行本机公开检查',timeoutMs:10000})}}]});chunk({},'tool_calls')}
 res.end('data: [DONE]\n\n');
});await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
async function start(){
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:resolve('.'),env:{...process.env,OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'0',OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',()=>{});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await sleep(100)}throw Error('API did not start');
}
async function stop(){child.kill('SIGTERM');for(let i=0;i<70&&child.exitCode===null;i++)await sleep(100);check('server exits cleanly',child.exitCode===0)}
const payload={requestId,message:'请执行本机公开检查'};
const send=()=>fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)}).then(async r=>({status:r.status,data:await r.json()})).catch(()=>({status:0}));
try{
 await start();const pending=send();
 for(let i=0;i<100;i++){if(await access(scope+'/started.txt').then(()=>true,()=>false))break;await sleep(100)}
 check('actual command started',await access(scope+'/started.txt').then(()=>true,()=>false));
 await stop();await pending;await sleep(4100);
 check('SIGTERM kills command before delayed write',await access(scope+'/late.txt').then(()=>false,()=>true));
 const db=new DatabaseSync(scope+'/opstwin-advance.db',{readOnly:true});const operations=db.prepare("select data from entities where type='command_operations'").all().map(r=>JSON.parse(r.data));
 check('durable unknown outcome recorded',operations.length===1&&operations[0].status==='unknown'&&operations[0].result.reason==='server_stopping');db.close();
 const before=calls;await start();const readback=await fetch(base+'/api/chat/requests/'+requestId);check('original request readable after restart',readback.status===200);
 const replay=await send();check('original request cannot launch another command',calls===before&&[200,409].includes(replay.status));
 const again=new DatabaseSync(scope+'/opstwin-advance.db',{readOnly:true});check('only one command operation exists',again.prepare("select count(*) n from entities where type='command_operations'").get().n===1);again.close();
 await stop();console.log(JSON.stringify({pass:true,checks:checks.length,out}));
}catch(e){checks.push({name:e.message,pass:false});process.exitCode=1;console.error(e.message)}
finally{if(child?.exitCode===null)child.kill('SIGKILL');model.closeAllConnections();model.close();await writeFile(out+'/result.json',JSON.stringify({checks,calls,scope:'production HTTP process + command + graceful SIGTERM + durable restart; abrupt SIGKILL not covered'},null,2))}
