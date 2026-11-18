// Production HTTP + SDK + SQLite, synthetic people and messages only.
// Failure cases precede implementation in docs/public/analysis-identity-and-time.md.
// Run: node --import tsx scripts/analysis-identity-time-http-e2e.mjs
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
const root=resolve('.local/acceptance/identity-time-'+randomUUID()),out=resolve('output/analysis-identity-time');
await mkdir(root+'/wiki/team',{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:root,OPSTWIN_PRIVATE_DIR:root,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46862',OPSTWIN_WEB_PORT:'46862',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
await writeFile(root+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46863/v1',apiKey:'fixture-only',api:'openai-completions',model:'fixture'}}));
await writeFile(root+'/wiki/TEMPLATE.md','## 基本信息');
const profile=(name,relationship)=>`# ${name}\n\n> 资料更新时间：2026-07-24\n\n## 基本信息\n\n| 中文名 | ${name} | 已确认 |\n| 当前角色 | 公开项目负责人 | 已确认 |\n| 与 Steve 的关系 | ${relationship} | 已确认 |\n\n## 人工记录\n\n保留原有 Markdown。`;
await writeFile(root+'/wiki/team/甲同事.md',profile('甲同事','高管协作者；不推断上下级'));
await writeFile(root+'/wiki/team/乙同事.md',profile('乙同事','直属管理关注对象'));
await writeFile(root+'/wiki/team/许茂林.md',profile('许茂林','本人'));
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'许茂林',role:'管理者',markdown:'# 许茂林（Steve）\n本人负责决策与验收。'},autonomy:{holdSending:true,alerts:'every'}});
S.put('connections',{id:'fixture',status:'connected',permissions:['read']});
S.put('conversations',{id:'primary',title:'公开验收'});S.setMeta('primaryConversationId','primary');
const enabled=new Date(Date.now()-6*3600000).toISOString();S.setMeta('ideas-chat-v1',{enabledAt:enabled,alerts:{},ideas:{},withdrawn:{},withdrawnAt:{}});
const at=(hours=0)=>new Date(Date.now()-hours*3600000).toISOString();
const msg=(id,body,isMine,hours=1,extra={})=>({id,text:body,isMine,senderName:isMine?'许茂林':'甲同事',senderId:isMine?'self':'other',sentAt:at(hours),...extra});
let mode='fresh',lastInput,calls=0;
const model=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);calls++;
 const text=request.messages.map(m=>typeof m.content==='string'?m.content:(m.content||[]).map(c=>c.text||'').join('')).find(t=>t.includes('资料 JSON：\n'));
 lastInput=JSON.parse(text.split('资料 JSON：\n').at(-1));
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(!request.messages.some(m=>m.role==='tool')){if(mode==='drift-before-research')S.put('inbox',{...S.get('inbox','conversation'),messages:[msg('replacement','公开来源已经更新。',false)]});chunk({role:'assistant',tool_calls:[{index:0,id:'research',type:'function',function:{name:'search_idea_sources',arguments:JSON.stringify({query:'公开'})}}]});chunk({},'tool_calls');}
 else{
  const source=lastInput.sources.find(s=>s.id==='conversation'),m=source.messages[0];
  const evidence=[{sourceId:source.id,quote:m.body,...(mode==='ambiguous'?{}:{messageId:m.id})}];
  const person=lastInput.analysisContext.people.find(p=>p.name==='甲同事');
  const existing=lastInput.existingIdeas.find(i=>i.topicKey==='unused'||i.title==='公开事项');
  const result={ideas:[{title:'公开事项',description:'请判断本次明确提出的方案选择。',topicKey:'公开事项',category:'insight',intent:mode==='delegation'?'delegation':'owner_request',sourceIds:[source.id],...(existing?{existingId:existing.id}:{}),evidence}],retire:[],personUpdates:mode==='delegation'||mode==='progress'?[{personId:person.id,kind:mode==='progress'?'progress':'delegation',summary:mode==='progress'?'甲同事报告了进展，尚未核验完成。':'你交办甲同事处理公开方案；执行责任在甲同事。',evidence}]:[]};
  if(mode==='progress')result.ideas=[];
  if(mode==='person-forged'){result.ideas=[];result.personUpdates=[{personId:lastInput.analysisContext.people.find(p=>p.name==='乙同事').id,kind:'progress',summary:'伪造人物归属',evidence}];}
  if(mode==='profile-drift')await writeFile(root+'/wiki/team/甲同事.md',profile('甲同事','同级协作者，已修订'));
  if(mode==='identity-drift')S.patchSettings({identity:{role:'已修订身份'}});
  if(mode==='revoke')S.put('connections',{id:'fixture',status:'disconnected',permissions:[]});
  chunk({role:'assistant',content:JSON.stringify(result)});chunk({},'stop');
 }
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>model.listen(46863,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts'),B=await import('../server/src/ideas-background.ts'),C=await import('../server/src/ideas-chat.ts');
const api=serve({fetch:app.fetch,port:46862,hostname:'127.0.0.1'}),checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const request=async(path,body,method=body?'POST':'GET')=>{const r=await fetch('http://127.0.0.1:46862'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()}};
const seed=messages=>S.put('inbox',{id:'conversation',title:'公开会话（乙同事也在名册中）',channel:'Email',origin:'human',connectionId:'fixture',status:'pending',messages});
const refresh=()=>request('/api/ideas/refresh',{prompt:'根据当前资料核对身份、责任和时间，记录人物进展。'});
try{
 const paths=await request('/api/settings/knowledge-paths');check('configure existing private Wiki through versioned HTTP',(await request('/api/settings/knowledge-paths',{version:paths.data.version,paths:[{id:'people-wiki',path:root+'/wiki'}]},'PATCH')).status===200);
 mode='delegation';seed([msg('assign','甲同事，请你把公开方案跑完给我验收。',true)]);
 const delegated=await refresh();check('owner delegation is analyzed successfully',delegated.status===200);check('delegation stays an observation without owner task',S.list('ideas').length===1&&S.list('ideas')[0].intent==='delegation'&&!S.list('tasks').length);
 check('owner name aliases and Markdown reach dedicated analysis',lastInput.analysisContext.owner.name==='许茂林'&&lastInput.analysisContext.owner.aliases.includes('Steve')&&lastInput.analysisContext.owner.markdown.includes('本人'));
 check('distinct role Markdown and review dates reach analysis',lastInput.analysisContext.people.some(p=>p.name==='甲同事'&&p.relationship.includes('高管')&&p.reviewedAt==='2026-07-24')&&lastInput.analysisContext.people.some(p=>p.name==='乙同事'&&p.relationship.includes('直属')));
 check('actor and message timestamp survive source serialization',lastInput.sources[0].messages[0].actor==='owner'&&!!lastInput.sources[0].messages[0].sentAt);
 let tracked=S.list('memories').find(m=>m.kind==='person_tracking');check('delegation recorded in readable persistent Markdown',tracked?.body.includes('甲同事处理')&&tracked.observations.length===1);
 await refresh();check('repeated observation is idempotent',S.get('memories',tracked.id).observations.length===1);
 check('original person Wiki unchanged',(await readFile(root+'/wiki/team/甲同事.md','utf8'))===profile('甲同事','高管协作者；不推断上下级'));
 const edited='人工补充：验收由我负责。\n\n'+S.get('memories',tracked.id).body;
 check('manual tracking note can be saved',(await request('/api/memories/'+tracked.id,{body:edited},'PATCH')).status===200);
 mode='progress';seed([msg('progress','甲同事：公开方案已提交候选，等待验收。',false)]);check('new progress succeeds',(await refresh()).status===200);
 tracked=S.get('memories',tracked.id);check('tracking appends while preserving manual notes and history',tracked.body.startsWith('人工补充')&&tracked.observations.length===2&&S.list('person_tracking_history').length===1);
 S.db.prepare("DELETE FROM entities WHERE type='ideas'").run();
 mode='fresh';seed([msg('old','公开故障请排查证书。',false,72),msg('resolved','好了，公开故障已经恢复。',false,71),msg('noise','公开计费规则另外讨论。',false,.2)]);
 check('old incident can be processed without becoming a new alert',(await refresh()).status===200&&!S.list('ideas').length);C.syncIdeasChat();check('unrelated recent message cannot rejuvenate old quote',!S.list('messages').length);
 mode='fresh';seed([msg('new','公开方案需要你决定选择 A 还是 B。',false)]);const fresh=await refresh();check('fresh incoming owner request creates one Idea',fresh.status===200&&S.list('ideas').length===1);
 C.syncIdeasChat();check('fresh exact-message evidence produces one reminder',S.list('messages').length===1);const reminder=S.list('messages')[0];
 check('reminder preserves exact evidence message ID',reminder.ideaAnalysis.evidence[0].messageId==='new');C.syncIdeasChat();check('resync does not duplicate reminder',S.list('messages').length===1);
 const savedSource=S.get('inbox','conversation');seed([msg('new','公开方案需要你决定选择 A 还是 B。',false,72),msg('noise2','公开无关聊天',false,.1)]);C.syncIdeasChat();check('historical reminder withdrawn with original retained',!S.list('messages').length&&S.get('messages',reminder.id,true));
 mode='fresh';seed([msg('unknown-time','公开方案需要你决定。',false,1,{sentAt:'2026-11-06 09:00:00'})]);const before=S.list('idea_history').length;await refresh();check('timezone-free time does not refresh existing Idea',S.list('idea_history').length===before);
 seed([msg('future','公开方案需要你决定。',false,-24)]);await refresh();check('future timestamp cannot create fresh evidence',S.list('idea_history').length===before);
 mode='fresh';seed([msg('own-invalid','甲同事，请你处理公开方案。',true)]);check('model cannot label owner message as incoming request',(await refresh()).data.error==='invalid_responsibility');
 seed([msg('namesake','公开方案需要你决定。',false,1,{senderName:'许茂林'})]);check('verified external same-name sender is not owner',(await refresh()).status===200&&lastInput.sources.find(s=>s.id==='conversation').messages[0].actor==='other');
 mode='ambiguous';seed([msg('one','公开方案需要你决定。',false),msg('two','公开方案需要你决定。',true)]);check('duplicate quote without message ID rejected',(await refresh()).data.error==='ambiguous_message_evidence');
 mode='person-forged';seed([msg('person-one','公开方案是甲同事报告的进展。',false)]);check('person update cannot attribute another person evidence',(await refresh()).data.error==='unbound_person_evidence');
 mode='drift-before-research';const callsBefore=calls;check('source drift on first search aborts instead of retrying forever',(await refresh()).data.error==='sources_changed'&&calls-callsBefore===1);
 mode='profile-drift';seed([msg('profile','公开方案需要你决定。',false)]);check('person Wiki drift rejects late model result',(await refresh()).data.error==='analysis_context_changed');
 mode='identity-drift';check('owner identity drift rejects late model result',(await refresh()).data.error==='analysis_context_changed');
 mode='revoke';check('source revocation rejects result',(await refresh()).data.error==='sources_changed');
 check('tracking excluded from source feedback loop',!B.sources().some(s=>s.id===tracked.id));
 check('no task writes or outbound records',!S.list('tasks').length&&!S.list('send_intents').length&&S.meta('primaryConversationId')==='primary');
 // Independent SQLite connection proves records are durable, not a process cache.
 const {DatabaseSync}=await import('node:sqlite');const readback=new DatabaseSync(root+'/opstwin-advance.db',{readOnly:true});
 const row=readback.prepare("SELECT data FROM entities WHERE type='memories' AND id=?").get(tracked.id);readback.close();check('Markdown tracking survives independent database read',JSON.parse(row.data).observations.length===2);
}catch(error){checks.push({name:String(error),pass:false});process.exitCode=1}
const files=['server/src/analysis-context.ts','server/src/people-context.ts','server/src/ideas-background.ts','server/src/ideas-chat.ts','server/src/store.ts','server/src/inbox-triage.ts'];
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
await writeFile(out+'/http.json',JSON.stringify({scope:'isolated production HTTP/SDK/SQLite, controlled model, synthetic sources',checks,calls,hashes},null,2));console.log(JSON.stringify({checks,calls}));api.close();model.close();
