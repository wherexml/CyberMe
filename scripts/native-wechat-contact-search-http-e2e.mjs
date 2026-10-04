#!/usr/bin/env node
// Failure inventory is recorded before implementation in docs/journeys/native-wechat-search-layout.md.
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),port=46240,api=`http://127.0.0.1:${port}`,work=join(root,'.local/acceptance/contact-search-'+randomUUID()),priv=join(work,'private'),out=join(root,'output/native-wechat-search-20261004',randomUUID());
for(const p of [work,priv,out])await mkdir(p,{recursive:true,mode:0o700});
await writeFile(join(priv,'config.json'),'{}',{mode:0o600});
const db=new DatabaseSync(join(work,'opstwin-advance.db'));db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'Public QA'},autonomy:{holdSending:true,levels:{sensitive:'observe'}}}));db.close();
const mode=join(work,'mode'),cli=join(work,'cli.mjs');await writeFile(mode,'normal');
await writeFile(cli,`#!/usr/bin/env node
import{readFileSync}from'node:fs';let a=process.argv.slice(2),mode=readFileSync(${JSON.stringify(mode)},'utf8'),cursor=a.includes('--cursor')?a[a.indexOf('--cursor')+1]:'0',n=Number(cursor);let e={schema:'greenbubbles.query.v1',ok:true,source:{identity:'PUBLIC'},consistency:{coverageComplete:mode!=='partial'},warnings:[],page:{hasMore:false},items:[]};
if(a[0]==='source')e.databaseCount=1;else if(a[0]==='chats')e.items=[{id:'PUBLIC-CHAT',displayName:'Public'}];else if(a[0]==='contacts'){if(mode==='first-partial'&&n===0){e.consistency.coverageComplete=false;e.warnings=[{code:'public-partial'}];}let budget=mode==='budget',end=budget?40:3;e.items=[{id:'PUBLIC-'+n,displayName:n===2&&!budget?'Public Target':'Public Other'}];e.page={hasMore:n<end,nextCursor:n<end?String(n+1):undefined};if(mode==='changed'&&n>0)e.source.identity='OTHER';if(mode==='repeat')e.page={hasMore:true,nextCursor:cursor||'0'};if(mode==='missing')e.page={hasMore:true};}console.log(JSON.stringify(e));
`,{mode:0o700});
const checks=[];let child,log='';const delay=ms=>new Promise(r=>setTimeout(r,ms));const sha=b=>createHash('sha256').update(b).digest('hex');
async function req(path,body){const r=await fetch(api+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(40000)});return{status:r.status,data:await r.json()};}
function check(name,pass,evidence={}){checks.push({name,status:pass?'PASS':'FAIL',evidence});}
async function setup(m='normal'){await writeFile(mode,m);await req('/api/wechat/connect',{});}
let status='ERROR';
try{
 await new Promise((ok,fail)=>{let s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:'46241',OPSTWIN_DATA_DIR:work,OPSTWIN_PRIVATE_DIR:priv,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_WECHAT_CLI:cli,OPSTWIN_WECHAT_ATTACHMENT_SHA256:undefined},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 for(let i=0;i<100;i++){try{if((await req('/api/health')).status===200)break;}catch{}await delay(100);}
 await setup();let r=await req('/api/wechat/contacts',{query:'Target',limit:1});check('legacy query remains one page',r.status===200&&r.data.items.length===0&&r.data.scanned===1&&r.data.hasMore);
 r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true});check('explicit lookup finds later page',r.status===200&&r.data.items.length===1&&r.data.scanned===3&&r.data.pagesScanned===3&&r.data.hasMore);
 const cursor=r.data.nextCursor;r=await req('/api/wechat/contacts',{query:'changed',limit:1,searchAll:true,cursor});check('changed query rejects old cursor',r.status===400&&r.data.error==='invalid_cursor');
 r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true,cursor});check('same query continues to honest completion',r.status===200&&!r.data.hasMore&&r.data.queryComplete&&r.data.items.length===0);
 await setup();r=await req('/api/wechat/contacts',{query:'Absent',limit:1,searchAll:true});check('no match searches to end',r.status===200&&r.data.scanned===4&&r.data.queryComplete);
 await setup('first-partial');r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true});check('earlier partial coverage survives later successful match',r.status===200&&!r.data.coverageComplete&&r.data.hasWarnings);r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true,cursor:r.data.nextCursor});check('earlier partial coverage survives continuation to end',r.status===200&&!r.data.queryComplete&&r.data.hasWarnings);
 await setup('budget');r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true});check('budget exhaustion retains continuation',r.status===200&&r.data.pagesScanned===20&&r.data.searchPending&&!r.data.queryComplete&&!!r.data.nextCursor);
 r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true,cursor:r.data.nextCursor});check('budget continuation advances',r.status===200&&r.data.pagesScanned===20&&r.data.hasMore);
 await setup('changed');r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true});check('source change between pages rejected',r.status===409&&r.data.error==='wechat_source_changed');
 await setup('repeat');r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true});check('repeated cursor rejected',r.status===502&&r.data.error==='wechat_cursor_repeated');
 await setup('missing');r=await req('/api/wechat/contacts',{query:'Target',limit:1,searchAll:true});check('missing continuation cannot appear complete',r.status===502&&r.data.error==='wechat_cursor_missing');
 await setup('partial');r=await req('/api/wechat/contacts',{query:'Absent',limit:1,searchAll:true});check('partial source does not claim complete query',r.status===200&&!r.data.queryComplete&&!r.data.coverageComplete);
 r=await req('/api/wechat/contacts',{query:'Target',searchAll:'true'});check('invalid search scope rejected',r.status===400);
 await req('/api/connections/wechat-sync-local/disconnect',{});r=await req('/api/wechat/contacts',{query:'Target',searchAll:true});check('disconnect blocks search',r.status===409);
 const inspect=new DatabaseSync(join(work,'opstwin-advance.db'),{readOnly:true});check('no external sends',inspect.prepare('SELECT count(*) n FROM send_intents').get().n===0);inspect.close();status=checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
}finally{
 if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(3000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 const sources={};for(const p of ['server/src/wechat-sync.ts','native/macos/app/src/settings.rs', 'scripts/native-wechat-contact-search-http-e2e.mjs'])sources[p]=sha(await readFile(join(root,p)));
 await writeFile(join(out,'manifest.json'),JSON.stringify({status,scope:'isolated production HTTP plus public typed CLI fixture; GUI/live distinct',checks,sourceHashes:sources,serverLogHash:sha(log),externalSends:0},null,2)+'\n');console.log(JSON.stringify({status,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length,artifact:join(out,'manifest.json')}));if(status!=='PASS')process.exitCode=1;
}
