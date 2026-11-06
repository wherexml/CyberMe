// Failure cases were recorded before implementation in docs/public/workspace-startup.md.
// node --import tsx scripts/workspace-startup-http-e2e.mjs
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {serve} from '@hono/node-server';import {Hono} from 'hono';
const scope=path.resolve('.local/acceptance/startup-'+randomUUID()),out=path.resolve('output/workspace-startup-20261105');await fs.mkdir(scope,{recursive:true,mode:0o700});await fs.mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.put('conversations',{id:'primary',title:'公开启动验收'});S.setMeta('primaryConversationId','primary');
const at=S.now(),insert=S.db.prepare('INSERT INTO entities(type,id,data,deleted) VALUES(?,?,?,?)');
for(let i=0;i<233;i++){const item={id:'source-'+i,title:'公开合成来源 '+i,channel:'Email',status:'pending',origin:'human',createdAt:at,updatedAt:at,messages:Array.from({length:40},(_,j)=>({id:'m'+j,text:'公开性能验收资料。'.repeat(500),isMine:false,sentAt:at}))};insert.run('inbox',item.id,JSON.stringify(item),0);}
const child={id:'round',sourceParentInboxId:'source-0',requestRoundId:'m1',title:'关联请求',channel:'Email',status:'pending',draft:'人工保留草稿',editedByUser:true,approved:true,sensitiveApproved:true,receipt:{id:'receipt-kept'},messages:[]};
insert.run('inbox',child.id,JSON.stringify(child),0);insert.run('inbox','deleted-round',JSON.stringify({...child,id:'deleted-round'}),1);insert.run('inbox','other-round',JSON.stringify({...child,id:'other-round',sourceParentInboxId:'source-1'}),0);
const raw=id=>JSON.parse(S.db.prepare("SELECT data FROM entities WHERE type='inbox' AND id=?").get(id).data),untouched=JSON.stringify([raw('deleted-round'),raw('other-round')]);
const {app}=await import('../server/src/index.ts');const gate=new Hono();gate.post('/fixture/sync',c=>{const item=raw('source-0'),start=performance.now();for(let n=0;n<100;n++)S.put('inbox',{...item,messages:[{id:'new-message',body:'公开更新 '+n,isMine:false,sentAt:at}],body:'公开更新 '+n});return c.json({elapsed:performance.now()-start})});gate.all('*',c=>app.fetch(c.req.raw));const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46848});
const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});};const timings={};
try{
 let start=performance.now();const sync=fetch('http://127.0.0.1:46848/fixture/sync',{method:'POST'});const health=fetch('http://127.0.0.1:46848/api/health');const result=await (await sync).json();check('health remains responsive during 100 source updates',(await health).ok&&(performance.now()-start)<2000);timings.sync100=result.elapsed;
 const updated=raw('round');check('exact linked round receives current source',updated.messages[0].body==='公开更新 99');check('draft and receipt preserved',updated.draft===child.draft&&updated.editedByUser&&updated.receipt.id===child.receipt.id);check('source change revokes approvals',updated.approved===false&&updated.sensitiveApproved===false);check('unrelated and deleted rounds unchanged',JSON.stringify([raw('deleted-round'),raw('other-round')])===untouched);
 start=performance.now();const bootstrap=await (await fetch('http://127.0.0.1:46848/api/bootstrap')).json();timings.bootstrap=performance.now()-start;check('bootstrap within 2 seconds',timings.bootstrap<2000);check('primary conversation in bootstrap',bootstrap.sources.primaryConversationId==='primary');check('all active inbox entries retained',bootstrap.inbox.length===235);
 const detail=await (await fetch('http://127.0.0.1:46848/api/inbox/round')).json();check('exact Inbox detail readable',detail.id==='round'&&detail.draft===child.draft);
 check('parent lookup uses index',S.db.prepare("EXPLAIN QUERY PLAN SELECT data FROM entities WHERE type='inbox' AND deleted=0 AND json_extract(data,'$.sourceParentInboxId')=?").all('source-0').some(r=>r.detail.includes('inbox_parent_source')));
 for(const [name,mutate] of [
  ['task',()=>S.put('tasks',{id:'linked-task',title:'Updated task',inboxId:'source-0',status:'active'})],
  ['identity',()=>S.patchSettings({identity:{instructions:'Updated public instructions'}})],
  ['feedback',()=>S.put('inbox_feedback',{id:'feedback',itemId:'another',active:true,channel:'Email',senderKey:'sender',body:'Public feedback'})],
 ]){
  S.put('inbox',{...raw('source-0'),sender:'sender'});const current=raw('source-0');S.put('inbox_triages',{id:current.id,status:'succeeded',sourceVersion:S.inboxTriageVersion(current),policyVersion:S.TRIAGE_POLICY_VERSION});
  const before=await (await fetch('http://127.0.0.1:46848/api/inbox')).json();check(name+' initial judgment matches',!!before.find(x=>x.id===current.id)?.triage);
  mutate();const after=await (await fetch('http://127.0.0.1:46848/api/inbox')).json();check(name+' change invalidates next list judgment',!after.find(x=>x.id===current.id)?.triage);
 }
 const hashes={};for(const f of ['server/src/store.ts','server/src/inbox-chat.ts','web/src/v6/App.tsx','web/src/v6/store.ts'])hashes[f]=createHash('sha256').update(await fs.readFile(f)).digest('hex');
 await fs.writeFile(out+'/http-result.json',JSON.stringify({synthetic:true,rows:233,timings,checks,hashes},null,2));console.log({timings,checks});if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{server.close();S.db.close()}
