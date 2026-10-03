import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.TRIAGE_API||'http://127.0.0.1:46110';
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
const marker='OPSADV-QA-TRIAGE-CONTEXT-'+Date.now();
const task=(await req('/api/tasks','POST',{title:marker+'-task',status:'active',notes:'客户已确认周五交付。'})).data;
const item=(await req('/api/inbox','POST',{title:marker,body:'许茂林，请依据关联任务回复目前状态。',sender:'Triage E2E',channel:'Internal',context:[task.id]})).data;
const first=await req('/api/inbox/'+item.id+'/triage','POST',{});
await req('/api/tasks/'+task.id,'PATCH',{notes:'已完成并验收。',status:'completed'});
const invalidated=!(await req('/api/inbox/'+item.id)).data.triage;
const next=await req('/api/inbox/'+item.id+'/triage','POST',{});
const active=req('/api/inbox/'+item.id+'/triage','POST',{force:true});
let sawRunning=false;for(let i=0;i<30;i++){if((await req('/api/inbox/'+item.id)).data.triage?.status==='running'){sawRunning=true;break;}}
await req('/api/inbox/'+item.id,'PATCH',{body:'最新内容已改变。仅供知悉，无需回复。'});
const changed=await active;
const checks={linkedTaskInvalidates:invalidated,linkedTaskNewVersion:next.data.sourceVersion!==first.data.sourceVersion,inflightObserved:sawRunning,staleResultRejected:changed.status===409&&changed.data.error==='triage_source_changed',staleHidden:!(await req('/api/inbox/'+item.id)).data.triage};
await writeFile(new URL('../output/inbox-triage-20261002/context-e2e.json',import.meta.url),JSON.stringify({marker,itemId:item.id,taskId:task.id,checks,first,next,changed},null,2));console.log(checks);assert.ok(Object.values(checks).every(Boolean));
