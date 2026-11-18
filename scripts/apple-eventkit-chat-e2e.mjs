// Run: node --import tsx scripts/apple-eventkit-chat-e2e.mjs
// Failure cases: docs/sprints-1109/APPLE-GITHUB-FAILURES.md.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
const dir=resolve('.local/acceptance/apple-eventkit-'+randomUUID()),out=resolve('output/apple-github-connections-20261109'),checks=[];
const port=46866,modelPort=46867,url='http://127.0.0.1:'+port;
const statusFile=resolve(dir,'eventkit-status.json'),callsFile=resolve(dir,'eventkit-calls.jsonl');
const eventTitle='Public EventKit Fixture Event',reminderTitle='Public EventKit Fixture Reminder';
await mkdir(dir,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:dir,OPSTWIN_PRIVATE_DIR:dir,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_WEB_PORT:String(port),OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_EVENTKIT_HELPER_FIXTURE:dir+'/eventkit'});
await writeFile(dir+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:'+modelPort+'/v1',apiKey:'public-fixture',api:'openai-completions',model:'public-apple-model'}}),{mode:0o600});
await writeFile(process.env.OPSTWIN_EVENTKIT_HELPER_FIXTURE,`#!${process.execPath}
import fs from 'node:fs';
if(process.argv.length!==3||process.argv[2]!=='--cyberme-eventkit-read')process.exit(4);
const x=JSON.parse(fs.readFileSync(0,'utf8'));
const state=JSON.parse(fs.readFileSync(${JSON.stringify(statusFile)},'utf8'));
fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify(x)+'\\n');
if(x.op==='status')console.log(JSON.stringify({ok:true,...state}));
else if(x.op==='events')console.log(JSON.stringify(state.calendar==='full'?{ok:true,items:[{title:${JSON.stringify(eventTitle)},allDay:true,start:'2026-11-10',end:'2026-11-11',timezone:'Asia/Singapore'}]}:{ok:false,code:'apple_permission_denied',status:state.calendar}));
else if(x.op==='reminders')console.log(JSON.stringify(state.reminders==='full'?{ok:true,items:[{title:${JSON.stringify(reminderTitle)},due:null,list:'Personal'}],lists:[{id:'public-list',title:'Personal'}]}:{ok:false,code:'apple_permission_denied',status:state.reminders}));
else process.exit(9);
`,{mode:0o700});
const osState=(calendar,reminders)=>writeFile(statusFile,JSON.stringify({calendar,reminders}),{mode:0o600});
await osState('not_determined','denied');
const db=new DatabaseSync(resolve(dir,'opstwin-advance.db'));
db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db.close();
const S=await import('../server/src/store.ts');
S.put('conversations',{id:'main',title:'Apple 连接公开验收'});S.setMeta('primaryConversationId','main');
let lastTool='';
const emit=(res,delta,reason)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:reason}]})+'\n\n');
const model=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;
 const {messages,tools}=JSON.parse(raw),i=messages.findLastIndex(m=>m.role==='user');
 const prompt=typeof messages[i]?.content==='string'?messages[i].content:messages[i]?.content?.[0]?.text;
 const direct=prompt?.split('当前用户请求：\n').at(-1)||'';
 const action=direct.includes('提醒')?'apple_reminders':'apple_calendar_events';
 const tool=messages.slice(i+1).findLast(x=>x.role==='tool');
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(!tool&&tools?.find(x=>x.function?.name==='app_read')?.function?.parameters?.properties?.action?.enum?.includes(action)){
  const input=action==='apple_reminders'?{list:'Personal',limit:2}:{start:'2026-11-10T00:00:00+08:00',end:direct.includes('错误日期')?'2026-12-25T00:00:00+08:00':'2026-11-12T00:00:00+08:00',limit:2};
  emit(res,{role:'assistant',tool_calls:[{index:0,id:'apple-test-call',type:'function',function:{name:'app_read',arguments:JSON.stringify({action,input})}}]},null);emit(res,{},'tool_calls');
 }else{
  lastTool=tool?.content||'';
  emit(res,{role:'assistant',content:lastTool.includes(eventTitle)||lastTool.includes(reminderTitle)?'APPLE_FIXTURE_RESULT':'NO_APPLE_READ'},null);emit(res,{},'stop');
 }
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');
const {executeApplicationAction}=await import('../server/src/agent-capabilities.ts');
const server=serve({fetch:app.fetch,port,hostname:'127.0.0.1'});
const api=(path,method='GET',body)=>fetch(url+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}).then(async r=>({status:r.status,data:await r.json()}));
const send=message=>api('/api/chat','POST',{requestId:randomUUID(),conversationId:'main',message});
const path='/api/connections/apple';
const reads=async()=>(await readFile(callsFile,'utf8').catch(()=>'' )).split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.op!=='status');
const expect=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name)};
try{
 const initial=(await api(path+'/status')).data;
 expect('fixture is explicitly labeled; no false native or connected state',initial.supported&&initial.source==='fixture'&&initial.calendar.os==='not_determined'&&!initial.calendar.read&&!initial.reminders.read);
 expect('denied OS access blocks local connection',(await api(path+'/reminders/authorize','POST',{})).status===403);
 await osState('write_only','denied');
 expect('write-only Calendar access cannot read or connect',(await api(path+'/calendar/authorize','POST',{})).status===403);
 await osState('full','denied');
 expect('Calendar can be enabled independently',(await api(path+'/calendar/authorize','POST',{})).status===200&&!(await api(path+'/status')).data.reminders.read);
 const calendar=await send('请查看 Apple 日历明天的日程');
 expect('Calendar data flows through actual Chat and app_read',calendar.data.assistantMessage?.content==='APPLE_FIXTURE_RESULT'&&lastTool.includes('fixture_eventkit')&&lastTool.includes('"allDay":true'));
 expect('Calendar read has no committed writes or event title in tool audit',calendar.data.run?.taskOutcome?.committedWrites===0&&!JSON.stringify(calendar.data.run.tools).includes(eventTitle));
 const n=(await reads()).length;
 await send('请查看 Apple 日历的授权状态');
 await send('解释这句话：“请查看 Apple 日历明天的日程”。');
 await send('请查看 Apple 日历的日程，错误日期');
 expect('configuration questions, quotes and out-of-range queries never invoke EventKit',(await reads()).length===n);
 await osState('full','full');
 expect('Reminders can be connected without altering Calendar',(await api(path+'/reminders/authorize','POST',{})).status===200&&(await api(path+'/status')).data.calendar.read);
 const reminder=await send('请列出 Apple 提醒事项');
 expect('Reminders result preserves undated incomplete items',reminder.data.assistantMessage?.content==='APPLE_FIXTURE_RESULT'&&lastTool.includes('"due":null')&&lastTool.includes('fixture_eventkit'));
 const after=(await reads()).length;
 const background=S.beginRun('ideas_refresh','合成后台任务');
 let denied=false;try{await executeApplicationAction(background.id,'请列出 Apple 提醒事项',{action:'apple_reminders',input:{}},true)}catch(e){denied=e.status===403}
 expect('background Agent cannot read Apple data',denied&&(await reads()).length===after);
 expect('disconnect only stops the selected app',(await api('/api/connections/apple-calendar-local/disconnect','POST',{})).status===200&&(await api(path+'/status')).data.reminders.read);
 await send('请查看 Apple 日历明天的日程');
 expect('disconnect stops later Calendar reads',(await reads()).length===after);
 await osState('full','denied');
 const revoked=(await api(path+'/status')).data;
 expect('system revocation changes only the matching connection',revoked.reminders.status==='reauth'&&!revoked.reminders.read&&revoked.calendar.status==='disconnected');
}finally{
 await writeFile(resolve(out,'apple-eventkit-chat-http.json'),JSON.stringify({url,checks,scope:'production Chat SDK with controlled native executable fixture'},null,2));
 await Promise.all([server,model].map(x=>new Promise(r=>x.close(r))));
}
console.log(JSON.stringify({checks:checks.length}));
