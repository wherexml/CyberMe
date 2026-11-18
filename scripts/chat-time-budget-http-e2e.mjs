// Chat time budgets + per-source mentions-only rules: real API child process + SQLite + a controlled
// OpenAI-compatible provider. Failure cases: docs/public/chat-time-budgets.md (recorded first).
// Synthetic data only; isolated ports 46981 (API) / 46982 (provider). No real model, no external sends.
//   node scripts/chat-time-budget-http-e2e.mjs
// Evidence: .local/acceptance/chat-time-budget-<uuid>/result.json (private, not for Git).
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const scope=resolve('.local/acceptance/chat-time-budget-'+randomUUID());await mkdir(scope,{recursive:true,mode:0o700});
const port=46981,modelPort=46982,base=`http://127.0.0.1:${port}`;
const PREPARE_MS=5000,ANSWER_MS=4000;
const checks=[];const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(pass?{}:{detail})});console.log((pass?'PASS ':'FAIL ')+name+(pass?'':' '+JSON.stringify(detail??null).slice(0,400)));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
{const seed=new DatabaseSync(scope+'/opstwin-advance.db');seed.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');seed.close();}
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-budget-model'}}),{mode:0o600});

// ---------- controlled provider ----------
// compaction: 'fail' (500, context stays large), or a delay in ms before a summary.
const ctl={compaction:'fail',ruleCall:undefined,discovery:{},capRefresh:{}};
const CAP_MARK='当前能力（服务端版本';
const textOf=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.map(p=>p.text||'').join(''):'';
const seen=[];
const provider=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);
 const messages=input.messages||[],afterTool=messages.at(-1)?.role==='tool',tools=(input.tools||[]).map(t=>t.function?.name).filter(Boolean),summarization=!tools.length;
 const lastUser=textOf([...messages].reverse().find(m=>m.role==='user'));
 const entry={at:Date.now(),summarization,afterTool,lastUser:lastUser.slice(-200),closed:false,toolResults:messages.filter(m=>m.role==='tool').map(textOf),capCount:messages.filter(m=>textOf(m).includes(CAP_MARK)).length};seen.push(entry);
 let closed=false;res.on('close',()=>{closed=true;entry.closed=!res.writableEnded;});
 const hold=async ms=>{const end=Date.now()+ms;while(Date.now()<end&&!closed)await sleep(50);return !closed;};
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'b',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 const done=()=>{res.write('data: '+JSON.stringify({id:'b',object:'chat.completion.chunk',created:1,model:input.model,choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})+'\n\n');res.end('data: [DONE]\n\n');};
 const say=text=>{res.writeHead(200,{'content-type':'text/event-stream'});chunk({role:'assistant',content:text});chunk({},'stop');done();};
 const call=(name,args)=>{res.writeHead(200,{'content-type':'text/event-stream'});chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+seen.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls');done();};
 if(summarization){
  if(ctl.compaction==='fail'){res.writeHead(500,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'synthetic compaction unavailable'}}));}
  if(!await hold(ctl.compaction))return;return say('SUMMARY-MARK 保留当前话题与未完成事项。');
 }
 const has=tag=>lastUser.includes(tag);
 if(has('#hang')){await hold(600000);return;}
 if(has('#slowtool')){if(!await hold(1500))return;if(!afterTool)return call('list_entities',{resource:'tasks',limit:1});return say('ANSWER slow tool done');}
 // #discover: ordinary discovery first; every argument comes from real tool results of THIS turn.
 if(has('#discover')){
  const lastUserIdx=messages.findLastIndex(m=>m.role==='user'&&textOf(m).includes('#discover'));
  const results=messages.slice(lastUserIdx+1).filter(m=>m.role==='tool').map(textOf);
  const json=t=>{try{return JSON.parse(t)}catch{const i=t.indexOf('{');try{return i>=0?JSON.parse(t.slice(i)):undefined}catch{return undefined}}};
  const d=ctl.discovery;const name=d.query;
  if(results.length===0)return call('get_app_capabilities',{});
  if(results.length===1){const cat=json(results[0]);d.catalogModes=Object.keys(cat?.inboxSourceRules?.supportedModes||{});d.catalogWriteTool=cat?.inboxSourceRules?.write?.tool;d.catalogAppAction=cat?.inboxSourceRules?.write?.appAction;d.catalogReadAction=(cat?.actions||[]).some(a=>a.name==='inbox_source_rules_read'&&a.effect==='read');
   if(!d.catalogModes.includes('mentions')||!d.catalogReadAction)return say('UNSUPPORTED 目录未提供仅@我模式');
   return call('app_read',{action:'inbox_source_rules_read',input:{query:name}});}
  if(results.length===2){const read=json(results[1]),list=read?.sources||[];const exact=list.filter(x=>x.name===name);d.readModes=list.map(x=>x.mode);const pick=exact.length===1?exact[0]:undefined;d.sourceKey=pick?.id;
   if(!pick)return say('AMBIGUOUS');
   return call(d.writeTool||d.catalogWriteTool,{sourceKey:pick.id,query:name,mode:'mentions',evidence:d.evidence});}
  return say('RULE '+results.at(-1).slice(0,300));
 }
 // #claim leaves an outdated assistant capability claim in the durable session (pre-upgrade behaviour).
 if(has('#claim'))return say('UNSUPPORTED-CLAIM 只支持排除或恢复关注，不支持只看@我。');
 // #caprefresh: only proceed if the current capability message is present after the old claim and before
 // the current input; then real tool results drive the rule write.
 if(has('#caprefresh')){
  const cr=ctl.capRefresh,userIdx=messages.findLastIndex(m=>m.role==='user'&&textOf(m).includes('#caprefresh'));
  const results=messages.slice(userIdx+1).filter(m=>m.role==='tool').map(textOf);
  const json=t=>{try{return JSON.parse(t)}catch{const i=t.search(/[\[{]/);try{return i>=0?JSON.parse(t.slice(i)):undefined}catch{return undefined}}};
  if(results.length===0){
   const caps=messages.map((m,i)=>({i,t:textOf(m)})).filter(x=>x.t.includes(CAP_MARK)),claimIdx=messages.findLastIndex(m=>m.role==='assistant'&&textOf(m).includes('UNSUPPORTED-CLAIM'));
   const last=caps.at(-1);Object.assign(cr,{capCount:caps.length,claimSeen:claimIdx>=0,capAfterClaim:!!last&&claimIdx>=0&&last.i>claimIdx,capBeforeInput:!!last&&last.i<userIdx,version:(last?.t.match(/服务端版本 ([^；]+)/)||[])[1],hasMentions:!!last?.t.includes('"mentions"'),listsWriteTool:!!last?.t.includes('"set_inbox_source_rule"')});
   if(!cr.hasMentions||!cr.listsWriteTool)return say('UNSUPPORTED-CLAIM 仍然只支持排除或恢复。');
   return call('list_inbox_sources',{query:cr.query});
  }
  if(results.length===1){const r=json(results[0]),list=Array.isArray(r)?r:r?.sources||r?.items||[];const exact=list.filter(x=>x.name===cr.query);cr.sourceKey=exact.length===1?exact[0].id:undefined;
   if(!cr.sourceKey)return say('AMBIGUOUS');
   return call('set_inbox_source_rule',{sourceKey:cr.sourceKey,query:cr.query,mode:'mentions',evidence:cr.evidence});}
  return say('RULE '+results.at(-1).slice(0,300));
 }
 if(has('#rule')&&!afterTool&&ctl.ruleCall)return call('set_inbox_source_rule',ctl.ruleCall);
 if(has('#rule')&&afterTool)return say('RULE '+(entry.toolResults.at(-1)||'').slice(0,300));
 say('ANSWER ok');
});
await new Promise(r=>provider.listen(modelPort,'127.0.0.1',r));

// ---------- API child ----------
let child;
async function start(extra={}){
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:resolve('.'),stdio:['ignore','ignore','ignore'],env:{...process.env,OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_LISTEN:'0',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',CYBERME_AGENT_SESSION_COMPACT_RATIO:'0',CYBERME_CHAT_PREPARE_BUDGET_MS:String(PREPARE_MS),CYBERME_CHAT_ANSWER_BUDGET_MS:String(ANSWER_MS),...extra}});
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await sleep(100)}throw Error('API did not start');
}
async function stop(){child.kill('SIGTERM');for(let i=0;i<80&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);}
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});return {status:r.status,data:await r.json().catch(()=>({}))};};
const chat=(conversationId,message,extra={})=>api('POST','/api/chat',{conversationId,message,requestId:extra.requestId||randomUUID(),...extra});
const run=async id=>(await api('GET','/api/runs/'+id)).data;
const request=async id=>(await api('GET','/api/chat/requests/'+id)).data;
const runOf=r=>r.data?.run||r.data?.detail?.run||r.data?.error?.detail?.run;
const tool=(r,name)=>(r?.tools||[]).filter(t=>t.name===name).at(-1);
const conv=async title=>(await api('POST','/api/conversations',{title,mode:'chat',status:'active'})).data.id;
// Long synthetic history so SDK compaction has real content to summarize (> Pi keepRecentTokens).
const filler=n=>Array.from({length:n},(_,i)=>`公开合成段落${i}：项目 Alpha 的验收清单需要逐项核对，负责人为公开示例甲。`).join('');
async function longSession(title){const id=await conv(title);ctl.compaction='fail';for(let i=0;i<3;i++){const r=await chat(id,`SEED-${i} ${filler(900)}`);if(r.status!==200)throw Error('seed failed '+r.status+JSON.stringify(r.data).slice(0,300));}return id;}

const result={scope,startedAt:new Date().toISOString()};
try{
 await start();

 // ---------- R1. transport envelope covers both phases (no client/proxy ends a valid run first) ----------
 {const {readFile}=await import('node:fs/promises');const src=async f=>readFile(resolve(f),'utf8');
  const shared=await src('shared/chat-budgets.ts'),n=k=>Number((shared.match(new RegExp(k+'=(\\d+)'))||[])[1]);
  const envelope=n('CHAT_PREPARE_BUDGET_MS')+n('CHAT_DEEP_ANSWER_BUDGET_MS')+n('CHAT_ENVELOPE_OVERHEAD_MS');
  const gw=await src('scripts/mygo-workspace-gateway.mjs'),proxy=await src('native/mygo/proxy.go'),bridge=await src('native/mygo/bridge.go'),web=await src('web/src/v6/store.ts');
  check('R1 envelope = prepare + deep answer + overhead and >= 300s',envelope===345000,envelope);
  check('R1 web POST /api/chat uses the shared envelope',web.includes("AbortSignal.timeout(CHAT_TRANSPORT_TIMEOUT_MS)")&&!/'\/api\/chat',body,AbortSignal\.timeout\(180000\)/.test(web));
  check('R1 gateway uses 345s for POST /api/chat',gw.includes('CHAT_TRANSPORT_TIMEOUT_MS=345000')&&gw.includes("u.pathname==='/api/chat'?CHAT_TRANSPORT_TIMEOUT_MS"));
  check('R1 native proxy and bridge use requestTimeout (345s for chat)',proxy.includes('return 345 * time.Second')&&proxy.includes('Timeout: requestTimeout(r.Method, r.URL.Path)')&&bridge.includes('Timeout: requestTimeout(method, route)'));}
 // Server clamps oversized env budgets to the envelope maxima (HTTP-observable through run.timeBudget).
 {const c0=await conv('预算上限');const r0=await chat(c0,'R1 ok');const tb=(runOf(r0)||{}).timeBudget||{};
  check('R1 run budgets within envelope maxima',tb.prepare?.budgetMs<=150000&&tb.answer?.budgetMs<=150000,tb);}

 // ---------- A1. slow compaction followed by a full answer/tool budget ----------
 const c1=await longSession('慢压缩后完整回答');
 ctl.compaction=2500;const from1=seen.length,t0=Date.now();
 const a1=await chat(c1,'A1 #slowtool 继续处理验收清单');
 const r1=runOf(a1)||await run(a1.data?.run?.id);
 check('A1 slow compaction then tool loop succeeds although total exceeds the old shared budget',a1.status===200&&Date.now()-t0>ANSWER_MS,{status:a1.status,ms:Date.now()-t0,data:a1.data?.error});
 const b1=r1?.timeBudget||{};
 check('A1 preparation budget recorded the compaction time',b1.prepare?.status==='completed'&&b1.prepare.elapsedMs>=2400&&b1.prepare.budgetMs===PREPARE_MS,b1);
 check('A1 answer budget is separate, full and completed',b1.answer?.status==='completed'&&b1.answer.budgetMs===ANSWER_MS&&b1.answer.elapsedMs<ANSWER_MS,b1);
 check('A1 phases do not overlap',b1.prepare?.endedAt<=b1.answer?.startedAt,b1);
 check('A1 compaction evidence succeeded with elapsedMs',tool(r1,'agent_session_compaction')?.output?.status==='succeeded'&&tool(r1,'agent_session_compaction')?.output?.elapsedMs>=2400,tool(r1,'agent_session_compaction'));
 check('A1 answer requests start after the summary',seen.slice(from1).filter(s=>!s.summarization).every(s=>s.at>=seen.slice(from1).find(x=>x.summarization)?.at),null);
 check('A1 chat_time_budget evidence states queue wait excluded',tool(r1,'chat_time_budget')?.output?.queueWaitIncluded===false,tool(r1,'chat_time_budget'));

 // ---------- A2. compaction timeout ----------
 const c2=await longSession('压缩超时');
 ctl.compaction=PREPARE_MS+4000;const from2=seen.length;
 const a2=await chat(c2,'A2 这轮不应发送给模型');
 const r2=runOf(a2)||{};
 check('A2 compaction timeout returns 504 chat_prepare_timeout (not llm_timeout)',a2.status===504&&JSON.stringify(a2.data).includes('chat_prepare_timeout'),a2.data);
 check('A2 prepare budget timed_out and no answer budget started',r2.timeBudget?.prepare?.status==='timed_out'&&!r2.timeBudget?.answer,r2.timeBudget);
 check('A2 compaction provider stream was aborted',seen.slice(from2).some(s=>s.summarization&&s.closed),seen.slice(from2).map(s=>({s:s.summarization,c:s.closed})));
 check('A2 prompt never sent to the model',!seen.slice(from2).some(s=>!s.summarization),null);
 const q2=await request(a2.data?.error?.detail?.requestId||r2.requestId);
 check('A2 durable request is failed with preparation_timeout code',q2.status==='failed'&&q2.failureCode==='preparation_timeout',q2);
 ctl.compaction='fail';
 const a2b=await chat(c2,'A2b 重试同一会话');
 check('A2 session preserved; next turn succeeds after failed compaction',a2b.status===200,a2b.data?.error);

 // ---------- A3. answer timeout ----------
 const c3=await conv('回答超时');
 const a3=await chat(c3,'A3 #hang');
 const r3=runOf(a3)||{};
 check('A3 answer timeout returns 504 llm_timeout with budget=answer',a3.status===504&&JSON.stringify(a3.data).includes('llm_timeout'),a3.data);
 check('A3 prepare completed, answer timed_out',r3.timeBudget?.prepare?.status==='completed'&&r3.timeBudget?.answer?.status==='timed_out',r3.timeBudget);

 // ---------- A4. cancellation during compaction ----------
 const c4=await longSession('压缩中停止');
 ctl.compaction=PREPARE_MS-500;const from4=seen.length;const req4=randomUUID();
 const p4=chat(c4,'A4 将被打断',{requestId:req4});await sleep(1200);
 ctl.compaction='fail';
 const a4b=await chat(c4,'A4b 新消息打断',{interruptCurrent:true});const a4=await p4;
 check('A4 interrupted turn ends as cancelled (409), not timeout',a4.status===409,a4.data);
 const q4=await request(req4);const r4=await run(q4.runId);
 check('A4 durable request cancelled; prepare budget cancelled',q4.status==='cancelled'&&r4.timeBudget?.prepare?.status==='cancelled'&&!r4.timeBudget?.answer,{q4,tb:r4.timeBudget});
 check('A4 compaction stream aborted, prompt not sent',seen.slice(from4).some(s=>s.summarization&&s.closed)&&!seen.slice(from4).some(s=>!s.summarization&&s.lastUser.includes('A4 将被打断')),null);
 check('A4 interrupting message succeeds',a4b.status===200,a4b.data?.error);

 // ---------- A5. queue wait outside both budgets ----------
 const c5=await longSession('排队');
 ctl.compaction=2500;
 const p5=chat(c5,'A5 第一条 #slowtool');await sleep(300);
 const qid=randomUUID();const q5=await chat(c5,'A5 第二条排队',{requestId:qid,queueCurrent:true});
 check('A5 queued request accepted (202)',q5.status===202,q5.data);
 const a5=await p5;ctl.compaction='fail';
 let s5;for(let i=0;i<200;i++){s5=await request(qid);if(!['queued','running'].includes(s5.status))break;await sleep(100);}
 const first=runOf(a5)||{},second=await run(s5.runId);
 check('A5 queued turn succeeds',s5.status==='succeeded',s5);
 check('A5 queued prepare budget starts after the previous run completed (queue wait excluded)',second.timeBudget?.prepare?.startedAt>=first.completedAt&&second.timeBudget.prepare.elapsedMs<PREPARE_MS,{first:first.completedAt,second:second.timeBudget});

 // ---------- A6. restart + idempotency ----------
 const c6=await conv('重启幂等');const body6={conversationId:c6,message:'A6 幂等',requestId:randomUUID()};
 const a6=await api('POST','/api/chat',body6);const before=seen.length;
 await stop();await start();
 const a6b=await api('POST','/api/chat',body6);
 check('A6 replay after restart returns same run without new model calls',a6b.status===200&&a6b.data.replayed===true&&a6b.data.run?.id===a6.data.run?.id&&seen.length===before,{a6b:a6b.data?.replayed});
 const q2b=await request(q2.requestId);
 check('A6 timed-out preparation stays failed after restart (no replay)',q2b.status==='failed'&&q2b.failureCode==='preparation_timeout',q2b);

 // ---------- B. mentions-only source rules ----------
 const SELF='ou_public_self';
 const item=async(id,title,sourceId,messages)=>(await api('POST','/api/inbox',{id,title,sender:'公开示例乙',channel:'Synthetic',sourceId,body:messages.at(-1).text,origin:'human',status:'pending',category:'群聊',selfId:SELF,messages})).status;
 const m=(id,text,meta={})=>({id,text,senderId:'ou_public_other',senderName:'公开示例乙',isMine:false,sentAt:new Date().toISOString(),...meta});
 check('B seed items',[
  await item('mx-plain','合成群Alpha','src-alpha',[m('m1','普通进展同步',{mentions:[]})]),
  await item('mx-mention','合成群Alpha','src-alpha',[m('m2','请看下',{mentions:[{id:SELF,name:'公开验收人'}]})]),
  await item('mx-false','合成群Alpha','src-alpha',[m('m3','@公开验收人 文字里像提及但元数据不是',{mentionsSelf:false})]),
  await item('mx-unknown','合成群Alpha','src-alpha',[m('m4','@公开验收人 没有元数据')]),
  await item('mx-draft','合成群Alpha','src-alpha',[m('m5','需要回复的普通消息',{mentions:[]})]),
  await item('mx-other','合成群Beta','src-beta',[m('m6','Beta 普通消息',{mentions:[]})]),
  await item('mx-dup','合成群Alpha备份','src-alpha-copy',[m('m7','备份群消息',{mentions:[]})]),
 ].every(s=>s===201||s===200));
 await api('PATCH','/api/inbox/mx-draft',{draft:'公开合成草稿'});
 const sources=(await api('GET','/api/inbox-source-rules?query=合成群Alpha')).data.sources||[];
 const alpha=sources.find(s=>s.name==='合成群Alpha'),beta=(await api('GET','/api/inbox-source-rules?query=合成群Beta')).data.sources?.[0];
 check('B sources listed with mode all by default',alpha?.mode==='all'&&alpha.excluded===false,sources);
 // Legacy HTTP shape stays valid.
 const legacy=await api('POST','/api/inbox-source-rules',{sourceKey:beta.id,excluded:true});
 check('B legacy excluded:true still writes an exclude rule',legacy.status===200&&legacy.data.rule?.mode==='exclude'&&legacy.data.rule?.active===true,legacy.data);
 const conflict=await api('POST','/api/inbox-source-rules',{sourceKey:beta.id,excluded:true,mode:'mentions'});
 check('B conflicting mode/excluded rejected',conflict.status===400,conflict.data);
 // Gates through the chat tool.
 const cR=await conv('来源规则');const ruleTry=async(msg,args)=>{ctl.ruleCall={sourceKey:alpha.id,query:'合成群Alpha',evidence:msg.replace(' #rule',''),...args};const r=await chat(cR,msg);return {r,t:tool(runOf(r)||await run(r.data?.run?.id),'set_inbox_source_rule')};};
 const neg=await ruleTry('不要只看合成群Alpha里@我的消息 #rule',{mode:'mentions'});
 check('B negated mentions request rejected',neg.t?.status==='failed',neg.t);
 const quoted=await ruleTry('请翻译这句：“合成群Alpha只看@我的消息” #rule',{mode:'mentions',evidence:'合成群Alpha只看@我的消息'});
 check('B quoted/translated request rejected',quoted.t?.status==='failed',quoted.t);
 const amb=await ruleTry('合成群只看@我的消息 #rule',{mode:'mentions',query:'合成群',evidence:'合成群只看@我的消息'});
 check('B ambiguous source name rejected',amb.t?.status==='failed'&&JSON.stringify(amb.t).includes('ambiguous'),amb.t);
 // R8: unique exact name beats longer names that contain it; duplicate exact names stay ambiguous.
 check('FIXTURE seed duplicate exact names',[await item('mx-gamma-1','合成群Gamma','src-gamma-1',[m('g1','Gamma 一',{mentions:[]})]),await item('mx-gamma-2','合成群Gamma','src-gamma-2',[m('g2','Gamma 二',{mentions:[]})])].every(x=>x===201));
 const gammas=(await api('GET','/api/inbox-source-rules?query=合成群Gamma')).data.sources||[];
 check('FIXTURE two distinct sources share the exact name',gammas.length===2&&gammas.every(g=>g.name==='合成群Gamma'),gammas);
 const dup=await ruleTry('合成群Gamma只看@我的消息 #rule',{mode:'mentions',sourceKey:gammas[0]?.id,query:'合成群Gamma',evidence:'合成群Gamma只看@我的消息'});
 check('R8 duplicate exact source names rejected as ambiguous',dup.t?.status==='failed'&&JSON.stringify(dup.t).includes('ambiguous'),dup.t);
 check('R8 partial name with several matches still ambiguous',amb.t?.status==='failed',amb.t);
 const wrongDir=await ruleTry('合成群Alpha只看@我的消息 #rule',{mode:'exclude'});
 check('B direction mismatch rejected',wrongDir.t?.status==='failed',wrongDir.t);
 const ok=await ruleTry('合成群Alpha以后只看@我的消息 #rule',{mode:'mentions'});
 check('B/R8 exact full name 合成群Alpha resolves despite 合成群Alpha备份; mentions-only writes and reads back',ok.t?.status==='succeeded'&&ok.t.output?.readback?.mode==='mentions'&&ok.t.output?.previousMode==='all',ok.t);
 const read=(await api('GET','/api/inbox-source-rules?query=合成群Alpha')).data;
 check('B HTTP readback mode=mentions, not excluded',read.sources?.find(s=>s.id===alpha.id)?.mode==='mentions'&&read.sources.find(s=>s.id===alpha.id).excluded===false,read.sources);
 const get=async id=>(await api('GET','/api/inbox/'+id)).data;
 const P=Object.fromEntries(await Promise.all(['mx-plain','mx-mention','mx-false','mx-unknown','mx-draft','mx-other','mx-dup'].map(async id=>[id,await get(id)])));
 for(const [id,d] of Object.entries(P))check('FIXTURE inbox '+id+' projection shape',d&&d.id===id&&Array.isArray(d.messages)&&d.disposition,{id,keys:Object.keys(d||{})});
 const quieted=i=>i.sourceRule?.active===true&&(i.disposition?.reasons||[]).includes('source_rule');
 check('B trusted not-mentioned item is quieted by the rule',quieted(P['mx-plain'])&&P['mx-plain'].sourceRule.reason==='mentions_only',P['mx-plain'].sourceRule);
 check('B trusted owner mention stays',!quieted(P['mx-mention'])&&P['mx-mention'].sourceRule?.mentionGate==='mentioned',P['mx-mention'].sourceRule);
 check('B false textual @ with mentionsSelf:false is not treated as mention',P['mx-false'].sourceRule?.mentionGate==='not_mentioned',P['mx-false'].sourceRule);
 check('B text-only @ without metadata stays (unknown, not guessed)',!quieted(P['mx-unknown'])&&P['mx-unknown'].sourceRule?.mentionGate==='unknown',P['mx-unknown'].sourceRule);
 check('B drafted item keeps attention',!quieted(P['mx-draft'])&&P['mx-draft'].sourceRule?.reason==='draft_kept',P['mx-draft'].sourceRule);
 check('B legacy exclude rule on another source unchanged',P['mx-other'].sourceRule?.mode==='exclude'&&P['mx-other'].sourceRule.active===true,P['mx-other'].sourceRule);
 check('B unrelated similarly named source unaffected',!P['mx-dup'].sourceRule,P['mx-dup'].sourceRule);
 check('B raw messages preserved',P['mx-plain'].messages?.length===1&&P['mx-false'].messages?.[0]?.text?.includes('文字里像提及'),null);
 // ---------- fixture helpers (fixture failures are reported as FIXTURE, not product evidence) ----------
 // requestRoundId/status are server-managed on HTTP writes, so rounds are created through ordinary HTTP and
 // then bound with a direct update of this isolated fixture DB (never production data).
 const fixture=(name,pass,detail)=>{check('FIXTURE '+name,pass,detail);if(!pass)throw Error('fixture failed: '+name);};
 const fixtureDb=()=>{const d=new DatabaseSync(scope+'/opstwin-advance.db');d.exec('PRAGMA busy_timeout=5000');return d;};
 const allInbox=async()=>{const out=[];for(let offset=0;;){const r=await api('GET',`/api/inbox?limit=200&offset=${offset}`);fixture(`inbox page shape @${offset}`,r.status===200&&Array.isArray(r.data.items)&&typeof r.data.total==='number'&&typeof r.data.hasMore==='boolean',{status:r.status,keys:Object.keys(r.data||{})});out.push(...r.data.items);if(!r.data.hasMore)return out;offset=r.data.nextOffset;}};
 const inboxShape=(id,d)=>fixture(`inbox ${id} projection shape`,d&&d.id===id&&Array.isArray(d.messages)&&d.disposition&&typeof d.disposition.placement==='string',{id,keys:Object.keys(d||{})});
 const ago=n=>new Date(Date.now()-n*60000).toISOString();
 const round=async(id,requestRoundId,messages,{fields={},managed={}}={})=>{
  const r=await api('POST','/api/inbox',{id,title:'合成群Alpha',sender:'公开示例乙',channel:'Synthetic',sourceId:'src-alpha',body:messages.at(-1).text,origin:'human',status:'pending',category:'群聊',selfId:SELF,messages,...fields});
  fixture(`create ${id} over HTTP`,r.status===201&&r.data?.id===id,{status:r.status,error:r.data?.error});
  const d=fixtureDb();try{
   const u=d.prepare("UPDATE entities SET data=json_patch(data,?) WHERE type='inbox' AND id=? AND deleted=0").run(JSON.stringify({requestRoundId,...managed}),id);
   const row=d.prepare("SELECT json_extract(data,'$.requestRoundId') AS bound FROM entities WHERE type='inbox' AND id=?").get(id);
   fixture(`bind ${id} requestRoundId in fixture DB`,u.changes===1&&row?.bound===requestRoundId,{changes:u.changes,bound:row?.bound});
  }finally{d.close();}
  const g=await get(id);inboxShape(id,g);fixture(`${id} readback bound`,g.requestRoundId===requestRoundId,g.requestRoundId);return g;};
 // Review 2: exact current request wins over neighbouring mentions in the same context.
 const mixed=[{...m('old-1','早先@我的请求一',{mentionsSelf:true}),sentAt:ago(30)},{...m('old-2','早先@我的请求二',{mentionsSelf:true}),sentAt:ago(20)},{...m('other-request','当前请求没有@我',{mentionsSelf:false}),sentAt:ago(10)}];
 const RM=await round('mx-round-mixed','other-request',mixed);
 const RB=await round('mx-round-bound','old-2',[...mixed,{...m('later','之后的普通消息',{mentionsSelf:false}),sentAt:ago(5)}]);
 const RX=await round('mx-round-missing','gone-request',mixed);
 check('R2 current round not mentioned although earlier messages mention me',RM.sourceRule?.mentionGate==='not_mentioned'&&RM.sourceRule.active===true&&RM.sourceRule.boundRequest===true,RM.sourceRule);
 check('R2 round bound to a mentioned request stays despite later non-mentions',RB.sourceRule?.mentionGate==='mentioned'&&RB.sourceRule.active===false,RB.sourceRule);
 check('R2 missing bound request is unknown (not re-bound to another mention)',RX.sourceRule?.mentionGate==='unknown'&&RX.sourceRule.active===false,RX.sourceRule);
 check('R2 raw mixed messages preserved',RM.messages?.length===3&&RM.messages.filter(x=>x.mentionsSelf===true).length===2,null);
 // Review 3: a verified non-mentioned pending round with an old failed analysis stays quiet.
 await round('mx-round-failed','other-request',mixed);
 {const d=fixtureDb();try{
   d.prepare("INSERT OR REPLACE INTO entities (type,id,data,deleted,local_edited) VALUES ('inbox_triages',?,?,0,0)").run('mx-round-failed',JSON.stringify({id:'mx-round-failed',itemId:'mx-round-failed',status:'failed',error:'synthetic stale analysis failure',sourceVersion:'stale-version',attempt:3}));
   const t=d.prepare("SELECT json_extract(data,'$.status') AS status FROM entities WHERE type='inbox_triages' AND id=? AND deleted=0").get('mx-round-failed');
   fixture('failed triage row present for mx-round-failed',t?.status==='failed',t);
  }finally{d.close();}}
 const RF=await get('mx-round-failed');inboxShape('mx-round-failed',RF);
 const RS=await round('mx-round-sending','other-request',mixed,{managed:{status:'send_unknown'}});
 const RH=await round('mx-round-human','other-request',mixed,{fields:{draft:'我自己写的回复',manualDraft:true}});
 check('R3 non-mentioned pending round with failed triage is quiet, not verify/pending',RF.disposition?.placement==='quiet'&&RF.disposition.primaryReason==='source_rule'&&!(RF.disposition.recoveryReasons||[]).length,RF.disposition);
 const rows=await allInbox();
 fixture('paginated inbox includes the failed round',rows.some(i=>i.id==='mx-round-failed'),rows.length);
 const pendingIds=rows.filter(i=>['pending','verify'].includes(i.disposition?.placement)).map(i=>i.id);
 check('R3 failed-analysis round not listed as actionable',!pendingIds.includes('mx-round-failed'),pendingIds);
 check('R3 unknown outbound keeps attention',RS.status==='send_unknown'&&RS.sourceRule?.active===false&&RS.sourceRule.reason==='outbound_kept'&&RS.disposition?.placement!=='quiet',{r:RS.sourceRule,d:RS.disposition});
 check('R3 human draft keeps attention',RH.sourceRule?.active===false&&RH.sourceRule.reason==='draft_kept',RH.sourceRule);
 const restore=await ruleTry('合成群Alpha恢复关注全部消息 #rule',{mode:'all'});
 check('B restore to all writes and reads back',restore.t?.status==='succeeded'&&restore.t.output?.readback?.mode==='all',restore.t);
 check('B restored source no longer quiets items',!(await get('mx-plain')).sourceRule,null);

 // ---------- R10/R11. ordinary discovery in a durable old conversation (no prefilled arguments) ----------
 const old=(await api('GET',`/api/chat/conversations/${c1}/agent-session`)).data;
 fixture('durable old conversation has a session from before the restart',!!old?.sessionId,old);
 const discover=async(text)=>{ctl.discovery={query:'合成群Alpha',evidence:text};const r=await chat(c1,text+' #discover');const rr=runOf(r)||await run(r.data?.run?.id);return {r,rr,d:{...ctl.discovery}};};
 const negD=await discover('不要只看合成群Alpha里@我的消息');
 check('R10 negated request via discovery still rejected by the gate',tool(negD.rr,'set_inbox_source_rule')?.status==='failed',tool(negD.rr,'set_inbox_source_rule'));
 const okD=await discover('合成群Alpha以后只看@我的消息');
 const names=(okD.rr?.tools||[]).map(t=>t.name),setT=tool(okD.rr,'set_inbox_source_rule');
 check('R10 catalog exposes all/mentions/exclude',['all','mentions','exclude'].every(x=>okD.d.catalogModes?.includes(x)),okD.d);
 check('R10 catalog write path is the dedicated tool, not app_action',okD.d.catalogWriteTool==='set_inbox_source_rule'&&okD.d.catalogAppAction===false,okD.d);
 check('R10 app_read inbox_source_rules_read is a read action returning modes',okD.d.catalogReadAction===true&&okD.d.readModes?.includes('all'),okD.d);
 check('R11 discovery order: get_app_capabilities → app_read → set_inbox_source_rule',names.indexOf('get_app_capabilities')>=0&&names.indexOf('get_app_capabilities')<names.indexOf('app_read')&&names.indexOf('app_read')<names.indexOf('set_inbox_source_rule'),names);
 check('R11 rule write from discovered sourceKey succeeded with readback mentions',setT?.status==='succeeded'&&setT.output?.readback?.mode==='mentions'&&okD.d.sourceKey===alpha.id,{setT,key:okD.d.sourceKey});
 check('R11 same durable session id in the old conversation',(await api('GET',`/api/chat/conversations/${c1}/agent-session`)).data?.sessionId===old.sessionId,null);
 // ---------- R13. restored session with an outdated "unsupported" claim + capability version change ----------
 {const reset=await api('POST','/api/inbox-source-rules',{sourceKey:alpha.id,mode:'all'});fixture('reset 合成群Alpha to all over HTTP',reset.status===200&&reset.data.mode==='all',reset.data);}
 const cOld=await conv('过期能力说法');
 const claim=await chat(cOld,'合成群Alpha能只看@我的消息吗？ #claim');
 const claimRun=runOf(claim)||await run(claim.data?.run?.id);
 fixture('old turn stored the outdated unsupported claim',claim.status===200&&String(claim.data?.assistantMessage?.content||'').includes('UNSUPPORTED-CLAIM'),claim.data?.error);
 check('R13 first turn records a capability context (no previous hash)',tool(claimRun,'agent_capability_context')?.output?.reason==='capability_changed',tool(claimRun,'agent_capability_context'));
 const oldSession=(await api('GET',`/api/chat/conversations/${cOld}/agent-session`)).data?.sessionId;
 await stop();await start({CYBERME_CAPABILITY_CONTEXT_VERSION:'e2e-capability-v2'});
 ctl.capRefresh={query:'合成群Alpha',evidence:'合成群Alpha以后只看@我的消息'};
 const ref=await chat(cOld,'合成群Alpha以后只看@我的消息 #caprefresh');
 const refRun=runOf(ref)||await run(ref.data?.run?.id),cr={...ctl.capRefresh},capEv=tool(refRun,'agent_capability_context')?.output;
 check('R13 restored session keeps the same session id',(await api('GET',`/api/chat/conversations/${cOld}/agent-session`)).data?.sessionId===oldSession&&!!oldSession,null);
 check('R13 version change refreshes the capability context with evidence',capEv?.reason==='capability_changed'&&String(capEv.version).includes('e2e-capability-v2')&&capEv.retired>=1&&capEv.sourceRuleWrite===true,capEv);
 check('R13 provider sees the old claim and exactly one current capability message',cr.claimSeen===true&&cr.capCount===1,cr);
 check('R13 capability message is after the outdated claim and before the current input',cr.capAfterClaim===true&&cr.capBeforeInput===true,cr);
 check('R13 capability message carries the new version, mentions mode and write tool',String(cr.version).includes('e2e-capability-v2')&&cr.hasMentions&&cr.listsWriteTool,cr);
 const capSet=tool(refRun,'set_inbox_source_rule');
 check('R13 durable rule receipt via list_inbox_sources → set_inbox_source_rule',tool(refRun,'list_inbox_sources')?.status==='succeeded'&&capSet?.status==='succeeded'&&capSet.output?.readback?.mode==='mentions'&&capSet.output?.previousMode==='all'&&cr.sourceKey===alpha.id,capSet);
 check('R13 HTTP readback mentions after refresh',(await api('GET','/api/inbox-source-rules?query=合成群Alpha')).data.sources?.find(x=>x.id===alpha.id)?.mode==='mentions',null);
 const from13=seen.length,next=await chat(cOld,'R13 后续普通问题');const nextRun=runOf(next)||await run(next.data?.run?.id);
 check('R13 unchanged version does not resend (bounded, one visible copy)',next.status===200&&!tool(nextRun,'agent_capability_context')&&seen.slice(from13).filter(x=>!x.summarization).every(x=>x.capCount===1),seen.slice(from13).map(x=>x.capCount));
 check('R13 no automatic rule write on the follow-up turn',!tool(nextRun,'set_inbox_source_rule'),null);
 check('R11 HTTP readback after discovery write',(await api('GET','/api/inbox-source-rules?query=合成群Alpha')).data.sources?.find(x=>x.id===alpha.id)?.mode==='mentions',null);
}catch(e){check('unexpected error',false,String(e?.stack||e));}
finally{
 try{await stop();}catch{}provider.close();
 result.checks=checks;result.passed=checks.filter(c=>c.pass).length;result.total=checks.length;result.finishedAt=new Date().toISOString();
 await writeFile(scope+'/result.json',JSON.stringify(result,null,2),{mode:0o600});
 console.log(`${result.passed}/${result.total} passed; evidence ${scope}/result.json`);
 process.exit(result.passed===result.total?0:1);
}
