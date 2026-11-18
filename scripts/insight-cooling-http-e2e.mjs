// Production HTTP contract checks for the draft cooling wait. Start a fresh scripts/insight-cooling-fixture.mjs (port 46905) first;
// restart it before the browser journey. Run: node --import tsx scripts/insight-cooling-http-e2e.mjs
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {messageRevision} from '../shared/inbox-surfacing.ts';
const root='/Users/steve/Projects/CyberMe',base='http://127.0.0.1:46905';
const out=root+'/output/insight-cooling-20261112/'+new Date().toISOString().replace(/[:.]/g,'-');
const checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(name)};
const req=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const t=await r.text();let data;try{data=JSON.parse(t)}catch{data=t}return {http:r.status,data}};
const ev=async()=>(await req('/__fixture/evidence')).data;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Binds the exact request revision the card binds, read from the canonical record.
const draft=async(id,operationId)=>{
 const item=(await req('/api/inbox/'+id)).data,requestMessageId=item.triage?.status==='succeeded'?item.triage.requestMessageId:item.lastOpenRequest?.requestMessageId;
 const m=(item.messages||[]).find(x=>x.id===requestMessageId);
 return req('/api/attention/actions',{entityKind:'inbox',entityId:id,requestMessageId,requestRevision:m?messageRevision(m):undefined,type:'draft_reply',operationId});
};
try{
 const start=await ev();
 const cop=(await req('/__fixture/deadline',{id:'waiting',seconds:3600})).data;
 const boot=(await req('/api/bootstrap')).data,row=boot.inbox.find(x=>x.id==='waiting');
 check('bootstrap exposes the authoritative cooldown to the client',row?.copilot?.state==='pending'&&row.copilot.notBefore===cop.notBefore,row?.copilot);
 let r=await draft('waiting','http-cooling-1');
 check('draft during cooling is refused with inbox_cooling and the stored deadline',r.http===409&&r.data.error==='inbox_cooling'&&r.data.detail?.notBefore===cop.notBefore,r.data);
 const op=(await req('/api/attention/actions/http-cooling-1')).data;
 check('refused operation is recorded once as failed inbox_cooling (readback, no replay)',op.status==='failed'&&op.error==='inbox_cooling',op);
 let e=await ev();
 check('cooling refusal calls no model and keeps the stale draft untouched',!(e.modelCalls.waiting)&&e.cards.waiting.draft==='公开旧草稿正文。'&&e.cards.waiting.draftStale===true);
 // Race: the card was ready, the source settles into a new window as the POST arrives.
 await req('/__fixture/arm-race',{id:'race',seconds:8});
 r=await draft('race','http-race-1');
 e=await ev();
 check('race returns inbox_cooling bound to the new deadline, without a model call',r.http===409&&r.data.error==='inbox_cooling'&&r.data.detail?.notBefore===e.cards.race.copilot.notBefore&&!(e.modelCalls.race),r.data);
 check('race request is not replayed by the server',e.actionPosts.filter(p=>p.entityId==='race').length===1);
 // Extension: a later deadline replaces the earlier one; the earlier time passing does not unlock.
 await req('/__fixture/deadline',{id:'extend',seconds:3});await req('/__fixture/deadline',{id:'extend',seconds:9});await sleep(4000);
 r=await draft('extend','http-extend-1');
 check('extended deadline still refuses after the earlier time',r.http===409&&r.data.error==='inbox_cooling');
 // Expiry: after the race deadline exactly one explicit request drafts once.
 await sleep(Math.max(0,Date.parse(e.cards.race.copilot.notBefore)-Date.now())+500);
 const callsBefore=(await ev()).modelCalls.race||0;
 r=await draft('race','http-race-2');
 e=await ev();
 check('after the deadline one explicit request drafts once',r.http===200&&r.data.status==='succeeded'&&(e.modelCalls.race||0)===callsBefore+1,{status:r.data.status,calls:e.modelCalls.race});
 // Honest failures stay failures.
 r=await draft('replied','http-replied-1');
 check('already-replied source keeps its honest refusal (not cooling)',r.http===409&&r.data.error!=='inbox_cooling',r.data);
 r=await draft('fail','http-fail-1');
 check('a real model failure is not reported as cooling',r.data.error!=='inbox_cooling'&&(r.http>=400||r.data.status==='failed'),r.data);
 e=await ev();
 check('no task, send or external call',e.tasks===start.tasks&&e.sends===0&&e.externalAttempts===0,{tasks:e.tasks,sends:e.sends});
}catch(err){checks.push({name:String(err?.message||err),pass:false});process.exitCode=1}
const files=['web/src/v6/Brief.tsx','web/src/v6/attention.ts','scripts/insight-cooling-fixture.mjs','scripts/insight-cooling-http-e2e.mjs','server/src/inbox-copilot.ts','server/src/inbox-triage.ts','server/src/drafts.ts'];
const sourceHashes={};for(const f of files){try{sourceHashes[f]=createHash('sha256').update(await readFile(root+'/'+f)).digest('hex')}catch{sourceHashes[f]=null}}
await mkdir(out,{recursive:true});
await writeFile(out+'/http.json',JSON.stringify({url:base,scope:'production HTTP and SQLite, synthetic Feishu records, controlled local model',sourceHashes,checks},null,2));
console.log(JSON.stringify({out,passed:checks.filter(c=>c.pass).length,total:checks.length}));
