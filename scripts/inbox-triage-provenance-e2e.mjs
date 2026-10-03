import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:46110',marker=`OPSADV-QA-TRIAGE-PROVENANCE-${Date.now()}`;
const evidence={marker,cases:[],checks:[]};
async function request(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();}
try{
 const cases=[
  ['self-test',{isSelfTest:true,recipientId:'self'},'rule','no_reply'],
  ['outgoing',{isMine:true,direction:'outgoing'},'rule','no_reply'],
  ['latest-outgoing',{messages:[{text:'Steve，请确认收到。',isMine:false},{text:'收到。',isMine:true}]},'rule','no_reply'],
  // This tests provenance precedence, not a calibrated semantic confidence level.
  ['latest-incoming',{isMine:true,direction:'outgoing',messages:[{text:'之前已收到。',isMine:true},{text:'Steve，请确认收到了这条新的消息，回复收到即可。',isMine:false}]},'jev',['quick_reply','review']],
 ];
 for(const [label,extra,method,route] of cases){
  const item=await request('/api/inbox','POST',{title:marker+'-'+label,testMarker:marker+'-'+label,sender:'Triage E2E',body:'Steve，请确认收到了这条消息，回复收到即可。',channel:'Internal',origin:'human',status:'pending',...extra});
  const triage=await request(`/api/inbox/${item.id}/triage`,'POST',{});
  evidence.cases.push({label,id:item.id,triage});
  const actual=await request(`/api/inbox/${item.id}`);
  for(const [name,pass] of [[label+': method',triage.method===method],[label+': route',Array.isArray(route)?route.includes(triage.route):triage.route===route],[label+': no side effects',!actual.draft&&!actual.receipt&&actual.status==='pending']]){evidence.checks.push({name,pass});assert.ok(pass,name);}
 }
 evidence.status='PASS';
}catch(e){evidence.status='FAIL';evidence.error=String(e);process.exitCode=1;}
await writeFile(new URL('../output/inbox-triage-20261002/provenance-e2e.json',import.meta.url),JSON.stringify(evidence,null,2));
console.log({status:evidence.status,checks:evidence.checks,error:evidence.error});
