// Run after the HTTP + browser journeys and same PENDING_QA_SCOPE server restart.
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:46376',checks=[];
const get=async p=>(await(await fetch(base+p)).json());
const post=async(p,body)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function check(name,ok){checks.push({name,status:ok?'PASS':'FAIL'});assert.ok(ok,name)}
try{
 const row=await get('/api/inbox/public-medium');check('same database restart retains expired edited draft',row.disposition.primaryReason==='expired'&&row.draft.includes('END-PENDING'));
 check('restart retains unique new round',(await get('/api/inbox')).filter(r=>r.sourceParentInboxId==='public-real-closed').length===1);
 await post('/qa/failed-draft',{});const before=await get('/qa/counts');
 check('failed original draft retry rechecks expiry',(await post('/api/inbox/public-old-empty/draft',{mode:'auto',requestId:'public-failed-retry'})).status===409);
 check('failed retry starts no run',(await get('/qa/counts')).runs===before.runs);
 const nr=await get('/api/inbox/public-no-reply');const restored=await(await post('/api/inbox/public-no-reply/surface',{baseUpdatedAt:nr.updatedAt})).json();check('explicit no-reply override exposes reply action',restored.disposition.placement==='pending'&&restored.disposition.actionType==='reply');
}catch(e){process.exitCode=1;checks.push({name:'execution',status:'FAIL',error:e.message})}finally{await writeFile('output/inbox-pending/restart-review.json',JSON.stringify({at:new Date().toISOString(),checks},null,2));console.log(checks)}
