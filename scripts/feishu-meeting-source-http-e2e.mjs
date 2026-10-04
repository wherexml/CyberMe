/** Full production Hono + isolated SQLite + public typed-CLI process E2E.
 * Failure inventory precedes implementation in part2-agent-sync-next-v33.
 * Public CLI fixture validates transport/collector, NOT real Feishu samples or GUI.
 */
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:net';
const root=resolve(import.meta.dirname,'..'),uuid=randomUUID(),stamp=new Date().toISOString().replaceAll(':','-');
const out=join(root,'output/native-parity-20261003/part2-agent-sync-next-v33/http',stamp),work=join(root,'.local/acceptance/feishu-meeting-source',uuid);
const port=46247,base=`http://127.0.0.1:${port}`,before=process.argv.includes('--before');
mkdirSync(out,{recursive:true});mkdirSync(work,{recursive:true,mode:0o700});const privateDir=join(root,'.local/private-runtime/feishu-meeting-source-'+uuid);mkdirSync(privateDir,{recursive:true,mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex'),source='server/src/feishu-sync-data.ts',sourceSHA=sha(readFileSync(join(root,source)));
const report={at:new Date().toISOString(),uuid,port,kind:'PRODUCTION_HTTP_PUBLIC_CLI_FIXTURE',before,sourceSHA,realFeishuReads:false,newModelCalls:0,externalWrites:0,GUI:'NOT_RUN',score:null,cases:[]};
writeFileSync(join(out,'failure-inventory.json'),JSON.stringify({beforeProductCodeOrProcess:true,cases:['chatLimit2 hides assistant on page2','independent lookup must not persist extra chats','duplicate exact names','exhaustive absence vs bounded limit','missing cursor','repeated cursor','permission lost during lookup','CLI failure','chat-only no lookup','minutes only no fake chat truncation']},null,2));
const controls=join(work,'controls.json'),calls=join(work,'calls.ndjson'),cli=join(work,'lark-public.mjs');
writeFileSync(cli,`#!/usr/bin/env node
import {readFileSync,appendFileSync} from 'node:fs';
const a=process.argv.slice(2),c=JSON.parse(readFileSync(${JSON.stringify(controls)},'utf8')),v=k=>{const i=a.indexOf(k);return i<0?undefined:a[i+1];},page=v('--page-token')||'0';
const command=a.slice(0,2).join(' ');appendFileSync(${JSON.stringify(calls)},JSON.stringify({command,page,chat:v('--chat-id')||null,at:new Date().toISOString()})+'\\n');
const done=(data)=>{console.log(JSON.stringify({ok:true,data}));},row=(i,name='Public metadata '+i)=>({chat_id:'qa-chat-'+i,name,chat_mode:i===202?'p2p':'group'});
if(command==='auth status'){console.log(JSON.stringify({ok:true,identity:'user',verified:true,identities:{user:{status:'ready',tokenStatus:'valid',openId:'qa-public-owner',userName:'许茂林'}}}));}
else if(command==='im +chat-list'){
 const p=Number(page);if(c.mode==='error'){console.log(JSON.stringify({ok:false,error:{subtype:'public_cli_failure',message:'Public controlled failure'}}));process.exit(1);}
 let items=[row(1),row(2)];let more=true,next='1';
 if(c.mode==='limit'){items=Array.from({length:100},(_,i)=>row(p*100+i));next=String(p+1);}
 else if(p===1){items=[row(3,'智能纪要助手'),row(4)];more=false;next='';}
 if(c.mode==='absent'&&p===1)items=[row(3),row(4)];
 if(c.mode==='ambiguous'&&p===1)items=[row(3,'智能纪要助手'),row(202,'智能纪要助手')];
 if(c.mode==='sameid'){items=[row(3,'智能纪要助手')];more=p===0;next=p===0?'1':'';}
 if(c.mode==='empty'){items=[];more=true;next='1';}
 if(c.mode==='repeat'){more=true;next='1';}
 if(c.mode==='missing'){more=true;next='';}
 if(c.mode==='slow'&&p===1)await new Promise(r=>setTimeout(r,800));
 done({items,has_more:more,page_token:next});
}else if(command==='im +chat-messages-list')done({items:[{message_id:'qa-public-message',msg_type:'text',body:{content:'https://qa.feishu.cn/docx/QAPublicMinute'}}],has_more:false});
else if(command==='docs +fetch')done({document:{content:'<title>OPSADV-QA Public Meeting</title>\\n会议主题：Public meeting source lookup\\n公开完整文档，不含私人来源'}});
else if(command==='mail +triage')done({items:[],has_more:false});
else {console.log(JSON.stringify({ok:false,error:{subtype:'unexpected_fixture_command'}}));process.exit(2);}
`);chmodSync(cli,0o700);
const sql=join(work,'opstwin-advance.db');const db=new DatabaseSync(sql);db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE entities(type TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,local_edited INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(type,id));');
db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.prepare('INSERT INTO meta VALUES(?,?)').run('settings',JSON.stringify({identity:{name:'OPSADV-QA Public Collector',language:'en'},autonomy:{holdSending:true},channels:{feishu:{enabled:true}}}));
db.prepare('INSERT INTO entities(type,id,data) VALUES(?,?,?)').run('connections','feishu-local',JSON.stringify({id:'feishu-local',title:'OPSADV-QA Public Feishu',name:'OPSADV-QA Public Feishu',provider:'Feishu',status:'connected',permissions:['read'],config:{syncInterval:'manual'}}));db.close();
let child;const pause=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error('HTTP '+r.status+' '+(d.error||''));return d;};
function mark(id,condition,data){report.cases.push({id,status:condition?'PASS':'FAIL',...data});writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));}
async function terminal(id){for(let i=0;i<100;i++){const s=await api('/api/feishu/sync');const r=s.history.items.find(x=>x.id===id);if(r&&r.status!=='running')return r;await pause(100);}throw Error('Terminal timeout');}
function callRows(){return readFileSync(calls,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}
try{
 await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
 writeFileSync(controls,JSON.stringify({mode:'found'}));writeFileSync(calls,'');
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_DATA_DIR:work,OPSTWIN_PRIVATE_DIR:privateDir,OPSTWIN_LARK_CLI:cli,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_DELIVERY_DISABLED:'1'},stdio:'ignore'});
 report.pid=child.pid;for(let i=0;i<100;i++){try{await api('/api/health');break;}catch{if(i===99)throw Error('Startup failed');await pause(100);}}
 await api('/api/feishu/sync/settings','PATCH',{chatLimit:2,messagesPerChat:1,minutesLimit:1,minutesMessageLimit:1,includeAttachments:false,chatIntervalMinutes:0,meetingEnabled:false,mailEnabled:false,analysisDelayMinutes:30});
 for(const mode of before?['found']:['found','sameid','ambiguous','absent','limit','repeat','missing','empty','error','permission','chatsonly','all']){
  await api('/api/connections/feishu-local','PATCH',{permissions:['read']});writeFileSync(controls,JSON.stringify({mode:mode==='permission'?'slow':['chatsonly','all'].includes(mode)?'found':mode}));writeFileSync(calls,'');
  const scope=mode==='chatsonly'?'chats':mode==='all'?'all':'minutes';const start=await api('/api/feishu/sync','POST',{scope});
  if(mode==='permission'){for(let i=0;i<100;i++){if(callRows().some(x=>x.command==='im +chat-list'&&x.page==='1'))break;await pause(10);}await api('/api/connections/feishu-local','PATCH',{permissions:[]});}
  const r=await terminal(start.runId),log=callRows(),projection={runId:r.id,operationStatus:r.status,counts:r.counts,truncated:r.truncated||[],failureCodes:(r.failures||[]).map(x=>x.code),errorCode:r.error?.code,lookup:r.meetingSourceLookup,cliCommandCounts:Object.fromEntries([...new Set(log.map(x=>x.command))].map(k=>[k,log.filter(x=>x.command===k).length]))};
  const doc=log.filter(x=>x.command==='docs +fetch').length,msg=log.filter(x=>x.command==='im +chat-messages-list').length;
  if(mode==='found'||mode==='sameid'){
   mark('FOUND-'+mode.toUpperCase(),r.counts.minutes===1&&r.status==='succeeded',projection);
   mark('ONLY-ASSISTANT-BODY-READ-'+mode.toUpperCase(),msg===1&&doc===1,{messages:msg,docs:doc});
   mark('NO-CHAT-COLLECTION-TRUNCATION-'+mode.toUpperCase(),r.counts.chats===0&&!(r.truncated||[]).includes('chats'),{counts:r.counts,truncated:r.truncated});
  }else if(mode==='chatsonly'){mark('CHATS-UNCHANGED-NO-LOOKUP',!r.meetingSourceLookup&&doc===0&&msg===2&&log.filter(x=>x.command==='im +chat-list').length===1,projection);}
  else if(mode==='all'){mark('ALL-CHAT-BODY-WINDOW-PRESERVED',r.counts.chats===2&&r.counts.minutes===1&&msg===3&&doc===1&&r.status==='partial'&&r.truncated.includes('chats')&&r.meetingSourceLookup.status==='found',projection);}
  else {const expected={ambiguous:'meeting_source_ambiguous',absent:'meeting_source_not_found',limit:'meeting_source_lookup_truncated',repeat:'repeated_cursor',missing:'missing_cursor',empty:'empty_cursor_page',error:'public_cli_failure',permission:'permission_denied'}[mode];mark('SAFE-'+mode.toUpperCase(),projection.failureCodes.includes(expected)||projection.errorCode===expected,projection);mark('NO-NEW-BODY-READ-'+mode.toUpperCase(),msg===0&&doc===0,{messages:msg,docs:doc});}
  if(mode==='limit')mark('LOOKUP-LIMIT-VISIBLE-FAILURE',r.failures?.some(x=>x.code==='meeting_source_lookup_truncated'&&x.message.includes('查找达到')&&x.message.includes('未读取助手正文')),{lookup:r.meetingSourceLookup,failureMessageHashes:r.failures?.map(x=>sha(x.message))});
 }
 const storage=await api('/api/feishu/sync');mark('STORAGE-NO-UNSELECTED-LOOKUP-CHATS',storage.storage.counts.chats===(before?0:2),{counts:storage.storage.counts});
 mark('SOURCE-STABLE',sourceSHA===sha(readFileSync(join(root,source))),{afterSHA:sha(readFileSync(join(root,source)))});
}catch(e){mark('RUNNER-ERROR',false,{errorName:e.name,errorHash:sha(String(e)),errorCode:String(e).match(/HTTP [0-9]+ [a-z_]+/)?.[0]});}
finally{
 if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
 report.exit=child?{exitCode:child.exitCode,signalCode:child.signalCode}:null;report.completedAt=new Date().toISOString();report.status=report.cases.some(x=>x.status==='FAIL')?'FAIL':'PASS';report.counts={pass:report.cases.filter(x=>x.status==='PASS').length,fail:report.cases.filter(x=>x.status==='FAIL').length};
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(out,'manifest.json'),JSON.stringify({reportSHA:sha(readFileSync(join(out,'report.json'))),runnerSHA:sha(readFileSync(import.meta.filename)),sourceSHA,status:report.status,score:null},null,2));console.log(JSON.stringify({out,status:report.status,counts:report.counts,exit:report.exit}));process.exitCode=before?0:report.status==='PASS'?0:1;
}
