#!/usr/bin/env node
// Failure inventory recorded first in docs/journeys/native-workspace-gui.md.
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const ready=JSON.parse(await readFile(join(root,'output/native-parity-20261003/settings-gui-v12/fixture-ready.json'),'utf8'));
if(ready.api!=='http://127.0.0.1:46214'||ready.guards?.NO_BACKGROUND!==1||ready.guards?.AUTONOMOUS_DELIVERY!=='off'||ready.guards?.NOTIFICATION_DELIVERY!=='off')throw Error('isolated non-delivery runtime required');
const data=await realpath(ready.serverData),allowed=await realpath(join(root,'.local/acceptance'));
if(!data.startsWith(allowed+'/')||data===resolve(root,'data'))throw Error('isolated data directory required');
const db=new DatabaseSync(join(data,'opstwin-advance.db'),{readOnly:true});
if(db.prepare('SELECT value FROM meta WHERE key=?').get('initialized')?.value!=='true')throw Error('initialized isolated database required');
const api=ready.api,marker='OPSADV-QA-WORKSPACE-'+randomUUID(),objects=[],checks=[];
async function req(path,method='GET',body){const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return{status:r.status,data:await r.json()};}
function check(name,ok,extra={}){checks.push({name,status:ok?'PASS':'FAIL',...extra});if(!ok)throw Error(name);}
function protectedFingerprint(){return hash(db.prepare("SELECT type,id,data,deleted FROM entities WHERE type IN ('memories','connections') ORDER BY type,id").all());}
const beforeProtected=protectedFingerprint(),beforeSettings=hash((await req('/api/settings')).data);
const mainConfigHash=hash(await readFile(join(root,'.local/config.json')));
const publicMemory=ready.publicFixtureObjects?.longMemory;
const memory=await req('/api/memories/'+encodeURIComponent(publicMemory?.id||''));
if(memory.status!==200||hash(memory.data.body)!==publicMemory.bodyHash)throw Error('public isolated memory guard mismatch');
const settings=await req('/api/settings');
if(settings.status!==200||settings.data.identity?.name!==ready.publicDataset.identity)throw Error('public isolated identity guard mismatch');
const stamp=new Date().toISOString().replaceAll(':','-'),out=join(root,'output/native-parity-20261003/workspace-gui',stamp);
await mkdir(out,{recursive:true});
const report={schema:1,kind:'production HTTP and readonly SQLite public fixture preparation; native GUI NOT_RUN',api,marker,dataDirectory:data,objects,checks,guiStatus:'NOT_RUN',externalSends:0,calendarWrites:0,modelRuns:0,sourceHashes:{}};
async function save(){await writeFile(join(out,'manifest.json'),JSON.stringify(report,null,2));}
try{
 check('isolated identity and public memory guards',true);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
 const longBody=('OPSADV-QA public workspace content. 公开长正文仅用于滚动和全文搜索。\n').repeat(210)+'\n'+marker+'-TAIL';
 const defs=[
  ['tasks','today',{title:'公开验收：今日任务',notes:'OPSADV-QA 多行任务正文\n第二行 😀\n'+marker+'-TASK',status:'active',dueDate:today}],
  ['tasks','later',{title:'公开验收：未来任务',notes:'OPSADV-QA future task',status:'active',dueDate:tomorrow}],
  ['tasks','done',{title:'公开验收：完成任务',notes:'OPSADV-QA completed task',status:'completed',dueDate:today}],
  ['inbox','saved',{title:'公开验收：已有草稿',sender:'OPSADV-QA Public Sender',senderId:marker+'-sender',channel:'Internal',origin:'human',sourceId:marker+'-saved-source',status:'pending',isMine:false,isSelfTest:false,body:longBody,draft:'公开已保存草稿\n必须保留此正文 😀\n'+marker+'-DRAFT',receivedAt:new Date().toISOString(),contextIds:[publicMemory.id]}],
  ['inbox','generate',{title:'公开验收：生成回复',sender:'OPSADV-QA Public Colleague',senderId:marker+'-colleague',channel:'Internal',origin:'human',sourceId:marker+'-generate-source',status:'pending',isMine:false,isSelfTest:false,body:'请确认公开测试计划周二先核对产品规格，再整理风险列表。这里只需回复草稿，无外发授权。',receivedAt:new Date().toISOString(),contextIds:[publicMemory.id]}],
  ['inbox','sensitive',{title:'公开验收：敏感事项',sender:'OPSADV-QA Public Sender',senderId:marker+'-sender',channel:'Internal',origin:'human',sourceId:marker+'-sensitive-source',status:'pending',isMine:false,isSelfTest:false,sensitive:true,body:'公开测试事项：涉及报价和合同，需要本人确认。不得自动外发。',draft:'请保留公开敏感事项草稿',receivedAt:new Date().toISOString()}],
  ['ideas','discuss',{title:'公开验收：只读深入聊聊',category:'productivity',status:'new',description:'OPSADV-QA 请仅分析下面公开产品清单，逐项解释任务与收件箱的关系；不得写入、发送或生成文件。\n'+marker+'-IDEA',steps:['阅读公开上下文','仅给出分析'],sourceIds:[],contextIds:[publicMemory.id]}],
  ['ideas','ignore',{title:'公开验收：可撤销忽略',category:'productivity',status:'new',description:'OPSADV-QA 公开忽略与撤销测试，不执行任何外部动作。'}]
 ];
 for(const [type,role,fields]of defs){
  const id=marker+'-'+type+'-'+role,created=await req('/api/'+type,'POST',{id,...fields});
  const row=db.prepare('SELECT data,deleted FROM entities WHERE type=? AND id=?').get(type,id);
  objects.push({type,role,id,title:fields.title,bodyCharacters:(fields.body||fields.notes||fields.description||'').length,contentHash:hash(fields.body||fields.notes||fields.description||''),createdHttp:created.status,updatedAt:created.data.updatedAt});
  await save();check(type+' '+role+' HTTP create and durable SQLite',created.status===201&&created.data.id===id&&row?.deleted===0&&JSON.parse(row.data).id===id);
  const got=await req('/api/'+type+'/'+id);check(type+' '+role+' exact detail readback',got.status===200&&got.data.id===id&&got.data.title===fields.title);
 }
 const t=objects.find(x=>x.role==='today'),original=(await req('/api/tasks/'+t.id)).data;
 const dup=await req('/api/tasks','POST',{id:t.id,title:'DO NOT OVERWRITE'});check('duplicate create rejects and preserves task',dup.status===409&&(await req('/api/tasks/'+t.id)).data.title===original.title);
 await new Promise(r=>setTimeout(r,10));
 const patched=await req('/api/tasks/'+t.id,'PATCH',{notes:original.notes+'\n公开并发远端修改',baseUpdatedAt:original.updatedAt});
 const conflict=await req('/api/tasks/'+t.id,'PATCH',{notes:'DO NOT OVERWRITE',baseUpdatedAt:original.updatedAt});
 check('real task stale version returns 409 and preserves current notes',patched.status===200&&conflict.status===409&&(await req('/api/tasks/'+t.id)).data.notes===patched.data.notes);
 t.updatedAt=patched.data.updatedAt;
 const search=await req('/api/workspace/search?q='+encodeURIComponent(marker+'-TAIL')+'&limit=50');
 check('production full-text search finds public long Inbox tail',search.status===200&&search.data.items?.some(x=>x.id===objects.find(o=>o.role==='saved').id));
 check('settings and existing memory/connection data unchanged',beforeSettings===hash((await req('/api/settings')).data)&&beforeProtected===protectedFingerprint());
 check('main private model configuration unchanged',mainConfigHash===hash(await readFile(join(root,'.local/config.json'))));
 check('no send or calendar intent created',db.prepare('SELECT COUNT(*) AS n FROM send_intents').get().n===0&&db.prepare('SELECT COUNT(*) AS n FROM calendar_intents').get().n===0);
 report.status='READY_PUBLIC_FIXTURE_GUI_NOT_RUN';
}catch(e){report.status='FAIL';report.error=String(e.message);process.exitCode=1;}
finally{
 for(const p of ['scripts/native-workspace-gui-prepare.mjs','server/src/index.ts','server/src/store.ts','server/src/workspace-search.ts'])report.sourceHashes[p]=hash(await readFile(join(root,p)));
 report.preparedObjects=objects.length;report.pass=checks.filter(x=>x.status==='PASS').length;report.fail=checks.filter(x=>x.status==='FAIL').length;
 await save();db.close();console.log(JSON.stringify({manifest:join(out,'manifest.json'),status:report.status,pass:report.pass,fail:report.fail,preparedObjects:objects.length}));
}
