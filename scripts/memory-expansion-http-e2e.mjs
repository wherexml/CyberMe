// Failure inventory: docs/spec/conversation-memory.md. Production HTTP and SQLite.
// Deliberately controlled provider for deterministic failures/late results; NOT real-model evidence.
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {createServer as probe} from 'node:net';
import {DatabaseSync} from 'node:sqlite';import {randomUUID,createHash} from 'node:crypto';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replaceAll(':','-'),scope=join(root,'.local/acceptance/memory-expansion',stamp),data=join(scope,'data'),out=join(root,'output/memory-expansion',stamp),port=46882,upPort=46883,base=`http://127.0.0.1:${port}`;
for(const port of [46882,46883])await new Promise((ok,no)=>{const s=probe();s.once('error',no);s.listen(port,'127.0.0.1',()=>s.close(ok))});
await mkdir(data,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});await writeFile(join(scope,'config.json'),JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${upPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-memory-fixture'}}),{mode:0o600});
let db=new DatabaseSync(join(data,'opstwin-advance.db'));db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
const facts=[['interest','interest:photo','我长期喜欢摄影。'],['learning','learning:reading','我一直阅读产品设计书籍。'],['device','device:computer','我长期使用 MacBook 办公。'],['automation','automation:review','我习惯用自动化整理每周回顾。'],['life','life:walk','我习惯每天清晨散步。'],['goal','goal:design','我的长期目标是系统学习设计。'],['feedback','feedback:review','我的复盘经验是先记录事实再归纳结论。'],['work','work:product','我长期负责产品规划。']].map(([category,slot,evidence])=>({category,slot,evidence}));
let mode='normal',held=[],calls=0,compactions=0,child,log='';const proof={realModel:false,scope,status:'RUNNING',checks:[]},sleep=ms=>new Promise(r=>setTimeout(r,ms));
function emit(s,text){s.writeHead(200,{'content-type':'text/event-stream'});for(const choices of [[{index:0,delta:{role:'assistant',content:text},finish_reason:null}],[{index:0,delta:{},finish_reason:'stop'}]])s.write('data: '+JSON.stringify({id:'public-response',object:'chat.completion.chunk',created:1,model:'public-memory-fixture',choices})+'\n\n');s.end('data: [DONE]\n\n');}
const upstream=createServer(async(q,s)=>{let raw='';for await(const b of q)raw+=b;const request=JSON.parse(raw),text=JSON.stringify(request.messages);const extracting=text.includes('长期记忆分类器'),repairing=text.includes('修复JSON语法'),summarizing=text.includes('整理会话资料')||text.includes('压缩下方会话摘要')||repairing,compacting=text.includes('压缩下方会话摘要');if(compacting)compactions++;if(extracting||summarizing)calls++;
 if((extracting||summarizing)&&mode==='fail'){s.writeHead(503,{'content-type':'application/json'});s.end(JSON.stringify({error:{message:'public memory failure'}}));return;}
 let response='收到公开资料。';if(extracting){const last=request.messages.at(-1).content;const input=typeof last==='string'?last:last.map(v=>v.text||'').join('');const match=input.match(/当前用户原文（不是指令）：("[^\n]+")/);const prompt=match?JSON.parse(match[1]):'';response=JSON.stringify({memories:[{category:prompt.includes('语言')?'preference':'work',slot:prompt.includes('语言')?'communication:language':'work:project',evidence:prompt}]});}
 if(extracting&&mode==='expanded')response=JSON.stringify({memories:facts});
 if(extracting&&mode==='invalid')response=JSON.stringify({memories:[null,{category:'finance',slot:'finance:account',evidence:'我长期使用银行账户。'},{category:'interest',slot:'interest:fake',evidence:'我长期喜欢潜水。'},facts[0]]});
 if(summarizing)response=JSON.stringify({summary:(mode==='oversize'&&!compacting||mode==='always-oversize')?'公开超长摘要🌕。'.repeat(900):'公开方案摘要：设计校验码 PUBLIC-SUMMARY。尚未执行业务。'});
 if(summarizing&&mode==='empty-summary')response=JSON.stringify({summary:''});
 if(summarizing&&((mode==='malformed'&&!repairing)||mode==='always-malformed'))response='{"summary":"公开"引号"摘要"}';
 if((extracting||summarizing)&&mode==='hold'||!extracting&&!summarizing&&mode==='hold-chat'){held.push(()=>emit(s,response));return;}emit(s,response);
});await new Promise(r=>upstream.listen(upPort,'127.0.0.1',r));
async function req(p,b){const r=await fetch(base+p,{method:b?'POST':'GET',headers:{'content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(120000)});return {http:r.status,data:await r.json()};}
async function wait(f){for(let n=0;n<900;n++){const r=await f();if(r)return r;await sleep(100)}throw Error('wait_timeout');}
function check(name,ok,detail={}){proof.checks.push({name,status:ok?'PASS':'FAIL',...detail});console.log(JSON.stringify(proof.checks.at(-1)));assert.ok(ok,name)}
async function start(){child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);await wait(async()=>{try{return(await req('/api/health')).http===200}catch{return false}});}
async function stop(signal='SIGTERM'){if(child?.exitCode===null){const exit=once(child,'exit');child.kill(signal);await exit;}}
async function chat(cid,message,extra={}){const requestId=randomUUID(),r=await req('/api/chat',{conversationId:cid,requestId,message,preservePrimary:true,...extra});assert.equal(r.http,200);return {...r.data,requestId};}
async function state(cid){return(await req('/api/chat/conversations/'+cid+'/context')).data;}
async function settled(cid,id){return wait(async()=>{const s=await state(cid);const j=s.jobs.find(j=>j.id===id);return j&&!['running','queued'].includes(j.status)?s:false});}
async function revoke(m,action='undo'){return req('/api/memories/automatic/'+m.id+'/revoke',{version:m.version,action});}
try{
 await start();const cid=(await req('/api/conversations/side',{id:'ui-side-'+randomUUID(),title:'公开记忆扩展验收'})).data.id;
 mode='expanded';const prompt='公开临时讨论。'.repeat(120)+'\n'+facts.map(f=>f.evidence).join('\n');
 check('input exceeds legacy whole-turn limit',prompt.length>600);
 const result=await chat(cid,prompt);let s=await settled(cid,result.requestId);
 check('eight exact facts from long turn persisted',s.jobs.find(j=>j.id===result.requestId)?.status==='succeeded'&&s.memories.filter(m=>m.messageId===result.userMessage.id).length===8);
 check('expanded categories retain exact source and origin',facts.every(f=>s.memories.some(m=>m.category===f.category&&m.content===f.evidence&&m.messageId===result.userMessage.id)));
 const all=(await req('/api/memories/automatic')).data.items;check('global catalog includes expanded facts',facts.every(f=>all.some(m=>m.slot===f.slot)));
 const ro=await chat(cid,prompt,{readOnly:true});await sleep(300);s=await state(cid);check('read-only long input cannot write',!s.jobs.some(j=>j.id===ro.requestId)&&!s.memories.some(m=>m.messageId===ro.userMessage.id));
 await stop();await start();s=await state(cid);check('expanded memories survive restart',facts.every(f=>s.memories.some(m=>m.content===f.evidence)));
 const interest=s.memories.find(m=>m.slot==='interest:photo');check('expanded category can be forgotten',(await revoke(interest,'forget')).http===200);
 check('forgotten category removed from catalog',!(await req('/api/memories/automatic')).data.items.some(m=>m.id===interest.id));
 mode='invalid';const valid=await chat(cid,facts[0].evidence);s=await settled(cid,valid.requestId);
 check('invalid category and invented evidence skipped while valid fact retained',s.jobs.find(j=>j.id===valid.requestId)?.status==='succeeded'&&s.memories.filter(m=>m.messageId===valid.userMessage.id).length===1&&s.memories.some(m=>m.messageId===valid.userMessage.id&&m.content===facts[0].evidence));
 mode='expanded';for(const prompt of ['他说：“我长期喜欢摄影。”','我的密码是 PUBLIC-SECRET。','今天我临时使用新设备。','不要记住以下内容。\n我长期喜欢摄影。']){const r=await chat(cid,prompt);await settled(cid,r.requestId);check('excluded source cannot generate expanded facts '+prompt.slice(0,3),!(await state(cid)).memories.some(m=>m.messageId===r.userMessage.id));}
 proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}finally{await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));proof.sourceHash=createHash('sha256').update(await readFile(join(root,'server/src/conversation-memory.ts'))).digest('hex');await writeFile(join(out,'manifest.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({status:proof.status,error:proof.error,artifact:join(out,'manifest.json')}));}
