// Real HTTP server + durable SQLite + controlled read-only CLI. No external transport.
// Covers disabled scheduling, due/restart, missing schedule, permission revoke,
// source refresh preserving edits, and independent Ideas/Tasks canonical updates.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'.local/acceptance/workspace-'+randomUUID()),out=join(root,'output/mygo-workspace-20261016'),port=46381;
mkdirSync(dir,{recursive:true});mkdirSync(out,{recursive:true});
const cli=join(dir,'lark');writeFileSync(cli,`#!${process.execPath}
import {existsSync} from 'node:fs';const a=process.argv.slice(2);if(a[0]==='auth')console.log(JSON.stringify({identity:'user',verified:true,identities:{user:{status:'ready',tokenStatus:'valid',openId:'public-owner',userName:'许茂林'}}}));
else if(a.includes('+chat-list'))console.log(JSON.stringify({ok:true,data:{items:[{chat_id:'public-chat',name:'公开同步验收',chat_mode:'p2p'}]}}));
else if(a[0]==='api')console.log(JSON.stringify({ok:true,data:{items:[{message_id:'public-message',chat_id:existsSync(import.meta.dirname+'/mismatch')?'other-chat':'public-chat',create_time:String(Date.now()),body:{content:JSON.stringify({text:'公开新内容'})},sender:{id:'public-source'},msg_type:'text'}]}}));
else if(a.includes('+chat-messages-list'))console.log(JSON.stringify({ok:true,data:{items:[{message_id:'public-message',create_time:'2026-10-16 09:00',text:'公开新内容',sender:{id:'public-source',name:'公开来源'},msg_type:'text'}]}}));
else {console.log(JSON.stringify({ok:false,error:{code:'write_denied'}}));process.exitCode=1}
`,{mode:0o700});
const database=()=>new DatabaseSync(join(dir,'opstwin-advance.db'));
let db=database();db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE entities(type TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,local_edited INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(type,id));');
const meta=(k,v)=>db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(k,JSON.stringify(v));meta('initialized',true);meta('feishuSyncSettings',{chatIntervalMinutes:5,meetingEnabled:false,mailEnabled:false,includeAttachments:false});meta('feishuScheduleIntervals',{chats:5,minutes:0,mail:0});meta('feishuNextRuns',{chats:new Date(Date.now()-60000).toISOString(),minutes:null,mail:null});
db.prepare('INSERT INTO entities(type,id,data) VALUES(?,?,?)').run('connections','feishu-local',JSON.stringify({id:'feishu-local',provider:'Feishu',status:'connected',type:'CLI',name:'公开连接',permissions:['read'],config:{syncInterval:'5m'}}));db.close();
let child;const checks=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(p,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert(r.ok,`${p}: ${r.status}`);return r.json()}
async function until(fn){for(let n=0;n<80;n++){const v=await fn();if(v)return v;await sleep(200)}throw Error('timeout')}
async function start(enabled){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_STANDALONE:'0',OPSTWIN_DATA_DIR:dir,OPSTWIN_PRIVATE_DIR:dir,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:enabled?'1':'0',OPSTWIN_LARK_CLI:cli},stdio:'ignore'});await until(async()=>{try{return await api('/feishu/sync')}catch{return false}})}
async function stop(){if(child?.exitCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end}child=undefined}
async function check(name,fn){await fn();checks.push({name,status:'PASS'});console.log('PASS',name)}
try{
 await start(false);await check('disabled background does not collect',async()=>{await sleep(2500);assert.equal((await api('/feishu/sync')).history.total,0)});await stop();await start(true);
 await check('desktop gate resumes overdue read and creates fresh Inbox',async()=>{await until(async()=>{const j=await api('/feishu/sync');return j.history.items[0]?.status==='succeeded'});const j=await api('/bootstrap');assert.equal(j.inbox[0].body,'公开来源: 公开新内容');assert(/^\d{13}$/.test(j.inbox[0].messages[0].sentAt));assert(Date.parse(j.inbox[0].sourceUpdatedAt)>Date.now()-20000);assert.equal((await api('/feishu/sync')).history.items[0].trigger,'schedule')});
 await check('repeated read preserves human draft',async()=>{await api('/inbox/live-public-chat','PATCH',{draft:'人工草稿必须保留',editedByUser:true});await api('/feishu/sync','POST',{scope:'chats'});await until(async()=>!(await api('/feishu/sync')).running);assert.equal((await api('/inbox/live-public-chat')).draft,'人工草稿必须保留')});
 await check('Ideas and Tasks are current canonical data',async()=>{await api('/tasks','POST',{id:'workspace-public-task',title:'公开最新任务',status:'pending'});await api('/ideas','POST',{id:'workspace-public-idea',title:'公开最新灵感',description:'公开资料建议',category:'insight',status:'new'});const j=await api('/bootstrap');assert(j.tasks.some(x=>x.id==='workspace-public-task'));assert(j.ideas.some(x=>x.id==='workspace-public-idea'))});
 await check('mismatched original message cannot replace saved source',async()=>{const before=await api('/inbox/live-public-chat');writeFileSync(join(dir,'mismatch'),'1');await api('/feishu/sync','POST',{scope:'chats'});await until(async()=>!(await api('/feishu/sync')).running);const last=(await api('/feishu/sync')).history.items[0];assert.equal(last.status,'failed');assert(last.failures.some(x=>x.code==='message_identity_mismatch'));assert.equal((await api('/inbox/live-public-chat')).sourceUpdatedAt,before.sourceUpdatedAt);unlinkSync(join(dir,'mismatch'))});
 const due=(await api('/feishu/sync')).nextRuns;await stop();await start(true);await check('restart preserves schedule and rows',async()=>{assert.deepEqual((await api('/feishu/sync')).nextRuns,due);assert((await api('/bootstrap')).tasks.some(x=>x.id==='workspace-public-task'))});
 await stop();db=database();db.prepare("UPDATE meta SET value='{}' WHERE key='feishuNextRuns'").run();db.close();await start(true);await check('missing next time repaired',async()=>assert(Date.parse((await api('/feishu/sync')).nextRuns.chats)>Date.now()));
 await check('read permission revoke disables schedule',async()=>{await api('/connections/feishu-local','PATCH',{permissions:[]});await until(async()=>(await api('/feishu/sync')).nextRuns.chats===null)});
}catch(e){checks.push({status:'FAIL',error:String(e)});process.exitCode=1}finally{await stop();writeFileSync(join(out,'scheduler-http.json'),JSON.stringify({scope:'real isolated HTTP with controlled CLI; not live Feishu',checks,sourceHashes:Object.fromEntries(['server/src/index.ts','server/src/connection-sync.ts','native/mygo/runtime.go'].map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]))},null,2))}
