// Global personal memory: real CyberMe HTTP/SQLite, controlled model, synthetic data only.
// Covers docs/public/global-memory.md failure cases F1–F22 (F10 agent lookups and F21 UI are
// covered by code review and scripts/global-memory-browser-e2e.mjs respectively).
// Usage: node --import tsx scripts/global-memory-http-e2e.mjs [--serve]
// Ports: API 47181, browser fixture 47182, controlled model 47183, unreachable oMLX 47184.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'output/global-memory-20261111'),scope=resolve(root,'.local/acceptance/global-memory-'+randomUUID());
const apiPort=47181,webPort=47182,modelPort=47183,deadOmlxPort=47184,base='http://127.0.0.1:'+apiPort,webUrl='http://127.0.0.1:'+webPort;
const assets=resolve(root,'.local/global-memory-web');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_MEM0_RECALL:'off'});
await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:'+modelPort+'/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-global-memory'}}),{mode:0o600});

// ---- Synthetic legacy state, written before the new server ever starts ----
const S=await import('../server/src/store.ts');
await import('../server/src/conversation-memory.ts');
S.setMeta('initialized',true);S.setMeta('primaryConversationId','primary');
S.patchSettings({identity:{name:'林远',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('projects',{id:'p-alpha',title:'合成甲项目'});S.put('projects',{id:'p-beta',title:'合成乙项目'});S.put('projects',{id:'p-removed',title:'合成旧项目'});
S.put('tasks',{id:'task-beta',title:'合成乙任务',projectId:'p-beta',status:'active'});
S.put('conversations',{id:'primary',title:'合成主会话'});
S.put('conversations',{id:'conv-alpha',title:'合成甲会话',memoryProjectId:'p-alpha'});
S.put('conversations',{id:'conv-removed',title:'合成旧会话',memoryProjectId:'p-removed'});
S.put('conversations',{id:'conv-deleted',title:'合成已删会话'});
S.put('memories',{id:'note-keyboard',kind:'personal',title:'合成笔记',body:'我常用合成丙键盘。'});
const msg=(id,conversationId,content,createdAt)=>S.put('messages',{id,conversationId,role:'user',content,createdAt});
const fact=(id,{slot,category,content,conversationId,project,at,status='active',hashOf=content})=>{
 const m=msg('msg-'+id,conversationId,content,at);
 S.db.prepare('INSERT INTO automatic_memories(id,data) VALUES(?,?)').run(id,JSON.stringify({id,slot,category,content,...(project?{memoryProjectId:project}:{}),sourceHash:S.hash(hashOf),status,messageId:m.id,requestId:'req-'+id,conversationId,runId:'run-'+id,createdAt:at,version:'v-'+id}));
};
fact('g-computer',{slot:'device:computer',category:'device',content:'我用合成甲型电脑办公。',conversationId:'primary',at:'2026-01-01T01:00:00.000Z'});
fact('a-computer',{slot:'device:computer',category:'device',content:'我现在用合成乙型电脑办公。',conversationId:'conv-alpha',project:'p-alpha',at:'2026-02-01T01:00:00.000Z'});
fact('r-hobby',{slot:'interest:hobby',category:'interest',content:'我长期喜欢合成观鸟。',conversationId:'conv-removed',project:'p-removed',at:'2026-02-02T01:00:00.000Z'});
fact('r-flow',{slot:'automation:flow',category:'automation',content:'我一直用合成脚本整理周报。',conversationId:'conv-removed',project:'p-removed',at:'2026-02-03T01:00:00.000Z'});
fact('f-goal',{slot:'goal:sport',category:'goal',content:'我的长期目标是合成马拉松。',conversationId:'primary',at:'2026-01-05T01:00:00.000Z',status:'forgotten'});
fact('e-habit',{slot:'life:morning',category:'life',content:'我习惯合成晨跑。',conversationId:'primary',at:'2026-01-06T01:00:00.000Z',hashOf:'已编辑的原文'});
fact('d-deleted',{slot:'learning:deleted',category:'learning',content:'我长期学习合成已删课程。',conversationId:'conv-deleted',at:'2026-01-07T01:00:00.000Z'});
fact('g-tone',{slot:'communication:tone',category:'preference',content:'请默认用简洁语气回复我。',conversationId:'primary',at:'2026-01-08T01:00:00.000Z'});
fact('a-tone',{slot:'communication:tone',category:'preference',content:'请默认用正式语气回复我。',conversationId:'conv-alpha',project:'p-alpha',at:'2026-03-01T01:00:00.000Z'});
S.remove('conversations','conv-deleted');
S.setMeta('memory-forgotten-slots:p-alpha',['learning:topic']);
// Historical successful chats, to be initialized by the new server (version 1 -> 2).
const legacyRequest=(id,conversationId,content,at,project)=>{
 const m=msg('msg-'+id,conversationId,content,at),run=S.put('runs',{id:'run-'+id,kind:'chat',status:'succeeded',readOnly:false,conversationId,tools:[]});
 S.db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?)').run(id,S.hash(content),'succeeded',JSON.stringify({conversationId,userMessage:m,runId:run.id,memoryPending:true,...(project?{memoryProjectId:project}:{})}),at);
 S.db.prepare('INSERT INTO memory_context_jobs VALUES(?,?)').run(id,JSON.stringify({id,conversationId,status:'succeeded',extractionVersion:1,memoryIds:[]}));
};
legacyRequest('legacy-tombstoned','conv-alpha','我长期学习合成天文。','2026-02-10T01:00:00.000Z','p-alpha');
legacyRequest('legacy-removed','conv-removed','我长期学习合成音乐。','2026-02-11T01:00:00.000Z','p-removed');
S.setMeta('memory-initialization-version',1);
// A legacy scope refusal receipt: failed, no run, original fingerprint includes memoryProjectId.
const refusedBody={requestId:'legacy-refused',message:'合成乙项目的需求是什么？',conversationId:'conv-alpha',memoryProjectId:'p-alpha'};
S.db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?)').run('legacy-refused',S.hash({message:refusedBody.message,attachmentIds:[],mode:'chat',contextIds:[],memoryProjectId:'p-alpha'}),'failed',JSON.stringify({conversationId:'conv-alpha',memoryProjectId:'p-alpha',scopeConflict:{reason:'other_project_named',at:'2026-02-12T01:00:00.000Z'}}),'2026-02-12T01:00:00.000Z');
// Same projects removed after binding: p-removed disappears, its conversation and facts remain.
S.remove('projects','p-removed');
const seeded=new Map((S.db.prepare('SELECT id,data FROM automatic_memories').all()).map(r=>[r.id,r.data]));
const seededConversations=JSON.stringify(['primary','conv-alpha','conv-removed'].map(id=>S.get('conversations',id)));

// ---- Controlled model ----
const chats=[],classifier={'我长期学习合成天文。':['learning','learning:topic'],'我长期学习合成音乐。':['learning','learning:music'],'我长期喜欢合成摄影。':['interest','interest:hobby'],'我在合成甲项目里一直用合成丁显示器。':['device','device:monitor']};
let child,log='',status='FAIL';const checks=[];
const model=createServer(async(q,s)=>{
 let raw='';for await(const b of q)raw+=b;const body=JSON.parse(raw),input=JSON.stringify(body.messages.at(-1));
 let content='收到。';
 if(input.includes('长期记忆分类器')){const found=Object.entries(classifier).filter(([sentence])=>input.includes(sentence));content=JSON.stringify({memories:found.map(([evidence,[category,slot]])=>({category,slot,evidence}))});}
 else if(input.includes('整理会话资料'))content='{"summary":"公开合成会话摘要。"}';
 else chats.push(JSON.stringify(body.messages));
 s.writeHead(200,{'content-type':'text/event-stream'});
 for(const [delta,finish_reason] of [[{role:'assistant',content},null],[{},'stop']])s.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 s.end('data: [DONE]\n\n');
});
await new Promise((r,j)=>model.once('error',j).listen(modelPort,'127.0.0.1',r));
async function req(path,body,method=body?'POST':'GET'){
 const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 return {status:r.status,data:await r.json().catch(()=>({}))};
}
async function wait(fn){for(let i=0;i<200;i++){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,75));}throw Error('condition timeout');}
async function start(env={}){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(apiPort),...env},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);await wait(async()=>{try{return(await req('/api/health')).status===200}catch{return false}});}
async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}}
const automatic=async()=>(await req('/api/memories/automatic')).data;
const drain=()=>wait(async()=>{const a=await automatic();return a.enabled&&!a.jobs.some(j=>['queued','running'].includes(j.status))&&a;});
const row=id=>{const r=S.db.prepare('SELECT data FROM automatic_memories WHERE id=?').get(id);return r&&JSON.parse(r.data);};
// Authoritative per-run selection. The model transcript also carries preserved history, so old
// source sentences legitimately remain there; current memory is judged from load_user_context.
async function userContext(requestId){const receipt=(await req('/api/chat/requests/'+requestId)).data,run=(await req('/api/runs/'+receipt.runId)).data;const output=(run.tools||[]).find(t=>t.name==='load_user_context')?.output||{};return {memoryIds:output.memoryIds||[],preferenceIds:output.preferenceIds||[],recall:output.recall};}
function check(name,pass){checks.push({name,pass:!!pass});console.log(JSON.stringify(checks.at(-1)));assert.ok(pass,name);}
async function chat(message,conversationId,extra={}){const input={message,conversationId,requestId:randomUUID(),preservePrimary:true,...extra};const before=chats.length;const result=await req('/api/chat',input);await drain();return {...result,input,prompt:chats.slice(before).join('\n')};}

try{
 await start();const initial=await drain();
 // F1/F2/F15/F9: startup reads and initialization change nothing that was stored.
 const unchanged=[...seeded].every(([id,data])=>S.db.prepare('SELECT data FROM automatic_memories WHERE id=?').get(id)?.data===data);
 check('F1/F2 seeded facts and legacy memoryProjectId are byte-identical after startup',unchanged&&JSON.stringify(['primary','conv-alpha','conv-removed'].map(id=>S.get('conversations',id)))===seededConversations);
 check('F15 initialization respects a legacy project tombstone',!initial.items.some(m=>m.slot==='learning:topic'));
 const music=initial.items.find(m=>m.slot==='learning:music');
 check('F9 removed-project conversation still initializes into the global library',!!music&&!music.memoryProjectId&&initial.jobs.every(j=>j.id!=='legacy-removed'));
 // F6/F16: one library, legacy provenance visible but inert.
 const ids=new Set(initial.items.map(m=>m.id));
 check('F6 legacy project and removed-project facts are listed, scope global, provenance kept',ids.has('a-computer')&&ids.has('r-flow')&&initial.items.every(m=>m.scope?.kind==='global')&&initial.items.find(m=>m.id==='r-flow').memoryProjectId==='p-removed');
 check('F16 forgotten, edited-source and deleted-conversation facts are excluded',!ids.has('f-goal')&&!ids.has('e-habit')&&!ids.has('d-deleted'));
 const primaryCtx=(await req('/api/chat/conversations/primary/context')).data,alphaCtx=(await req('/api/chat/conversations/conv-alpha/context')).data;
 check('F6/F7 conversation context lists the same global facts everywhere',primaryCtx.memories.some(m=>m.id==='a-computer')&&alphaCtx.memories.some(m=>m.id==='g-tone'));
 // F6/F12/F11: recall and preferences.
 const computer=await chat('我用什么电脑办公？','primary'),computerCtx=await userContext(computer.input.requestId);
 check('F6/F12 global chat recalls the newest same-slot fact from a legacy project only',computer.status===200&&computerCtx.memoryIds.includes('a-computer')&&!computerCtx.memoryIds.includes('g-computer'));
 check('F11 newest communication preference applies in the primary chat',computerCtx.preferenceIds.includes('a-tone')&&!computerCtx.preferenceIds.includes('g-tone'));
 const keyboard=await chat('我常用什么键盘？','conv-alpha'),keyboardCtx=await userContext(keyboard.input.requestId);
 check('F7 legacy project chat sees hand-written MEMORY and the same preference',keyboard.status===200&&keyboardCtx.memoryIds.includes('note-keyboard')&&keyboardCtx.preferenceIds.includes('a-tone')&&!keyboardCtx.preferenceIds.includes('g-tone'));
 const hobby=await chat('我有什么兴趣爱好？','conv-removed');
 check('F9 removed-project chat is accepted and recalls global facts',hobby.status===200&&(await userContext(hobby.input.requestId)).memoryIds.includes('r-hobby'));
 // F8: project names and cross-project context no longer refuse or filter.
 const named=await chat('合成乙项目的需求是什么？','conv-alpha'),ctx=await chat('看看这个任务？','conv-alpha',{contextIds:['task-beta']});
 check('F8 naming another project or selecting its task is not refused',named.status===200&&ctx.status===200&&!JSON.stringify([named.data,ctx.data]).includes('memory_scope'));
 const monitor=await chat('我在合成甲项目里一直用合成丁显示器。','primary');
 check('F8 a message naming a project is still extracted into global memory',monitor.status===200&&(await automatic()).items.some(m=>m.slot==='device:monitor'&&!m.memoryProjectId));
 // F17/F18: replay semantics.
 const oldBody={message:'合成旧客户端消息。',conversationId:'conv-alpha',requestId:randomUUID(),memoryProjectId:'p-alpha',preservePrimary:true};
 const first=await req('/api/chat',oldBody),again=await req('/api/chat',oldBody);await drain();
 const count=S.list('messages').filter(m=>m.requestId===oldBody.requestId&&m.role==='user').length;
 check('F17 old-client body with memoryProjectId succeeds and replays from the stored result',first.status===200&&again.data.replayed===true&&count===1);
 const conflict=await req('/api/chat',{...oldBody,message:'另一条'});
 check('F17 same requestId with a different message stays 409 request_conflict',conflict.status===409&&JSON.stringify(conflict.data).includes('request_conflict'));
 const cross=await req('/api/chat',{...oldBody,conversationId:'primary'});
 check('F18 the same requestId from another conversation is rejected, no second message',cross.status===409&&S.list('messages').filter(m=>m.requestId===oldBody.requestId&&m.role==='user').length===1);
 const noConversation=await req('/api/chat',{message:'合成无会话旧请求。',requestId:randomUUID(),memoryProjectId:'p-alpha',preservePrimary:true});await drain();
 check('F17 memoryProjectId without a conversation is ignored, not 409',noConversation.status===200);
 // F4: legacy refusal stays failed until explicitly retried; retry keeps provenance.
 const refused=(await req('/api/chat/requests/legacy-refused')).data;
 check('F4 legacy scope refusal receipt is still failed with its code',refused.status==='failed'&&refused.failureCode==='scope_other_project_named');
 const retried=await req('/api/chat',refusedBody);await drain();
 const retriedData=JSON.parse(S.db.prepare('SELECT data FROM chat_requests WHERE id=?').get('legacy-refused').data);
 check('F4 explicit retry of the legacy refusal completes and keeps memoryProjectId provenance',retried.status===200&&(await req('/api/chat/requests/legacy-refused')).data.status==='succeeded'&&retriedData.memoryProjectId==='p-alpha');
 // F19: history stays per conversation.
 await chat('合成暗号紫杉会议改到周三。','conv-alpha');const isolated=await chat('刚才说的暗号会议是哪天？','primary'),own=await chat('刚才说的暗号会议是哪天？','conv-alpha');
 check('F19 another conversation history does not leak; own history remains',!isolated.prompt.includes('紫杉')&&own.prompt.includes('紫杉'));
 // F13: a new statement corrects the legacy removed-project fact.
 const photo=await chat('我长期喜欢合成摄影。','primary'),newest=(await automatic()).items.find(m=>m.slot==='interest:hobby');
 check('F13 new statement supersedes the legacy project fact and is stored without project',photo.status===200&&newest?.content==='我长期喜欢合成摄影。'&&!newest.memoryProjectId&&row('r-hobby').status==='superseded'&&row('r-hobby').memoryProjectId==='p-removed');
 // F14: forget is global across provenances.
 const target=(await automatic()).items.find(m=>m.id==='a-computer');
 const forgot=await req('/api/memories/automatic/a-computer/revoke',{version:target.version,action:'forget'});
 check('F14 forget tombstones the slot globally and forgets every provenance',forgot.status===200&&row('a-computer').status==='forgotten'&&row('g-computer').status==='forgotten'&&S.meta('memory-forgotten-slots',[]).includes('device:computer')&&row('a-computer').memoryProjectId==='p-alpha');
 const after=await chat('我用什么电脑办公？','conv-alpha');
 const afterCtx=await userContext(after.input.requestId);
 check('F14/F16 forgotten slot is not recalled from any conversation',after.status===200&&!afterCtx.memoryIds.includes('a-computer')&&!afterCtx.memoryIds.includes('g-computer'));
 // F20: retired endpoint creates nothing.
 const convCount=S.list('conversations').length,retiredProject=await req('/api/chat/memory-scope',{projectId:'p-beta'}),retiredNull=await req('/api/chat/memory-scope',{projectId:null});
 check('F20 memory-scope endpoint is retired with 410 and creates no conversation',retiredProject.status===410&&retiredNull.status===200&&retiredNull.data.conversationId==='primary'&&S.list('conversations').length===convCount);
 const patch=await req('/api/conversations/conv-alpha',{memoryProjectId:null},'PATCH');
 check('F2 provenance cannot be rewritten through PATCH',patch.status===409&&S.get('conversations','conv-alpha').memoryProjectId==='p-alpha');
 // F5: the concurrent queue behaviour is unchanged.
 const q1={message:'合成排队一。',conversationId:'primary',requestId:randomUUID(),preservePrimary:true,queueCurrent:true},q2={...q1,message:'合成排队二。',requestId:randomUUID()};
 await Promise.all([req('/api/chat',q1),req('/api/chat',q2)]);
 await wait(async()=>(await Promise.all([q1,q2].map(q=>req('/api/chat/requests/'+q.requestId)))).every(r=>r.data.status==='succeeded'));
 // Parallel network requests may arrive in either order. FIFO follows durable acceptance,
 // and the later accepted run must start only after the first run reaches its terminal state.
 const accepted=S.db.prepare('SELECT data FROM chat_requests WHERE id IN (?,?) ORDER BY rowid ASC').all(q1.requestId,q2.requestId).map(r=>JSON.parse(r.data));
 const queuedRuns=accepted.map(r=>S.get('runs',r.runId));
 check('F5 queued delivery still completes in durable acceptance order',accepted.length===2&&queuedRuns.every(r=>r.status==='succeeded')&&Date.parse(queuedRuns[1].startedAt)>=Date.parse(queuedRuns[0].completedAt));await drain();
 // F22: Mem0 enabled but provider unreachable falls back with evidence.
 await stop();await start({OPSTWIN_MEM0_RECALL:'',OPSTWIN_OMLX_BASE_URL:'http://127.0.0.1:'+deadOmlxPort+'/v1',OPSTWIN_OMLX_KEY:'public-fixture-key'});await drain();
 const fallback=await chat('我有什么兴趣爱好？','primary');
 const fallbackCtx=await userContext(fallback.input.requestId),recall=fallbackCtx.recall;
 check('F22 Mem0 failure falls back to keyword recall with a reason and chat completes',fallback.status===200&&recall?.engine==='lexical'&&!!recall.fallbackReason&&recall.method==='bounded-lexical-v1'&&recall.scope==='global'&&fallbackCtx.memoryIds.includes(newest.id)&&!fallbackCtx.memoryIds.includes('r-hobby'));
 check('F1 no stored fact or conversation was deleted',[...seeded.keys()].every(id=>row(id))&&['primary','conv-alpha','conv-removed'].every(id=>S.get('conversations',id)));
 status='PASS';
}catch(e){console.error(e);console.error(log.slice(-4000));process.exitCode=1;}
await writeFile(resolve(out,'http.json'),JSON.stringify({status,url:base,synthetic:true,realModel:false,checks},null,2));
if(status==='PASS'&&process.argv.includes('--serve')){
 const web=createServer(async(q,s)=>{try{
  const path=new URL(q.url,webUrl).pathname;
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
