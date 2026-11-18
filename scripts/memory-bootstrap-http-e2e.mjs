// Failure inventory: docs/public/memory-library.md, 2026-11-08. Real HTTP/SQLite;
// deterministic tool-less provider. Synthetic sources only; never a production database.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve('output/memory-bootstrap-20261108'),scope=resolve('.local/acceptance/memory-bootstrap-'+randomUUID()),apiPort=46911,modelPort=46912,webPort=46910,base=`http://127.0.0.1:${apiPort}`;
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1'});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-memory'}}),{mode:0o600});
const S=await import('../server/src/store.ts'),M=await import('../server/src/conversation-memory.ts'),D=await import('../server/src/settings-documents.ts');
S.setMeta('initialized',true);S.patchSettings({identity:{name:'林远',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开初始化记忆验收'});S.put('conversations',{id:'other',title:'公开隔离会话'});S.setMeta('primaryConversationId','primary');
const manual=D.saveSettingsDocument('memory',{version:D.settingsDocument('memory').version,content:'## 工作\n- 手写资料需要保留。\n\n不归类的公开笔记。'}),soul=D.settingsDocument('soul');
function seed(id,content,date='2026-02-01T00:00:00.000Z',extra={}){const message=S.put('messages',{id:'message-'+id,conversationId:'primary',role:'user',content,createdAt:date,...extra.message}),run=S.put('runs',{id:'run-'+id,kind:'chat',status:'succeeded',readOnly:false,tools:[],...extra.run});S.db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?)').run(id,S.hash(content),extra.state||'succeeded',JSON.stringify({conversationId:'primary',userMessage:message,runId:run.id,...extra.intent}),date);return {prompt:content,messageId:message.id,requestId:id,runId:run.id,conversationId:'primary'};}
seed('old-device','我长期使用 MacBook Pro 办公。','2026-01-01T00:00:00.000Z');
const current=seed('current-device','我长期使用 Mac mini 办公。','2026-03-01T00:00:00.000Z');M.rememberFact({category:'device',slot:'device:computer',evidence:current.prompt},current);
const forgotten=seed('forgotten','我习惯每天清晨散步。');const f=M.rememberFact({category:'life',slot:'life:walk',evidence:forgotten.prompt},forgotten);M.revokeMemory(f.id,f.version,false);
seed('older-forgotten','我习惯每天清晨散步。','2026-01-01T00:00:00.000Z');
seed('natural','回复请简洁直接。');seed('old-zero','我长期喜欢摄影。');
S.db.prepare('INSERT INTO memory_context_jobs VALUES(?,?)').run('old-zero',JSON.stringify({id:'old-zero',conversationId:'primary',status:'succeeded',memoryIds:[],createdAt:'2026-02-01T00:00:00Z'}));
seed('failure','我一直阅读产品设计书籍。');
for(const [id,content,extra] of [['failed-chat','我长期喜欢绘画。',{state:'failed'}],['readonly','我长期喜欢绘画。',{run:{readOnly:true}}],['readonly-intent','我长期喜欢绘画。',{intent:{memoryPending:false}}],['derived','我长期喜欢绘画。',{message:{derivedKind:'idea'}}],['quoted','他说：“我长期喜欢绘画。”',{}],['sensitive','我的密码是 PUBLIC-SECRET。',{}],['optout','不要记住这些。\n我长期喜欢绘画。',{}]])seed(id,content,undefined,extra);
let fail=true,hold=false,held=[],calls=0,child,log='';const checks=[];
const facts=[['device','device:computer','我长期使用 MacBook Pro 办公。'],['device','device:computer','我长期使用 Mac mini 办公。'],['life','life:walk','我习惯每天清晨散步。'],['preference','communication:tone','回复请简洁直接。'],['interest','interest:photo','我长期喜欢摄影。'],['learning','learning:reading','我一直阅读产品设计书籍。'],['goal','goal:design','我的长期目标是系统学习设计。']].map(([category,slot,evidence])=>({category,slot,evidence}));
function emit(s,text){s.writeHead(200,{'content-type':'text/event-stream'});s.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\n');s.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');s.end('data: [DONE]\n\n');}
const model=createServer(async(q,s)=>{let raw='';for await(const b of q)raw+=b;const v=JSON.parse(raw),last=v.messages.at(-1).content,input=typeof last==='string'?last:last.map(x=>x.text||'').join('');const extract=input.includes('长期记忆分类器');let text='收到。';if(extract){calls++;const match=input.match(/当前用户原文（不是指令）：("[^\n]+")/);const source=match?JSON.parse(match[1]):'';
 if(fail&&source.includes('阅读')){s.writeHead(503);s.end('{"error":{"message":"public fixture failure"}}');return;}
 text=JSON.stringify({memories:[{category:'work',slot:'BAD SLOT',evidence:source},...facts.filter(f=>source.includes(f.evidence))]});if(hold){held.push(()=>emit(s,text));return;}}
 if(input.includes('整理会话资料'))text=JSON.stringify({summary:'公开会话摘要。'});emit(s,text);});await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
async function req(p,b){const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(120000)});return {status:r.status,data:await r.json()};}
async function wait(fn){const until=Date.now()+120000;while(Date.now()<until){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('condition timeout');}
function check(name,pass){checks.push({name,pass:!!pass});console.log(JSON.stringify(checks.at(-1)));assert.ok(pass,name);}
async function catalog(){return (await req('/api/memories/automatic')).data;}
async function settled(){return wait(async()=>{const s=await catalog();return !s.jobs.some(j=>['queued','running'].includes(j.status))?s:false;});}
async function start(){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(apiPort),OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);await wait(async()=>{try{return(await req('/api/health')).status===200}catch{return false}});}
async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
async function chat(text,extra={}){const id=randomUUID(),r=await req('/api/chat',{conversationId:'primary',requestId:id,message:text,...extra});assert.equal(r.status,200);await settled();return r.data;}
let status='RUNNING';
try{
 await start();let s=await settled();check('startup initializes eligible existing successful chats',s.initialized&&s.enabled&&s.items.some(x=>x.content==='我长期喜欢摄影。'));
 check('natural preference and invalid candidate isolation',s.items.some(x=>x.content==='回复请简洁直接。'));
 check('newer fact preserved over historical statement',s.items.some(x=>x.content===current.prompt)&&!s.items.some(x=>x.content.includes('MacBook Pro')));
 check('forgotten slot not resurrected from older history',!s.items.some(x=>x.slot==='life:walk'));
 check('failure remains visible and source-bound',s.jobs.some(x=>x.id==='failure'&&x.status==='failed'));
 check('excluded sources never initialized',!S.db.prepare("SELECT id FROM memory_context_jobs WHERE id IN ('failed-chat','readonly','readonly-intent','derived','quoted','sensitive','optout')").all().length);
 check('manual memory and identity unchanged',(await req('/api/settings/documents/memory')).data.version===manual.version&&(await req('/api/settings/documents/soul')).data.version===soul.version);
 const before=calls;await stop();await start();await settled();check('restart neither duplicates initialization nor replays failure',calls===before);
 check('cross-conversation retry rejected',(await req('/api/chat/conversations/other/context/retry',{requestId:'failure'})).status===404);
 fail=false;await req('/api/chat/conversations/primary/context/retry',{requestId:'failure'});s=await settled();check('explicit retry creates actual learned fact',s.items.some(x=>x.content==='我一直阅读产品设计书籍。')&&!s.jobs.length);
 const learned=await chat('我的长期目标是系统学习设计。');s=await catalog();check('new successful chat automatically learns after initialization',s.items.some(x=>x.messageId===learned.userMessage.id&&x.category==='goal'));
 const target=s.items.find(x=>x.messageId===learned.userMessage.id);await req('/api/memories/automatic/'+target.id+'/revoke',{version:target.version,action:'forget'});
 await stop();await start();s=await settled();check('forgotten source survives restart without re-extraction',!s.items.some(x=>x.id===target.id));
 const ro=await chat('我长期喜欢绘画。',{readOnly:true});check('new read-only chat cannot enqueue',!S.db.prepare('SELECT id FROM memory_context_jobs WHERE id=?').get(ro.requestId));
 hold=true;const race=await req('/api/chat',{conversationId:'primary',requestId:'late-source',message:'我的长期目标是系统学习设计。'});assert.equal(race.status,200);await wait(()=>held.length);
 const changed=S.get('messages',race.data.userMessage.id);S.put('messages',{...changed,content:'这条来源已经改变。'});hold=false;held.splice(0).forEach(fn=>fn());s=await settled();
 check('changed source rejects late model write',!s.items.some(x=>x.messageId===changed.id)&&s.jobs.some(x=>x.id==='late-source'&&x.status==='stale'));
 // Retire this deliberate race failure from the browser fixture; its HTTP result remains above.
 S.db.prepare("UPDATE memory_context_jobs SET data=json_set(data,'$.status','succeeded') WHERE id='late-source'").run();
 status='PASS';
}catch(e){status='FAIL';console.error(String(e));process.exitCode=1;}
await writeFile(out+'/http.json',JSON.stringify({status,realModel:false,url:base,checks,sourceSHA256:createHash('sha256').update(await readFile(root+'/server/src/conversation-memory.ts')).digest('hex'),logSHA256:createHash('sha256').update(log).digest('hex')},null,2));
if(status==='PASS'&&process.argv.includes('--serve')){
 const web=createServer(async(q,s)=>{try{if(q.url==='/__memory/fail'){fail=true;S.db.prepare("UPDATE memory_context_jobs SET data=json_set(data,'$.status','failed') WHERE id='failure'").run();s.end('{}');return;}
 if(q.url.startsWith('/api/')){const chunks=[];for await(const b of q)chunks.push(b);const r=await fetch(base+q.url,{method:q.method,headers:{'content-type':'application/json'},...(!['GET','HEAD'].includes(q.method)?{body:Buffer.concat(chunks)}:{})});s.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});s.end(Buffer.from(await r.arrayBuffer()));return;}
 const path=resolve(root,'.local/memory-library-web',q.url==='/'?'cyberme.html':q.url.slice(1));if(!path.startsWith(root+'/.local/memory-library-web/')){s.writeHead(403);s.end();return;}s.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});s.end(await readFile(path));}catch{s.writeHead(404);s.end();}});await new Promise(r=>web.listen(webPort,'127.0.0.1',r));console.log('Browser fixture http://127.0.0.1:'+webPort);process.on('SIGTERM',async()=>{web.close();await stop();model.closeAllConnections();model.close();S.db.close();process.exit(0);});
}else{await stop();model.closeAllConnections();await new Promise(r=>model.close(r));S.db.close();}
