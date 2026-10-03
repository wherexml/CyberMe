import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.TRIAGE_API||'http://127.0.0.1:46110';
const out=new URL('../output/inbox-surfacing-20261002/',import.meta.url);await mkdir(out,{recursive:true});
const proof={marker:`OPSADV-QA-SURFACING-${Date.now()}`,checks:[],ids:[]};
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
function check(name,ok){proof.checks.push({name,status:ok?'PASS':'FAIL'});assert.ok(ok,name);}
async function create(extra={}){const item=await req('/api/inbox','POST',{title:proof.marker,sender:proof.marker,channel:'Internal',origin:'human',status:'pending',body:'Daily informational summary. Everything is normal. No action or response needed.',...extra});proof.ids.push(item.id);return item;}
try{
 const own=await create({isMine:true});await req(`/api/inbox/${own.id}/triage`,'POST',{});check('successful quiet projection',(await req('/api/inbox/'+own.id)).surfacing==='quiet');
 await req(`/api/inbox/${own.id}/surface`,'POST',{});check('explicit restore survives refresh',(await req('/api/bootstrap')).inbox.find(i=>i.id===own.id).surfacing==='attention');
 const sensitive=await create({isMine:true,sensitive:true});await req(`/api/inbox/${sensitive.id}/triage`,'POST',{});check('sensitive never quiet',(await req('/api/inbox/'+sensitive.id)).surfacing==='attention');
 const draft=await create({isMine:true,draft:'Preserved review draft'});await req(`/api/inbox/${draft.id}/triage`,'POST',{});check('existing draft retained',(await req('/api/inbox/'+draft.id)).surfacing==='attention');
 const unknown=await create({body:'Unclear current state'});check('unassessed item retained',(await req('/api/inbox/'+unknown.id)).surfacing==='attention');
 const failed=await create({isMine:true,status:'send_failed'});await req(`/api/inbox/${failed.id}/triage`,'POST',{});check('send failure remains actionable',(await req('/api/inbox/'+failed.id)).surfacing==='attention');
 const first=await create();await req('/api/inbox/'+first.id,'PATCH',{status:'dismissed'});
 const next=await create();let feedback=await req(`/api/inbox/${next.id}/feedback`);check('dismissal available to same sender',feedback.some(f=>f.itemId===first.id));
 const other=await create({sender:'Other '+proof.marker});check('feedback scoped to sender',!(await req(`/api/inbox/${other.id}/feedback`)).length);
 const request=await create({body:'Steve, please personally approve the $500,000 purchase contract by 5pm today. We cannot proceed without your explicit decision.'});const decision=await req(`/api/inbox/${request.id}/triage`,'POST',{});check('new consequential request overrides ignored FYI',decision.status==='succeeded'&&decision.route!=='no_reply'&&(await req('/api/inbox/'+request.id)).surfacing==='attention');
 const triage=await req(`/api/inbox/${next.id}/triage`,'POST',{});proof.jev=triage;check('real Jev succeeds',triage.method==='jev'&&triage.status==='succeeded');
 await req('/api/inbox/'+first.id,'PATCH',{status:'pending'});check('reopen retracts feedback',!(await req(`/api/inbox/${next.id}/feedback`)).length);check('feedback retraction invalidates cached judgment',!(await req('/api/inbox/'+next.id)).triage);
 const quiet=await create({isMine:true,title:proof.marker+'-quiet',body:proof.marker+'-quiet'});await req(`/api/inbox/${quiet.id}/triage`,'POST',{});proof.quietId=quiet.id;
 proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1;}
await writeFile(new URL('http.json',out),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
