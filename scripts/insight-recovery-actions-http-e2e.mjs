// Production HTTP contract checks the recovery controller relies on. Start a fresh scripts/insight-recovery-actions-fixture.mjs
// (port 46913) first; restart it before the browser journey. Run: node --import tsx scripts/insight-recovery-actions-http-e2e.mjs
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {messageRevision} from '../shared/inbox-surfacing.ts';
const root='/Users/steve/Projects/CyberMe',base='http://127.0.0.1:46913';
const out=root+'/output/insight-action-recovery-20261112/'+new Date().toISOString().replace(/[:.]/g,'-');
const checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(name)};
const req=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const t=await r.text();let data;try{data=JSON.parse(t)}catch{data=t}return {http:r.status,data}};
const ev=async()=>(await req('/__fixture/evidence')).data;
const fx=(name,body)=>req('/__fixture/'+name,body||{});
// The exact payload a card sends: binding from the canonical record, a fresh operation ID, immutable extra input.
async function payload(id,type,extra={}){
 const item=(await req('/api/inbox/'+id)).data,requestMessageId=item.triage?.status==='succeeded'?item.triage.requestMessageId:item.lastOpenRequest?.requestMessageId;
 const m=(item.messages||[]).find(x=>x.id===requestMessageId);
 return {entityKind:'inbox',entityId:id,requestMessageId,requestRevision:m?messageRevision(m):undefined,type,operationId:'http-'+type+'-'+randomUUID(),...extra};
}
const post=p=>req('/api/attention/actions',p),op=id=>req('/api/attention/actions/'+id);
try{
 const start=await ev();
 // Same ID + same payload is a readback, not a second run.
 let p=await payload('dup','draft_reply');let a=await post(p);
 check('first draft operation succeeds',a.http===200&&a.data.status==='succeeded',a.data);
 let b=await post(p);
 check('same ID and payload replays without a second model run',b.http===200&&b.data.replayed===true&&(await ev()).modelCalls.dup===1);
 check('unknown operation ID reads back as 404',(await op('http-never-sent-'+randomUUID())).http===404);
 // POST never arrives: GET 404; explicit same-ID resubmission runs once; the delayed original is then a replay.
 await fx('fault',{entityId:'late',kind:'delay'});p=await payload('late','draft_reply');
 a=await post(p);check('delayed POST looks lost to the client',a.data==='');
 check('GET 404 while the original is still delayed',(await op(p.operationId)).http===404);
 b=await post(p);check('explicit same-ID resubmission succeeds',b.http===200&&b.data.status==='succeeded');
 const released=(await fx('release-delayed')).data;
 check('delayed original arrives as a replay of the same ID',released.length===1&&released[0].body?.replayed===true&&released[0].body?.id===p.operationId,released);
 check('exactly one model run for late',(await ev()).modelCalls.late===1);
 // Stale binding: refused before anything is recorded.
 await fx('fault',{entityId:'stale',kind:'stale'});p=await payload('stale','draft_reply');a=await post(p);
 check('binding change on arrival is a 409 action_stale',a.http===409&&a.data.error==='action_stale',a.data);
 check('stale refusal records no operation and runs no model',(await op(p.operationId)).http===404&&!(await ev()).modelCalls.stale);
 // Ambiguous 5xx after commit: GET settles it.
 await fx('fault',{entityId:'ambiguous',kind:'ambiguous'});p=await payload('ambiguous','draft_reply');a=await post(p);
 check('ambiguous 503 after commit',a.http===503);
 check('original ID reads back succeeded',(await op(p.operationId)).data.status==='succeeded');
 // Interrupted (unknown) with positive evidence.
 await fx('fault',{entityId:'proof',kind:'unknown'});p=await payload('proof','draft_reply');await post(p);
 check('forced unknown operation reads back unknown',(await op(p.operationId)).data.status==='unknown');
 const proof=(await req('/api/inbox/proof')).data.draftPreparation;
 check('positive evidence: draftPreparation carries the exact request ID',proof?.requestId===p.operationId&&['succeeded','review'].includes(proof?.status),proof);
 const ledger=await req('/api/inbox/proof/draft-requests/'+p.operationId);
 check('exact draft-request ledger reports the terminal state for the same ID',ledger.http===200&&ledger.data.requestId===p.operationId&&['succeeded','review'].includes(ledger.data.status),ledger.data);
 check('draft-request ledger 404 for an ID that never ran',(await req('/api/inbox/proof/draft-requests/http-never-'+randomUUID().slice(0,8))).http===404);
 // Interrupted create_task has no exact evidence beyond its own (lost) result.
 await fx('fault',{entityId:'absent',kind:'unknown'});p=await payload('absent','create_task');await post(p);
 const absent=(await op(p.operationId)).data;
 check('interrupted create_task reads back unknown without a result',absent.status==='unknown'&&!absent.result?.taskId,absent);
 // create_task receipt returns the exact task ID; a new request on the same record is a different binding.
 p=await payload('task','create_task');a=await post(p);const taskId=a.data.result?.taskId;
 check('create_task returns the exact task ID',a.data.status==='succeeded'&&!!taskId);
 await fx('new-request',{id:'task'});const q=await payload('task','create_task');
 check('new request changes the binding revision',q.requestMessageId!==p.requestMessageId||q.requestRevision!==p.requestRevision);
 // The server refuses typed 'discuss', which is why the client keeps discussion read-only (composer only).
 const d=await post({entityKind:'idea',entityId:'idea-info',provenanceKey:'x',type:'discuss',operationId:'http-discuss-'+randomUUID()});
 check('server refuses a typed discuss action',d.http===400&&d.data.error==='invalid_action',d.data);
 const e=await ev();
 check('no send or external call; tasks only from explicit create_task',e.sends===0&&e.externalAttempts===0&&e.tasks.length===start.tasks.length+2,{tasks:e.tasks.length,sends:e.sends});
}catch(err){checks.push({name:String(err?.message||err),pass:false});process.exitCode=1}
const files=['web/src/v6/store.ts','web/src/v6/attention.ts','web/src/v6/attention-action-state.ts','web/src/v6/Brief.tsx','web/src/v6/MessageActions.tsx','scripts/insight-recovery-actions-fixture.mjs','scripts/insight-recovery-actions-http-e2e.mjs','server/src/attention-actions.ts'];
const sourceHashes={};for(const f of files){try{sourceHashes[f]=createHash('sha256').update(await readFile(root+'/'+f)).digest('hex')}catch{sourceHashes[f]=null}}
await mkdir(out,{recursive:true});
await writeFile(out+'/http.json',JSON.stringify({url:base,scope:'production HTTP and SQLite, synthetic Feishu records, controlled local model',sourceHashes,checks},null,2));
console.log(JSON.stringify({out,passed:checks.filter(c=>c.pass).length,total:checks.length}));
