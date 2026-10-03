#!/usr/bin/env node
// Failure inventory FIRST: docs/journeys/native-wechat-runtime.md + selector design.
// Actual public SQLite/complete CLI/production HTTP; no default/private CLI reads.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,chmod,symlink,link,lstat,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicAttachmentFixture} from './lib/greenbubbles-public-attachment-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),stamp=new Date().toISOString().replaceAll(':','-'),port=46232,api=`http://127.0.0.1:${port}`;
const work=join(root,'.local/acceptance/wechat-runtime',stamp),out=join(root,'output/native-parity-20261003/wechat-runtime',stamp);
await mkdir(work,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const readyBytes=await readFile(join(root,'output/native-parity-20261003/wechat-attachment-cli/candidate-ready.json')),ready=JSON.parse(readyBytes),candidate=ready.candidateCli;
const stat=await lstat(candidate);if(ready.status!=='PASS_BUILD'||!ready.archiveVerified||await realpath(candidate)!==candidate||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o222)||sha(await readFile(candidate))!==ready.compiledHash)throw Error('Frozen candidate mismatch');
const fixture=createPublicAttachmentFixture(join(work,'public-fixture')),counter=join(work,'command-count.json');await writeFile(counter,'0',{mode:0o600});
const wrapperSource=`#!/usr/bin/env node
import{spawn}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const a=process.argv.slice(2),cli=${JSON.stringify(candidate)},db=${JSON.stringify(fixture.databaseRoot)},account=${JSON.stringify(fixture.accountRoot)};
let b;if(a[0]==='chats')b=['conversations','list',db,'--decrypted',...a.slice(1)];else if(['source','contacts','messages','message','attachment'].includes(a[0])&&['status','list','search','get','inspect','materialize'].includes(a[1]))b=[...a.slice(0,2),a[0]==='attachment'?account:db,'--decrypted',...a.slice(2)];else process.exit(90);
writeFileSync(${JSON.stringify(counter)},String(Number(readFileSync(${JSON.stringify(counter)},'utf8'))+1));const c=spawn(cli,b,{stdio:'inherit',shell:false});c.once('error',()=>process.exit(91));c.once('exit',code=>process.exit(code??92));
`;
const wrapperHash=sha(wrapperSource),wrapperDir=join(root,'.local/greenbubbles-attachment-candidate/bin',wrapperHash),wrapper=join(wrapperDir,'greenbubbles');await mkdir(wrapperDir,{recursive:true,mode:0o700});await writeFile(wrapper,wrapperSource,{mode:0o500,flag:'wx'});await chmod(wrapper,0o500);
const binding={schema:'opstwins.wechat-attachment-runtime.v1',cliPath:wrapper,sha256:wrapperHash};
const paths=['server/src/wechat-runtime-selector.ts','server/src/wechat-attachment-cli.ts','server/src/wechat-sync.ts','server/src/private-paths.ts','server/src/index.ts','scripts/native-wechat-runtime-http-e2e.mjs','scripts/lib/greenbubbles-public-attachment-fixture.mjs'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(join(root,p)))])));
const mainHash=sha(await readFile(join(root,'.local/config.json'))),report={schema:1,at:new Date().toISOString(),scope:'public actual CLI + fresh isolated production HTTP startup selector; no installed/default/profile reads',sourceHashes,compiledHash:ready.compiledHash,wrapperHash,checks:[],externalSends:0,guiAcceptance:false};
const check=(id,ok,details={})=>report.checks.push({id,status:ok?'PASS':'FAIL',...details});let child,log='',active,caseNumber=0;
async function request(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});let data;try{data=await r.json()}catch{}return{status:r.status,data};}
async function stop(){if(!child)return;const owned=child;owned.kill('SIGTERM');await Promise.race([new Promise(r=>owned.once('exit',r)),pause(3000)]);if(owned.exitCode===null&&owned.signalCode===null)throw Error('Owned service did not stop');child=undefined;}
async function newCase(){
 const dir=join(work,'case-'+(++caseNumber)),priv=join(dir,'private'),data=join(dir,'server');await mkdir(priv,{recursive:true,mode:0o700});await mkdir(data,{mode:0o700});await writeFile(join(priv,'config.json'),'{}',{mode:0o600});
 const db=new DatabaseSync(join(data,'opstwin-advance.db'));db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE entities(type TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,local_edited INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(type,id))');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');
 db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'OPSADV-QA runtime',language:'en'},autonomy:{holdSending:true},channels:{}}));
 // Metadata-only fallback tests do not call default CLI. This seed is not connect success.
 db.prepare('INSERT INTO entities(type,id,data) VALUES(?,?,?)').run('connections','wechat-sync-local',JSON.stringify({id:'wechat-sync-local',name:'OPSADV-QA public seed',provider:'wechat',type:'CLI',status:'connected',permissions:['read'],updatedAt:new Date().toISOString(),config:{readOnly:true}}));db.close();return{priv,data,bindingPath:join(priv,'wechat-attachment-runtime.json')};
}
async function start(c,overrides={}){
 await stop();active=c;await new Promise((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:'46233',OPSTWIN_DATA_DIR:c.data,OPSTWIN_PRIVATE_DIR:c.priv,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_WECHAT_CLI:undefined,OPSTWIN_WECHAT_ATTACHMENT_SHA256:undefined,...overrides},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 let healthy=false;for(let i=0;i<100;i++){try{healthy=(await request('/api/health')).status===200;if(healthy)break;}catch{}await pause(100);}if(!healthy)throw Error('Startup affected API health');
}
async function writeBinding(c,value=binding,mode=0o600){await writeFile(c.bindingPath,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value),{mode});await chmod(c.bindingPath,mode);}
async function assertInvalid(id,c,overrides={}){
 const before=Number(await readFile(counter,'utf8'));await start(c,overrides);const cap=await request('/api/wechat/capabilities'),connect=await request('/api/wechat/connect','POST',{}),bootstrap=await request('/api/bootstrap');
 check(id,cap.status===503&&cap.data?.error==='wechat_runtime_selection_invalid'&&connect.status===503&&connect.data?.error==='wechat_runtime_selection_invalid'&&bootstrap.status===200&&before===Number(await readFile(counter,'utf8')),{cap:cap.status,connect:connect.status,otherApi:bootstrap.status});
}
try{
 const missing=await newCase();await start(missing);const missingCap=await request('/api/wechat/capabilities');check('MISSING-BINDING-LEGACY-METADATA-ONLY',missingCap.status===200&&missingCap.data?.attachments?.mode==='installed-image-fallback'&&Number(await readFile(counter,'utf8'))===0);
 const valid=await newCase();await writeBinding(valid);await start(valid);let connected=await request('/api/wechat/connect','POST',{});check('PRIVATE-BINDING-ACTUAL-CLI-CONNECT',connected.status===200&&connected.data?.ok===true);
 let cap=await request('/api/wechat/capabilities');check('PRIVATE-BINDING-EXACT-CAPABILITIES',cap.status===200&&cap.data?.attachments?.mode==='verified-exact-cli'&&cap.data?.attachments?.businessMediaVerified===false);
 await request('/api/wechat/chats?limit=1');const messages=await request('/api/wechat/messages?conversation='+encodeURIComponent(fixture.conversation)+'&limit=4'),voice=messages.data?.items?.find(m=>m.messageTypeLabel==='voice');if(!voice)throw Error('Full CLI voice reference missing');
 const attachment=await request('/api/wechat/attachment','POST',{conversation:fixture.conversation,message:voice.id});check('PRIVATE-BINDING-FULL-ATTACHMENT-BYTES',attachment.status===200&&attachment.data?.sha256===sha(fixture.expectedBytes.voice));
 const media=await fetch(api+attachment.data?.url);check('PRIVATE-BINDING-HTTP-BYTES',media.status===200&&Buffer.from(await media.arrayBuffer()).equals(fixture.expectedBytes.voice));
 await writeBinding(valid,'{');cap=await request('/api/wechat/capabilities');check('RUNNING-SNAPSHOT-NOT-HOT-REPLACED',cap.status===200&&cap.data?.attachments?.mode==='verified-exact-cli');await assertInvalid('RESTART-ADOPTS-BAD-BINDING-SAFELY',valid);
 await writeBinding(valid);await start(valid);connected=await request('/api/wechat/connect','POST',{});check('SAME-PRIVATE-ROOT-RESTART-PERSISTS-SELECTION',connected.status===200&&connected.data?.ok===true&&(await request('/api/wechat/capabilities')).data?.attachments?.mode==='verified-exact-cli');
 const isolated=await newCase();await start(isolated);check('EMPTY-PRIVATE-ROOT-DOES-NOT-BORROW-EXACT-SELECTION',(await request('/api/wechat/capabilities')).data?.attachments?.mode==='installed-image-fallback');
 const invalidValues=[['BAD-JSON','{'],['EMPTY-FILE',''],['TOO-LARGE','x'.repeat(8193)],['INVALID-UTF8',Buffer.from([255,254,255])],['ARRAY',[]],['EXTRA-FIELD',{...binding,profile:'OPSADV-QA forbidden'}],['BAD-SCHEMA',{...binding,schema:'WRONG'}],['BAD-HASH',{...binding,sha256:'bad'}],['NONCANONICAL-PATH',{...binding,cliPath:wrapperDir+'/./greenbubbles'}],['OUTSIDE-DIGEST-ARCHIVE',{...binding,cliPath:join(wrapperDir,'..','greenbubbles')}]];
 for(const [id,value]of invalidValues){const c=await newCase();await writeBinding(c,value);await assertInvalid(id,c);}
 const permissions=await newCase();await writeBinding(permissions,binding,0o644);await assertInvalid('GROUP-READABLE-BINDING-REFUSED',permissions);
 const linked=await newCase(),target=join(linked.priv,'public-target.json');await writeFile(target,JSON.stringify(binding),{mode:0o600});await symlink(target,linked.bindingPath);await assertInvalid('SYMLINK-BINDING-REFUSED',linked);check('LINK-TARGET-UNCHANGED',sha(await readFile(target))===sha(JSON.stringify(binding)));
 const hardlinked=await newCase(),hardTarget=join(hardlinked.priv,'public-target.json');await writeFile(hardTarget,JSON.stringify(binding),{mode:0o600});await link(hardTarget,hardlinked.bindingPath);await assertInvalid('HARDLINK-BINDING-REFUSED',hardlinked);
 const bad=await newCase();await writeBinding(bad,'{');await start(bad,{OPSTWIN_WECHAT_CLI:wrapper,OPSTWIN_WECHAT_ATTACHMENT_SHA256:wrapperHash});connected=await request('/api/wechat/connect','POST',{});check('EXPLICIT-EXACT-ENV-OVERRIDES-BAD-FILE',connected.status===200&&connected.data?.ok===true&&(await request('/api/wechat/capabilities')).data?.attachments?.mode==='verified-exact-cli');
 await start(bad,{OPSTWIN_WECHAT_CLI:wrapper});connected=await request('/api/wechat/connect','POST',{});check('EXPLICIT-CLI-NO-SHA-LEGACY-OVERRIDES-BAD-FILE',connected.status===200&&connected.data?.ok===true&&(await request('/api/wechat/capabilities')).data?.attachments?.mode==='installed-image-fallback');
 await assertInvalid('SHA-WITHOUT-CLI-REFUSED',bad,{OPSTWIN_WECHAT_ATTACHMENT_SHA256:wrapperHash});await assertInvalid('EMPTY-CLI-REFUSED',bad,{OPSTWIN_WECHAT_CLI:''});await assertInvalid('EMPTY-CLI-SHA-REFUSED',bad,{OPSTWIN_WECHAT_CLI:wrapper,OPSTWIN_WECHAT_ATTACHMENT_SHA256:''});
 const db=new DatabaseSync(join(active.data,'opstwin-advance.db'),{readOnly:true});check('ZERO-EXTERNAL-SEND-INTENTS',db.prepare('SELECT count(*) n FROM send_intents').get().n===0);db.close();
 check('DEFAULT-CONFIG-UNCHANGED',mainHash===sha(await readFile(join(root,'.local/config.json'))));check('FROZEN-PROGRAMS',sha(await readFile(candidate))===ready.compiledHash&&sha(await readFile(wrapper))===wrapperHash);
}catch(error){check('HARNESS-COMPLETES',false,{errorName:error.name,errorHash:sha(String(error))});}
finally{await stop();check('OWNED-SERVER-EXIT',!child);report.serverLogHash=sha(log);report.sourceStable=(await Promise.all(paths.map(async p=>sha(await readFile(join(root,p)))===sourceHashes[p]))).every(Boolean);check('SOURCE-STABLE',report.sourceStable);report.counts=Object.fromEntries(['PASS','FAIL'].map(s=>[s,report.checks.filter(c=>c.status===s).length]));report.status=report.counts.FAIL?'FAIL':'PASS_SCOPE';await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,counts:report.counts,manifest:join(out,'manifest.json')}));if(report.counts.FAIL)process.exitCode=1;}
