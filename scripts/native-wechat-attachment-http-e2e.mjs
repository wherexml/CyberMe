#!/usr/bin/env node
// Failure inventory FIRST: docs/journeys/native-wechat-attachment-api.md.
// Actual complete CLI processes + fresh public SQLite + production Hono API.
// Synthetic media proves byte transport, never private media usability or GUI.
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,chmod,lstat,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicAttachmentFixture} from './lib/greenbubbles-public-attachment-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),stamp=new Date().toISOString().replaceAll(':','-'),port=46230,api=`http://127.0.0.1:${port}`;
const sha=x=>createHash('sha256').update(x).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const out=join(root,'output/native-parity-20261003/wechat-attachment-http',stamp),work=join(root,'.local/acceptance/wechat-attachment-http',stamp),priv=join(root,'.local/private-runtime/wechat-attachment-http-'+randomUUID());
for(const p of [out,work,priv])await mkdir(p,{recursive:true,mode:0o700});
const ready=JSON.parse(await readFile(join(root,'output/native-parity-20261003/wechat-attachment-cli/candidate-ready.json'),'utf8'));
const candidate=await realpath(ready.candidateCli),candidateStat=await lstat(ready.candidateCli);
if(ready.status!=='PASS_BUILD'||!ready.archiveVerified||!candidate.startsWith(join(root,'.local/greenbubbles-attachment-candidate/bin/'))||candidateStat.isSymbolicLink()||!candidateStat.isFile()||candidateStat.uid!==process.getuid()||(candidateStat.mode&0o222)!==0||sha(await readFile(candidate))!==ready.compiledHash)throw Error('Immutable candidate provenance mismatch');
const fixture=createPublicAttachmentFixture(join(work,'fixture'));
const listing=spawnSync(candidate,['messages','list',fixture.databaseRoot,'--decrypted','--conversation',fixture.conversation,'--limit','16','--json'],{encoding:'utf8',timeout:30000,maxBuffer:8000000});
const rows=JSON.parse(listing.stdout).items;
if(listing.status!==0||rows?.length!==4)throw Error('Public full CLI list failed');
// Fixed explicit public source injection; every command still runs the actual CLI.
// No protocol responses are fabricated. Unknown commands cannot reach a default profile.
const wrapperSource=`#!/usr/bin/env node
import{spawn}from'node:child_process';
const a=process.argv.slice(2),candidate=${JSON.stringify(candidate)},db=${JSON.stringify(fixture.databaseRoot)},account=${JSON.stringify(fixture.accountRoot)};
let b;
if(a[0]==='chats')b=['conversations','list',db,'--decrypted',...a.slice(1)];
else if(['source','contacts','messages','message','attachment'].includes(a[0])&&['status','list','search','get','inspect','materialize'].includes(a[1]))b=[...a.slice(0,2),a[0]==='attachment'?account:db,'--decrypted',...a.slice(2)];
else process.exit(90);
const child=spawn(candidate,b,{stdio:'inherit',shell:false});child.once('error',()=>process.exit(91));child.once('exit',code=>process.exit(code??92));
`;
const wrapperHash=sha(wrapperSource),wrapperDir=join(root,'.local/greenbubbles-attachment-candidate/bin',wrapperHash),wrapper=join(wrapperDir,'greenbubbles');
await mkdir(wrapperDir,{recursive:true,mode:0o700});
await writeFile(wrapper,wrapperSource,{mode:0o500,flag:'wx'});await chmod(wrapper,0o500);
await writeFile(join(priv,'config.json'),'{}',{mode:0o600});
const sql=join(work,'server','opstwin-advance.db');await mkdir(join(work,'server'),{mode:0o700});
const db=new DatabaseSync(sql);db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'OPSADV-QA attachment HTTP',language:'en'},autonomy:{holdSending:true},channels:{}}));db.close();
const paths=['server/src/wechat-sync.ts','server/src/index.ts','scripts/native-wechat-attachment-http-e2e.mjs','scripts/lib/greenbubbles-public-attachment-fixture.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(join(root,p)))])));
const report={schema:1,at:new Date().toISOString(),scope:'public SQLite actual CLI + isolated production HTTP; synthetic bytes, no live/private/default-profile reads',compiledHash:ready.compiledHash,buildManifestHash:sha(await readFile(join(root,'output/native-parity-20261003/wechat-attachment-cli/candidate-ready.json'))),wrapperHash,fixtureSchemaHash:fixture.fixtureSchemaHash,sourceHashes,checks:[],guiAcceptance:false,realNonimageUsability:'NOT_RUN_NO_CANDIDATE',externalSends:0};
const check=(id,ok,evidence={})=>report.checks.push({id,status:ok?'PASS':'FAIL',...evidence});
async function request(path,method='GET',body){const response=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(50000)});let data;try{data=await response.json()}catch{}return{status:response.status,data};}
let child,log='';
try{
 await new Promise((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:'46231',OPSTWIN_DATA_DIR:join(work,'server'),OPSTWIN_PRIVATE_DIR:priv,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_WECHAT_CLI:wrapper,OPSTWIN_WECHAT_ATTACHMENT_SHA256:wrapperHash},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 let healthy=false;for(let i=0;i<100;i++){try{healthy=(await request('/api/health')).status===200;if(healthy)break;}catch{}await pause(100);}if(!healthy)throw Error('Isolated HTTP service unavailable');
 const connected=await request('/api/wechat/connect','POST',{});check('CONNECT-FULL-CLI-PUBLIC-SOURCE',connected.status===200&&connected.data?.ok===true,{http:connected.status});
 const chats=await request('/api/wechat/chats?limit=10');check('CURRENT-CONVERSATION-SAME-CLI',chats.status===200&&chats.data?.items?.some(c=>c.id===fixture.conversation));
 const messages=await request('/api/wechat/messages?conversation='+encodeURIComponent(fixture.conversation)+'&limit=16');check('FOUR-SAME-SECOND-MESSAGES',messages.status===200&&messages.data?.items?.length===4&&messages.data.items.every(m=>m.at===200));
 const tokens=[];
 for(const m of rows){
  const kind=m.messageType===34?'voice':m.messageType===43?'video':'document';
  const expected=kind==='voice'?fixture.expectedBytes.voice:kind==='video'?fixture.expectedBytes.video:fixture.expectedBytes.documents[m.serverId-3004];
  const result=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:m.id});
  check('EXACT-'+kind+'-'+m.serverId,result.status===200&&result.data?.sha256===sha(expected)&&result.data?.bytes===expected.length&&/^[a-f0-9-]{36}$/.test(result.data?.attachmentId||'')&&result.data?.url==='/api/wechat/attachments/'+result.data?.attachmentId,{http:result.status,code:result.data?.error,bytes:result.data?.bytes});
  if(result.status===200&&typeof result.data?.url==='string'){
   const r=await fetch(api+result.data.url,{signal:AbortSignal.timeout(50000)}),bytes=Buffer.from(await r.arrayBuffer());
   check('BYTES-'+kind+'-'+m.serverId,r.status===200&&bytes.equals(expected)&&sha(bytes)===result.data.sha256&&r.headers.get('content-type')===result.data.mime&&r.headers.get('x-content-type-options')==='nosniff'&&r.headers.get('cache-control')==='no-store',{http:r.status,bytes:bytes.length,sha256:sha(bytes)});
   tokens.push(result.data.attachmentId);
  }
 }
 check('FOUR-DISTINCT-MESSAGE-TOKENS',tokens.length===4&&new Set(tokens).size===4);
 const wrong=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:'OPSADV-QA-WRONG'});check('WRONG-OPAQUE-MESSAGE-REFUSED',wrong.status>=400,{http:wrong.status});
 const guessed=await request('/api/wechat/attachment','POST',{conversation:'OPSADV-QA-UNSEEN',message:rows[0].id});check('UNSEEN-CONVERSATION-REFUSED',guessed.status===409&&guessed.data?.error==='wechat_conversation_unverified');
 const disconnected=await request('/api/connections/wechat-sync-local/disconnect','POST',{});check('DISCONNECT',disconnected.status===200);
 for(const token of tokens){const r=await fetch(api+'/api/wechat/attachments/'+token);check('OLD-TOKEN-DISCONNECTED',r.status===409,{http:r.status});}
 const inspect=new DatabaseSync(sql,{readOnly:true});check('ZERO-SEND-INTENTS',inspect.prepare('SELECT count(*) n FROM send_intents').get().n===0);inspect.close();
 check('FROZEN-CLI-AND-WRAPPER',sha(await readFile(candidate))===ready.compiledHash&&sha(await readFile(wrapper))===wrapperHash);
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,300)};check('HARNESS-COMPLETES',false);}
finally{
 if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);check('OWNED-SERVER-EXIT',child.exitCode!==null||child.signalCode!==null);}
 report.serverLogHash=sha(log);report.sourceStable=(await Promise.all(paths.map(async p=>sha(await readFile(join(root,p)))===sourceHashes[p]))).every(Boolean);
 check('SOURCE-STABLE',report.sourceStable);report.counts=Object.fromEntries(['PASS','FAIL'].map(s=>[s,report.checks.filter(c=>c.status===s).length]));report.status=report.counts.FAIL?'FAIL':'PASS_SCOPE';
 await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,counts:report.counts,manifest:join(out,'manifest.json')}));if(report.counts.FAIL)process.exitCode=1;
}
