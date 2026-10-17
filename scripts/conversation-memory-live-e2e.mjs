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
const root=resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replaceAll(':','-'),scope=join(root,'.local/acceptance/conversation-memory',stamp),data=join(scope,'data'),out=join(root,'output/conversation-memory',stamp),port=46470,base=`http://127.0.0.1:${port}`;
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
 await start();const cid=await conversation('公开记忆验收');proof.conversationId=cid;
 const first=await chat(cid,'我长期负责晨舟项目，内部代号是 LUMEN-7391。只确认收到，不使用任何工具。');
 let s=await settled(cid,first.requestId);let m=s.memories.find(m=>m.content.includes('LUMEN-7391'));
 check('background real extraction binds exact source',!!m&&m.messageId===first.userMessage.id&&s.jobs[0].status==='succeeded',{memoryId:m?.id,job:s.jobs[0]});
 const other=await conversation('公开跨会话召回');const recall=await chat(other,'晨舟项目的内部代号是什么？仅根据已有上下文回答，不使用工具。',{readOnly:true});
 check('real cross-conversation recall',recall.assistantMessage.content.includes('LUMEN-7391')&&recall.run.tools.some(t=>t.name==='load_user_context'&&t.output.memoryIds.includes(m.id)));
 const quote=await chat(other,'请翻译以下引用，不使用工具：他说：“我长期负责暮云项目，代号是 QUOTED-888。”');await settled(other,quote.requestId);
 check('quoted third-party fact not stored',!(await req('/api/memories/automatic')).data.items.some(m=>m.content.includes('QUOTED-888')));
 const temp=await chat(other,'今天临时用英文回复一句收到，不使用工具。');await settled(other,temp.requestId);
 check('temporary request not stored',!(await req('/api/memories/automatic')).data.items.some(m=>m.messageId===temp.userMessage.id));
 // Public long history and document fixture are seeded while the service is stopped.
 await stop();db=openDB();const insert=db.prepare('INSERT INTO entities(type,id,data) VALUES(?,?,?)');
 const longCid='public-summary-'+randomUUID();insert.run('conversations',longCid,JSON.stringify({id:longCid,title:'公开长会话',status:'active'}));
 for(let i=0;i<20;i++){const id='public-history-'+i+'-'+randomUUID();insert.run('messages',id,JSON.stringify({id,conversationId:longCid,role:i%2?'assistant':'user',content:i===0?'本次方案的校验码为 ORBIT-6812；这是会话内临时设计资料。':i===1?'收到此方案校验码，尚未执行任何业务操作。':'公开布局讨论第 '+i+' 条，保持现有结构。'}));}
 const docId='public-memory-doc';insert.run('memories',docId,JSON.stringify({id:docId,kind:'personal',content:Array.from({length:180},(_,i)=>'无关材料 '+i+'：'+ '公园树木和步道说明。'.repeat(8)).join('\n\n')+'\n\n海岬计划的交付暗号为 CAPE-5264。',updatedAt:new Date().toISOString()}));db.close();await start();
 const summaryTrigger=await chat(longCid,'请简短确认继续讨论布局，不使用工具。');s=await settled(longCid,summaryTrigger.requestId);
 check('real incremental summary persisted',!!s.summary?.text.includes('ORBIT-6812')&&s.summary.coveredCount===8,{coveredCount:s.summary?.coveredCount});
 const summaryRead=await chat(longCid,'此前方案校验码是什么？仅根据会话资料回答，不使用工具。',{readOnly:true});
 check('real answer uses summary outside recent14',summaryRead.assistantMessage.content.includes('ORBIT-6812')&&summaryRead.run.tools.some(t=>t.name==='load_conversation_context'&&t.output.summaryStatus==='ready'));
 const documentRead=await chat(other,'海岬计划的交付暗号是什么？不使用工具。',{readOnly:true});const load=documentRead.run.tools.find(t=>t.name==='load_user_context');
 check('relevant tail of large document recalled within budget',documentRead.assistantMessage.content.includes('CAPE-5264')&&load.output.memoryIds.includes(docId)&&load.output.recall.characters<=6000,{recall:load.output.recall});
 const unrelated=await chat(other,'二加二等于几？只回答数字，不使用工具。',{readOnly:true});check('unrelated personal document excluded',!unrelated.run.tools.find(t=>t.name==='load_user_context').output.memoryIds.includes(docId));
 const stale=await req('/api/memories/automatic/'+m.id+'/revoke',{version:'stale',action:'undo'});check('stale mutation refused',stale.http===409);
 const undone=await req('/api/memories/automatic/'+m.id+'/revoke',{version:m.version,action:'undo'});check('undo confirmed',undone.http===200&&undone.data.status==='undone');
 check('undo idempotent',(await req('/api/memories/automatic/'+m.id+'/revoke',{version:m.version,action:'undo'})).http===200);
 const cleanCid=await conversation('公开撤销回归');const forgotten=await chat(cleanCid,'晨舟项目的内部代号是什么？如果资料没有，请说不知道。不使用工具。',{readOnly:true});
 check('undo removes later recall',!forgotten.assistantMessage.content.includes('LUMEN-7391')&&!forgotten.run.tools.find(t=>t.name==='load_user_context').output.memoryIds.includes(m.id));
 const sourceRead=await chat(cid,'晨舟项目的内部代号是什么？如果资料没有，请说不知道。不使用工具。',{readOnly:true});check('undo excludes original source round from context',!sourceRead.assistantMessage.content.includes('LUMEN-7391'));
 const derived=await chat(other,'晨舟项目的内部代号是什么？如果资料没有，请说不知道。不使用工具。',{readOnly:true});check('undo excludes earlier recall-derived answer',!derived.assistantMessage.content.includes('LUMEN-7391'));
 s=(await req('/api/chat/conversations/'+longCid+'/context')).data;check('undo invalidates older summaries',s.summary===null&&s.summaryStale);
 await stop();await start();check('undo survives restart',!(await req('/api/memories/automatic')).data.items.some(a=>a.id===m.id));
 const again=await chat(cid,'请简短确认继续，不使用工具。');await settled(cid,again.requestId);check('old source not automatically resurrected',!(await req('/api/memories/automatic')).data.items.some(a=>a.id===m.id));
 const language=await chat(cleanCid,'中文沟通');s=await settled(cleanCid,language.requestId);const preference=s.memories.find(m=>m.slot==='communication:language'&&m.messageId===language.userMessage.id);check('existing direct language preference tool remains supported',!!preference&&language.run.tools.some(t=>t.name==='save_preference'&&t.status==='succeeded'));if(preference)await req('/api/memories/automatic/'+preference.id+'/revoke',{version:preference.version,action:'undo'});
 db=openDB();check('no external-send intents',db.prepare('SELECT COUNT(*) n FROM send_intents').get().n===0&&db.prepare('SELECT COUNT(*) n FROM calendar_intents').get().n===0);db.close();check('private original config unchanged',(await readFile(configSource)).equals(config));proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}finally{await stop();proof.logHash=createHash('sha256').update(log).digest('hex');proof.sourceHash=createHash('sha256').update(await readFile(join(root,'server/src/conversation-memory.ts'))).digest('hex');await writeFile(join(out,'manifest.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,error:proof.error,artifact:join(out,'manifest.json')}));}
