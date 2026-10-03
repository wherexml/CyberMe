#!/usr/bin/env node
// Failure matrix exists in docs/spec/native-workspace-search.md before implementation.
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const marker='OPSADV-QA-SEARCH-'+randomUUID(),port=Number(process.env.OPSTWIN_SEARCH_QA_PORT||46196);
if(!Number.isInteger(port)||port<10000||port>65535)throw Error('five-digit port required');
const dir=root+'.local/acceptance/native-workspace-search/'+new Date().toISOString().replaceAll(':','-');
await mkdir(dir,{recursive:true});
const isolation=new DatabaseSync(dir+'/opstwin-advance.db');
isolation.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
isolation.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('initialized','true');
isolation.close();
const api=`http://127.0.0.1:${port}`,checks=[];
const child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_DATA_DIR:dir,OPSTWIN_NO_BACKGROUND:'1'},stdio:['ignore','ignore','ignore']});
const req=async path=>{const r=await fetch(api+path,{signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};};
function check(name,ok,detail={}){checks.push({name,status:ok?'PASS':'FAIL',...detail});if(!ok)throw Error(name);}
let db;
try{
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('isolated API exited');try{ready=(await req('/api/settings')).status===200;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}check('isolated real API ready',ready);
 db=new DatabaseSync(dir+'/opstwin-advance.db');
 const insert=db.prepare('INSERT INTO entities(type,id,data,deleted) VALUES(?,?,?,?)');
 const put=(kind,id,fields={},deleted=0)=>insert.run(kind,id,JSON.stringify({id,title:marker,createdAt:'2026-10-03T00:00:00.000Z',...fields}),deleted);
 const tail=marker+'-TAIL',old=marker+'-OLD',literal=marker+'-%_';
 put('inbox',marker+'-inbox',{body:'公开填充 '.repeat(2100)+tail,messages:Array.from({length:140},(_,i)=>({text:i===0?old:'公开来源 '+i,sentAt:'2026-10-02T00:00:00.000Z'}))});
 put('memories',marker+'-memory',{body:'公开填充 '.repeat(400)+tail});
 put('conversations',marker+'-conv',{name:'公开QA会话'});
 for(let i=0;i<130;i++)put('messages',marker+'-msg-'+String(i).padStart(3,'0'),{title:undefined,conversationId:marker+'-conv',content:i===0?old:'公开消息 '+i,createdAt:new Date(Date.UTC(2026,9,1,0,i)).toISOString()});
 for(const kind of ['tasks','ideas','artifacts','projects','automations','activities'])put(kind,marker+'-'+kind,{notes:marker+' PAGE',description:marker+' PAGE'});
 put('tasks',marker+'-literal',{title:literal,notes:'**公开粗体** <b>公开标签</b> [公开链接](https://example.com)'});
 put('tasks',marker+'-deleted',{body:marker+'-DELETED'},1);
 put('artifacts',marker+'-archived',{body:marker+'-ARCHIVED',archivedAt:'2026-10-03T01:00:00Z'});
 for(const kind of ['settings','connections','binding','config'])put(kind,marker+'-'+kind,{body:marker+'-HIDDEN',apiKey:marker+'-SECRET'});
 put('tasks',marker+'-secretfield',{apiKey:marker+'-SECRET'});
 put('tasks',marker+'-unicode',{body:'公开 ΩMEGA 😊 '+marker+'-UNICODE'});
 const searchFields=['title','name','sender','senderName','body','content','description','notes','prompt','summary','markdown','text','draft','detail'];
 for(const field of searchFields)put('tasks',marker+'-field-'+field,{[field]:marker+'-FIELD-'+field});
 put('ideas',marker+'-steps',{steps:[{description:marker+'-STEP-OBJECT'},marker+'-STEP-TEXT']});
 db.prepare("INSERT INTO meta(key,value) VALUES('revision','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
 const search=async(q,extra='')=>req('/api/workspace/search?q='+encodeURIComponent(q)+extra);
 let r=await search(tail);check('full Inbox >8000 and memory >1200 tail searchable',r.status===200&&r.data.total===2&&r.data.items.every(i=>i.snippet.includes(tail)));
 r=await search(old);check('full old embedded source and old Chat message searchable',r.status===200&&r.data.items.some(i=>i.kind==='inbox')&&r.data.items.some(i=>i.kind==='messages'&&i.targetId===marker+'-conv'));
 r=await search(literal);check('percent and underscore are literal',r.status===200&&r.data.total===1&&r.data.items[0].id===marker+'-literal');
 r=await search(marker+'-DELETED');check('deleted records excluded',r.status===200&&r.data.total===0);
 r=await search(marker+'-ARCHIVED');check('archived artifact excluded',r.status===200&&r.data.total===0);
 r=await search(marker+'-HIDDEN');check('excluded types not searched',r.status===200&&r.data.total===0);
 r=await search(marker+'-SECRET');check('credential field not searched',r.status===200&&r.data.total===0);
 r=await search(marker,'&kind=inbox');check('type filter returns only Inbox',r.status===200&&r.data.total===1&&r.data.items[0].kind==='inbox');
 r=await search(marker+'-UNICODE');check('Unicode plain bounded snippet',r.status===200&&r.data.items[0].snippet.includes('😊')&&[...r.data.items[0].snippet].length<=220);
 r=await search('ωmega');check('nonASCII case folding',r.status===200&&r.data.total===1);
 r=await search('公开粗体');check('snippet is plain text',r.status===200&&!r.data.items[0].snippet.includes('<b>')&&!r.data.items[0].snippet.includes('**')&&!r.data.items[0].snippet.includes('](https'));
 for(const field of searchFields){r=await search(marker+'-FIELD-'+field);check('known full text field '+field,r.status===200&&r.data.items.some(i=>i.id===marker+'-field-'+field));}
 r=await search(marker+'-STEP-OBJECT');check('object step description searchable',r.status===200&&r.data.total===1);r=await search(marker+'-STEP-TEXT');check('plain step searchable',r.status===200&&r.data.total===1);
 r=await search(marker,'&limit=100');check('all ten allowed workspace kinds searchable',r.status===200&&new Set(r.data.items.map(i=>i.kind)).size===10);
 const details={inbox:'inbox',memories:'memory',conversations:'conv',messages:'msg-000',tasks:'tasks',ideas:'ideas',artifacts:'artifacts',projects:'projects',automations:'automations',activities:'activities'};
 for(const [kind,suffix] of Object.entries(details)){
  const id=marker+'-'+suffix,detail=await req('/api/'+kind+'/'+encodeURIComponent(id));
  check('exact searchable '+kind+' detail can open',detail.status===200&&detail.data.id===id,{httpStatus:detail.status});
 }
 const missing=await req('/api/activities/'+encodeURIComponent(marker+'-missing'));
 check('missing activity detail is object not_found',missing.status===404&&missing.data.error==='not_found');
 let page=await search(marker,'&limit=3'),seen=new Set(),offset=0;check('pagination first page bounded',page.status===200&&page.data.items.length===3&&page.data.hasMore===true);
 const total=page.data.total,revision=page.data.revision;
 while(true){for(const item of page.data.items){check('page record unique '+seen.size,!seen.has(item.kind+':'+item.id));seen.add(item.kind+':'+item.id);check('response item shape excludes raw content '+seen.size,Object.keys(item).sort().join(',')==='id,kind,snippet,targetId,time,title');}if(!page.data.hasMore)break;offset=page.data.nextOffset;page=await search(marker,`&limit=3&offset=${offset}&revision=${revision}`);check('subsequent stable page '+offset,page.status===200&&page.data.total===total);}
 check('all pages complete exact total',seen.size===total);
 db.prepare("UPDATE meta SET value='2' WHERE key='revision'").run();r=await search(marker,'&revision=1');check('changed snapshot rejects stale pagination',r.status===409&&r.data.error==='search_changed');
 for(const suffix of ['&kind=settings','&kind=connections','&kind=bogus','&offset=-1','&offset=1.5','&offset=9007199254740992','&limit=0','&limit=101','&raw=true','&revision=-1']){r=await search(marker,suffix);check('invalid params rejected '+suffix,r.status===400);}
 r=await search('');check('empty query rejected',r.status===400);r=await search('x'.repeat(501));check('long query rejected',r.status===400);r=await search(Array.from({length:17},(_,i)=>'word'+i).join(' '));check('too many terms rejected',r.status===400);
 r=await search("' OR 1=1 --");check('SQL text is literal, no injection',r.status===200&&r.data.total===0);
}catch(error){checks.push({name:'journey stopped',status:'FAIL',reason:String(error.message||error).slice(0,180)});}finally{db?.close();child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,1500)});if(child.exitCode===null)child.kill('SIGKILL');}
const hashes={};for(const path of ['server/src/workspace-search.ts','server/src/index.ts','native/macos/crates/opstwin-api/src/product.rs','docs/spec/native-workspace-search.md']){try{hashes[path]=createHash('sha256').update(await readFile(root+path)).digest('hex')}catch{hashes[path]=null}}
const report={schema:1,marker,api,scope:'Real isolated SQLite and HTTP with production route; no existing business DB, no GUI, no Agent/external writes/auth/sync.',createdAt:new Date().toISOString(),sourceHashes:hashes,checks,passed:checks.every(c=>c.status==='PASS'),notRun:['native search UI','native keyboard/narrow/focus','production SQL performance']};
await writeFile(dir+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({artifact:dir+'/result.json',passed:report.passed,checks:checks.length}));process.exitCode=report.passed?0:1;
