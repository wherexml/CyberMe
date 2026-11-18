// Failure cases recorded before implementation: output/insight-recovery-20261107/FAILURE-CASES.md.
// Production HTTP/SDK/SQLite with controlled model and synthetic data; no external actions.
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
const root=resolve('.local/acceptance/insight-recovery-'+randomUUID()),out=resolve('output/insight-recovery-20261107');
await mkdir(root,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:root,OPSTWIN_PRIVATE_DIR:root,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46876',OPSTWIN_WEB_PORT:'46876',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
await writeFile(root+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46877/v1',apiKey:'fixture-only',api:'openai-completions',model:'fixture'}}));
const cli=root+'/lark.mjs',docTime=String(Date.now()-3600000);
await writeFile(cli,`#!${process.execPath}
const a=process.argv.slice(2);if(a[0]==='auth'){console.log(JSON.stringify({identity:'user',verified:true,identities:{user:{status:'ready',tokenStatus:'valid',openId:'public-owner',userName:'许茂林'}}}));process.exit(0)}
let data={};if(a[1]==='+chat-list')data={items:[{chat_id:'public-assistant',name:'智能纪要助手'}]};
if(a[1]==='+chat-messages-list')data={items:[{message_id:'public-note',body:{content:'https://example.feishu.cn/docx/PublicMeeting'}}]};
if(a[1]==='+fetch')data={content:'会议主题：公开同步会议\\n会议时间：'+new Date(Number(${JSON.stringify(docTime)})+8*3600000).toISOString().slice(0,16).replace(/^(\\d{4})-(\\d{2})-(\\d{2})T/,'$1年$2月$3日 ')+' - 23:59\\n# 总结\\n公开会议确认试点先覆盖单一场景。'};
console.log(JSON.stringify({ok:true,data}));`,{mode:0o700});process.env.OPSTWIN_LARK_CLI=cli;
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'许茂林'},autonomy:{holdSending:true,alerts:'every'}});
S.put('connections',{id:'feishu-local',provider:'Feishu',status:'connected',permissions:['read']});S.put('conversations',{id:'primary',title:'公开验收'});S.setMeta('primaryConversationId','primary');S.setMeta('ideas-chat-v1',{enabledAt:new Date(Date.now()-6*3600000).toISOString(),alerts:{},ideas:{},withdrawn:{},withdrawnAt:{}});
const at=h=>new Date(Date.now()-h*3600000).toISOString();
for(const [id,time,extra] of [['meeting',at(1),{}],['unknown','',{}],['edited',at(2),{content:'人工正文保留',sourceContentHash:'old-hash'}],['existing',at(5),{eventAt:at(3)}]]){
 S.put('feishu_records',{id:'minutes:'+id,kind:'minutes',sourceId:id,payload:{createdAt:time?String(Date.parse(time)):'',markdown:'公开会议决定缩小试点，先验证单一场景。'}});
 S.put('memories',{id:'feishu-minute-'+id,title:'公开会议',content:'公开会议决定缩小试点，先验证单一场景。',category:'meeting',sourceManaged:true,sourceSystem:'feishu-cli',sourceId:id,...extra});
}
let mode='meeting',lastInput,repairCount=0,calls=0;
const model=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const r=JSON.parse(raw);calls++;
 const content=m=>typeof m.content==='string'?m.content:(m.content||[]).map(c=>c.text||'').join('');const text=r.messages.map(content).find(t=>t.includes('资料 JSON：\n'));lastInput=JSON.parse(text.split('资料 JSON：\n').at(-1));
 const repair=r.messages.some(m=>content(m).includes('修正输出：'));if(repair)repairCount++;
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');res.writeHead(200,{'content-type':'text/event-stream'});
 if(!r.messages.some(m=>m.role==='tool')){chunk({role:'assistant',tool_calls:[{index:0,id:'research',type:'function',function:{name:'search_idea_sources',arguments:'{"query":"公开"}'}}]});chunk({},'tool_calls');}
 else {
 const src=lastInput.sources.find(s=>s.id===(mode==='meeting'?'feishu-minute-meeting':'conversation')),m=src.messages?.at(-1);let evidence=m?{sourceId:src.id,quote:m.body,evidenceRef:m.evidenceRef}:{sourceId:src.id,quote:src.body};
 if(mode==='ambiguous')evidence={sourceId:src.id,quote:m.body};
 if(mode==='forged')evidence={sourceId:src.id,quote:'这句话从未出现在任何来源中',evidenceRef:m.evidenceRef};
 if(mode==='wrong-id'&&(!repair||!r.messages.some(m=>content(m).includes('ideas[0].evidence[0]')&&content(m).includes('message_not_found')&&content(m).includes(src.messages.at(-1).evidenceRef))))evidence={sourceId:src.id,quote:m.body,messageId:'wrong-long-id'};
 if(mode==='cross-ref')evidence={sourceId:'feishu-minute-meeting',quote:m.body,evidenceRef:m.evidenceRef};
 if(mode==='drift'&&repair)S.put('inbox',{...S.get('inbox','conversation'),messages:[{id:'changed',text:'公开资料改变',sentAt:at(0),isMine:false}]});
 if(mode==='drift'&&!repair)evidence={sourceId:src.id,quote:m.body,messageId:'wrong-long-id'};
 const intent=['delegation','delegation-progress'].includes(mode)?'delegation':['meeting','information'].includes(mode)?'information':'owner_request';
 const payload={ideas:[{title:'公开观察 '+mode,description:'试点范围缩小有助于尽早验证关键假设，负责人继续执行。',topicKey:'public-'+mode,category:'insight',intent,sourceIds:[src.id],evidence:mode==='delegation-progress'?[evidence,{sourceId:src.id,quote:src.messages[0].body,evidenceRef:src.messages[0].evidenceRef}]:[evidence],recommendationLabel:'分析变化影响',recommendationPrompt:'分析这次变化对试点的影响，不创建任务。'}],retire:[],personUpdates:[]};
 if(mode==='multi-invalid'&&(!repair||!r.messages.some(m=>content(m).includes('ideas[0].sourceIds')&&content(m).includes('ideas[1].evidence[0]')))){payload.ideas=[{...payload.ideas[0],sourceIds:['missing-source']},{...payload.ideas[0],title:'第二个公开观察',topicKey:'public-second',evidence:[{sourceId:src.id,quote:'这句话并不在消息中',evidenceRef:m.evidenceRef}]}]}
 chunk({role:'assistant',content:JSON.stringify(payload)});chunk({},'stop');}
 res.end('data: [DONE]\n\n');});await new Promise(r=>model.listen(46877,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts'),B=await import('../server/src/ideas-background.ts'),C=await import('../server/src/ideas-chat.ts'),F=await import('../server/src/feishu-sync-data.ts');
const api=serve({fetch:app.fetch,port:46876,hostname:'127.0.0.1'}),checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const request=async(path,body)=>{const r=await fetch('http://127.0.0.1:46876'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()}};
const refresh=()=>request('/api/ideas/refresh',{prompt:'读取公开资料，记录值得注意的变化；区分洞察与本人待办。'});
const seed=(extra={})=>S.put('inbox',{id:'conversation',title:'公开聊天',channel:'Email',origin:'human',status:'pending',messages:[{id:'long-message-one',text:'公开方案需要你选择A还是B。',sentAt:at(2),isMine:true},{id:'long-message-two',text:'公开方案需要你选择A还是B。',sentAt:at(1),isMine:false}],...extra});
try{
 check('startup backfills precise meeting time',S.get('memories','feishu-minute-meeting').eventAt===B.sources().find(s=>s.id==='feishu-minute-meeting').eventAt&&!!S.get('memories','feishu-minute-meeting').eventAt);
 check('unknown meeting time remains unknown',!S.get('memories','feishu-minute-unknown').eventAt);
 check('manual content and existing event time preserved',S.get('memories','feishu-minute-edited').content==='人工正文保留'&&Date.parse(S.get('memories','feishu-minute-existing').eventAt)>Date.now()-4*3600000);
 const before=S.get('memories','feishu-minute-meeting').updatedAt;F.backfillMeetingTimes();check('backfill idempotent',S.get('memories','feishu-minute-meeting').updatedAt===before);
 const fp=B.sources().find(s=>s.id==='feishu-minute-meeting').fingerprint;S.put('memories',{...S.get('memories','feishu-minute-meeting'),eventAt:at(.5)});check('event time participates in fingerprint',B.sources().find(s=>s.id==='feishu-minute-meeting').fingerprint!==fp);
 check('meeting information creates visible insight',(await refresh()).status===200&&S.list('ideas').some(i=>i.intent==='information'&&i.occurredAt));check('flat model recommendation maps to existing display contract',S.list('ideas')[0].recommendation?.label==='分析变化影响');C.syncIdeasChat();check('meeting insight can be read in chat without creating a task',!S.list('tasks').length&&S.list('messages').some(m=>S.get('ideas',m.ideaAnalysis?.ideaId)?.intent==='information'));
 mode='information';seed({status:'dismissed'});check('closed conversation can still support independent information insight',(await refresh()).status===200&&S.list('ideas').some(i=>i.title.endsWith('information')));
 const A=await import('../shared/inbox-attention.ts');check('resolved Inbox does not hide information insight',!A.ideaSourcesClosed(S.list('ideas').find(i=>i.intent==='information'),S.list('inbox')));
 mode='delegation';seed({messages:[{id:'assign',text:'公开方案由甲同事执行，请你完成试点。',sentAt:at(1),isMine:true}]});check('delegation retained as insight',(await refresh()).status===200&&S.list('ideas').some(i=>i.intent==='delegation'));C.syncIdeasChat();check('delegation can be read in chat without becoming an owner task',!S.list('tasks').length&&S.list('messages').some(m=>S.get('ideas',m.ideaAnalysis?.ideaId)?.intent==='delegation'));
 mode='delegation-progress';seed({messages:[{id:'owner-assign',text:'公开试点请甲同事负责完成。',sentAt:at(2),isMine:true},{id:'other-progress',text:'公开试点由我负责，周五交付。',sentAt:at(1),isMine:false}]});check('delegation may lead with newer progress backed by owner assignment',(await refresh()).status===200&&S.list('ideas').some(i=>i.title.endsWith('delegation-progress')));
 mode='reference';seed();check('short evidence reference disambiguates identical messages',(await refresh()).status===200&&S.list('ideas').find(i=>i.title.endsWith('reference'))?.evidence[0].messageId==='long-message-two');C.syncIdeasChat();check('owner request still eligible for reminder',S.list('messages').some(m=>S.get('ideas',m.ideaAnalysis?.ideaId)?.intent==='owner_request'));
 mode='wrong-id';check('wrong long ID repaired with exact reference',(await refresh()).status===200&&repairCount>0&&S.list('ideas').find(i=>i.title.endsWith('wrong-id'))?.evidence[0].messageId==='long-message-two');
 mode='multi-invalid';check('one repair receives all invalid idea paths',(await refresh()).status===200);
 mode='ambiguous';check('unbound duplicate quote still rejected',(await refresh()).data.error==='ambiguous_message_evidence');
 mode='forged';check('forged quote rejected despite valid reference',(await refresh()).data.error==='invalid_evidence');
 mode='cross-ref';check('cross-source reference rejected',(await refresh()).data.error==='invalid_evidence');
 mode='drift';check('source drift during repair rejects result',(await refresh()).data.error==='sources_changed');
 mode='reference';seed();const idea=S.list('ideas').find(i=>i.title.endsWith('reference'));S.put('ideas',{...idea,status:'dismissed'});await refresh();check('dismissed insight does not revive',S.get('ideas',idea.id).status==='dismissed');
 const started=await request('/api/feishu/sync',{scope:'minutes'});let synced;
 for(let n=0;n<100;n++){synced=(await request('/api/feishu/sync')).data.history.items.find(r=>r.id===started.data.runId);if(synced&&synced.status!=='running')break;await new Promise(r=>setTimeout(r,30))}
 check('typed CLI meeting sync stores event time',synced?.counts?.minutes===1&&!!S.get('memories','feishu-minute-PublicMeeting')?.eventAt);
 const stored=S.get('memories','feishu-minute-PublicMeeting');delete stored.eventAt;S.put('memories',stored);
 const again=await request('/api/feishu/sync',{scope:'minutes'});for(let n=0;n<100;n++){const r=(await request('/api/feishu/sync')).data.history.items.find(r=>r.id===again.data.runId);if(r&&r.status!=='running')break;await new Promise(r=>setTimeout(r,30))}
 check('unchanged document sync still repairs missing event time',!!S.get('memories','feishu-minute-PublicMeeting')?.eventAt);
 check('all analysis remains read-only with no business task writes',!S.list('tasks').length&&S.list('runs').filter(r=>r.kind==='ideas_refresh').every(r=>r.readOnly));
 const {DatabaseSync}=await import('node:sqlite');const d=new DatabaseSync(root+'/opstwin-advance.db',{readOnly:true});check('meeting time durable on independent SQLite read',!!JSON.parse(d.prepare("SELECT data FROM entities WHERE type='memories' AND id='feishu-minute-meeting'").get().data).eventAt);d.close();
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}
const files=['server/src/feishu-sync-data.ts','server/src/ideas-background.ts','server/src/ideas-chat.ts','server/src/agent.ts','shared/inbox-attention.ts'];
await writeFile(out+'/http.json',JSON.stringify({checks,calls,repairCount,hashes:Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),url:'http://127.0.0.1:46876/api/ideas/refresh'},null,2));console.log(JSON.stringify({checks,calls,repairCount}));api.close();model.close();
