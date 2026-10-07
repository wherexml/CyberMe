import assert from 'node:assert/strict';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const base='http://127.0.0.1:46376',out='output/inbox-pending/http-'+Date.now()+'.json',checks=[];
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const item=async id=>(await call('/api/inbox/public-'+id)).body;
function check(name,ok,evidence){checks.push({name,status:ok?'PASS':'FAIL',...(evidence?{evidence}: {})});assert.ok(ok,name)}
try{
 await call('/qa/review-cases','POST',{});
 check('recalled status is not replied',(await item('review-recalled')).disposition.primaryReason!=='replied');
 check('legacy sent with new unresolved request needs verification',(await item('review-stale-sent')).disposition.placement==='verify');
 check('all old conversation expires without selected request',(await item('review-old-all')).disposition.primaryReason==='expired');
 const before=(await call('/qa/counts')).body;
 await call('/qa/arm-boundary','POST',{});check('before 168h pending',(await item('boundary')).disposition.placement==='pending');
 const deadline=Date.now()+5000;let boundary;do{boundary=await item('boundary');if(boundary.disposition.placement==='quiet')break;await new Promise(r=>setTimeout(r,100))}while(Date.now()<deadline);check('168h boundary expires without entity write',boundary.disposition.primaryReason==='expired');
 for(const [id,placement,reason]of [['old','quiet','expired'],['no-reply','quiet','no_reply'],['low','quiet','low_priority'],['replied','quiet','replied'],['unknown-time','verify','time_unknown'],['future','verify','time_unknown'],['failed','verify','judgment_failed'],['priority-unknown','verify','priority_unknown'],['contradiction','verify','context_unknown'],['sensitive','verify','sensitive'],['unrelated','pending','action'],['decision','pending','action'],['medium','pending','action']]){const r=await item(id);check(id+' projection',r.disposition.placement===placement&&r.disposition.primaryReason===reason,{placement:r.disposition.placement,reason:r.disposition.primaryReason});}
 const r=await item('no-reply');check('manual and candidate drafts preserved',r.draft==='保留草稿 no-reply'&&r.editedByUser&&r.draftCandidate.text==='保留候选');
 const expiredUnknown=await item('send-unknown');check('expired unknown send keeps recovery',expiredUnknown.disposition.placement==='quiet'&&expiredUnknown.disposition.recoveryReasons.includes('send_unknown'));
 check('recalled reply not resolved',(await item('recalled')).disposition.primaryReason!=='replied');
 const pending=(await call('/api/inbox/query?limit=200')).body;check('pending query excludes four exit reasons',!pending.items.some(r=>['public-old','public-no-reply','public-low','public-replied'].includes(r.id)));check('high priorities first',pending.items[0].disposition.priority==='high');
 for(const placement of ['quiet','verify','pending']){const all=(await call('/api/inbox/query?placement='+placement+'&limit=200')).body;const page=(await call('/api/inbox/query?placement='+placement+'&limit=1&offset=0')).body;check(placement+' canonical pagination',all.total===all.items.length&&page.total===all.total&&page.items.length===1);}
 const unknown=(await call('/api/inbox/query?placement=verify&limit=200')).body;check('verification includes expired unknown send',unknown.items.some(r=>r.id==='public-send-unknown'));
 for(const id of ['old-empty','no-reply-empty','low-empty']){const result=await call('/api/inbox/public-'+id+'/draft','POST',{mode:'auto',requestId:'public-policy-'+id});check(id+' auto generation blocked',result.status===409);}
 await call('/qa/default','POST',{});const after=(await call('/qa/counts')).body;check('blocked auto drafts have zero model or send effects',after.runs===before.runs&&after.drafts===before.drafts&&after.sends===0);
 const old=await item('old');const saved=await call('/api/inbox/public-old','PATCH',{draft:'过期后保留的人工草稿',editedByUser:true,baseUpdatedAt:old.updatedAt});check('saving expired draft does not renew clock',saved.status===200&&saved.body.disposition.primaryReason==='expired'&&saved.body.disposition.actionableAt===old.disposition.actionableAt);
 check('expired restore rejected',(await call('/api/inbox/public-old/surface','POST',{baseUpdatedAt:saved.body.updatedAt})).status===409);
 const low=await item('low');check('restore stale lease rejected',(await call('/api/inbox/public-low/surface','POST',{baseUpdatedAt:'stale'})).status===409);
 const restored=await call('/api/inbox/public-low/surface','POST',{baseUpdatedAt:low.updatedAt});check('valid explicit restoration',restored.status===200&&restored.body.disposition.placement==='pending');
 await call('/api/inbox/public-low','PATCH',{body:'现在出现新的请求，请重新核实',baseUpdatedAt:restored.body.updatedAt});check('source change invalidates judgment and override',(await item('low')).disposition.placement==='verify');
 check('server projection cannot be forged',(await call('/api/inbox/public-medium','PATCH',{disposition:{placement:'quiet'}})).status===403);
 await call('/qa/sync-reply','POST',{});check('new incoming source state invalidates old judgment',(await item('sync')).disposition.placement==='verify');
 if(process.argv.includes('--real-jev'))for(const [id,expected]of [['real-ended','no_reply'],['real-group','unresolved'],['real-replied','replied'],['sync','replied']]){const response=await call('/api/inbox/public-'+id+'/triage','POST',{force:true});const r=await item(id);check('real Jev '+id,response.status===200&&response.body.status==='succeeded'&&(expected==='unresolved'?['pending','verify'].includes(r.disposition.placement)&&r.disposition.primaryReason!=='replied':r.disposition.primaryReason===expected),{method:response.body.method,route:response.body.route,priority:response.body.priority,resolution:response.body.resolution,reason:r.disposition.primaryReason,requestMessageId:response.body.requestMessageId,replyMessageId:response.body.replyMessageId,error:response.body.error});}
 if(process.argv.includes('--real-jev')){
  const triage=await call('/api/inbox/public-real-closed/triage','POST',{force:true});
  const all=(await call('/api/inbox')).body,rounds=all.filter(r=>r.sourceParentInboxId==='public-real-closed');
  check('new request after closure creates independent round',triage.body.resolution==='open'&&rounds.length===1&&rounds[0].status==='pending'&&!rounds[0].draft&&!rounds[0].sendKey,{resolution:triage.body.resolution,roundCount:rounds.length});
  await call('/api/inbox/public-real-closed/triage','POST',{force:true});
  check('repeat analysis creates no duplicate rounds',(await call('/api/inbox')).body.filter(r=>r.sourceParentInboxId==='public-real-closed').length===1);
  check('old closed round and draft preserved',(await item('real-closed')).status==='done'&&(await item('real-closed')).draft==='保留草稿 real-closed');
 }
 check('external send gate denies',(await call('/api/inbox/public-medium/send','POST',{})).status===403);
} catch(e){process.exitCode=1;checks.push({name:'execution',status:'FAIL',error:e.message})}finally{
 await mkdir('output/inbox-pending',{recursive:true});const sources={};for(const p of ['shared/inbox-surfacing.ts','server/src/inbox-triage.ts','server/src/store.ts','server/src/default-drafts.ts','server/src/drafts.ts','web/src/desktop/full/inbox.js'])sources[p]=createHash('sha256').update(await readFile(p)).digest('hex');await writeFile(out,JSON.stringify({scope:'isolated production HTTP with public fixed decisions; real Jev checks explicitly marked',checks,sources},null,2));console.log(JSON.stringify({out,checks}));
}
