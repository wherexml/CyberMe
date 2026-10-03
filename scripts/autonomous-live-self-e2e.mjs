// Authorized one-message Steve-only live E2E. No production database/settings mutations.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const root=resolve('.'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=join(root,'output','autonomous-live-self-'+stamp),data=join(out,'data'),port=46127,base='http://127.0.0.1:'+port;
fs.mkdirSync(data,{recursive:true});const marker='OPSADV-QA-AUTO-LIVE-'+randomUUID(),itemId='auto-live-'+randomUUID();let child,logs='',owned;
const report={status:'RUNNING',kind:'real configured model + real verified Steve Feishu autonomous reply, isolated production HTTP runtime',marker,itemId,cases:[],startedAt:new Date().toISOString()};
const pause=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)},save=()=>fs.writeFileSync(join(out,'manifest.json'),JSON.stringify(report,null,2));
const files=fs.readdirSync(join(root,'server/src')).filter(f=>f.endsWith('.ts')).sort().map(f=>'server/src/'+f);const hashes=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(join(root,f))).digest('hex')]));report.fileHashes=hashes();
const req=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});const b=await r.json();if(!r.ok)throw Error(`${r.status}: ${JSON.stringify(b)}`);return b};
const check=async(name,fn)=>{try{const evidence=await fn();report.cases.push({name,status:'PASS',evidence});save();return evidence}catch(e){report.cases.push({name,status:'FAIL',error:String(e)});save();throw e}};
const harness=join(out,'live-harness.ts');fs.writeFileSync(harness,`import {serve} from '${root}/node_modules/@hono/node-server/dist/index.mjs';
import {setMeta,meta,patchSettings,get,list,publicValue} from '${root}/server/src/store.ts';
import {requireSelf,readSelfMessages,lark,ApiError} from '${root}/server/src/integrations.ts';
import {textContent} from '${root}/server/src/import.ts';
setMeta('initialized',true);if(!meta('qa-notice-initialized',false)){patchSettings({channels:{feishu:{enabled:true,notifications:false}},autonomy:{holdSending:true,alerts:'every',quietFrom:'00:00',quietUntil:'00:00',files:['show_before_send'],deepThink:[],levels:{ack:'send_undo'}}});setMeta('qa-notice-initialized',true)}
const {app}=await import('${root}/server/src/index.ts');const itemId=${JSON.stringify(itemId)},marker=${JSON.stringify(marker)};
app.get('/qa/auth',async c=>{const a=await requireSelf();return c.json({ready:a.ready,verified:a.verified,name:a.name,openId:a.openId,identity:a.identity})});
app.get('/qa/readback',async c=>{const a=await requireSelf();const deliveries=list('autonomous_dispatches').filter(d=>d.itemId===itemId);const messages=await readSelfMessages(a.openId);const matching=messages.filter(m=>{const text=m.text||textContent(m.body?.content||m.content);return typeof text==='string'&&text.includes(marker)}).map(m=>({messageId:m.message_id||m.messageId||m.id,text:m.text||textContent(m.body?.content||m.content),deleted:m.deleted===true||m.is_deleted===true}));return c.json({recipientId:a.openId,matching,deliveries:publicValue(deliveries)})});
app.post('/qa/recall',async c=>{const a=await requireSelf();const item=get('inbox',itemId);const messageId=item?.receipt?.messageId;if(!messageId||item.receipt.recipientId!==a.openId||!item.sentText?.includes(marker))throw new ApiError(403,'not_owned','No confirmed own automatic reply');await (await import('${root}/server/src/integrations.ts')).undoItem(itemId);const read=await lark(['im','+messages-mget','--as','user','--message-ids',messageId,'--no-reactions','--format','json']);const rows=Array.isArray(read.data)?read.data:read.data?.items||read.data?.messages||[];return c.json({messageId,readback:rows.map(m=>({messageId:m.message_id||m.id,deleted:m.deleted===true||m.is_deleted===true})),notReturned:!rows.some(m=>(m.message_id||m.id)===messageId)})});
const server=serve({fetch:app.fetch,port:${port},hostname:'127.0.0.1'});process.on('SIGTERM',()=>server.close());
`);
async function start(){child=spawn(process.execPath,['--import','tsx',harness],{cwd:root,env:{...process.env,OPSTWIN_NO_LISTEN:'1',OPSTWIN_DATA_DIR:data,OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'live-self'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);for(let i=0;i<150;i++){try{await req('/api/health');return}catch{}if(child.exitCode!==null)break;await pause(100)}throw Error('Own server failed to start')}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}}
try{
 await start();await check('Existing verified Steve identity and isolated empty database',async()=>{const a=await req('/qa/auth'),b=await req('/api/bootstrap');assert(a.ready&&a.verified&&a.name==='许茂林','wrong identity');assert(b.inbox.length===0&&b.tasks.length===0,'unexpected imported data');return {auth:a,inbox:b.inbox.length,tasks:b.tasks.length}});
 await check('Actual connection verification and explicit source scope',async()=>{const c=await req('/api/connections','POST',{id:'feishu-local',name:'Live self notification QA',provider:'Feishu',type:'CLI',permissions:['read','draft','send'],config:{timezone:'Asia/Singapore',syncInterval:'manual',workingHoursOnly:false,scopes:[{id:'qa-notice',name:marker,chatId:marker,enabled:true,mode:'draft'}]}});const r=await req('/api/connections/'+c.id+'/test','POST',{config:c.config});assert(r.connection?.status==='connected'||r.status==='connected','connection not verified');return r});
 await check('HTTP source processing generates real configured-model draft',async()=>{await req('/api/inbox','POST',{id:itemId,title:marker,body:'看到这条消息后，回我一声收到了就好，谢谢。',isSelfTest:true,recipientId:'self',testMarker:marker,sender:'许茂林',channel:'Feishu',category:'ack',status:'pending',sourceId:marker,sourceScope:{id:'qa-notice',mode:'draft',explicit:true,filter:''}});const q=await req('/api/inbox/'+itemId+'/process-source','POST',{});assert(q.jobs?.length===1,'job not queued');let item;for(let i=0;i<600;i++){item=await req('/api/inbox/'+itemId);if(!['queued','running'].includes(item.sourceProcessing?.status)&&item.sourceProcessing?.semanticState!=='preparing')break;await pause(500)}assert(item.sourceProcessing?.status==='succeeded'&&item.draft,'draft did not succeed: '+JSON.stringify(item.sourceProcessing));const runs=await req('/api/runs'),run=runs.find(r=>r.id===item.sourceProcessing.runId);assert(run?.status==='succeeded','run did not succeed');fs.writeFileSync(join(out,'source-and-run.json'),JSON.stringify({item,run},null,2));return {itemId,jobId:item.sourceProcessing.jobId,runId:run.id,model:run.model,draft:item.draft}});
 owned=await check('Full undo window then one real automatic Steve self reply',async()=>{
 let plan;for(let i=0;i<100;i++){plan=(await req('/api/autonomous-dispatches')).plans.find(p=>p.itemId===itemId);if(plan)break;await pause(200)}assert(plan?.state==='waiting','No waiting semantic plan: '+JSON.stringify(plan));
 assert(Date.parse(plan.readyAt)-Date.parse(plan.createdAt)===120000,'Undo window changed');
 fs.writeFileSync(join(out,'frozen-plan.json'),JSON.stringify(plan,null,2));await req('/api/settings','PATCH',{autonomy:{holdSending:false}});
 for(let i=0;i<400;i++){plan=(await req('/api/autonomous-dispatches')).plans.find(p=>p.itemId===itemId);if(['delivered','unknown','failed','cancelled'].includes(plan.state))break;await pause(500)}
 if(plan?.state==='unknown')plan=await req('/api/autonomous-dispatches/'+plan.id+'/reconcile','POST',{});
 assert(plan?.state==='delivered'&&plan.receipt?.messageId,'Automatic delivery not confirmed: '+JSON.stringify(plan));
 assert(Date.parse(plan.attemptStartedAt)>=Date.parse(plan.readyAt),'Attempt before undo deadline');return plan;
 });
 await check('Exact real readback and no duplicate across ticks and restart',async()=>{
 let proof=await req('/qa/readback');const expected=owned.frozenDraft+'\n\n['+marker+']';
 assert(proof.matching.length===1&&proof.matching[0].messageId===owned.receipt.messageId&&proof.matching[0].text===expected,'Real readback mismatch');
 await req('/api/autonomous-dispatches/tick','POST',{});await stop();await start();await pause(1500);await req('/api/autonomous-dispatches/tick','POST',{});
 proof=await req('/qa/readback');assert(proof.matching.length===1,'Duplicate after restart');const replay=await req('/api/autonomous-dispatches/'+owned.id+'/reconcile','POST',{});assert(replay.replayed&&replay.receipt.messageId===owned.receipt.messageId,'Receipt replay mismatch');return {proof,replay};
 });
 await check('Recall only own confirmed automatic reply and read back deletion',async()=>{const r=await req('/qa/recall','POST',{});assert(r.messageId===owned.receipt.messageId&&(r.notReturned||r.readback.some(m=>m.messageId===r.messageId&&m.deleted)),'Recall not confirmed');return r});
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;
 // Do not retry uncertain sends or recall an unverified id. Own confirmed receipt remains in manifest.
}finally{await stop();report.completedAt=new Date().toISOString();report.sourceStable=JSON.stringify(report.fileHashes)===JSON.stringify(hashes());if(!report.sourceStable&&report.status==='PASS')report.status='PASS_WITH_SOURCE_DRIFT';save();fs.writeFileSync(join(out,'server.log'),logs);console.log(JSON.stringify({status:report.status,manifest:join(out,'manifest.json'),error:report.error}));}
