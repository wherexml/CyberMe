// Repeatable production-HTTP checks for the 洞察 footer contracts. Start scripts/insight-footer-fixture.mjs first (port 46881).
// It changes fixture state: restart the fixture before the browser run. Run: node --import tsx scripts/insight-footer-http-e2e.mjs
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ideaProvenance} from '../shared/attention-actions.ts';
const base='http://127.0.0.1:46881',stamp=new Date().toISOString().replace(/[:.]/g,'-'),out='output/insight-footer-client-20261112/'+stamp;
const checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(name)};
const req=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {http:r.status,data}};
const fx=(name,body)=>req('/__fixture/'+name,body||{});
const ev=async()=>(await req('/__fixture/evidence')).data;
const inbox=async id=>(await req('/api/inbox/'+id)).data,idea=async id=>(await req('/api/ideas/'+id)).data;
const ideaCall=async(i,action,operationId)=>req('/api/ideas/'+i.id+'/attention',{action,operationId,baseUpdatedAt:i.updatedAt,baseProvenanceKey:ideaProvenance(i)});
try{
 const start=await ev();
 // Same bare ID across kinds: restoring inbox:same leaves idea:same untouched.
 const ideaSameBefore=JSON.stringify(await idea('same'));
 let row=await inbox('same');
 const undo=await req('/api/inbox/same/attention-dismissal/undo',{dismissalId:row.attentionDismissal.id,baseUpdatedAt:row.updatedAt});
 check('inbox dismissal undo with exact dismissalId/baseUpdatedAt',undo.http===200&&undo.data.item.status!=='dismissed'&&undo.data.item.attentionDismissalUndone?.id===row.attentionDismissal.id);
 check('same bare ID in ideas unchanged',JSON.stringify(await idea('same'))===ideaSameBefore);
 // Stale base: 409, record unchanged.
 row=await inbox('conflict');await fx('touch',{id:'conflict'});
 const stale=await req('/api/inbox/conflict/attention-dismissal/undo',{dismissalId:row.attentionDismissal.id,baseUpdatedAt:row.updatedAt});
 check('stale baseUpdatedAt is a 409 and keeps the dismissal',stale.http===409&&(await inbox('conflict')).status==='dismissed');
 const fresh=await inbox('conflict');
 check('canonical reread then restore succeeds',(await req('/api/inbox/conflict/attention-dismissal/undo',{dismissalId:fresh.attentionDismissal.id,baseUpdatedAt:fresh.updatedAt})).http===200);
 // Snooze undo is bound to its operationId.
 row=await inbox('snoozed-inbox');
 check('wrong snooze operationId is refused',(await req('/api/inbox/snoozed-inbox/attention-snooze/undo',{operationId:'not-this-one'})).http===409);
 check('snooze undo with exact operationId',(await req('/api/inbox/snoozed-inbox/attention-snooze/undo',{operationId:row.attentionSnooze.operationId})).http===200&&!(await inbox('snoozed-inbox')).attentionSnooze);
 // Lost response after commit: readback by binding proves it; no replay needed.
 row=await inbox('lost-inbox');await fx('fault',{method:'POST',path:'/api/inbox/lost-inbox/attention-dismissal/undo',kind:'after'});
 const lost=await req('/api/inbox/lost-inbox/attention-dismissal/undo',{dismissalId:row.attentionDismissal.id,baseUpdatedAt:row.updatedAt});
 const lostRead=await inbox('lost-inbox');
 check('lost undo response is recoverable by readback',lost.data===''&&lostRead.attentionDismissalUndone?.id===row.attentionDismissal.id);
 // Idea restore keeps base version/provenance and clears deferral; untimed legacy deferral restores honestly.
 for(const id of ['deferred-timed','legacy-untimed']){const i=await idea(id);const r=await ideaCall(i,'restore','http-restore-'+id);check('idea restore '+id,r.http===200&&r.data.idea.status==='new'&&!r.data.idea.deferredUntil&&!!r.data.idea.restoredAt)}
 const legacy=await idea('local-mark');check('local-only mark has no server state',legacy.status==='new'&&!legacy.attentionAction);
 // Expired and forwarded records are not restore candidates.
 const forwarded=await inbox('forwarded');check('forwarded dismissal undo is refused',(await req('/api/inbox/forwarded/attention-dismissal/undo',{dismissalId:forwarded.attentionDismissal.id,baseUpdatedAt:forwarded.updatedAt})).http===409);

 // Refresh: one real model run per POST; outcome from authoritative counts, with the same ID updated in place.
 const ids=async()=>(await req('/api/ideas')).data.map(x=>x.id).sort().join(',');
 await fx('mode',{mode:'update'});await fx('source',{body:'公开试点：日期改到下周三。'});
 let before=await ids(),calls=(await ev()).modelCalls;
 const up=await req('/api/ideas/refresh',{});
 check('update counted though no new ID appears',up.http===200&&up.data.counts.updated>=1&&(await ids())===before,up.data.counts);
 check('one research-and-answer model run',(await ev()).modelCalls===calls+2);
 await fx('mode',{mode:'none'});const none=await req('/api/ideas/refresh',{});
 check('nothing new reports zero counts',none.http===200&&['created','updated','merged','archived'].every(k=>!none.data.counts[k]),none.data.counts);
 await fx('mode',{mode:'invalid'});const snapshot=JSON.stringify((await req('/api/ideas')).data);const bad=await req('/api/ideas/refresh',{});
 check('failure is visible and keeps every card',bad.http===502&&JSON.stringify((await req('/api/ideas')).data)===snapshot);
 check('background is not running after failure (retry safe)',(await ev()).background.status==='failed');
 // Lost refresh response after commit: background readback shows a new run ID that succeeded.
 await fx('mode',{mode:'update'});await fx('source',{body:'公开试点：日期确认为周四。'});
 const baseline=(await ev()).background.runId;await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'after'});
 const lostRefresh=await req('/api/ideas/refresh',{});const bg=(await ev()).background;
 check('lost refresh confirmed only by a new run ID',lostRefresh.data===''&&bg.runId!==baseline&&bg.status==='succeeded',{baseline,bg});
 // Never reached: background still shows the baseline run, so it cannot confirm this request.
 await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'before'});const runBefore=(await ev()).background.runId;
 await req('/api/ideas/refresh',{});check('request that never ran leaves the previous run as is',(await ev()).background.runId===runBefore);
 // Concurrent POSTs share one in-flight run.
 await fx('source',{body:'公开试点：日期再次确认。'});await fx('mode',{mode:'hold'});calls=(await ev()).modelCalls;
 const a=req('/api/ideas/refresh',{});for(let n=0;n<100&&!(await ev()).held;n++)await new Promise(r=>setTimeout(r,100));
 const b=req('/api/ideas/refresh',{});await new Promise(r=>setTimeout(r,200));await fx('release');await Promise.all([a,b]);
 check('concurrent refresh shares one model run',(await ev()).modelCalls===calls+2);
 await fx('mode',{mode:'update'});
 const end=await ev();
 check('no task, message or send created',end.tasks===start.tasks&&end.messages===start.messages&&end.sends===0,{tasks:end.tasks,messages:end.messages,sends:end.sends});
}catch(e){checks.push({name:String(e?.message||e),pass:false});process.exitCode=1}
const files=['web/src/v6/InsightFooter.tsx','web/src/v6/Brief.tsx','web/src/v6/attention.ts','web/src/v6/strings.ts','scripts/insight-footer-fixture.mjs','scripts/insight-footer-http-e2e.mjs','server/src/ideas-background.ts','server/src/inbox-attention-actions.ts','server/src/attention-actions.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
await mkdir(out,{recursive:true});
await writeFile(out+'/http.json',JSON.stringify({url:base,scope:'production HTTP and SQLite, synthetic data, controlled local model',sourceHashes,checks},null,2));
console.log(JSON.stringify({out,passed:checks.filter(c=>c.pass).length,total:checks.length}));
