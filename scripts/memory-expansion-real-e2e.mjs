// Failure inventory precedes implementation in docs/spec/conversation-memory.md.
// Production HTTP/SQLite, real configured model; only public seeded source material.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const initialSourceHash=createHash('sha256').update(await readFile(new URL('../server/src/conversation-memory.ts',import.meta.url))).digest('hex');
const root=resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replaceAll(':','-'),scope=join(root,'.local/acceptance/conversation-memory',stamp),data=join(scope,'data'),out=join(root,'output/memory-expansion-real',stamp),port=46884,base=`http://127.0.0.1:${port}`;
await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(port,'127.0.0.1',()=>s.close(ok));});
await mkdir(data,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const configSource=process.env.OPSTWIN_QA_CONFIG||join(root,'.local/config.json'),config=await readFile(configSource);await writeFile(join(scope,'config.json'),config,{mode:0o600});
let db=new DatabaseSync(join(data,'opstwin-advance.db'));db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
let child,log='';const proof={status:'RUNNING',scope,initialSourceHash,realModel:true,checks:[]},sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});return {http:r.status,data:await r.json()};}
async function wait(fn){for(let i=0;i<1200;i++){const v=await fn();if(v)return v;await sleep(100);}throw Error('condition_timeout');}
function check(name,ok,detail={}){proof.checks.push({name,status:ok?'PASS':'FAIL',...detail});console.log(JSON.stringify(proof.checks.at(-1)));assert.ok(ok,name);}
async function start(){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);await wait(async()=>{try{return (await req('/api/health')).http===200}catch{return false}});}
async function stop(){if(child?.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}}
async function conversation(title){const r=await req('/api/conversations/side',{id:'ui-side-'+randomUUID(),title});assert.equal(r.http,201);return r.data.id;}
async function chat(cid,message,extra={}){const p={conversationId:cid,requestId:randomUUID(),message,preservePrimary:true,...extra};const r=await req('/api/chat',p);check('real chat '+proof.checks.length,r.http===200&&r.data.run?.status==='succeeded',{requestId:p.requestId,runId:r.data.run?.id,http:r.http,error:r.data.error});return {...r.data,p};}
async function settled(cid,id){const s=await wait(async()=>{const r=await req('/api/chat/conversations/'+cid+'/context');const j=r.data.jobs?.find(j=>j.id===id);return j&&!['queued','running'].includes(j.status)?r.data:false});return s;}
const openDB=()=>new DatabaseSync(join(data,'opstwin-advance.db'));
try{
 await start();const cid=await conversation('公开扩展记忆真实模型验收');
 const facts=['我长期喜欢摄影。','我一直阅读产品设计书籍。','我长期使用 MacBook 办公。','我习惯用自动化整理每周回顾。','我习惯每天清晨散步。'];
 const prompt='公开临时背景说明。'.repeat(90)+'\n'+facts.join('\n')+'\n只确认收到，不使用工具。';
 const r=await chat(cid,prompt);const s=await settled(cid,r.requestId||r.p.requestId);const found=s.memories.filter(m=>m.messageId===r.userMessage.id);
 check('real long turn extracts more than two exact facts',found.length>=3&&found.every(m=>facts.includes(m.content)),{count:found.length,categories:found.map(m=>m.category),jobStatus:s.jobs.find(j=>j.id===(r.requestId||r.p.requestId))?.status});
 const other=await conversation('公开扩展记忆召回');const recall=await chat(other,'我平时用什么电脑办公？只根据记忆回答，不使用工具。',{readOnly:true});
 check('real expanded device memory recalled',recall.assistantMessage.content.includes('MacBook'));
 check('original configuration preserved',(await readFile(configSource)).equals(config));proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}finally{await stop();proof.logHash=createHash('sha256').update(log).digest('hex');await writeFile(join(out,'manifest.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,error:proof.error,artifact:join(out,'manifest.json')}));}
