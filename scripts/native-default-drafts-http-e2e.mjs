// Real production HTTP + scheduler, fresh SQLite, empty private model config.
// Missing-model and observe-only failures are intentional; no network model/send.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),scope=path.join(root,'.local/acceptance/default-drafts',randomUUID());
const data=path.join(scope,'data'),priv=path.join(scope,'private'),out=path.join(root,'output/inbox-autosave-20261004');
for(const p of [data,priv,out])fs.mkdirSync(p,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(data,'opstwin-advance.db'));db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
const harness=path.join(scope,'harness.ts');fs.writeFileSync(harness,`import '${root}/server/src/index.ts';import {startDefaultDrafts} from '${root}/server/src/default-drafts.ts';startDefaultDrafts();`);
let child;const checks=[];const assert=(x,n)=>{checks.push({name:n,pass:!!x});if(!x)throw Error(n)};
const api='http://127.0.0.1:46320';const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function req(p,method='GET',body){const r=await fetch(api+p,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function start(){await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(46320,'127.0.0.1',()=>probe.close(resolve));});child=spawn(process.execPath,['--import','tsx',harness],{cwd:root,env:{...process.env,OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:priv,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_API_PORT:'46320',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'},stdio:'ignore'});for(let i=0;i<80;i++){try{if((await req('/api/health')).status===200)return;}catch{}await wait(100);}throw Error('startup');}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}
try{
 await start();
 const ids={};for(const [name,extra] of Object.entries({empty:{},edited:{editedByUser:true},existing:{draft:'public existing'},sensitive:{sensitive:true},done:{status:'done'}})){
  const id='OPSADV-QA-default-'+name;ids[name]=id;const r=await req('/api/inbox','POST',{id,title:'公开默认草稿 '+name,body:'公开测试内容，不发送',sender:'OPSADV-QA',isMine:true,direction:'outgoing',channel:'Internal',status:'pending',...extra});assert(r.status===201,'create '+name);
 }
 let rows;for(let i=0;i<120;i++){rows=Object.fromEntries(await Promise.all(Object.entries(ids).map(async([n,id])=>[n,(await req('/api/inbox/'+id)).data])));if(rows.empty.draftPreparation?.status==='failed'&&rows.sensitive.draftPreparation?.status==='failed')break;await wait(150);}
 assert(rows.empty.draftPreparation?.status==='failed','unopened missing draft queued and attempted');
 assert(rows.sensitive.draftPreparation?.code==='sensitive_observe_only','sensitive observe guard retained');
 assert(!rows.edited.draftPreparation&&!rows.existing.draftPreparation&&!rows.done.draftPreparation,'edited existing done untouched');
 const rid=rows.empty.draftPreparation.requestId;await stop();await start();await wait(3500);
 const again=(await req('/api/inbox/'+ids.empty)).data;assert(again.draftPreparation.requestId===rid&&again.draftPreparation.status==='failed','restart does not retry failed job');
 const old=(await req('/api/inbox/'+ids.existing)).data;
 const saved=await req('/api/inbox/'+ids.existing,'PATCH',{draft:'public autosave HTTP',editedByUser:true,baseUpdatedAt:old.updatedAt});assert(saved.status===200&&saved.data.draft==='public autosave HTTP','real draft PATCH persists');
 const conflict=await req('/api/inbox/'+ids.existing,'PATCH',{draft:'stale',baseUpdatedAt:old.updatedAt});assert(conflict.status===409,'real stale save rejected');
 await stop();const verify=new DatabaseSync(path.join(data,'opstwin-advance.db'));
 assert(verify.prepare('SELECT COUNT(*) n FROM send_intents').get().n===0,'zero send intents');verify.close();
 fs.writeFileSync(path.join(out,'default-drafts-http.json'),JSON.stringify({scope:'real HTTP and production scheduler; no configured model; GUI separate',checks},null,2));console.log(JSON.stringify({pass:checks.length}));
}finally{await stop();fs.writeFileSync(path.join(out,'default-drafts-http.json'),JSON.stringify({scope:'real HTTP and production scheduler; intentional missing-model failure; no success model claim',checks},null,2));}
