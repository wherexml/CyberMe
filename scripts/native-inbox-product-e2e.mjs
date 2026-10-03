// Real HTTP regression for native Inbox candidate/status and Tasks conflict contracts.
// OPSTWIN_QA_CANDIDATE=1 includes real-model concurrent generation (can take minutes).
// Evidence records ids/statuses/hashes only. No external messages, no private text.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const API=process.env.OPSTWIN_API||'http://127.0.0.1:46110';
const marker='OPSADV-QA-NATIVE-INBOX-'+Date.now();
const out=process.env.OPSTWIN_QA_OUTPUT||'output/native-inbox-product-'+Date.now();await mkdir(out,{recursive:true});
const rows=[],cleanup=[];let inbox,task;
function check(name,ok,detail={}){rows.push({name,status:ok?'PASS':'FAIL',...detail});console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)throw Error(name);}
async function req(path,method='GET',body){const res=await fetch(API+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};}
try {
 const create=await req('/api/inbox','POST',{title:marker,sender:'Native QA synthetic',channel:'Internal',origin:'human',body:'请确认合成测试任务。仅测试本地草稿，不发送消息',status:'pending',draft:'原始合成草稿',receivedAt:new Date().toISOString()});
 inbox=create.status===201?create.body:undefined;check('create synthetic inbox',create.status===201);
 const saved=await req('/api/inbox/'+inbox.id,'PATCH',{draft:'并发合成草稿',baseUpdatedAt:inbox.updatedAt});check('save reply with version',saved.status===200);
 const conflict=await req('/api/inbox/'+inbox.id,'PATCH',{draft:'不得覆盖',baseUpdatedAt:inbox.updatedAt});check('reply conflict protects edits',conflict.status===409&&conflict.body.error==='edit_conflict');
 const ignored=await req('/api/inbox/'+inbox.id,'PATCH',{status:'dismissed',baseUpdatedAt:saved.body.updatedAt});check('ignore state saved',ignored.status===200&&ignored.body.status==='dismissed');
 const reopened=await req('/api/inbox/'+inbox.id,'PATCH',{status:'pending',baseUpdatedAt:ignored.body.updatedAt});check('reopen cancels feedback',reopened.status===200&&reopened.body.status==='pending');
 const bad=await req('/api/inbox/'+inbox.id+'/draft-candidate/apply','POST',{requestId:'missing-candidate',baseUpdatedAt:reopened.body.updatedAt});check('missing candidate refused',bad.status===409&&bad.body.error==='candidate_not_found');
 const quiet=await req('/api/inbox/query?includeQuiet=true&includeDone=true&limit=200');check('quiet API has real surfaced values',quiet.status===200&&quiet.body.items.every(item=>['attention','quiet'].includes(item.surfacing)));
 const t=await req('/api/tasks','POST',{title:marker,notes:'Synthetic native task notes',status:'active',dueDate:'2026-10-03'});task=t.status===201?t.body:undefined;check('task create',t.status===201);
 const tp=await req('/api/tasks/'+task.id,'PATCH',{notes:'Updated synthetic notes',baseUpdatedAt:task.updatedAt});check('task save',tp.status===200);
 const tc=await req('/api/tasks/'+task.id,'PATCH',{notes:'Do not overwrite',baseUpdatedAt:task.updatedAt});check('task conflict',tc.status===409&&tc.body.error==='edit_conflict');
 const td=await req('/api/tasks/'+task.id,'PATCH',{status:'completed',baseUpdatedAt:tp.body.updatedAt});check('task complete',td.status===200&&td.body.status==='completed');
 const tr=await req('/api/tasks/'+task.id,'PATCH',{status:'active',baseUpdatedAt:td.body.updatedAt});check('task reopen',tr.status===200&&tr.body.status==='active');
 if(process.env.OPSTWIN_QA_CANDIDATE==='1') {
   const requestId='native-qa-candidate-'+Date.now();
   await writeFile(out+'/candidate-request.json',JSON.stringify({requestId,inboxId:inbox.id}));
   const generation=req('/api/inbox/'+inbox.id+'/draft','POST',{mode:'chat',requestId});
   let run;for(let attempt=0;attempt<100;attempt++){const b=await req('/api/runs?limit=100');const runs=Array.isArray(b.body)?b.body:b.body.items;run=runs?.find(a=>a.requestId===requestId&&a.status==='running');if(run)break;await new Promise(r=>setTimeout(r,1000));}
   // Generating ledger is persisted after triage; wait until candidate run begins.
   if(!run) {rows.push({name:'candidate race triggered',status:'BLOCKED',reason:'running draft not observed in bootstrap activities'});await generation;}
   else {
     const latest=await req('/api/inbox/'+inbox.id);const race=await req('/api/inbox/'+inbox.id,'PATCH',{draft:'并发编辑必须保留',baseUpdatedAt:latest.body.updatedAt});check('concurrent edit while generating',race.status===200);
     const result=await generation;check('generation stores reviewed candidate',result.status===409&&result.body.error==='draft_review_required');
     const current=await req('/api/inbox/'+inbox.id);const candidate=current.body.draftCandidate;check('candidate reads after refresh',candidate?.requestId===requestId&&!!candidate.text,{requestId});
     const apply=await req('/api/inbox/'+inbox.id+'/draft-candidate/apply','POST',{requestId,baseUpdatedAt:current.body.updatedAt});check('candidate explicitly applied',apply.status===200&&apply.body.item.draft===candidate.text&&!apply.body.item.draftCandidate);
   }
 } else {rows.push({name:'real model concurrent candidate',status:'NOT_RUN',reason:'Run with OPSTWIN_QA_CANDIDATE=1'});}
} catch(error) {rows.push({name:'execution',status:'FAIL',reason:error.message});}
finally {
 for(const [type,item]of [['inbox',inbox],['tasks',task]])if(item){const response=await req('/api/'+type+'/'+item.id,'DELETE');cleanup.push({type,id:item.id,status:response.status});}
 const sources={};for(const path of ['native/macos/app/src/inbox.rs','native/macos/app/src/tasks.rs','native/macos/app/src/files.rs','native/macos/crates/opstwin-api/src/inbox_product.rs'])sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 await writeFile(out+'/report.json',JSON.stringify({marker,api:API,scope:'Real HTTP native contracts; GUI requires screenshot acceptance',rows,cleanup,sources},null,2));
 console.log(out+'/report.json');if(rows.some(r=>r.status==='FAIL'))process.exitCode=1;
}
