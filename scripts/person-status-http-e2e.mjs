// Real CyberMe HTTP/SQLite with a controlled model and synthetic personnel files.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'output/person-status-20261109'),scope=resolve(root,'.local/acceptance/person-status-'+randomUUID());
const apiPort=46931,modelPort=46932,webPort=46930,base='http://127.0.0.1:'+apiPort,webUrl='http://127.0.0.1:'+webPort;
const wiki=resolve(scope,'people'),assets=resolve(root,'.local/person-status-web');
await mkdir(wiki,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:'+modelPort+'/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-status'}}),{mode:0o600});
await writeFile(resolve(wiki,'TEMPLATE.md'),'## 基本信息');
const original=(name,alias,date='2026-01-01')=>`# ${name}\n\n> 状态：在岗\n> 资料更新时间：${date}\n\n## 基本信息\n\n| 字段 | 内容 |\n| --- | --- |\n| 中文名 | ${name} |\n| 英文名 | ${alias} |\n| 当前角色 | 产品研发 |\n`;
for(const [name,alias] of [['陈青','Chen'],['周岚','Lan'],['宋宁','Ning'],['方远','Yuan'],['方宇','Yuan'],['齐川','Chuan'],['夏晨','Chen Xia']])await writeFile(resolve(wiki,name+'.md'),original(name,alias));
const S=await import('../server/src/store.ts');
S.setMeta('initialized',true);S.setMeta('primaryConversationId','primary');S.setMeta('memory-initialization-version',2);
S.patchSettings({identity:{name:'林远',language:'zh-CN'},knowledgePaths:[{id:'synthetic-wiki',path:wiki}],autonomy:{holdSending:true}});
for(const id of ['primary','ask','side','browser'])S.put('conversations',{id,title:'合成人物档案验收',...(id==='side'?{sideChat:true}:{})});
S.put('memories',{id:'synthetic-ref',kind:'knowledge',title:'合成参考资料',body:'公开合成内容。'});
const D=await import('../server/src/settings-documents.ts');
const manual=D.saveSettingsDocument('memory',{version:D.settingsDocument('memory').version,content:'## 工作\n- 保留原笔记。'});
function old(id,content,date,state='succeeded'){
 const message=S.put('messages',{id:'message-'+id,conversationId:'primary',role:'user',content,createdAt:date}),run=S.put('runs',{id:'run-'+id,kind:'chat',status:state,readOnly:false,tools:[]});
 S.db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?)').run(id,S.hash(content),state,JSON.stringify({conversationId:'primary',userMessage:message,runId:run.id,memoryPending:true}),date);
 if(state==='succeeded')S.db.prepare('INSERT INTO memory_context_jobs VALUES(?,?)').run(id,JSON.stringify({id,conversationId:'primary',status:'succeeded',extractionVersion:2,memoryIds:[],eligibleSentences:0}));
}
await import('../server/src/conversation-memory.ts');
old('historical-left','陈青 已经离职了','2026-02-01T06:00:00.000Z');
old('historical-older','陈青 在岗','2026-01-20T06:00:00.000Z');
old('historical-failed','宋宁 已经离职了','2026-02-01T06:00:00.000Z','failed');
old('historical-quoted','> 宋宁 已经离职了','2026-02-01T06:00:00.000Z');

let child,log='',status='FAIL',received=[],reject=false,hold,release,summaries=0;const checks=[];
const model=createServer(async(q,s)=>{
 let raw='';for await(const b of q)raw+=b;const body=JSON.parse(raw);received.push(body.messages);
 if(reject){s.writeHead(400,{'content-type':'application/json'});s.end('{"error":{"message":"synthetic failed chat"}}');return;}
 const input=JSON.stringify(body.messages.at(-1));
 if(hold&&input.includes('整理会话资料')){summaries++;await hold;}
 const content=input.includes('长期记忆分类器')?'{"memories":[]}':input.includes('整理会话资料')?'{"summary":"公开合成会话摘要。"}':'收到。';
 s.writeHead(200,{'content-type':'text/event-stream'});
 for(const [delta,finish_reason] of [[{role:'assistant',content},null],[{},'stop']])s.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 s.end('data: [DONE]\n\n');
});
await new Promise((r,j)=>model.once('error',j).listen(modelPort,'127.0.0.1',r));
async function req(path,body){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 return {status:r.status,data:await r.json()};
}
async function wait(fn){for(let i=0;i<160;i++){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,75));}throw Error('condition timeout');}
async function start(){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(apiPort)},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);await wait(async()=>{try{return(await req('/api/health')).status===200}catch{return false}});}
async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
const automatic=async()=>(await req('/api/memories/automatic')).data;
const people=async()=>(await req('/api/memory-library/people')).data.people;
const profile=async name=>(await people()).find(p=>p.name===name);
const drain=()=>wait(async()=>{const a=await automatic();return a.enabled&&!a.jobs.some(j=>['queued','running'].includes(j.status))&&a;});
function check(name,pass){checks.push({name,pass:!!pass});console.log(JSON.stringify(checks.at(-1)));assert.ok(pass,name);}
async function chat(message,extra={},conversationId=randomUUID()){
 if(!S.get('conversations',conversationId))S.put('conversations',{id:conversationId,title:'隔离对话'});
 const input={message,conversationId,requestId:randomUUID(),preservePrimary:true,...extra};
 const result=await req('/api/chat',input);await drain();return {...result,input};
}
// Leaves the shared memory worker waiting on a model summary until releaseSummary().
async function blockSummary(id){
 S.put('conversations',{id,title:'合成阻塞摘要'});
 for(let i=0;i<16;i++)S.put('messages',{id:id+'-history-'+i,conversationId:id,role:i%2?'assistant':'user',content:'合成历史 '+i,createdAt:new Date(Date.UTC(2026,0,1,i)).toISOString()});
 const before=summaries;hold=new Promise(r=>release=r);
 const started=await req('/api/chat',{message:'合成会话继续。',conversationId:id,requestId:randomUUID(),preservePrimary:true});
 assert.equal(started.status,200);await wait(()=>summaries>before);
}
function releaseSummary(){release?.();hold=undefined;}
function directReport(message){const report={message,conversationId:randomUUID(),requestId:randomUUID(),preservePrimary:true};S.put('conversations',{id:report.conversationId,title:'隔离对话'});return report;}
let web;
try{
 await start();await drain();
 const historic=await profile('陈青');
 check('successfully processed legacy chat recovers the newer direct report',historic.chatStatus?.status==='left'&&historic.chatStatus.reportedAt==='2026-02-01T06:00:00.000Z');
 check('old original status and file unchanged',historic.markdown.includes('状态：在岗')&&await readFile(resolve(wiki,'陈青.md'),'utf8')===original('陈青','Chen'));
 check('failed and quoted historical inputs cannot set status',!(await profile('宋宁')).chatStatus);
 const ask=await chat('陈青目前是什么状态？',{},'ask');
 check('distinct chat receives source-bound status in actual model request',ask.status===200&&JSON.stringify(received.at(-1)).includes('personStatusReports')&&JSON.stringify(received.at(-1)).includes('陈青 已经离职了'));
 const unrelated=await chat('你记得我什么？');
 check('unrelated chat does not recall personnel reports',unrelated.status===200&&!JSON.stringify(received.at(-1)).includes('personStatusReports'));
 const negatives=await Promise.all(['宋宁可能离职了','宋宁已经离职了吗？','宋宁没有离职','他说宋宁已经离职了','「宋宁已经离职了」','宋宁已经离职了。请联系她。','Yuan 已经离职了','未知人物 已经离职了'].map(s=>chat(s)));
 check('hedged, interrogative, negated, quoted, multiple instructions, ambiguous and unknown statements do not write',negatives.every(r=>r.status===200)&&(await automatic()).items.filter(m=>m.category==='person_status').length===1);
 const readOnly=await chat('宋宁 已经离职了',{readOnly:true}),side=await chat('宋宁 已经离职了',{},'side');
 const contextual=await chat('宋宁 已经离职了',{contextIds:['synthetic-ref']});
 reject=true;const failed=await chat('宋宁 已经离职了');reject=false;
 check('read-only, side, selected-source and failed chats do not write',readOnly.status===200&&side.status===200&&contextual.status===200&&failed.status>=400&&!(await profile('宋宁')).chatStatus);
 S.put('projects',{id:'synthetic-project',title:'合成项目'});S.put('conversations',{id:'project-chat',title:'合成项目会话',memoryProjectId:'synthetic-project'});
 const scoped=await chat('宋宁 已经离职了',{},'project-chat');
 // 2026-11-11 global memory: a legacy project conversation is an ordinary conversation (docs/public/global-memory.md).
 check('legacy project conversation writes the global status and signals a change',scoped.status===200&&scoped.data.memoryChanged?.includes('people')&&(await profile('宋宁')).chatStatus?.status==='left');
 const sent=await chat('陈青 已经返岗了');
 const returned=await profile('陈青');
 check('fresh chat corrects older status with exact evidence',sent.status===200&&returned.chatStatus.status==='active'&&returned.chatStatus.content===sent.input.message);
 const replay=await req('/api/chat',sent.input);
 check('request replay does not duplicate the update',replay.data.replayed&&(await profile('陈青')).chatStatus.id===returned.chatStatus.id);
 await stop();await start();await drain();
 check('server restart preserves status without replaying historical sources',(await profile('陈青')).chatStatus.id===returned.chatStatus.id);
 await writeFile(resolve(wiki,'陈青.md'),original('陈青','Chen','2099-01-01'));
 check('newer dated original status takes precedence',!(await profile('陈青')).chatStatus);
 await writeFile(resolve(wiki,'陈青.md'),original('陈青','Chen'));
 const saved=(await automatic()).items.find(x=>x.id===returned.chatStatus.id);
 const forgotten=await req('/api/memories/automatic/'+saved.id+'/revoke',{version:saved.version,action:'forget'});
 await stop();await start();await drain();
 check('forget removes current and earlier updates after restart',forgotten.status===200&&!(await profile('陈青')).chatStatus&&!(await automatic()).items.some(m=>m.slot===saved.slot));
 const newReport=await chat('陈青 已经离职了');
 check('a fresh user statement can set the status again',newReport.status===200&&(await profile('陈青')).chatStatus?.status==='left');
 S.put('messages',{...S.get('messages',newReport.data.userMessage.id),content:'已修改来源。'});
 check('a changed source removes the update from the profile',!(await profile('陈青')).chatStatus);
 await blockSummary('blocked-survive');
 const report=directReport('夏晨已经离职了'),sentAt=Date.now(),posted=await req('/api/chat',report),latency=Date.now()-sentAt,immediate=await profile('夏晨'),during=await automatic();
 check('a blocked summary does not delay the direct report',posted.status===200&&posted.data.memoryChanged?.includes('people')&&immediate.chatStatus?.status==='left'&&during.jobs.some(j=>j.conversationId==='blocked-survive'&&j.status==='running')&&latency<5000);
 const receipt=await req('/api/chat/requests/'+report.requestId),repeated=await req('/api/chat',report);
 check('durable receipt and replay carry the signal without a second fact',receipt.data.status==='succeeded'&&receipt.data.memoryChanged?.includes('people')&&repeated.data.replayed&&repeated.data.memoryChanged?.includes('people')&&(await automatic()).items.filter(m=>m.personId===immediate.id).length===1);
 releaseSummary();const settled=await drain(),summary=(await req('/api/chat/conversations/blocked-survive/context')).data.summary;
 check('held summary still completes and the queued job stays idempotent',!!summary?.text&&!settled.jobs.some(j=>['failed','stale'].includes(j.status)&&['blocked-survive',report.conversationId].includes(j.conversationId))&&(await profile('夏晨')).chatStatus?.id===immediate.chatStatus.id);
 await blockSummary('blocked-forget');
 const forgetReport=directReport('齐川已经离职了');await req('/api/chat',forgetReport);
 const committed=(await automatic()).items.find(m=>m.requestId===forgetReport.requestId);
 const revoked=await req('/api/memories/automatic/'+committed.id+'/revoke',{version:committed.version,action:'forget'});
 releaseSummary();const afterForget=await drain();
 check('late queued job cannot resurrect a status forgotten while it waited',revoked.status===200&&!(await profile('齐川')).chatStatus&&!afterForget.items.some(m=>m.slot===committed.slot)&&!afterForget.jobs.some(j=>['failed','stale'].includes(j.status)&&j.conversationId===forgetReport.conversationId));
 check('handwritten personal memory keeps its original version',(await req('/api/settings/documents/memory')).data.version===manual.version);
 status='PASS';
}catch(e){console.error(e);process.exitCode=1;}
await writeFile(resolve(out,'http.json'),JSON.stringify({status,url:base,synthetic:true,realModel:false,checks},null,2));
if(status==='PASS'&&process.argv.includes('--serve')){
 S.setMeta('primaryConversationId','browser');
 web=createServer(async(q,s)=>{try{
  const path=new URL(q.url,webUrl).pathname;
  if(path==='/__fixture/block-summary'||path==='/__fixture/release-summary'){if(path.endsWith('release-summary'))releaseSummary();else await blockSummary('blocked-browser');s.writeHead(200,{'content-type':'application/json'});s.end('{}');return;}
  if(path.startsWith('/api/')){
   const chunks=[];for await(const b of q)chunks.push(b);
   const response=await fetch(base+q.url,{method:q.method,headers:{'content-type':'application/json'},...(!['GET','HEAD'].includes(q.method)?{body:Buffer.concat(chunks)}:{})});
   s.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});s.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const p=resolve(assets,path==='/'?'cyberme.html':path.slice(1));if(!p.startsWith(assets+'/')){s.writeHead(403).end();return;}
  const b=await readFile(p);s.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(p)]||'application/octet-stream'});s.end(b);
 }catch{s.writeHead(404).end();}});
 await new Promise((r,j)=>web.once('error',j).listen(webPort,'127.0.0.1',r));console.log('Browser fixture '+webUrl);
 process.on('SIGTERM',async()=>{web.closeAllConnections();web.close();await stop();model.closeAllConnections();model.close();S.db.close();process.exit(0);});
}else{await stop();model.closeAllConnections();await new Promise(r=>model.close(r));S.db.close();}
