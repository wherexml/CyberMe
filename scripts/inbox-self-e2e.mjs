import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.TRIAGE_API||'http://127.0.0.1:46110',out=new URL('../output/inbox-self-20261002/',import.meta.url);
await mkdir(out,{recursive:true});
const marker=`OPSADV-QA-SELF-${Date.now()}`,evidence={marker,checks:[],cases:[]};
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
function check(name,ok){evidence.checks.push({name,status:ok?'PASS':'FAIL'});assert.ok(ok,name);}
try{
 const cases=[
 ['self-test',{isSelfTest:true,recipientId:'self',testMarker:marker},'self_test'],
 ['outgoing',{isMine:true,direction:'outgoing'},'own_message'],
 ['latest-own',{messages:[{text:'请回复收到',isMine:false},{text:'收到',isMine:true}]},'own_message'],
 ['incoming-after-own',{sender:'许茂林',recipientId:'self',messages:[{text:'早上好',isMine:true},{text:'Steve，请确认收到，回一句收到即可。',isMine:false}]},null],
 ['recipient-self',{recipientId:'self'},null],
 ];
 for(const [label,extra,reason]of cases){const item=await req('/api/inbox','POST',{title:`${marker}-${label}`,sender:'HTTP E2E colleague',channel:'Internal',origin:'human',status:'pending',body:'Steve，请确认收到此消息，回一句收到即可。',...extra});
 const triage=await req(`/api/inbox/${item.id}/triage`,'POST',{});evidence.cases.push({label,id:item.id,triage});
 check(label+' route',triage.status==='succeeded'&&(reason?triage.route==='no_reply'&&triage.reason===reason&&triage.method==='rule':triage.route!=='no_reply'&&triage.method==='jev'&&triage.reason!=='own_message'));
 const cached=await req(`/api/inbox/${item.id}/triage`,'POST',{});check(label+' cached',cached.completedAt===triage.completedAt);
 const after=await req('/api/inbox/'+item.id);check(label+' no side effects',after.updatedAt===item.updatedAt&&after.status==='pending'&&!after.draft&&!after.receipt&&!after.approved);
 }
 const own=evidence.cases.find(c=>c.label==='latest-own');
 await req('/api/inbox/'+own.id,'PATCH',{messages:[{text:'收到',isMine:true},{text:'Steve，请再确认是否收到新版本，回复收到即可。',isMine:false}],draft:'手工保留',approved:true});
 const changed=await req('/api/inbox/'+own.id);check('new incoming invalidates own-message result',!changed.triage);
 const next=await req(`/api/inbox/${own.id}/triage`,'POST',{});check('new incoming uses Jev',next.method==='jev'&&next.route!=='no_reply');
 const after=await req('/api/inbox/'+own.id);check('manual draft approval retained',after.draft==='手工保留'&&after.approved===changed.approved);
 const bootstrap=await req('/api/bootstrap');check('refresh restores result',bootstrap.inbox.find(i=>i.id===own.id)?.triage?.sourceVersion===next.sourceVersion);
 evidence.status='PASS';
}catch(e){evidence.status='FAIL';evidence.error=String(e);process.exitCode=1;}
await writeFile(new URL('http-e2e.json',out),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
