// Run with scripts/chat-queue-fixture.mjs on 46831. Actual API/SQLite/SDK, controlled model.
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:46831',out='output/chat-queue-20261111',checks=[];
await mkdir(out,{recursive:true});
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {http:r.status,...await r.json()}};
const check=(name,ok)=>{checks.push({name,pass:!!ok});if(!ok)throw Error(name)};
const until=async f=>{const end=Date.now()+25000;while(Date.now()<end){const v=await f();if(v)return v;await new Promise(r=>setTimeout(r,80))}throw Error('wait timed out')};
const body=(id,conversationId='queue-primary',extra={})=>({requestId:id,conversationId,message:id,queueCurrent:true,readOnly:true,...extra});
const send=(id,cid,extra)=>api('POST','/api/chat',body(id,cid,extra));
const state=()=>api('GET','/fixture/state');const status=id=>api('GET','/api/chat/requests/'+id);
try{
 const a=await send('QUEUE-HOLD-A');check('first accepted durably',a.http===202);await until(async()=>(await state()).held.includes('QUEUE-HOLD-A'));
 const b=await send('QUEUE-B'),c=await send('QUEUE-C');check('second and third accepted',b.http===202&&c.http===202);
 check('original is still running',(await status('QUEUE-HOLD-A')).status==='running');check('later turns remain queued',(await status('QUEUE-B')).status==='queued'&&(await status('QUEUE-C')).status==='queued');
 check('queued has no model start',(await state()).seen.length===1);
 check('queued idempotent replay returns receipt',(await send('QUEUE-B')).http===202);
 check('queued payload conflict rejected',(await send('QUEUE-B',undefined,{message:'different'})).http===409);
 check('discovery includes queued',(await api('GET','/api/chat/conversations/queue-primary/unresolved')).items.some(x=>x.requestId==='QUEUE-B'&&x.status==='queued'));
 const other=await api('POST','/api/conversations',{title:'独立排队验收'});await send('QUEUE-OTHER',other.id);await until(async()=>(await status('QUEUE-OTHER')).status==='succeeded');check('other conversation runs independently',(await status('QUEUE-HOLD-A')).status==='running');
 await api('POST','/fixture/release',{tag:'QUEUE-HOLD-A'});await until(async()=>(await status('QUEUE-C')).status==='succeeded');
 const s=await state(),same=s.seen.filter(x=>x.tag!=='QUEUE-OTHER');check('same conversation FIFO',same.map(x=>x.tag).join(',')==='QUEUE-HOLD-A,QUEUE-B,QUEUE-C');check('next turn sees prior assistant',same[1].all.includes('QUEUE-HOLD-A 已完成。'));check('prior turn excludes future queued messages',!same[0].all.includes('QUEUE-B')&&!same[1].all.includes('QUEUE-C'));
 check('first succeeded without cancellation',(await status('QUEUE-HOLD-A')).status==='succeeded');
 const before=s.seen.length;check('success replay returns original',(await send('QUEUE-B')).replayed===true);check('no duplicate model call',(await state()).seen.length===before);
 await send('QUEUE-FAIL',undefined,{contextIds:['missing-synthetic-context']});await send('QUEUE-AFTER-FAIL');await until(async()=>(await status('QUEUE-AFTER-FAIL')).status==='succeeded');check('failure remains failed',(await status('QUEUE-FAIL')).status==='failed');check('failure does not block following turn',(await status('QUEUE-AFTER-FAIL')).status==='succeeded');
 await send('QUEUE-HOLD-RETRY');await until(async()=>(await state()).held.includes('QUEUE-HOLD-RETRY'));await send('QUEUE-FAIL',undefined,{contextIds:['missing-synthetic-context']});check('explicit failed retry joins tail',(await status('QUEUE-FAIL')).status==='queued');await api('POST','/fixture/release',{tag:'QUEUE-HOLD-RETRY'});await until(async()=>(await status('QUEUE-FAIL')).status==='failed');check('retry did not interrupt active turn',(await status('QUEUE-HOLD-RETRY')).status==='succeeded');
 await api('POST','/fixture/work',{status:'running'});await send('QUEUE-AFTER-WORK');check('chat waits for existing work',(await status('QUEUE-AFTER-WORK')).status==='queued');check('existing work not cancelled',(await state()).works[0].status==='running');await api('POST','/fixture/work',{status:'succeeded'});await until(async()=>(await status('QUEUE-AFTER-WORK')).status==='succeeded');check('chat starts after work settles',true);
 // Project memory partitions are retired (docs/public/global-memory.md): the endpoint answers 410 and memoryProjectId is inert.
 // Queued requests carrying the legacy claim still run once, in their own conversation, under global memory.
 const project=await api('POST','/api/projects',{title:'公开隔离项目'}),retired=await api('POST','/api/chat/memory-scope',{projectId:project.id});check('retired project memory scope returns 410',retired.http===410);
 const side=await api('POST','/api/conversations',{title:'全局记忆兼容排队验收'});check('isolated side conversation created',typeof side.id==='string'&&side.id!=='queue-primary');
 await send('QUEUE-HOLD-SCOPE',side.id,{memoryProjectId:project.id});await until(async()=>(await state()).held.includes('QUEUE-HOLD-SCOPE'));await send('QUEUE-SCOPE-WAIT',side.id,{memoryProjectId:project.id});
 check('legacy-claim request waits behind the running turn',(await status('QUEUE-HOLD-SCOPE')).status==='running'&&(await status('QUEUE-SCOPE-WAIT')).status==='queued'&&!(await state()).seen.some(x=>x.tag==='QUEUE-SCOPE-WAIT'));
 await api('DELETE','/api/projects/'+project.id);await api('POST','/fixture/release',{tag:'QUEUE-HOLD-SCOPE'});await until(async()=>['succeeded','failed','partial','cancelled'].includes((await status('QUEUE-SCOPE-WAIT')).status));
 const hold=await status('QUEUE-HOLD-SCOPE'),wait=await status('QUEUE-SCOPE-WAIT');check('both legacy-claim requests succeed under global memory',hold.status==='succeeded'&&wait.status==='succeeded');
 check('removed project does not invalidate queued work',!wait.failureCode);
 check('queued request reaches the provider exactly once in its original conversation',(await state()).seen.filter(x=>x.tag==='QUEUE-SCOPE-WAIT').length===1&&wait.conversationId===side.id&&hold.conversationId===side.id);
 check('invalid delivery combination rejected',(await send('QUEUE-INVALID',undefined,{interruptCurrent:true})).http===400);
 console.log({checks:checks.length,pass:true});
}finally{await writeFile(out+'/http-result.json',JSON.stringify({url:base,scope:'Production API/SQLite/Agent SDK, controlled SSE provider, synthetic data',checks},null,2))}
