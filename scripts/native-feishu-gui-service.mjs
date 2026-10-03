#!/usr/bin/env node
// Failure inventory: docs/journeys/native-feishu-gui.md. Prepares; never sends.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,open,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const stamp=new Date().toISOString().replaceAll(':','-'), uuid=randomUUID();
const out=join(root,'output/native-parity-20261003/feishu-gui',stamp);
const state=join(root,'.local/acceptance/native-feishu-gui',uuid);
const sql=join(state,'server'),native=join(state,'native');
const priv=join(root,'.local/private-runtime/feishu-gui-'+uuid);
const api='http://127.0.0.1:46224',proxy='http://127.0.0.1:46225';
const sha=v=>createHash('sha256').update(v).digest('hex');
const children=[],checks=[];let logs='',stopping=false;
const manifest={schema:1,scope:'actual isolated production Feishu API preparation; native GUI NOT_RUN; no send/approval/undo',readiness:'NOT_RUN',api,proxy,sql,native,privateRuntime:priv,marker:'OPSADV-QA-NATIVE-GUI-'+uuid,itemId:'inbo-native-gui-'+uuid,externalSends:0,checks,sourceHashes:{}};
async function durable(path,value){const temp=path+'.tmp-'+randomUUID();const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}await rename(temp,path);}
async function save(){await durable(join(out,'manifest.json'),manifest);}
async function free(port){await new Promise((ok,no)=>{const s=createServer();s.once('error',()=>no(Error('port_occupied')));s.listen(port,'127.0.0.1',()=>s.close(ok));});}
async function req(origin,path,method='GET',body){const r=await fetch(origin+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(65000)});return {status:r.status,data:await r.json()};}
function check(name,ok,evidence={}){checks.push({name,status:ok?'PASS':'FAIL',evidence});if(!ok)throw Error('preparation_failed');}
async function waitReady(origin,path){for(let i=0;i<100;i++){if(children.some(c=>c.exitCode!==null||c.signalCode!==null))throw Error('owned_service_exited');try{const r=await req(origin,path);if(r.status===200)return r;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('service_unavailable');}
function launch(script,env){const child=spawn(process.execPath,script,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(child);for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{if(logs.length<1000000)logs+=b;});return child;}
async function stop(){if(stopping)return;stopping=true;for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGTERM');await Promise.all(children.map(c=>new Promise(r=>{if(c.exitCode!==null||c.signalCode!==null)r();else{c.once('exit',r);setTimeout(r,3000).unref();}})));manifest.ownedServicesStopped=children.every(c=>c.exitCode!==null||c.signalCode!==null);manifest.serverLogSha256=sha(logs);await save();}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try{
 for(const d of [out,sql,native,priv])await mkdir(d,{recursive:true,mode:0o700});
 for(const port of [46224,46225])await free(port);
 await durable(join(priv,'config.json'),{});
 const db=new DatabaseSync(join(sql,'opstwin-advance.db'));
 db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');
 db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'许茂林',language:'en',instructions:'Public isolated GUI acceptance only'},autonomy:{holdSending:false,levels:{ack:'observe',meet:'observe',docs:'observe',commit:'observe',boss:'observe',sensitive:'observe'},files:[]},channels:{feishu:{enabled:true},email:{enabled:false}}}));db.close();
 for(const p of ['scripts/native-feishu-gui-service.mjs','scripts/native-ui-proxy.mjs','server/src/index.ts','server/src/integrations.ts','server/src/sending.ts','native/macos/app/src/inbox.rs'])manifest.sourceHashes[p]=sha(await readFile(join(root,p)));
 manifest.defaultConfigBefore=sha(await readFile(join(root,'.local/config.json')));await save();
 const env={OPSTWIN_API_PORT:'46224',OPSTWIN_WEB_PORT:'46226',OPSTWIN_DATA_DIR:sql,OPSTWIN_PRIVATE_DIR:priv,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'};
 launch(['--import','tsx','server/src/index.ts'],env);
 const health=await waitReady(api,'/api/health');check('own production API is independent',health.data.database==='independent');
 launch(['scripts/native-ui-proxy.mjs'],{OPSTWIN_API:api,OPSTWIN_QA_PROXY_PORT:'46225'});
 const forward=await waitReady(proxy,'/__qa/status');check('own proxy begins online without armed send fault',forward.data.offline===false&&forward.data.dropInboxSendResponse===false&&forward.data.attempts.length===0);
 const verified=await req(api,'/api/connections/test','POST',{name:'Public Steve-only Feishu GUI QA',provider:'Feishu',type:'CLI',permissions:['read','draft','send']});
 check('actual current CLI verifies Steve user identity',verified.status===200&&verified.data.ok===true&&verified.data.connection?.evidence?.name==='许茂林'&&verified.data.connection?.identity==='user',{http:verified.status,status:verified.data.connection?.status});
 const window=await req(api,'/api/connections/feishu-local/working-window');check('isolated explicit send policy permits GUI test',window.status===200&&window.data.allowed===true,{http:window.status});
 const text=manifest.marker+'\nPublic OpsTwins native Feishu GUI acceptance. Synthetic message only; no action required.';
 manifest.draftSha256=sha(text);await save();
 const made=await req(api,'/api/inbox','POST',{id:manifest.itemId,title:manifest.marker,sender:'许茂林',channel:'Feishu',origin:'human',body:text,draft:text,status:'pending',approved:false,isSelfTest:true,recipientId:'self',testMarker:manifest.marker,sensitive:false,attachments:[]});
 check('one public self draft saved without approval or receipt',made.status===201&&made.data.id===manifest.itemId&&made.data.approved===false&&made.data.status==='pending'&&!made.data.receipt&&sha(made.data.draft)===manifest.draftSha256,{http:made.status,itemId:manifest.itemId});
 const reread=await req(proxy,'/api/inbox/'+manifest.itemId);check('proxy exact item readback retains public draft',reread.status===200&&reread.data.recipientId==='self'&&reread.data.testMarker===manifest.marker&&sha(reread.data.draft)===manifest.draftSha256);
 const audit=await req(proxy,'/__qa/status');check('preparation has zero send POSTs',audit.data.attempts.length===0);
 check('default private config unchanged',manifest.defaultConfigBefore===sha(await readFile(join(root,'.local/config.json'))));
 manifest.readiness='PREPARED';manifest.preparedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({readiness:manifest.readiness,manifest:join(out,'manifest.json'),api:proxy,native,itemId:manifest.itemId,externalSends:0}));
 // Child handles keep this process live for the separately owned native GUI.
}catch(e){manifest.readiness='BLOCKED';manifest.error=typeof e.message==='string'&&/^[a-z_]{1,80}$/.test(e.message)?e.message:'preparation_failed';await stop();console.log(JSON.stringify({readiness:manifest.readiness,manifest:join(out,'manifest.json'),externalSends:0}));process.exitCode=1;}
