// Full HTTP/Pi/SQLite, real Mem0 and loopback embeddings. Only the main chat response is controlled in HTTP checks.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createFixture,ids,names,source,out} from './mem0-project-acceptance-fixture.mjs';

const fixture=await createFixture();
const {S,request,wait,start,stop,controls,releaseEmbeddings}=fixture;
const checks=[];
function check(name,pass,detail={}){checks.push({name,passed:!!pass,...detail});console.log(JSON.stringify(checks.at(-1)));assert.ok(pass,name);}
const chatBody=(conversationId,message,extra={})=>({conversationId,message,requestId:randomUUID(),preservePrimary:true,memoryProjectId:S.get('conversations',conversationId)?.memoryProjectId??null,...extra});
const send=body=>request('/api/chat',body);
async function chat(conversationId,message,extra={}){
 const body=chatBody(conversationId,message,extra),result=await send(body);
 assert.equal(result.status,200,result.data.code||result.data.error);
 return {...result.data,input:body};
}
const audit=run=>run?.tools?.find(row=>row.name==='load_user_context')?.output;
const facts=()=>S.db.prepare('SELECT data FROM automatic_memories').all().map(row=>JSON.parse(row.data));
async function waitFact(message){
 return wait(()=>{
  const row=facts().find(f=>f.messageId===message.userMessage.id&&f.status==='active');
  if(row)return row;
  const job=S.db.prepare('SELECT data FROM memory_context_jobs WHERE id=?').get(message.requestId);
  if(job&&['failed','stale'].includes(JSON.parse(job.data).status))throw new Error('memory_job_'+JSON.parse(job.data).status);
 });
}
async function learned(cid,text){return waitFact(await chat(cid,text));}
const stopWithDrain=async()=>{
 await wait(()=>!S.db.prepare("SELECT 1 FROM memory_context_jobs WHERE json_extract(data,'$.status') IN ('queued','running')").get());
 await stop();
};
const scoped=(key,suffix)=>{
 const id=key+'-'+suffix;
 S.put('conversations',{id,title:'公开项目对话 '+key+' '+suffix,memoryProjectId:ids[key]});
 return id;
};
const forget=(item)=>request('/api/memories/automatic/'+item.id+'/revoke',{version:item.version,action:'forget'});
const query='谁负责汇集客户的诉求？';
const context=(response,id)=>audit(response.run)?.memoryIds?.includes(id);
const engine=response=>audit(response.run)?.recall?.method;
let status='FAIL';
try{
 const startArgs={OPSTWIN_OMLX_BASE_URL:'http://127.0.0.1:46962/v1',OPSTWIN_OMLX_KEY:'synthetic-proxy'};
 await start(startArgs);
 async function select(projectId){
  const result=await request('/api/chat/memory-scope',{projectId});
  assert.equal(result.status,200);
  return result.data;
 }
 const [selectedA,selectedB,selectedGlobal]=await Promise.all([select(ids.a),select(ids.b),select(null)]);
 const aLearn=selectedA.conversationId,bLearn=selectedB.conversationId;
 check('project selection binds separate conversations and keeps the global primary',aLearn!==bLearn&&selectedA.memoryProjectId===ids.a&&selectedB.memoryProjectId===ids.b&&selectedGlobal.conversationId===ids.global&&(await select(ids.a)).conversationId===aLearn);
 const invalid=await request('/api/chat/memory-scope',{projectId:names.a});
 const forged=await send(chatBody(aLearn,'公开锚点',{memoryProjectId:ids.b}));
 check('titles and forged scope cannot select or change a project',invalid.status===404&&forged.status===409);
 const first=await chat(aLearn,source.a),a=await waitFact(first),b=await learned(bLearn,source.b);
 const replay=await send(first.input),crossReplay=await send({...first.input,conversationId:bLearn,memoryProjectId:ids.b});
 check('durable request cannot replay across scopes',replay.status===200&&replay.data.replayed&&replay.data.userMessage.id===first.userMessage.id&&crossReplay.status===409);
 const mutate=await request('/api/conversations/'+aLearn,{memoryProjectId:ids.b},'PATCH');
 check('generic conversation update cannot rebind project identity',mutate.status>=400&&S.get('conversations',aLearn).memoryProjectId===ids.a);
 check('same slot in two projects remains active',a.slot===b.slot&&facts().filter(row=>[a.id,b.id].includes(row.id)).every(row=>row.status==='active'));
 const one=await learned(aLearn,source.same),two=await learned(bLearn,source.same);
 check('same literal across projects remains separately forgettable',one.id!==two.id&&one.content===two.content);
 const reads=await Promise.all([chat(scoped('a','verify'),query),chat(scoped('b','verify'),query)]);
 check('real Mem0 resolves two projects independently',context(reads[0],a.id)&&!context(reads[0],b.id)&&context(reads[1],b.id)&&!context(reads[1],a.id)&&reads.every(r=>String(engine(r)).includes('mem0')),{methods:reads.map(engine)});
 controls.foreignRun=reads[1].run.id;
 const toolLookup=await chat(scoped('a','lookup'),'请核对合成运行。');
 const tool=toolLookup.run?.tools?.find(item=>item.name==='app_read');
 check('project chat cannot read an execution record from another project',tool?.status==='failed'&&!JSON.stringify(tool.output).includes('周宁'));
 const wrong=await send(chatBody(scoped('a','wrong'),names.b+'的客户需求由谁收集？'));
 check('explicitly named conflicting project fails closed',wrong.status===409||wrong.status===200&&!context(wrong.data,a.id)&&!context(wrong.data,b.id));
 const wrongInActive=await send(chatBody(aLearn,names.b+'的客户需求由谁收集？'));
 check('existing conversation cannot answer a conflicting project from its earlier history',wrongInActive.status===409||wrongInActive.status===200&&!wrongInActive.data.assistantMessage?.content?.includes('林澈')&&!wrongInActive.data.assistantMessage?.content?.includes('周宁'));
 check('conflict is resolved before the main model sees either project history',!controls.chatInputs.some(text=>text.includes(names.b+'的客户需求由谁收集？')));
 const task=S.put('tasks',{id:'synthetic-task-b',title:'晨舟合成任务',status:'active',projectId:ids.b});
 const contradict=await send(chatBody(aLearn,'请看选中的任务。',{contextIds:[task.id]}));
 check('selected task from another project is rejected',contradict.status===409||contradict.status===200&&!context(contradict.data,a.id)&&!context(contradict.data,b.id)&&!controls.chatInputs.some(text=>text.includes('请看选中的任务。')));
 const global=await chat(ids.global,query);
 check('global chat does not recall either project',!context(global,a.id)&&!context(global,b.id));
 const oldGlobal=await learned(ids.global,source.global);
 const globalFactRead=await chat(scoped('a','global-fact'), '我平常有什么爱好？');
 check('global legacy facts do not enter a project',!context(globalFactRead,oldGlobal.id));
 const next=await learned(aLearn,source.next);
 check('correction only supersedes the target project',facts().find(x=>x.id===a.id)?.status==='superseded'&&facts().find(x=>x.id===b.id)?.status==='active'&&next.slot===b.slot);
 const correction=await chat(scoped('a','corrected'),query);
 check('new conversation gets the correction',context(correction,next.id)&&!context(correction,a.id)&&!context(correction,b.id));
 const baseline=controls.requests.length;
 controls.holdEmbeddings=true;
 const inFlight=chat(scoped('a','race'),'谁统一收集客户需求和反馈？');
 try{
  await wait(()=>controls.requests.length>baseline,6500);
  assert.equal((await forget(next)).status,200);
 }finally{releaseEmbeddings();}
 const late=await inFlight;
 check('forget rejects late index and leaves other project active',!context(late,next.id)&&!context(late,a.id)&&!context(late,b.id)&&facts().find(x=>x.id===b.id)?.status==='active');
 controls.failEmbeddings=true;
 const fallback=await chat(scoped('b','fallback'),'客户需求由谁统一收集？');
 controls.failEmbeddings=false;
 check('embedding outage falls back without widening scope',context(fallback,b.id)&&!context(fallback,next.id)&&!String(engine(fallback)).includes('mem0'),{method:engine(fallback)});
 await stopWithDrain();
 await start(startArgs);
 const restarted=await chat(scoped('b','restarted'),query);
 check('backend restart preserves per-project recall and forget',context(restarted,b.id)&&!context(restarted,a.id)&&!context(restarted,next.id));
 const changedQuery='谁是客户反馈的汇总负责人？';
 const count=controls.requests.length;
 controls.holdEmbeddings=true;
 const changed=send(chatBody(bLearn,changedQuery));
 try{
  await wait(()=>controls.requests.length>count,6500);
  S.remove('projects',ids.b);
 }finally{releaseEmbeddings();}
 const removed=await changed;
 S.restore('projects',ids.b);
 check('project removal during recall prevents history from reaching the model',removed.status===409&&!controls.chatInputs.some(text=>text.includes(changedQuery)));
 if(process.argv.includes('--serve')){
  await learned(aLearn,source.a);
  controls.realChat=true;
  await fixture.serveWeb();
 }
 status='PASS';
}catch(error){console.error(String(error));process.exitCode=1;}
await writeFile(join(out,'http.json'),JSON.stringify({status,url:fixture.url,synthetic:true,checks},null,2));
if(status==='PASS'&&process.argv.includes('--serve')){
 console.log('Synthetic project-memory browser fixture '+fixture.url);
 process.on('SIGTERM',()=>fixture.finish().then(()=>process.exit(0)));
}else await fixture.finish();
