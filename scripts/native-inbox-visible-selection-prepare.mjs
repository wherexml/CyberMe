#!/usr/bin/env node
// Failure inventory: docs/journeys/native-inbox-visible-selection.md.
// Real public Jev preparation only; does not operate GUI or generate/send a reply.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),api='http://127.0.0.1:46218';
const sha=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
async function req(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});return{status:r.status,data:await r.json()};}
const settings=await req('/api/settings');
if(settings.status!==200||settings.data.identity?.name!=='OPSADV-QA Public Partial Owner'||settings.data.autonomy?.holdSending!==true)throw Error('existing public isolated runtime required');
const original=JSON.parse(await readFile(join(root,'output/native-parity-20261003/real-partial/2026-10-03T16-23-05.398Z/manifest.json'),'utf8'));
const recovery=await req('/api/chat/requests/'+original.requestId);
if(recovery.status!==200||recovery.data.status!=='partial'||recovery.data.runId!==original.beforeKill.runId)throw Error('original real partial runtime required');
const id='OPSADV-QA-VISIBLE-'+randomUUID(),stamp=new Date().toISOString().replaceAll(':','-'),out=join(root,'output/native-parity-20261003/inbox-visible-selection',stamp);
await mkdir(out,{recursive:true,mode:0o700});
const fields={id,title:'公开验收：请确认收到',sender:'OPSADV-QA Public Colleague',senderId:id+'-sender',sourceId:id+'-source',origin:'human',channel:'Internal',status:'pending',isMine:false,isSelfTest:false,sensitive:false,body:'请回复我收到公开测试计划就行。只需确认收到，没有任何承诺，不需要查资料，不需要执行计划，也没有外发授权。',receivedAt:new Date().toISOString()};
await writeFile(join(out,'public-create-intent.json'),JSON.stringify(fields,null,2)+'\n',{mode:0o600});
const mainHash=sha(await readFile(join(root,'.local/config.json'))),report={schema:1,scope:'real HTTP public Inbox plus real Jev; native GUI NOT_RUN',api,id,status:'RUNNING',guiStatus:'NOT_RUN',externalSends:0,sourceHashes:{},checks:[]};
async function save(){await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');}
function check(name,ok){report.checks.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);}
await save();
try{
 const prior=await req('/api/inbox/'+id);check('unique public ID confirmed absent before creation',prior.status===404);
 const created=await req('/api/inbox','POST',fields);check('public incoming item actually created',created.status===201&&created.data.id===id);
 const triage=await req('/api/inbox/'+id+'/triage','POST',{});
 const item=await req('/api/inbox/'+id),policy=await req('/api/inbox/'+id+'/policy');
 report.triage={http:triage.status,method:triage.data.method,status:triage.data.status,route:triage.data.route,model:triage.data.model,needsReply:triage.data.needsReply,missingContext:triage.data.missingContext,sourceVersion:triage.data.sourceVersion};
 check('actual Jev current result satisfies production probability gate',triage.status===200&&triage.data.method==='jev'&&triage.data.status==='succeeded'&&['quick_reply','deep_reply'].includes(triage.data.route)&&triage.data.needsReply>=.75&&triage.data.missingContext<.5&&item.data.triage?.sourceVersion===triage.data.sourceVersion);
 check('current public source is incoming without draft/candidate/lock',item.status===200&&item.data.id===id&&!item.data.isMine&&!item.data.isSelfTest&&!item.data.draft&&!item.data.draftCandidate&&!item.data.draftError&&!item.data.editedByUser&&!item.data.sensitive);
 check('actual policy permits normal or deep drafting',policy.status===200&&['chat','deep'].includes(policy.data.mode));
 report.item={updatedAt:item.data.updatedAt,bodyHash:sha(item.data.body),policyMode:policy.data.mode,draftPresent:!!item.data.draft};
 const list=await req('/api/inbox/query?limit=20');
 check('actual default pending list selects this public first item',list.status===200&&list.data.items?.[0]?.id===id);
 const read=await req('/api/chat/requests/'+original.requestId);check('original actual SQL partial remains unchanged',read.status===200&&read.data.status==='partial'&&read.data.runId===original.beforeKill.runId);
 check('main private model configuration unchanged',mainHash===sha(await readFile(join(root,'.local/config.json'))));
 report.status='READY_REAL_JEV_GUI_NOT_RUN';
}catch(e){report.status='FAIL_OR_NOT_ELIGIBLE';report.error=String(e.message);process.exitCode=1;}
finally{
 for(const p of ['scripts/native-inbox-visible-selection-prepare.mjs','server/src/inbox-triage.ts','native/macos/crates/opstwin-api/src/inbox_product.rs'])report.sourceHashes[p]=sha(await readFile(join(root,p)));
 report.pass=report.checks.filter(x=>x.status==='PASS').length;report.fail=report.checks.filter(x=>x.status==='FAIL').length;
 await save();console.log(JSON.stringify({status:report.status,id,pass:report.pass,fail:report.fail,manifest:join(out,'manifest.json')}));
}
