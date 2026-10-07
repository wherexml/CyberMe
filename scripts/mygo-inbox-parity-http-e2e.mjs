// Public fixture 46374 only; artifacts contain public messages and counts, never credentials.
import assert from 'node:assert/strict';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const base='http://127.0.0.1:46374',checks=[];const out='output/mygo-inbox-parity/http-'+Date.now()+'.json';
async function call(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
function check(name,ok){checks.push({name,status:ok?'PASS':'FAIL'});assert.ok(ok,name)}
try{
 const b=(await call('/api/bootstrap')).body;const get=id=>b.inbox.find(x=>x.id===id);
 check('automatic draft does not prevent quiet',get('public-ok').surfacing==='quiet'&&get('public-ok').draft==='旧自动草稿');
 for(const id of ['manual','sensitive','unknown-send','decision','failed'])check('retain '+id,get('public-'+id).surfacing==='attention');
 for(const id of ['public-sensitive','public-decision']){const r=await call('/api/inbox/'+id+'/draft','POST',{requestId:'public-no-reply-'+id,mode:'auto'});check('no-reply attention item never drafts '+id,(r.status===409&&r.body.error==='reply_not_needed')||(id==='public-sensitive'&&r.status===403&&r.body.error==='sensitive_observe_only'))}
 check('source-excluded item starts quiet',get('public-excluded').surfacing==='quiet');
 check('startup recovers running draft ledger as failed',(await call('/api/inbox/public-recover/draft-requests/public-recovery-original')).body.status==='failed');
 const before=(await call('/qa/counts')).body;
 const rejected=await call('/api/inbox/public-ok/draft','POST',{requestId:'public-no-reply-request',mode:'auto'});check('no-reply generation blocked before model',rejected.status===409&&rejected.body.error==='reply_not_needed');
 await call('/qa/default','POST',{});const after=(await call('/qa/counts')).body;check('default preparation no model for uncertain/no-reply',before.runs===after.runs&&before.drafts===after.drafts);
 for(const id of ['public-ok','public-ended','public-excluded']){const row=(await call('/api/inbox/'+id)).body;check(id+' no default preparation',!row.draftPreparation)}
 for(const [id,route] of [['public-own','no_reply'],['public-ended','no_reply'],['public-reply','reply']]){const r=await call('/api/inbox/'+id+'/triage','POST',{force:true});check('real judgment '+id,r.status===200&&r.body.status==='succeeded'&&(route==='reply'?r.body.needsReply>=.75:r.body.route===route));checks.at(-1).method=r.body.method;checks.at(-1).route=r.body.route}
 const item=(await call('/api/inbox/public-ok')).body;const changed=await call('/api/inbox/public-ok','PATCH',{body:'请确认新增时间，之前的OK不代表这个问题已解决',baseUpdatedAt:item.updatedAt});check('new content invalidates quiet',changed.status===200&&(await call('/api/inbox/public-ok')).body.surfacing==='attention');
 check('external send blocked', (await call('/api/inbox/public-reply/send','POST',{})).status===403);
}finally{await mkdir('output/mygo-inbox-parity',{recursive:true});const sources={};for(const p of ['shared/inbox-surfacing.ts','server/src/drafts.ts','server/src/default-drafts.ts','web/src/desktop/full/inbox.js'])sources[p]=createHash('sha256').update(await readFile(p)).digest('hex');await writeFile(out,JSON.stringify({scope:'public-production-http; seeded decisions plus real Jev explicitly marked',checks,sources},null,2));console.log(JSON.stringify({out,checks}))}
