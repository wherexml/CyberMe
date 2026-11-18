// Run: node scripts/apple-github-installed-read-e2e.mjs
// Uses the signed installed app, its existing model, and at most one result per Apple tool.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const out=resolve('output/apple-github-connections-20261109');
await mkdir(out,{recursive:true});
const link=JSON.parse(await readFile(resolve(homedir(),'Library/Application Support/OpsTwins/.local/mygo-desktop/connection.json'),'utf8'));
const api=(path,method='GET',body)=>fetch('http://127.0.0.1:'+link.port+path,{method,headers:{'X-OpsTwins-Pilot':link.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(100000)}).then(async r=>({status:r.status,data:await r.json()}));
const app='/Applications/CyberMe.app',date='2026-11-10';
const version=execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleVersion',app+'/Contents/Info.plist'],{encoding:'utf8'}).trim();
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const origin='http://127.0.0.1:46110';
const checks=[],runs=[],record={version,checks,runs,links:{apple:origin+'/api/connections/apple/status',gmail:origin+'/api/connections/google/status'},scope:'signed installed CyberMe through desktop gateway; existing model; no titles or mail data in evidence'};
const check=(name,pass)=>{checks.push({name,pass:!!pass});return !!pass;};
try{
 const health=await api('/api/health');
 assert.ok(check('installed standalone gateway healthy',health.status===200&&health.data.runtimeMode==='standalone'));
 const apple=(await api('/api/connections/apple/status')).data;
 assert.ok(check('both Apple services report real OS permission and in-app connection',apple.source==='native'&&apple.calendar.read===true&&apple.reminders.read===true));
 const gmail=(await api('/api/connections/google/status')).data;
 record.gmail={configured:gmail.configured===true,status:gmail.status,read:gmail.read===true};
 const id='ui-side-'+randomUUID();
 assert.ok(check('created separate QA conversation',(await api('/api/conversations/side','POST',{id,title:'只读连接验收'})).status===201));
 const fixture=JSON.parse(await readFile(resolve(out,'github-issue-live.json'),'utf8')).publicIssue;
 const steps=[
  {name:'Calendar',tool:'app_read',action:'apple_calendar_events',message:`请查 Apple 日历 ${date} 从 00:00 到次日 00:00（Asia/Singapore）的日程，limit 设为 1。只告诉我读到了几条；不要输出事件标题、地点或任何个人内容，不要用终端。`,readOnly:true},
  {name:'Reminders',tool:'app_read',action:'apple_reminders',message:'请列出 Apple 提醒事项里的未完成事项，最多读取 1 条。只告诉我读到了几条，不要输出标题、列表名或任何个人内容，不要用终端。',readOnly:true},
  {name:'GitHub Issue',tool:'read_github_issue',message:`请查看 GitHub Issue ${fixture}。请使用精确 Issue 只读工具，不要使用通用命令。只回答是否读到，不要复述正文。`},
 ];
 for(const step of steps){
  const requestId=randomUUID();
  try{
   const r=await api('/api/chat','POST',{requestId,conversationId:id,preservePrimary:true,message:step.message,...(step.readOnly?{readOnly:true}:{})});
   const tools=(r.data.run?.tools||[]).filter(t=>t.name===step.tool&&(!step.action||t.input?.action===step.action));
   const success=tools.find(t=>t.status==='succeeded'&&t.effect==='read');
   const count=success?.output?.count;
   const failure=tools.find(t=>t.status==='failed')?.output?.code;
   const committedWrites=r.data.run?.taskOutcome?.committedWrites;
   const passed=r.status===200&&!!success&&committedWrites===0;
   check(step.name+' direct Chat reached the expected read-only tool',passed);
   runs.push({name:step.name,requestId,status:r.status,tool:step.tool,action:step.action,passed,count:Number.isInteger(count)?count:undefined,failure,committedWrites});
   console.log({step:step.name,passed,count:Number.isInteger(count)?count:undefined,failure,status:r.status});
  }catch(e){check(step.name+' direct Chat reached the expected read-only tool',false);runs.push({name:step.name,requestId,error:e.name});console.log({step:step.name,error:e.name});}
 }
}finally{
 await writeFile(resolve(out,'installed-read-chat.json'),JSON.stringify(record,null,2),{mode:0o600});
}
if(checks.some(x=>!x.pass))process.exitCode=1;
