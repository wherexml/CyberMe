// Real-HTTP regression for native client endpoints (S1–S4). Logs counts/ids only, never message bodies.
// Usage: node scripts/native-api-e2e.mjs  [OPSTWIN_API=http://127.0.0.1:46110]
import http from 'node:http';

const API=process.env.OPSTWIN_API||'http://127.0.0.1:46110';
const results=[];let failed=0;
function check(name,ok,detail=''){results.push({name,ok,detail});if(!ok)failed++;console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`);}
async function req(path,init={}){const res=await fetch(API+path,{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}});let body;try{body=await res.json();}catch{body=undefined;}return {status:res.status,body};}
const keys=o=>Object.keys(o||{}).sort().join(',');

// Opens an SSE stream and collects parsed events; resolves helpers to wait for events.
function openSSE(headers={}){
  const events=[];let waiters=[];let raw='';let req;
  const ready=new Promise((resolve,reject)=>{
    req=http.get(API+'/api/native/events',{headers:{Accept:'text/event-stream',...headers}},res=>{
      resolve(res);res.setEncoding('utf8');
      res.on('data',chunk=>{raw+=chunk;let i;while((i=raw.indexOf('\n\n'))>=0){const block=raw.slice(0,i);raw=raw.slice(i+2);const ev={event:'message',data:'',id:undefined,comment:false};for(const line of block.split('\n')){if(line.startsWith(':')){ev.comment=true;continue;}const [k,...v]=line.split(':');const val=v.join(':').replace(/^ /,'');if(k==='event')ev.event=val;else if(k==='data')ev.data+=val;else if(k==='id')ev.id=val;}events.push(ev);waiters=waiters.filter(w=>!w(ev));}});
    });req.on('error',reject);
  });
  const waitFor=(pred,ms)=>new Promise((resolve,reject)=>{const hit=events.find(pred);if(hit)return resolve(hit);const t=setTimeout(()=>reject(new Error('timeout')),ms);waiters.push(ev=>{if(pred(ev)){clearTimeout(t);resolve(ev);return true;}return false;});});
  return {ready,events,waitFor,close:()=>req.destroy()};
}

console.log(`# native-api-e2e  ${new Date().toISOString()}  target=${API}`);

// --- S3: version
const v=await req('/api/native/version');
check('version 200',v.status===200,`status=${v.status}`);
check('version shape',v.body?.apiVersion===1&&v.body?.server==='opstwin-advance'&&Number.isInteger(v.body?.revision)&&JSON.stringify(v.body?.features)==='["messages.page","events.sse"]',`keys=${keys(v.body)} revision=${v.body?.revision}`);

// --- compatibility (shape captured from existing routes; unchanged by native-api.ts)
const boot=await req('/api/bootstrap');
check('bootstrap top-level shape unchanged',boot.status===200&&keys(boot.body)==='activities,artifacts,automations,connections,conversations,ideas,inbox,memories,messages,projects,revision,settings,sources,tasks',`keys=${keys(boot.body)}`);
const prim=await req('/api/conversations/primary');
check('conversations/primary shape unchanged',prim.status===200&&keys(prim.body)==='conversation,conversationId',`keys=${keys(prim.body)} id=${prim.body?.conversationId}`);
const primaryId=prim.body?.conversationId;
const cont=await req('/api/chat/continuation/'+encodeURIComponent(primaryId));
check('chat/continuation shape unchanged',cont.status===200&&keys(cont.body)==='items,running'&&Array.isArray(cont.body.items)&&typeof cont.body.running==='boolean',`keys=${keys(cont.body)} items=${cont.body?.items?.length}`);
const conv=await req('/api/conversations/'+encodeURIComponent(primaryId));
check('generic /api/conversations/:id still served',conv.status===200&&conv.body?.id===primaryId);

// --- S1: messages pagination, compared against the bootstrap set (rowid order) per conversation
const byConv=new Map();for(const m of boot.body.messages)byConv.set(m.conversationId,[...(byConv.get(m.conversationId)||[]),m]);
const busiest=[...byConv.entries()].sort((a,b)=>b[1].length-a[1].length)[0]?.[0];
async function pageAll(id,limit){
  const ids=[];let before;let pages=0;let firstPage;
  for(;;){const q=new URLSearchParams({limit:String(limit)});if(before)q.set('before',before);const r=await req(`/api/conversations/${encodeURIComponent(id)}/messages?${q}`);if(r.status!==200)return {error:r.status};pages++;if(!firstPage)firstPage=r.body;
    const pageIds=r.body.items.map(m=>m.id);
    const asc=r.body.items.every((m,i,a)=>i===0||String(a[i-1].createdAt)<=String(m.createdAt));
    if(!asc)return {error:'page_not_ascending'};
    if(r.body.items.some(m=>m.conversationId!==id))return {error:'foreign_message'};
    if(r.body.items.length>limit)return {error:'over_limit'};
    ids.unshift(...pageIds);
    if(!r.body.hasMore){if(r.body.nextBefore!==null)return {error:'nextBefore_without_more'};break;}
    if(r.body.nextBefore!==pageIds[0])return {error:'nextBefore_mismatch'};before=r.body.nextBefore;if(pages>500)return {error:'runaway'};}
  return {ids,pages,firstPage};
}
for(const [label,id,limit] of [['primary',primaryId,3],['primary default',primaryId,undefined],['busiest',busiest,7],['busiest default',busiest,undefined]]){
  if(!id){check(`pagination ${label}`,false,'no conversation');continue;}
  const expected=(byConv.get(id)||[]).map(m=>m.id);
  const r=await pageAll(id,limit??50);
  if(r.error){check(`pagination ${label} (limit=${limit??'default'})`,false,`error=${r.error}`);continue;}
  const unique=new Set(r.ids).size===r.ids.length;
  const sameSet=r.ids.length===expected.length&&expected.every(x=>r.ids.includes(x));
  const sameOrder=JSON.stringify(r.ids)===JSON.stringify(expected);
  check(`pagination ${label} (limit=${limit??'default 50'})`,unique&&sameSet,`conv=${id} total=${r.ids.length} expected=${expected.length} pages=${r.pages} unique=${unique} orderMatchesInsertion=${sameOrder}`);
  if(limit===undefined)check(`default limit is 50 (${label})`,r.firstPage.items.length===Math.min(50,expected.length),`firstPage=${r.firstPage.items.length}`);
}
const firstBusy=(await req(`/api/conversations/${encodeURIComponent(busiest)}/messages?limit=1`)).body;
check('limit=1 returns newest single message',firstBusy?.items?.length===1&&firstBusy.items[0].id===byConv.get(busiest).at(-1).id&&firstBusy.hasMore===true);
const max=await req(`/api/conversations/${encodeURIComponent(busiest)}/messages?limit=200`);
check('limit=200 accepted',max.status===200&&max.body.items.length===Math.min(200,byConv.get(busiest).length)&&max.body.hasMore===(byConv.get(busiest).length>200),`items=${max.body?.items?.length}`);
const oldest=byConv.get(busiest)[0].id;
const beforeOldest=await req(`/api/conversations/${encodeURIComponent(busiest)}/messages?before=${encodeURIComponent(oldest)}`);
check('before=oldest returns empty, hasMore=false',beforeOldest.status===200&&beforeOldest.body.items.length===0&&beforeOldest.body.hasMore===false&&beforeOldest.body.nextBefore===null);
for(const bad of ['0','201','-1','abc','1.5','']){const r=await req(`/api/conversations/${encodeURIComponent(primaryId)}/messages?limit=${bad}`);check(`limit=${JSON.stringify(bad)} → 400`,r.status===400&&r.body?.error==='invalid_pagination',`status=${r.status} error=${r.body?.error}`);}
const badBefore=await req(`/api/conversations/${encodeURIComponent(primaryId)}/messages?before=message-does-not-exist`);
check('unknown before id → 400',badBefore.status===400&&badBefore.body?.error==='invalid_before',`status=${badBefore.status} error=${badBefore.body?.error}`);
const foreignBefore=busiest!==primaryId?await req(`/api/conversations/${encodeURIComponent(primaryId)}/messages?before=${encodeURIComponent(oldest)}`):{status:400};
check('before id from another conversation → 400',foreignBefore.status===400,`status=${foreignBefore.status}`);
const missing=await req('/api/conversations/conversation-does-not-exist/messages');
check('unknown conversation → 404',missing.status===404&&missing.body?.error==='not_found',`status=${missing.status}`);
check('no secret-looking keys in page',!JSON.stringify(max.body).match(/"(apiKey|accessToken|diskPath|password|secret|token)"/));

// --- S2: SSE
const sse=openSSE();const res=await sse.ready;
check('SSE content-type',String(res.headers['content-type']).startsWith('text/event-stream'),`status=${res.statusCode} ct=${res.headers['content-type']}`);
const hello=await sse.waitFor(e=>e.event==='hello',3000).catch(()=>undefined);
const helloRev=hello?JSON.parse(hello.data).revision:undefined;
check('SSE hello received',!!hello&&Number.isInteger(helloRev)&&hello.id===String(helloRev),`id=${hello?.id} revision=${helloRev}`);
const marker=`OPSADV-QA-NATIVE-SSE-${Date.now()}`;
const created=await req('/api/tasks',{method:'POST',body:JSON.stringify({title:marker,status:'active'})});
check('marker task created',created.status===201,`status=${created.status} id=${created.body?.id}`);
const revEv=await sse.waitFor(e=>e.event==='revision'&&JSON.parse(e.data).revision>helloRev,5000).catch(()=>undefined);
check('SSE revision event after write',!!revEv&&revEv.id===String(JSON.parse(revEv.data).revision),`id=${revEv?.id}`);
const deleted=created.body?.id?await req('/api/tasks/'+encodeURIComponent(created.body.id),{method:'DELETE'}):{status:0};
check('marker task soft-deleted',deleted.status===200&&deleted.body?.deleted===true,`status=${deleted.status}`);
const afterDelete=await sse.waitFor(e=>e.event==='revision'&&JSON.parse(e.data).revision>JSON.parse(revEv?.data||'{"revision":0}').revision,5000).catch(()=>undefined);
check('SSE revision event after delete',!!afterDelete,`id=${afterDelete?.id}`);
const nowRev=(await req('/api/native/version')).body.revision;
check('SSE revisions monotonic',sse.events.filter(e=>e.event==='revision').every((e,i,a)=>i===0||Number(a[i-1].id)<Number(e.id)),`events=${sse.events.length} serverRevision=${nowRev}`);
sse.close();

// Last-Event-ID resume: stale id → immediate revision; current id → no extra event.
const stale=openSSE({'Last-Event-ID':String(helloRev)});await stale.ready;
const staleRev=await stale.waitFor(e=>e.event==='revision',2000).catch(()=>undefined);
check('Last-Event-ID stale → immediate revision',!!staleRev&&Number(staleRev.id)>helloRev,`lastEventId=${helloRev} got=${staleRev?.id}`);stale.close();
const fresh=openSSE({'Last-Event-ID':String((await req('/api/native/version')).body.revision)});await fresh.ready;
await fresh.waitFor(e=>e.event==='hello',2000).catch(()=>undefined);await new Promise(r=>setTimeout(r,800));
check('Last-Event-ID current → hello only',fresh.events.filter(e=>e.event==='revision').length===0||fresh.events.filter(e=>e.event==='revision').every(e=>Number(e.id)>Number(fresh.events[0].id)),`events=${fresh.events.map(e=>e.event).join(',')}`);fresh.close();

// Concurrent subscribers all receive a broadcast, then disconnect cleanly.
const many=Array.from({length:5},()=>openSSE());await Promise.all(many.map(s=>s.ready));
const hellos=await Promise.all(many.map(s=>s.waitFor(e=>e.event==='hello',3000).catch(()=>undefined)));
const marker2=`OPSADV-QA-NATIVE-SSE-${Date.now()}-fanout`;
const t2=await req('/api/tasks',{method:'POST',body:JSON.stringify({title:marker2,status:'active'})});
const got=await Promise.all(many.map((s,i)=>s.waitFor(e=>e.event==='revision'&&Number(e.id)>Number(hellos[i]?.id),5000).then(()=>true,()=>false)));
if(t2.body?.id)await req('/api/tasks/'+encodeURIComponent(t2.body.id),{method:'DELETE'});
check('5 concurrent subscribers receive revision',got.every(Boolean),`received=${got.filter(Boolean).length}/5 task=${t2.body?.id}`);
many.forEach(s=>s.close());
await new Promise(r=>setTimeout(r,1500));
const health=await req('/api/health');
check('server healthy after SSE disconnects',health.status===200&&health.body?.ok===true,`revision=${health.body?.revision}`);

console.log(`\n# summary: ${results.length-failed}/${results.length} passed, ${failed} failed`);
process.exit(failed?1:0);
