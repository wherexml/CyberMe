// Real acceptance: chat time budgets with REAL long-session SDK compaction and a REAL mentions-only rule
// write/readback. Failure cases: docs/public/chat-time-budgets.md (incl. review items R1–R7).
//
// Model chain: the coordinator's EXACT saved daily settings (llm block copied verbatim: baseUrl, api, model
// such as `opencode-go/deepseek-v4.1-flash`, gateway key, provider bindings). Nothing is stripped, renamed or
// substituted; deep-mode is never used and every run must report exactly the saved standard model.
// TLS: the existing gateway CA via NODE_EXTRA_CA_CERTS (required; verification is never disabled).
//
// Modes
//  - synthetic (default): isolated synthetic long conversation + synthetic source.
//  - snapshot: CYBERME_SESSION_SNAPSHOT=<private dir with opstwin-advance.db (+WAL) and agent session files>
//    CYBERME_SNAPSHOT_CONVERSATION_ID=<explicit conversation id> CYBERME_SNAPSHOT_SOURCE_NAME=<explicit source name>
//    The snapshot is cloned into a private local acceptance dir; real compaction and the mentions-only rule
//    run in THAT long conversation. Production data and the snapshot itself are never written. Nothing is
//    sent remotely except the model calls of the configured daily chain; metrics contain only booleans,
//    hashes, counts and timings (no prompts, answers, history, names or identifiers).
//  - rule-only (R13): add CYBERME_RULE_ONLY=1 to snapshot mode. Skips the compaction turn and runs only the
//    mentions-only rule turn in the restored current-snapshot conversation, asserting the versioned capability
//    context refresh and the durable rule receipt. Repeatable: every run clones the snapshot afresh.
// Isolation: API port 46983, own data/private dir, every background worker and delivery disabled.
//   NODE_EXTRA_CA_CERTS=<existing CA> node scripts/chat-time-budget-real-e2e.mjs
// Evidence: .local/acceptance/chat-time-budget-real-<uuid>/result.json (private, metrics only).
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join,sep} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';

const abort=msg=>{console.error('ABORT: '+msg);process.exit(2);};
const h=v=>createHash('sha256').update(String(v)).digest('hex').slice(0,16);
const productionDir=join(homedir(),'Library/Application Support/OpsTwins');
const configPath=process.env.CYBERME_DAILY_CONFIG||join(productionDir,'.local/config.json');
const daily=JSON.parse(await readFile(configPath,'utf8')),llm=daily.llm||daily;
// Exact saved values; only presence is validated. No host/model rewriting, no fallback.
if(typeof llm.baseUrl!=='string'||!llm.baseUrl||typeof llm.model!=='string'||!llm.model||!llm.apiKey)abort('daily standard role (baseUrl/model/apiKey) is incomplete; no fallback');
const EXPECTED_MODEL=llm.model;
if(process.env.CYBERME_EXPECT_MODEL&&process.env.CYBERME_EXPECT_MODEL!==EXPECTED_MODEL)abort('saved daily model differs from CYBERME_EXPECT_MODEL; no fallback');
if(llm.baseUrl.startsWith('https://')&&!(process.env.NODE_EXTRA_CA_CERTS&&existsSync(process.env.NODE_EXTRA_CA_CERTS)))abort('NODE_EXTRA_CA_CERTS must point to the existing gateway CA');
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')abort('TLS verification must stay enabled');

const port=46983,base=`http://127.0.0.1:${port}`,scope=resolve('.local/acceptance/chat-time-budget-real-'+randomUUID());
await mkdir(scope,{recursive:true,mode:0o700});
const ruleOnly=process.env.CYBERME_RULE_ONLY==='1';
const snapshot=process.env.CYBERME_SESSION_SNAPSHOT,snapConversation=process.env.CYBERME_SNAPSHOT_CONVERSATION_ID,snapSource=process.env.CYBERME_SNAPSHOT_SOURCE_NAME;
if(ruleOnly&&!process.env.CYBERME_SESSION_SNAPSHOT)abort('CYBERME_RULE_ONLY=1 requires a current snapshot (CYBERME_SESSION_SNAPSHOT)');
if(snapshot){
 if(!existsSync(join(snapshot,'opstwin-advance.db'))||!snapConversation||!snapSource)abort('snapshot mode needs opstwin-advance.db, CYBERME_SNAPSHOT_CONVERSATION_ID and CYBERME_SNAPSHOT_SOURCE_NAME');
 const real=await realpath(snapshot),prod=existsSync(productionDir)?await realpath(productionDir):productionDir;
 if(real===prod||real.startsWith(prod+sep))abort('snapshot must be an isolated copy, not the production data directory');
 // Clone (never open the original read-write). Its own config, if any, is replaced below.
 await cp(real,scope,{recursive:true,filter:src=>!/\/config\.json$/.test(src)});
}else{const seed=new DatabaseSync(scope+'/opstwin-advance.db');seed.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');seed.close();}
await writeFile(scope+'/config.json',JSON.stringify({llm}),{mode:0o600});

const checks=[],metrics=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OFF={OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_INBOX_CHAT_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_VIRTUAL_IM_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',CYBERME_INSIGHT_VISUALS:'off'};
const child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:resolve('.'),stdio:['ignore','ignore','ignore'],env:{...process.env,...OFF,OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_LISTEN:'0',...(snapshot?{}:{CYBERME_AGENT_SESSION_COMPACT_RATIO:process.env.CYBERME_AGENT_SESSION_COMPACT_RATIO??'0'})}});
const api=async(method,path,body,ms=360000)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(ms)});return {status:r.status,data:await r.json().catch(()=>({}))};};
const tool=(r,name)=>(r?.tools||[]).filter(t=>t.name===name).at(-1);
// Metrics: timings, statuses and booleans only.
const record=(label,r)=>{const run=r.data?.run||r.data?.error?.detail?.run||{};const c=tool(run,'agent_session_compaction')?.output,tb=run.timeBudget||{};
 metrics.push({label,httpStatus:r.status,errorCode:r.data?.error?.code,modelExact:run.model===EXPECTED_MODEL,prepare:tb.prepare&&{status:tb.prepare.status,elapsedMs:tb.prepare.elapsedMs,budgetMs:tb.prepare.budgetMs},answer:tb.answer&&{status:tb.answer.status,elapsedMs:tb.answer.elapsedMs,budgetMs:tb.answer.budgetMs},noOverlap:!!(tb.prepare&&tb.answer&&tb.prepare.endedAt<=tb.answer.startedAt),compaction:c?{status:c.status,elapsedMs:c.elapsedMs}:null,toolReceipts:(run.tools||[]).map(t=>({name:t.name,status:t.status}))});return run;};
// Pagination is limited to 200 per page; walk all pages and assert the shape.
const allInbox=async label=>{const out=[];for(let offset=0;;){const r=await api('GET',`/api/inbox?limit=200&offset=${offset}`);check(`${label}: FIXTURE inbox page shape @${offset}`,r.status===200&&Array.isArray(r.data.items)&&typeof r.data.hasMore==='boolean');if(!Array.isArray(r.data.items))return out;out.push(...r.data.items);if(!r.data.hasMore)return out;offset=r.data.nextOffset;}};
const ruleChecks=async(label,cid,sourceName,expectItems)=>{
 // Same resolution as the product: a unique exact name wins over longer names containing it.
 const resolveSource=list=>{const exact=list.filter(x=>String(x.name).trim().toLocaleLowerCase()===sourceName.trim().toLocaleLowerCase());return exact.length?exact:list;};
 const listed0=await api('GET','/api/inbox-source-rules?query='+encodeURIComponent(sourceName));
 check(`${label}: FIXTURE source listing shape`,listed0.status===200&&Array.isArray(listed0.data.sources));
 const before=resolveSource(listed0.data.sources||[]);
 check(`${label}: source name resolves to exactly one source (exact first)`,before.length===1);
 const r=await api('POST','/api/chat',{conversationId:cid,requestId:randomUUID(),preservePrimary:true,message:`${sourceName}以后只看@我的消息。`});
 const run=record(label+'-rule',r),t=tool(run,'set_inbox_source_rule');
 check(`${label}: rule turn succeeded on the exact saved model`,r.status===200&&run.model===EXPECTED_MODEL);
 check(`${label}: set_inbox_source_rule receipt succeeded`,t?.status==='succeeded');
 check(`${label}: tool readback mode=mentions`,t?.output?.readback?.mode==='mentions');
 // R13: the restored session receives the current capability context before the input (versioned, replaceable).
 const cap=tool(run,'agent_capability_context')?.output;
 metrics.push({label:label+'-capability',refreshed:!!cap,reason:cap?.reason,versionHash:cap?h(cap.version):undefined,sourceRuleWrite:cap?.sourceRuleWrite,retired:cap?.retired});
 if(ruleOnly)check(`${label}: restored session got the current capability context with the write tool`,!!cap&&cap.sourceRuleWrite===true);
 // R10: whatever discovery the real model chose, it must not conclude mentions-only is unsupported.
 const used=n=>(run.tools||[]).some(x=>x.name===n&&x.status==='succeeded'),answer=String(r.data?.assistantMessage?.content||'');
 const catalogRead=(run.tools||[]).find(x=>x.name==='get_app_capabilities'&&x.status==='succeeded');
 if(catalogRead)check(`${label}: discovered catalog exposes mentions mode`,JSON.stringify(catalogRead.output||{}).includes('"mentions"'));
 check(`${label}: answer does not claim mentions-only is unsupported`,!/(不支持|无法|不能|只支持|仅支持)[^。\n]{0,20}(@我|仅@|只看@|mentions)|only (?:supports?|exclude)/i.test(answer));
 metrics.push({label:label+'-discovery',usedCatalog:used('get_app_capabilities'),usedAppRead:used('app_read'),usedListSources:used('list_inbox_sources'),ruleWrites:(run.tools||[]).filter(x=>x.name==='set_inbox_source_rule'&&x.status==='succeeded').length});
 const after=resolveSource((await api('GET','/api/inbox-source-rules?query='+encodeURIComponent(sourceName))).data.sources||[]);
 check(`${label}: HTTP readback mode=mentions, not excluded`,after.length===1&&after[0].id===before[0]?.id&&after[0].mode==='mentions'&&after[0].excluded===false);
 const all=await allInbox(label),rows=all.filter(i=>i.sourceRule?.mode==='mentions'&&i.sourceRule.id===after[0]?.id);
 check(`${label}: FIXTURE projected items have disposition and messages`,rows.every(i=>i.disposition&&typeof i.disposition.placement==='string'&&Array.isArray(i.messages)));
 const quiet=rows.filter(i=>i.sourceRule.active),kept=rows.filter(i=>!i.sourceRule.active);
 check(`${label}: quieted items all have a verified non-mentioned current request`,quiet.every(i=>i.sourceRule.mentionGate==='not_mentioned'&&i.disposition?.placement!=='pending'));
 check(`${label}: mentioned/unknown/outbound/draft items are kept`,kept.every(i=>i.sourceRule.mentionGate!=='not_mentioned'||['outbound_kept','draft_kept'].includes(i.sourceRule.reason)));
 if(expectItems)check(`${label}: synthetic projection quiets one and keeps one`,quiet.length===1&&kept.length===1);
 metrics.push({label:label+'-projection',sourceHash:h(after[0]?.id),items:rows.length,quiet:quiet.length,kept:kept.length,unknown:rows.filter(i=>i.sourceRule.mentionGate==='unknown').length});
};
try{
 let up=false;for(let i=0;i<300&&!up;i++){try{up=(await fetch(base+'/api/health')).ok}catch{}if(!up)await sleep(100);}
 if(!up)throw Error('API did not start');
 await api('PATCH','/api/settings',{autonomy:{holdSending:true}}).catch(()=>{});

 if(snapshot){
  // ---------- snapshot: real compaction + rule in the SAME supplied long conversation ----------
  const view=(await api('GET',`/api/chat/conversations/${encodeURIComponent(snapConversation)}/agent-session`)).data;
  check('snapshot conversation has a durable SDK session',!!view?.sessionId);
  metrics.push({label:'snapshot-session',sessionHash:h(view?.sessionId),entries:Array.isArray(view?.entries)?view.entries.length:undefined});
   if(!ruleOnly){
 const r=await api('POST','/api/chat',{conversationId:snapConversation,requestId:randomUUID(),readOnly:true,preservePrimary:true,message:'请用一句话说明我们当前在讨论什么，不做任何操作。'});
  const run=record('snapshot-compaction',r),c=tool(run,'agent_session_compaction')?.output,tb=run.timeBudget||{};
  check('snapshot: turn succeeded without timeout',r.status===200);
  check('snapshot: real SDK compaction ran and succeeded',c?.status==='succeeded'&&c.elapsedMs>0);
  check('snapshot: prepare includes compaction, answer separate and full',tb.prepare?.status==='completed'&&tb.prepare.elapsedMs>=(c?.elapsedMs||0)&&tb.answer?.status==='completed'&&tb.prepare.endedAt<=tb.answer.startedAt);
  check('snapshot: exact saved model',run.model===EXPECTED_MODEL);
  check('snapshot: compaction turn wrote nothing',!(run.tools||[]).some(t=>t.effect==='write'&&t.status==='succeeded'));
  }
  await ruleChecks('snapshot',snapConversation,snapSource,false);
 }else{
  // ---------- synthetic: long conversation, real compaction, then rule in the same conversation ----------
  const cid=(await api('POST','/api/conversations',{title:'时间预算真实验收（合成）',mode:'chat',status:'active',sideChat:true})).data.id;
  const para=i=>`第${i}段公开合成资料：青岚 Alpha 项目的验收清单包括接口联调、数据迁移、权限复核和回滚演练；负责人林澄，截止周五。`;
  for(let i=0;i<3;i++){const r=await api('POST','/api/chat',{conversationId:cid,requestId:randomUUID(),readOnly:true,preservePrimary:true,message:`第${i+1}轮资料，请只回复“已收到”。${Array.from({length:700},(_,k)=>para(k)).join('')}`});const run=record('seed-'+i,r);check(`seed ${i+1} succeeded on the exact saved model`,r.status===200&&run.model===EXPECTED_MODEL);}
  const r=await api('POST','/api/chat',{conversationId:cid,requestId:randomUUID(),readOnly:true,preservePrimary:true,message:'根据前面的资料，青岚 Alpha 的负责人是谁、截止时间是什么？请用一句话回答。'});
  const run=record('compaction',r),c=tool(run,'agent_session_compaction')?.output,tb=run.timeBudget||{},answer=r.data?.assistantMessage?.content||'';
  check('real SDK compaction ran and succeeded',c?.status==='succeeded'&&c.elapsedMs>0);
  check('prepare includes compaction; answer budget separate and full',tb.prepare?.status==='completed'&&tb.prepare.elapsedMs>=(c?.elapsedMs||0)&&tb.answer?.status==='completed'&&tb.answer.budgetMs>=110000&&tb.prepare.endedAt<=tb.answer.startedAt);
  check('answer retained referent after compaction',/林澄/.test(answer)&&/周五/.test(answer));
  const SELF='ou_public_self',ago=n=>new Date(Date.now()-n*60000).toISOString();
  const msg=(id,text,meta,at)=>({id,text,senderId:'ou_public_other',senderName:'公开示例乙',isMine:false,sentAt:ago(at),...meta});
  for(const [id,requestRoundId,messages] of [
   ['real-round-plain','rq-plain',[msg('rq-old','早先@我',{mentionsSelf:true},30),msg('rq-plain','当前请求未@我',{mentionsSelf:false},10)]],
   ['real-round-mention','rq-mention',[msg('rq-mention','当前请求@我',{mentionsSelf:true},5)]]])
  {const c=await api('POST','/api/inbox',{id,title:'合成验收群Alpha',sender:'公开示例乙',channel:'Synthetic',sourceId:'real-src-alpha',body:messages.at(-1).text,origin:'human',status:'pending',category:'群聊',selfId:SELF,messages});
   check(`FIXTURE create ${id} over HTTP`,c.status===201&&c.data?.id===id);
   // requestRoundId is server-managed on HTTP writes: bind it in this isolated synthetic DB only.
   const d=new DatabaseSync(scope+'/opstwin-advance.db');d.exec('PRAGMA busy_timeout=5000');
   try{const u=d.prepare("UPDATE entities SET data=json_patch(data,?) WHERE type='inbox' AND id=? AND deleted=0").run(JSON.stringify({requestRoundId}),id);check(`FIXTURE bind ${id}`,u.changes===1);}finally{d.close();}
   const g=(await api('GET','/api/inbox/'+id)).data;check(`FIXTURE ${id} readback bound with projection`,g?.requestRoundId===requestRoundId&&g.disposition&&Array.isArray(g.messages));}
  await ruleChecks('synthetic',cid,'合成验收群Alpha',true);
 }
}catch(e){check('unexpected error ('+String(e?.name||'Error')+')',false);}
finally{
 child.kill('SIGTERM');
 const result={scopeHash:h(scope),mode:snapshot?'snapshot':'synthetic',modelHash:h(EXPECTED_MODEL),endpointHash:h(llm.baseUrl),caConfigured:!!process.env.NODE_EXTRA_CA_CERTS,checks,metrics,passed:checks.filter(c=>c.pass).length,total:checks.length,finishedAt:new Date().toISOString()};
 await writeFile(scope+'/result.json',JSON.stringify(result,null,2),{mode:0o600});
 console.log(`${result.passed}/${result.total} passed; private evidence ${scope}/result.json`);
 process.exit(result.passed===result.total?0:1);
}
