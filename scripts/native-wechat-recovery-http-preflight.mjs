// Fresh current-production public media qualification; no GUI or playback claim.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),scope='b8bd7f05-ab31-4efe-b0be-599ade946ee3';
const out=path.join(root,'output/native-parity-20261003/wechat-valid-media/gui-v43-recovery');
const prepared=JSON.parse(fs.readFileSync(path.join(root,'output/native-parity-20261003/wechat-valid-media/current-prepared.json')));
if(prepared.id!==scope||prepared.work!=='.local/acceptance/wechat-valid-media/'+scope||prepared.output!=='output/native-parity-20261003/wechat-valid-media/'+scope)throw Error('scope_layout_mismatch');
const originalReady=JSON.parse(fs.readFileSync(path.join(root,'output/native-parity-20261003/wechat-valid-media/ready.json')));if(originalReady.scope!==scope)throw Error('original_scope_mismatch');
const fixture=JSON.parse(fs.readFileSync(path.join(root,prepared.output,'fixture.json'))),base='http://127.0.0.1:46228';
const runId=randomUUID(),mediaDir=path.join(out,'preflight-'+runId);fs.mkdirSync(mediaDir,{mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex'),report={scope,checks:[],records:[],runId,status:'RUNNING',gui:'NOT_RUN',playback:'NOT_RUN'};
const check=(name,pass,meta={})=>{report.checks.push({name,pass,...meta});if(!pass)throw Error(name);};
async function req(p,method='GET',body){const r=await fetch(base+p,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});return {status:r.status,value:await r.json()};}
try{
 const ready=JSON.parse(fs.readFileSync(path.join(out,'ready.json')));check('Exact current source ready',ready.scope===scope&&ready.status==='READY');
 for(const [f,h] of Object.entries(ready.sourceHashes))check('Qualified source '+f,sha(fs.readFileSync(path.join(root,f)))===h);
 const entry=path.join(root,'.local/acceptance/wechat-valid-media',scope,'public-api-entry-v43.mjs');
 check('Exact scoped entry bytes before any POST',ready.entry===entry&&fs.realpathSync(entry)===entry&&!fs.lstatSync(entry).isSymbolicLink()&&sha(fs.readFileSync(entry))===ready.runtimeHashes.entrySHA256);
 const listeners=execFileSync('/usr/sbin/lsof',['-nP','-iTCP:46228','-sTCP:LISTEN','-Fp'],{encoding:'utf8'}).split('\n').filter(x=>/^p\d+$/.test(x)).map(x=>Number(x.slice(1)));
 check('Exact owned listener before any POST',listeners.length===1&&listeners[0]===ready.apiPID);
 report.apiPID=ready.apiPID;report.entrySHA256=ready.runtimeHashes.entrySHA256;report.sourceHashes=ready.sourceHashes;
 const args=execFileSync('/bin/ps',['-p',String(listeners[0]),'-o','args='],{encoding:'utf8'}).trim();const ppid=Number(execFileSync('/bin/ps',['-p',String(listeners[0]),'-o','ppid='],{encoding:'utf8'}).trim());
 check('Exact scope argv and parent before any POST',args.endsWith('node --import tsx '+entry)&&ppid===ready.managerPID);
 const health=await req('/api/health');check('Current production health',health.status===200&&health.value.ok&&health.value.database==='independent');
 const connection=await req('/api/wechat/connect','POST',{});check('Connect exact public source via actual immutable CLI',connection.status===200&&connection.value.ok===true);
 const caps=await req('/api/wechat/capabilities');check('Verified exact CLI with no send',caps.status===200&&caps.value.send===false&&caps.value.attachments.mode==='verified-exact-cli');
 const messages=await req('/api/wechat/messages?conversation='+encodeURIComponent(fixture.conversation)+'&limit=16');check('Exact three public messages',messages.status===200&&messages.value.items.length===3);
 for(const row of messages.value.items){
  const exact=originalReady.records.find(r=>r.messageId===row.id);const kind=exact?.kind;check('Only expected exact public ID',!!exact&&['voice','video','document'].includes(kind)&&[93002,93003,93004].includes(exact.serverId));
  const metadata=await req('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:row.id});const m=metadata.value;check('Metadata '+kind,metadata.status===200&&typeof m.attachmentId==='string'&&m.url==='/api/wechat/attachments/'+m.attachmentId);
  const r=await fetch(base+'/api/wechat/attachments/'+encodeURIComponent(m.attachmentId),{signal:AbortSignal.timeout(50000)});const bytes=Buffer.from(await r.arrayBuffer()),digest=sha(bytes);check('Own metadata bytes '+kind,r.status===200&&bytes.length===m.bytes&&digest===m.sha256);
  if(kind!=='voice')check('Original source exact bytes '+kind,digest===fixture.sourceMetadata[kind].sha256);
  const file=path.join(mediaDir,'public-'+kind+(kind==='voice'?'.ogg':kind==='video'?'.mp4':'.pdf'));fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  if(kind==='voice'||kind==='video'){
   const decode=spawnSync('/opt/homebrew/bin/ffmpeg',['-nostdin','-v','error','-i',file,'-f','null','-'],{timeout:60000,encoding:'utf8'});check('Full decode '+kind,decode.status===0);
  }else check('PDF original full file signature',bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-16).toString().includes('%%EOF'));
  report.records.push({file:path.relative(out,file),kind,serverId:exact.serverId,messageIdSha256:sha(row.id),metadataSHA256:m.sha256,bytes:bytes.length,bodySha256:digest,expiresAt:m.expiresAt});
 }
 for(const route of ['/api/feishu/binding','/api/calendar/events','/api/settings/models/tests/test-public']){const r=await req(route);check('Explicit blocked GET '+route,r.status===403);}
 const r=await req('/api/settings','PATCH',{});check('Other group write blocked',r.status===403);
 report.status='PASS';
}catch(e){report.status='FAIL';report.errorType=e.constructor.name;report.error=String(e);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'http-preflight.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,records:report.records.length,error:report.error}));}
