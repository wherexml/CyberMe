// Real Steve-only self-send HTTP recovery E2E. No GUI claim.
// Fresh run: node scripts/native-inbox-self-send-http-e2e.mjs
// Resume: OPSTWIN_QA_OUTPUT=<same output dir> node scripts/native-inbox-self-send-http-e2e.mjs
// Intent is fsynced before the sole initial send; all resume paths GET first,
// preserve the same key, and never retry an unresolved initial dispatch.
import {mkdir,open,rename,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const API=process.env.OPSTWIN_API||'http://127.0.0.1:46110';
const PROXY=process.env.OPSTWIN_QA_PROXY||'http://127.0.0.1:46191';
for(const address of [API,PROXY]){const u=new URL(address);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\d{5}$/.test(u.port)||u.username||u.password||u.pathname!=='/')throw Error('Loopback five-digit HTTP origin required');}
const out=resolve(process.env.OPSTWIN_QA_OUTPUT||join(root,'output','native-inbox-self-send-'+Date.now()+'-'+randomUUID().slice(0,8)));
await mkdir(out,{recursive:true,mode:0o700});
const intentPath=join(out,'intent.json'),originalReportPath=join(out,'report.json'),reportPath=join(out,process.env.OPSTWIN_QA_OUTPUT?'resume-report-'+Date.now()+'.json':'report.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
const rows=[],trace=[];let intent,terminal='NOT_RUN';
function blocked(name,code='precondition_blocked',http){rows.push({name,status:'BLOCKED',code,...(http?{http}:{})});throw Object.assign(Error(name),{qaBlocked:true,code});}
function check(name,ok,data={}){rows.push({name,...data,status:ok?'PASS':'FAIL'});console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)throw Object.assign(Error(name),{code:'assertion_failed'});}
async function durable(patch={}){intent={...intent,...patch,updatedAt:Date.now()};const temp=intentPath+'.tmp-'+randomUUID();const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(intent,null,2));await f.sync();}finally{await f.close();}await rename(temp,intentPath);const directory=await open(out,'r');try{await directory.sync();}finally{await directory.close();}}
async function req(base,path,method='GET',body,timeout=90000){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});let data;try{data=await response.json();}catch{throw Object.assign(Error('HTTP response is not JSON'),{code:'invalid_response_json',http:response.status});}return {http:response.status,data};}
const ids=item=>[...new Set(item?.receipt?.messageIds||[item?.receipt?.messageId].filter(Boolean))];
const safeCode=value=>typeof value==='string'&&/^[\w-]{1,80}$/.test(value)?value:'unclassified_failure';
function mustOk(result,name,expected=200){if(result.http===expected)return result.data;if([401,403,409,423,502,503].includes(result.http))blocked(name,safeCode(result.data?.error),result.http);check(name,false,{http:result.http});}
function publicDraft(marker){return marker+'\nPublic OpsTwins native HTTP recovery QA. Synthetic message only; no action required.';}
// The child imports existing actual requireSelf/readSelfMessages/lark adapters.
// Raw CLI/auth/message outputs remain in child memory and are never persisted.
async function sensitive(mode,messageIds=[]){
 const source=`import {requireSelf,readSelfMessages,lark} from './server/src/integrations.ts';
import {textContent} from './server/src/import.ts';
let input='';for await(const chunk of process.stdin)input+=chunk;const q=JSON.parse(input);
const mid=m=>m.message_id||m.messageId||m.id;
try{const a=await requireSelf();if(!a.ready||!a.verified||a.identity!=='user'||a.name!=='许茂林')throw {status:403,code:'wrong_identity'};
 let output={ok:true,selfVerified:true,identity:'user'};
 if(q.mode==='list'){const messages=await readSelfMessages(a.openId);const matching=messages.filter(m=>String(m.text||textContent(m.body?.content||m.content)).includes(q.marker));output={...output,count:matching.length,messageIds:[...new Set(matching.map(mid).filter(Boolean))],deletedCount:matching.filter(m=>m.deleted===true||m.is_deleted===true).length};}
 if(q.mode==='mget'){const envelope=await lark(['im','+messages-mget','--as','user','--message-ids',q.messageIds.join(','),'--no-reactions','--format','json']);const data=envelope.data;const messages=Array.isArray(data)?data:data?.items||data?.messages||[];output={...output,count:messages.length,items:messages.map(m=>({messageId:mid(m),deleted:m.deleted===true||m.is_deleted===true})),notReturned:q.messageIds.filter(id=>!messages.some(m=>mid(m)===id))};}
 console.log(JSON.stringify(output));
}catch(e){console.log(JSON.stringify({ok:false,status:Number(e.status)||0,code:typeof e.code==='string'&&/^[\\w-]{1,80}$/.test(e.code)?e.code:'auth_or_readback_failed'}));}`;
 return await new Promise((resolveResult,reject)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:root,env:{...process.env,OPSTWIN_NO_BACKGROUND:'1'},stdio:['pipe','pipe','pipe']});let stdout='',over=false;const timer=setTimeout(()=>{over=true;child.kill('SIGTERM');},65000);child.stdout.on('data',b=>{stdout+=b;if(stdout.length>100000){over=true;child.kill('SIGTERM');}});child.stderr.on('data',()=>{});child.on('error',()=>{clearTimeout(timer);reject(Object.assign(Error('Private adapter unavailable'),{code:'adapter_spawn_failed'}));});child.on('close',()=>{clearTimeout(timer);if(over)return resolveResult({ok:false,code:'adapter_timeout'});try{const value=stdout.trim().split('\n').reverse().find(line=>line.startsWith('{'));resolveResult(JSON.parse(value));}catch{resolveResult({ok:false,code:'adapter_invalid_response'});}});child.stdin.end(JSON.stringify({mode,marker:intent.marker,messageIds}));});
}
async function readItem(){trace.push({event:'item_get_begin',itemId:intent.itemId,at:Date.now()});const result=await req(PROXY,'/api/inbox/'+encodeURIComponent(intent.itemId));const item=mustOk(result,'original item readback');trace.push({event:'item_get_done',itemId:intent.itemId,at:Date.now(),status:item.status,messageCount:ids(item).length});await durable({lastReadbackAt:Date.now(),lastStatus:item.status,messageIds:ids(item)});return item;}
try {
 try{intent=JSON.parse(await readFile(intentPath,'utf8'));}catch(error){if(error.code!=='ENOENT')blocked('durable intent unreadable','intent_unreadable');}
 if(intent){check('resume retains original public intent',intent.api===API&&intent.proxy===PROXY&&/^OPSADV-QA-[\w-]{6,100}$/.test(intent.marker)&&/^native-self-[a-f0-9]{32}$/.test(intent.idempotencyKey)&&/^inbo-native-self-[a-f0-9]{32}$/.test(intent.itemId));}
 else{const uuid=randomUUID().replaceAll('-','');const marker='OPSADV-QA-NATIVE-SELF-'+Date.now()+'-'+uuid.slice(0,8);intent={version:1,api:API,proxy:PROXY,marker,itemId:'inbo-native-self-'+uuid,idempotencyKey:'native-self-'+uuid,draftHash:hash(publicDraft(marker)),sendAttempted:false,createdAt:Date.now()};await durable();}
 const health=await req(API,'/api/health');mustOk(health,'live API health');check('real service healthy',health.http===200);
 let proxy=mustOk(await req(PROXY,'/__qa/status'),'proxy available');if(proxy.offline)blocked('proxy is offline','qa_proxy_offline');if(proxy.dropInboxSendResponse&&!intent.sendAttempted)blocked('another send fault is already armed','qa_fault_busy');
 const auth=await sensitive('auth');if(!auth.ok||!auth.selfVerified)blocked('requireSelf preflight',safeCode(auth.code));check('actual requireSelf verifies Steve user identity',auth.selfVerified===true&&auth.identity==='user');
 const settings=mustOk(await req(API,'/api/settings'),'read sending settings');if(settings.autonomy?.holdSending!==false)blocked('holdSending prevents send','sending_held');if(settings.channels?.feishu?.enabled===false)blocked('Feishu channel disabled','channel_disabled');
 const connectionResult=mustOk(await req(API,'/api/connections'),'read send permission');const connections=Array.isArray(connectionResult)?connectionResult:connectionResult.items||[];const feishu=connections.filter(c=>/^(feishu|飞书)$/i.test(c.provider));const connection=feishu.find(c=>c.id==='feishu-local')||feishu.find(c=>c.status==='connected')||feishu[0];
 if(!connection||connection.status!=='connected')blocked('verified send connection unavailable','connection_disconnected');if(!(connection.permissions||[]).some(p=>['send','send_self','messages.send_self'].includes(p)))blocked('send permission unavailable','permission_denied');
 const working=mustOk(await req(API,'/api/connections/'+encodeURIComponent(connection.id)+'/working-window'),'working window check');if(working.allowed!==true)blocked('working window prevents send',safeCode(working.reason||'outside_working_hours'));check('unchanged hold channel permission working policy permits send',true);
 let found=await req(API,'/api/inbox/'+encodeURIComponent(intent.itemId));let item;
 if(found.http===404&&!intent.sendAttempted){await durable({state:'creating_item'});const create=await req(API,'/api/inbox','POST',{id:intent.itemId,title:intent.marker,sender:'许茂林',channel:'Feishu',origin:'human',body:publicDraft(intent.marker),draft:publicDraft(intent.marker),status:'pending',isSelfTest:true,recipientId:'self',testMarker:intent.marker,sensitive:false,attachments:[]});item=mustOk(create,'create independent self test',201);await durable({state:'draft_saved'});}
 else item=mustOk(found,'recover original independent item');
 check('saved public draft belongs to independent Steve self item',item.id===intent.itemId&&item.isSelfTest===true&&item.recipientId==='self'&&item.testMarker===intent.marker&&!item.sourceSystem&&hash(String(item.draft||''))===intent.draftHash&&!(item.attachments||[]).length,{itemId:intent.itemId,draftHash:intent.draftHash});
 if(!intent.sendAttempted){
  if(item.status!=='pending')blocked('new send item is no longer pending','changed_status');
  if(!item.approved)item=mustOk(await req(API,'/api/inbox/'+encodeURIComponent(intent.itemId),'PATCH',{approved:true,baseUpdatedAt:item.updatedAt}),'explicitly approve saved draft');
  check('saved draft explicitly approved before sending',item.approved===true&&hash(String(item.draft))===intent.draftHash);
  const baseline=await sensitive('list');if(!baseline.ok)blocked('baseline self readback unavailable',safeCode(baseline.code));check('unique marker absent from real self messages',baseline.count===0,{count:baseline.count});
  mustOk(await req(PROXY,'/__qa/drop-inbox-send-response','POST',{}),'arm single successful send response loss');
  await durable({state:'send_intent_durable',sendAttempted:true,initialAttemptAt:Date.now()});
  const fromDisk=JSON.parse(await readFile(intentPath,'utf8'));check('send key intent fsynced before external request',fromDisk.sendAttempted===true&&fromDisk.idempotencyKey===intent.idempotencyKey,{idempotencyKey:intent.idempotencyKey});
  trace.push({event:'initial_send',at:Date.now(),idempotencyKey:intent.idempotencyKey});
  try{const sent=await req(PROXY,'/api/inbox/'+encodeURIComponent(intent.itemId)+'/send','POST',{idempotencyKey:intent.idempotencyKey,draft:publicDraft(intent.marker)});await durable({initialHttp:sent.http});if(sent.http!==200)blocked('send safety policy or transport blocked',safeCode(sent.data?.error),sent.http);check('proxy must discard successful response',false,{http:sent.http});}
  catch(error){if(error.qaBlocked||error.code==='assertion_failed')throw error;await durable({state:'initial_outcome_unknown',initialOutcome:'network_unknown'});check('successful send response lost at client',true);}
 }
 // Every new or resumed execution performs GET before any same-key POST.
 item=await readItem();
 for(let attempt=0;attempt<20&&item.status==='sending';attempt++){await new Promise(r=>setTimeout(r,1500));item=await readItem();}
 if(!['sent','send_unknown','recalled'].includes(item.status)||item.sendKey!==intent.idempotencyKey)blocked('original intent not confirmed; no resend attempted','send_outcome_unresolved');
 if(item.status==='recalled'){check('resume confirms already recalled item without resend',ids(item).length===1);const recalled=await sensitive('mget',ids(item));if(!recalled.ok)blocked('resumed recalled message readback unavailable',safeCode(recalled.code));check('resumed exact-ID readback confirms deleted or absent',ids(item).every(id=>recalled.notReturned?.includes(id)||recalled.items?.some(m=>m.messageId===id&&m.deleted)),{count:recalled.count,deletedCount:recalled.items?.filter(m=>m.deleted).length,notReturnedCount:recalled.notReturned?.length});const prior=JSON.parse(await readFile(originalReportPath,'utf8'));if(prior.status!=='PASS')blocked('resume cannot replace missing original complete workflow evidence','original_evidence_incomplete');terminal='PASS';rows.push({name:'original complete workflow retained',status:'PASS',reportSha256:hash(await readFile(originalReportPath)),originalAssertionCount:prior.rows?.length});await durable({state:'recalled',finalStatus:item.status,messageIds:ids(item)});}
 else{
  proxy=mustOk(await req(PROXY,'/__qa/status'),'proxy dropped-response evidence');const initial=proxy.attempts?.find(a=>a.path==='/api/inbox/'+intent.itemId+'/send'&&a.requestId===intent.idempotencyKey&&a.responseDropped&&a.status===200);
  check('46191 proves one upstream successful response was dropped',!!initial,{responseDropped:!!initial});
  trace.push({event:'same_key_replay',at:Date.now(),idempotencyKey:intent.idempotencyKey});
  const replay=mustOk(await req(PROXY,'/api/inbox/'+encodeURIComponent(intent.itemId)+'/send','POST',{idempotencyKey:intent.idempotencyKey,draft:publicDraft(intent.marker)}),'original key reconciles or replays');
  item=replay.item;check('same key replays original single receipt',replay.replayed===true&&item.status==='sent'&&ids(item).length===1&&!item.receipt?.partial,{messageIds:ids(item),count:ids(item).length});
  await durable({state:'sent_confirmed',messageIds:ids(item)});
  const proof=await sensitive('list');if(!proof.ok)blocked('real self message readback unavailable',safeCode(proof.code));check('actual self inbox contains one matching real message ID',proof.count===1&&proof.messageIds.length===1&&proof.messageIds[0]===ids(item)[0],{count:proof.count,messageIds:proof.messageIds});
  const changed=await req(PROXY,'/api/inbox/'+encodeURIComponent(intent.itemId)+'/send','POST',{idempotencyKey:intent.idempotencyKey,draft:publicDraft(intent.marker)+'\nChanged public content must be rejected'});
  check('different content same key returns 409 idempotency conflict',changed.http===409&&changed.data?.error==='idempotency_conflict',{http:changed.http,code:safeCode(changed.data?.error)});
  const exact=await sensitive('mget',ids(item));if(!exact.ok)blocked('real message-id readback unavailable',safeCode(exact.code));check('real exact message ID readback confirms unrecalled message',exact.items?.some(m=>m.messageId===ids(item)[0]&&!m.deleted),{messageIds:exact.items?.map(m=>m.messageId),count:exact.count});
  const afterReplay=await sensitive('list');if(!afterReplay.ok)blocked('post replay uniqueness readback unavailable',safeCode(afterReplay.code));check('replay and conflicting content never duplicate self message',afterReplay.count===1&&afterReplay.messageIds[0]===ids(item)[0],{count:afterReplay.count});
  const audit=mustOk(await req(PROXY,'/__qa/status'),'ordered proxy evidence');const sendAttempts=audit.attempts.filter(a=>a.path==='/api/inbox/'+intent.itemId+'/send'&&a.requestId===intent.idempotencyKey);const readbacks=audit.readbacks.filter(r=>r.path==='/api/inbox/'+intent.itemId);
  check('unknown outcome GET precedes second same-key POST',sendAttempts.length===3&&sendAttempts[0].responseDropped&&readbacks.some(r=>r.at>=sendAttempts[0].at&&r.at<=sendAttempts[1].at),{sendPostCount:sendAttempts.length,readbackCount:readbacks.length});
  trace.push({event:'undo',at:Date.now(),messageIds:ids(item)});await durable({state:'undo_intent_durable'});
  const undo=mustOk(await req(API,'/api/inbox/'+encodeURIComponent(intent.itemId)+'/undo','POST',{}),'undo real own message');check('undo confirms one real own receipt recalled',undo.item?.status==='recalled'&&undo.receipt?.messageIds?.length===1&&!undo.receipt.partial,{count:undo.receipt?.messageIds?.length,messageIds:undo.receipt?.messageIds});
  item=await readItem();check('recalled status survives item GET',item.status==='recalled'&&ids(item).length===1,{itemId:item.id,itemStatus:item.status,messageIds:ids(item)});
  const recalled=await sensitive('mget',ids(item));if(!recalled.ok)blocked('independent recalled message readback unavailable',safeCode(recalled.code));check('independent exact-ID readback confirms deleted or absent',ids(item).every(id=>recalled.notReturned?.includes(id)||recalled.items?.some(m=>m.messageId===id&&m.deleted)),{count:recalled.count,deletedCount:recalled.items?.filter(m=>m.deleted).length,notReturnedCount:recalled.notReturned?.length});
  await durable({state:'recalled',finalStatus:item.status,messageIds:ids(item)});terminal='PASS';
 }
}catch(error){terminal=error.qaBlocked?'BLOCKED':'FAIL';if(!error.qaBlocked&&error.code!=='assertion_failed')rows.push({name:'execution',status:'FAIL',code:safeCode(error.code)});}
finally{
 const sources={};for(const path of ['scripts/native-inbox-self-send-http-e2e.mjs','scripts/native-ui-proxy.mjs','server/src/sending.ts','server/src/integrations.ts'])sources[path]=hash(await readFile(join(root,path)));
 const report={status:terminal,scope:'Real Steve-only external HTTP send and recall; no native GUI claim',marker:intent?.marker,itemId:intent?.itemId,idempotencyKey:intent?.idempotencyKey,draftHash:intent?.draftHash,messageIds:intent?.messageIds||[],retainsSendHistory:true,rows,trace,sources};await open(reportPath,'w',0o600).then(async f=>{try{await f.writeFile(JSON.stringify(report,null,2));await f.sync();}finally{await f.close();}});console.log(reportPath);if(terminal==='FAIL')process.exitCode=1;
}
