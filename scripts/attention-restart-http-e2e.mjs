// True process restarts: every restart is SIGKILL followed by a new process on the same isolated database. Synthetic data, fake local model, no send.
// Repeat: node --import tsx scripts/attention-restart-http-e2e.mjs   (API 46852, model 46853)
// Boundary: an interrupted action is the durable record a crash leaves, seeded directly; a kill during a live model call is not exercised. Not installed-app or native evidence.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:46852',scope=resolve('.local/acceptance/attention-restart-'+randomUUID()),out=resolve('output/attention-v2'),checks=[];let child,restarts=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,ok)=>{checks.push({name,pass:!!ok});assert.ok(ok,name)};
async function raw(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});return {status:r.status,data:await r.json()}}
const fix=async b=>(await raw('/fixture',b)).data;
async function start(){child=spawn(process.execPath,['--import','tsx','scripts/attention-restart-service.mjs'],{env:{...process.env,ATTENTION_SCOPE:scope},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',d=>errors+=d);for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('service exited: '+errors.slice(-400));if(await fetch(base+'/api/native/notifications').then(r=>r.ok).catch(()=>false))return;await sleep(150)}throw Error('service timeout')}
async function crash(){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));restarts++;await start()}
const generated=(id,sourceId,quote)=>({ideas:[{title:'公开灵感',description:'公开判断。',topicKey:id,category:'insight',sourceIds:[sourceId],existingId:id,mergeIds:[],evidence:[{sourceId,quote}]}],retire:[]});
try{
 await start();
 // D4: held digest survives a crash; nothing is repeated or lost.
 let s=(await fix({reset:true,settings:{alerts:'urgent_digest',quietEnabled:false},requests:Array.from({length:20},(_,i)=>({id:'low-'+i})),syncInbox:true})).state;
 check('D4 before crash: one digest, 17 held',s.digests.length===1&&s.held===17);const firstDigest=s.digests[0];
 await crash();s=(await fix({syncInbox:true})).state;
 check('D4 after crash: same digest, no duplicate',s.digests.length===1&&s.digests[0].id===firstDigest.id&&s.held===17&&!s.reminders.length);
 s=(await fix({syncInbox:true})).state;check('D4 the 3-hour gap survives a crash',s.digests.length===1);
 s=(await fix({backdateDigest:true,syncInbox:true})).state;const seen=s.digests.flatMap(d=>d.entries);
 check('D4 next digest carries different matters',s.digests.length===2&&s.held===14&&new Set(seen).size===seen.length);
 await crash();s=(await fix({syncInbox:true})).state;check('D4 second crash adds nothing',s.digests.length===2&&s.held===14);
 // A2: a finished action replays; an interrupted one becomes unknown and never runs.
 s=(await fix({reset:true,requests:[{id:'act',priority:'high'}],syncInbox:true})).state;check('A2 urgent request delivered',s.reminders.length===1);
 const page=(await raw('/api/conversations/main/messages?limit=50')).data.items.find(m=>m.inboxAnalysis?.itemId==='act').inboxAnalysis,bind={entityKind:'inbox',entityId:'act',requestMessageId:page.requestMessageId,requestRevision:page.requestRevision};
 const done=(await raw('/api/attention/actions',{...bind,type:'create_task',operationId:'op-finished'})).data;check('A2 task created before crash',done.status==='succeeded');
 await fix({runningOp:{...bind,type:'dismiss',operationId:'op-interrupted'}});
 await crash();
 let r=await raw('/api/attention/actions',{...bind,type:'create_task',operationId:'op-finished'});check('A2 finished action replays after crash without a second task',r.data.replayed===true&&r.data.result.taskId===done.result.taskId&&(await fix({})).state.tasks===1);
 check('A2 interrupted action reads back unknown',(await raw('/api/attention/actions/op-interrupted')).data.status==='unknown');
 r=await raw('/api/attention/actions',{...bind,type:'dismiss',operationId:'op-interrupted'});check('A2 interrupted action is not replayed',r.data.status==='unknown'&&r.data.replayed===true&&(await raw('/api/inbox/act')).data.status==='pending');
 // I1: ignore survives a crash and regeneration, everywhere it could surface.
 const quote='公开验证：请确定试点时间';
 await fix({reset:true,settings:{alerts:'every'},source:{id:'src-a',notes:quote+'。'}});const notice=(await raw('/api/native/notifications')).data;if(!notice.enabled)await raw('/api/native/notifications',{enabled:true,baseVersion:notice.version},'PATCH');await sleep(5);
 const idea=await fix({idea:{id:'i1',sourceId:'src-a',quote},syncIdeas:true});check('I1 reminder and notification are pending before ignore',idea.state.ideaMessages.length===1&&(await raw('/api/native/notifications')).data.pending.length===1);
 let row=(await raw('/api/ideas/i1')).data;await raw('/api/ideas/i1/attention',{action:'dismiss',operationId:'i1-op',baseUpdatedAt:row.updatedAt,baseProvenanceKey:'unused'});
 await crash();s=(await fix({syncIdeas:true})).state;
 check('I1 after crash: reminder and follow-up context stay gone',!s.ideaMessages.length&&!s.reminderContext&&(await raw('/api/ideas/i1')).data.status==='dismissed');
 check('I1 after crash: no notification pending',!(await raw('/api/native/notifications')).data.pending.length);
 await fix({modelResult:generated('i1','src-a',quote)});r=await raw('/api/ideas/refresh',{});s=(await fix({syncIdeas:true})).state;
 check('I1 regeneration cannot bring it back',r.status===200&&r.data.counts.suppressed>=1&&(await raw('/api/ideas/i1')).data.status==='dismissed'&&!s.ideaMessages.length);
 // I2: a snooze survives a crash and wakes exactly once.
 await fix({reset:true,source:{id:'src-b',notes:quote+'。'}});await fix({idea:{id:'i2',sourceId:'src-b',quote},syncIdeas:true});row=(await raw('/api/ideas/i2')).data;
 await raw('/api/ideas/i2/attention',{action:'snooze',operationId:'i2-op',baseUpdatedAt:row.updatedAt,baseProvenanceKey:'unused',until:new Date(Date.now()+1000).toISOString()});
 await crash();await sleep(1200);s=(await fix({syncIdeas:true,syncInbox:true})).state;
 check('I2 wakes after a crash as one digest line',(await raw('/api/ideas/i2')).data.status==='new'&&!s.ideaMessages.length&&s.digests.length===1&&s.digests[0].entries[0]==='i2');
 await crash();s=(await fix({syncIdeas:true,syncInbox:true})).state;check('I2 a second crash does not wake it again',s.digests.length===1&&!s.ideaMessages.length);
 // I2: new evidence wakes early; the same evidence keeps the snooze.
 await fix({reset:true,source:{id:'src-c',notes:quote+'。'}});await fix({idea:{id:'i3',sourceId:'src-c',quote},syncIdeas:true});row=(await raw('/api/ideas/i3')).data;
 await raw('/api/ideas/i3/attention',{action:'snooze',operationId:'i3-op',baseUpdatedAt:row.updatedAt,baseProvenanceKey:'unused',until:new Date(Date.now()+864e5).toISOString()});
 await fix({modelResult:generated('i3','src-c',quote)});await raw('/api/ideas/refresh',{});check('I2 same evidence keeps the snooze',(await raw('/api/ideas/i3')).data.status==='deferred');
 const later='公开更新：试点改到周三';await sleep(5);await fix({source:{id:'src-c',notes:quote+'。'+later+'。'}});await fix({modelResult:generated('i3','src-c',later)});r=await raw('/api/ideas/refresh',{});s=(await fix({syncIdeas:true})).state;
 check('I2 new evidence wakes it through one normal reminder',r.status===200&&(await raw('/api/ideas/i3')).data.status==='new'&&s.ideaMessages.length===1);
 await crash();s=(await fix({syncIdeas:true})).state;check('I2 the new reminder is not repeated after a crash',s.ideaMessages.length===1);
}catch(e){checks.push({name:String(e?.message||e),pass:false});process.exitCode=1}
finally{if(child&&child.exitCode===null)child.kill('SIGKILL');await mkdir(out,{recursive:true});await writeFile(out+'/restart.json',JSON.stringify({scope:'synthetic isolated SQLite, SIGKILL restarts, fake model',restarts,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks},null,2));console.log(JSON.stringify({restarts,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).map(c=>c.name)},null,1))}
