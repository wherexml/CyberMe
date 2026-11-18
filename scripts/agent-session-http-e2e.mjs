// Continuous single Agent session: real API child process + SQLite + controlled OpenAI-compatible
// provider. Synthetic data only; isolated ports 46971 (API) / 46972 (provider). Never touches the
// installed app or real model. Run from the repository root:
//   node scripts/agent-session-http-e2e.mjs
// Evidence: .local/acceptance/agent-session-<uuid>/result.json (private, not for Git).
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const scope=resolve('.local/acceptance/agent-session-'+randomUUID());await mkdir(scope,{recursive:true,mode:0o700});
const port=46971,modelPort=46972,base=`http://127.0.0.1:${port}`;
const SECRET='sk-ant-PUBLICFIXTURE0123456789abcdefXYZ';
const checks=[];let firstFailure;const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(pass?{}:{detail})});if(!pass&&!firstFailure)firstFailure={name,detail};console.log((pass?'PASS ':'FAIL ')+name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
{const seed=new DatabaseSync(scope+'/opstwin-advance.db');seed.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');seed.close();}
const config=model=>writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model}}),{mode:0o600});
await config('public-session-a');

// ---------- controlled provider ----------
const textOf=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.map(p=>p.text||'').join(''):'';
const seen=[];let toolhangCallId;
const provider=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);
 const messages=input.messages||[],lastUser=textOf([...messages].reverse().find(m=>m.role==='user')),afterTool=messages.at(-1)?.role==='tool';
 const tools=(input.tools||[]).map(t=>t.function?.name).filter(Boolean),summarization=!tools.length;
 seen.push({model:input.model,summarization,afterTool,tools,lastUser,roles:messages.map(m=>m.role),all:messages.map(textOf).join('\n'),
  userTexts:messages.filter(m=>m.role==='user').map(textOf),assistantToolCalls:messages.filter(m=>m.role==='assistant'&&m.tool_calls?.length).flatMap(m=>m.tool_calls.map(c=>c.function?.name)),toolMessages:messages.filter(m=>m.role==='tool').length,toolResultIds:messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id)});
 const has=tag=>lastUser.includes(tag);
 if(!summarization&&has('#fail')&&!afterTool){res.writeHead(500,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'synthetic upstream failure'}}));}
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'session',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 // Fixed synthetic usage per provider call: 100 input / 5 output tokens.
 const done=()=>{res.write('data: '+JSON.stringify({id:'session',object:'chat.completion.chunk',created:1,model:input.model,choices:[],usage:{prompt_tokens:100,completion_tokens:5,total_tokens:105}})+'\n\n');res.end('data: [DONE]\n\n');};
 const say=text=>{chunk({role:'assistant',content:text});chunk({},'stop');done();};
 const call=(name,args)=>{chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+seen.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls');done();};
 if(summarization)return say('SUMMARY-MARK 当前讨论对象与未完成事项已保留。');
 // #toolhang: a real tool call completes, then the follow-up model call hangs (crash target).
 if(has('#toolhang')){if(!afterTool){toolhangCallId='call-'+seen.length;return call('get_entity',{type:'memories',id:'alpha-src'});}await new Promise(r=>req.on('close',r));return;}
 if(has('#hang')&&!afterTool){await new Promise(r=>req.on('close',r));return;}
 if(has('#pref')&&!afterTool)return call('save_preference',{key:'language',value:'中文',evidence:'以后请用中文和我沟通'});
 if(has('#slow')&&!afterTool)await sleep(2500);
 if(has('#forbidden-write')&&!afterTool)return call('create_task',{title:'不应创建的公开任务'});
 if(has('#tool')&&!afterTool)return call('get_entity',{type:'memories',id:'alpha-src'});
 say('ANSWER '+(lastUser.match(/[A-Z0-9]+-MARK/g)||[]).join(' '));
});
await new Promise(r=>provider.listen(modelPort,'127.0.0.1',r));

// ---------- API child ----------
let child;
async function start(extra={}){
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:resolve('.'),stdio:['ignore','ignore','ignore'],env:{...process.env,OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_LISTEN:'0',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',...extra}});
 for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await sleep(100)}throw Error('API did not start');
}
async function stop(signal='SIGTERM'){child.kill(signal);for(let i=0;i<80&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);}
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});return {status:r.status,data:await r.json().catch(()=>({}))};};
const chat=(conversationId,message,extra={})=>api('POST','/api/chat',{conversationId,message,requestId:extra.requestId||randomUUID(),...extra});
const view=async cid=>(await api('GET',`/api/chat/conversations/${cid}/agent-session`)).data;
const run=async id=>(await api('GET','/api/runs/'+id)).data;
const toolNames=r=>(r?.tools||[]).map(t=>t.name);
const evidence=(r,name)=>(r?.tools||[]).find(t=>t.name===name)?.output;
const turnRequests=from=>seen.slice(from).filter(s=>!s.summarization);
const db=()=>{const d=new DatabaseSync(scope+'/opstwin-advance.db');d.exec('PRAGMA busy_timeout=5000');return d;};

try{
 await start();
 // ---------- synthetic data ----------
 const mem=async(id,title,body)=>check(`seed ${id}`,(await api('POST','/api/memories',{id,title,body,kind:'note'})).status===201);
 await mem('alpha-src','Project Alpha 交付安排',`ALPHA-MARK Project Alpha 需在周五前完成验收清单；负责人：公开示例甲。来源临时密钥 ${SECRET} 不可外泄。`);
 await mem('gamma-src','Project Gamma 活动安排','GAMMA-MARK Project Gamma 周末活动场地待确认。');
 const conv=async title=>(await api('POST','/api/conversations',{title,mode:'chat',status:'active'})).data.id;
 const cA=await conv('会话A'),cB=await conv('会话B'),cL=await conv('迁移会话');
 const taskCount=async()=>{const d=(await api('GET','/api/tasks?limit=500')).data;return Array.isArray(d)?d.length:(d.total??d.items?.length);};

 // ---------- 1. selected Alpha, then unselected follow-ups with competing fresh Beta tasks ----------
 let mark=seen.length;
 const t1Request=randomUUID(),t1Body={conversationId:cA,message:`T1-MARK #tool 请看看这个资料，临时密钥 ${SECRET} 不要保存`,requestId:t1Request,contextIds:['alpha-src']};
 const t1=await api('POST','/api/chat',t1Body);check('T1 selected Alpha succeeds',t1.status===200,t1.data);
 const v1=await view(cA);
 await api('POST','/api/tasks',{title:'Project Beta BETA-MARK 新任务一',status:'pending'});
 mark=seen.length;
 const t2=await chat(cA,'T2-MARK 你帮我看看这个任务如何处理吧');check('T2 follow-up succeeds',t2.status===200,t2.data);
 const r2=turnRequests(mark).at(-1)||{};
 check('T2 sees prior turn as real roles (user + assistant tool_call + tool result)',r2.userTexts?.some(t=>t.includes('T1-MARK'))&&r2.assistantToolCalls?.includes('get_entity')&&r2.toolMessages>=1,{roles:r2.roles});
 check('T2 history is not flattened into one prompt',!r2.all?.includes('历史会话（只作上下文）'));
 check('T2 keeps selected Alpha source in the session',r2.all?.includes('ALPHA-MARK'));
 check('T2 relies on native history without pinning an earlier selection',r2.all?.includes('alpha-src')&&!r2.lastUser?.includes('当前讨论对象'));
 check('T2 sees no competing Beta task or ambient reminder',!r2.all?.includes('BETA-MARK'));
 await api('POST','/api/tasks',{title:'Project Beta BETA-MARK 新任务二',status:'pending'});
 mark=seen.length;
 const t3=await chat(cA,'T3-MARK #tool 那下一步呢');check('T3 second follow-up succeeds',t3.status===200,t3.data);
 const r3=turnRequests(mark).at(-1)||{};
 check('T3 still anchored on Alpha, Beta not injected',r3.all?.includes('ALPHA-MARK')&&r3.all?.includes('alpha-src')&&!r3.all?.includes('BETA-MARK'));
 const v3=await view(cA);
 check('stable SDK session id across turns',v1.sessionId&&v1.sessionId===v3.sessionId,{v1:v1.sessionId,v3:v3.sessionId});
 check('same live instance across turns',v1.instanceId&&v1.instanceId===v3.instanceId&&v3.turnsOnInstance===3,{v1:v1.instanceId,v3:v3.instanceId,turns:v3.turnsOnInstance});
 check('durable entries keep tool call and tool result roles',v3.entries.some(e=>e.kind==='message:toolResult'&&e.toolName==='get_entity')&&v3.entries.some(e=>(e.toolCalls||[]).some(c=>c.name==='get_entity')));
 const run1=await run(t1.data.run?.id),run3=await run(t3.data.run?.id);
 check('current-turn evidence rebinding: each run records only its own tool call',toolNames(run1).filter(n=>n==='get_entity').length===1&&toolNames(run3).filter(n=>n==='get_entity').length===1);
 // T3 made exactly two provider calls (tool call + answer); a cumulative session total would be larger.
 check('per-run usage counts only this turn',run3.usage?.input===200&&run3.usage?.output===10,run3.usage);

 // ---------- 2. repeated request ID ----------
 const before=seen.length,entriesBefore=(await view(cA)).entries.length;
 const replay=await api('POST','/api/chat',t1Body);
 check('repeated request ID replays without a model call or session entry',replay.status===200&&replay.data.replayed===true&&seen.length===before&&(await view(cA)).entries.length===entriesBefore);

 // ---------- 3. readOnly turn cannot use an old write grant ----------
 const tasks0=await taskCount();mark=seen.length;
 const ro=await chat(cA,'RO-MARK #forbidden-write 只读看看',{readOnly:true});
 const rro=turnRequests(mark)[0]||{};
 check('readOnly turn declares no write tools',ro.status===200&&!rro.tools?.includes('create_task')&&!rro.tools?.includes('app_action'),{status:ro.status,tools:rro.tools});
 check('readOnly turn: forced write call is refused, no task created',(await taskCount())===tasks0&&!toolNames(await run(ro.data.run?.id)).includes('create_task'));

 // ---------- 4. steering inside the same session ----------
 mark=seen.length;
 const slow=chat(cA,'SLOW-MARK #slow #tool 继续核对');await sleep(900);
 const steer=await api('POST','/api/chat/continuation',{conversationId:cA,requestId:randomUUID(),message:'STEER-MARK 补充：只看验收清单',delivery:'steer'});
 const slowResult=await slow;
 const steerReceipt=await api('GET','/api/chat/continuation/receipts/'+steer.data.id);
 check('steer durably accepted then consumed at safe boundary',steer.data.status==='queued'&&steerReceipt.data.status==='inserted'&&steerReceipt.data.processingStatus==='succeeded',steerReceipt.data);
 check('steered message reaches the same session before the next model call',slowResult.status===200&&turnRequests(mark).some(s=>s.userTexts.some(t=>t.includes('STEER-MARK'))));

 // ---------- 5. interruption ----------
 const hang=chat(cA,'HANG-MARK #hang 这个很慢');await sleep(900);mark=seen.length;
 const interrupt=await chat(cA,'INTERRUPT-MARK 换个问法',{interruptCurrent:true});const hangResult=await hang;
 const ri=turnRequests(mark).at(-1)||{};
 check('interrupted turn reports chat_interrupted',hangResult.status===409&&hangResult.data.error==='chat_interrupted',hangResult.data);
 check('next turn continues same session and states the stopped turn',interrupt.status===200&&ri.all?.includes('HANG-MARK')&&ri.all.includes('本轮未正常完成'));

 // ---------- 6. failure ----------
 const fail=await chat(cA,'FAIL-MARK #fail 试一下');mark=seen.length;
 const afterFail=await chat(cA,'AFTERFAIL-MARK 刚才那个呢');
 check('failed turn surfaces failure',fail.status>=500||fail.status===409,fail.status);
 check('failed outcome is kept in session, not replayed or assumed done',afterFail.status===200&&(turnRequests(mark).at(-1)?.all||'').includes('状态 failed')&&turnRequests(mark).filter(s=>s.lastUser.includes('FAIL-MARK #fail')).length===0);

 // ---------- 7. conversation isolation ----------
 mark=seen.length;const b1=await chat(cB,'B-MARK 另一个会话的问题');const rb=turnRequests(mark).at(-1)||{};
 check('other conversation has its own session and none of A history',b1.status===200&&!rb.all?.includes('T1-MARK')&&!rb.all?.includes('ALPHA-MARK')&&(await view(cB)).sessionId!==v1.sessionId);

 // ---------- 8. legacy initialization (bounded, once) ----------
 {const d=db(),t=new Date(Date.now()-60000).toISOString(),put=(id,role,content,contextIds)=>d.prepare("INSERT INTO entities(type,id,data) VALUES('messages',?,?)").run(id,JSON.stringify({id,conversationId:cL,role,content,contextIds,createdAt:t,updatedAt:t}));
  put('legacy-u1','user','LEGACY-USER-MARK 之前问过这个资料',['alpha-src']);put('legacy-a1','assistant','LEGACY-ANSWER-MARK 之前的回答',[]);d.close();}
 mark=seen.length;await chat(cL,'L1-MARK 接着说这个');const rl1=turnRequests(mark).at(-1)||{};
 mark=seen.length;await chat(cL,'L2-MARK 还有呢');const rl2=turnRequests(mark).at(-1)||{};
 const count=(s,x)=>s.split(x).length-1;
 check('legacy history migrated once with linked source focus',rl1.all?.includes('LEGACY-USER-MARK')&&rl1.all.includes('迁移前会话记录')&&rl1.all?.includes('alpha-src'));
 check('legacy history not re-injected on later turns',count(rl2.all||'','迁移前会话记录')===1&&!rl2.lastUser?.includes('LEGACY-USER-MARK'));

 // ---------- 9. explicit topic change / new selection ----------
 mark=seen.length;await chat(cA,'G-TURN 看看这个新资料',{contextIds:['gamma-src']});const rg=turnRequests(mark).at(-1)||{};
 check('new selection wins and becomes focus',rg.all?.includes('GAMMA-MARK')&&(await view(cA)).focus?.ids?.[0]==='gamma-src');
 mark=seen.length;await chat(cA,'GFOLLOW-MARK 这个呢');const rgf=turnRequests(mark).at(-1)||{};
 check('follow-up retains new selection in history without re-pinning it',rgf.all?.includes('gamma-src')&&!rgf.lastUser?.includes('当前讨论对象'));
 const selectedCount=x=>(x||'').split('选定资料（用户本轮').length-1;
 mark=seen.length;await chat(cA,'TOPIC-MARK 换个话题：帮我想一个周末活动');const rt=turnRequests(mark).at(-1)||{};
 check('plain-text topic switch: no old selection re-injected',rt.lastUser?.includes('TOPIC-MARK')&&selectedCount(rt.all)===selectedCount(rgf.all)&&!rt.lastUser.includes('当前讨论对象'));
 check('plain-text topic switch does not move server focus by itself (model-judged boundary)',(await view(cA)).focus?.ids?.[0]==='gamma-src');

 // ---------- 10. revoked source and excluded turn ----------
 check('delete gamma source',(await api('DELETE','/api/memories/gamma-src')).status<300);
 {const d=db();d.prepare('INSERT OR IGNORE INTO memory_exclusions VALUES(?,?,?)').run('run:'+t2.data.run?.id,null,new Date().toISOString());d.close();}
 mark=seen.length;await chat(cA,'REVOKE-MARK 现在呢');const rr=turnRequests(mark).at(-1)||{};
 check('deleted source body leaves context',!rr.all?.includes('GAMMA-MARK')&&rr.all?.includes('选定资料已变化'));
 check('excluded (forgotten) turn does not resurrect via session replay',!rr.all?.includes('T2-MARK'));

 // ---------- 10b. real forget API: original and derived turns leave the session ----------
 const cF=await conv('遗忘会话');
 const pref=await chat(cF,'PREF-MARK #pref 以后请用中文和我沟通');
 const derived=await chat(cF,'DERIVED-MARK 按这个偏好继续');
 const derivedProvenance=evidence(await run(derived.data.run?.id),'load_conversation_context');
 check('persistent turn records source-message provenance for forget propagation',(derivedProvenance?.historySourceIds||[]).includes(pref.data.userMessage?.id),derivedProvenance);
 const automatic=(await api('GET','/api/memories/automatic')).data.items||[];
 const prefMemory=automatic.find(m=>m.messageId===pref.data.userMessage?.id);
 check('preference saved through the real chat tool',!!prefMemory,automatic.map(m=>m.messageId));
 if(prefMemory){const forgot=await api('POST',`/api/memories/automatic/${prefMemory.id}/revoke`,{version:prefMemory.version,action:'forget'});check('forget API accepted',forgot.status===200,forgot.data);}
 mark=seen.length;await chat(cF,'AFTERFORGET-MARK 现在呢');const rf=turnRequests(mark).at(-1)||{};
 check('forgotten original turn and derived turn are gone from the session context',!rf.all?.includes('PREF-MARK')&&!rf.all?.includes('DERIVED-MARK'));
 // ---------- 10c. selected task: notes change is a new source version ----------
 check('seed delta task',(await api('POST','/api/tasks',{id:'delta-task',title:'Delta 任务',notes:'DELTA-MARK 原备注',status:'pending'})).status===201);
 await chat(cB,'D-TURN 看看这个任务',{contextIds:['delta-task']});
 check('change delta task notes',(await api('PATCH','/api/tasks/delta-task',{notes:'新的备注'})).status===200);
 mark=seen.length;await chat(cB,'DCHANGED-MARK 这个任务现在怎样');const rd=turnRequests(mark).at(-1)||{};
 check('changed task notes retire the old selected body',!rd.all?.includes('DELTA-MARK')&&rd.all?.includes('已有新版本'));

 // ---------- 11. credential redaction ----------
 {const d=db();const leaked=d.prepare('SELECT count(*) n FROM agent_session_entries WHERE data LIKE ?').get('%'+SECRET+'%').n;d.close();
  check('credential value never persisted in session transcript',leaked===0);check('credential value never sent to provider',!seen.some(s=>s.all.includes(SECRET)));}

 // ---------- 12. model settings change ----------
 await config('public-session-b');mark=seen.length;const mc=await chat(cA,'MODEL-MARK 换模型后继续');
 const rm=turnRequests(mark).at(-1)||{},rmRun=await run(mc.data.run?.id);
 check('model change rebuilds explicitly with same session identity',evidence(rmRun,'agent_session_rebuilt')?.reason==='model_settings_changed'&&(await view(cA)).sessionId===v1.sessionId&&rm.model==='public-session-b'&&rm.all?.includes('T1-MARK'));

 // ---------- 13. restart: same identity, no replay; controlled compaction ----------
 // Pi keeps ~20000 recent tokens uncompacted; a threshold alone cannot force a small session to compact.
 for(let i=0;i<4;i++)await chat(cA,`PAD-MARK ${i} 合成填充资料，仅用于压缩验收。 `+'lorem ipsum synthetic padding '.repeat(1000));
 const preRestart=await view(cA),tasks1=await taskCount();
 await stop();await start({CYBERME_AGENT_SESSION_COMPACT_RATIO:'0'});
 mark=seen.length;const rs=await chat(cA,'RESTART-MARK 重启后继续这个');const rsRun=await run(rs.data.run?.id),after=await view(cA);
 const rsReq=turnRequests(mark).at(-1)||{};
 check('restart restores same session id with a new instance',rs.status===200&&after.sessionId===preRestart.sessionId&&after.instanceId!==preRestart.instanceId&&evidence(rsRun,'load_agent_session')?.restored===true);
 check('restart does not replay tools or prompts',!toolNames(rsRun).includes('get_entity')&&(await taskCount())===tasks1&&turnRequests(mark).filter(s=>s.lastUser.includes('T1-MARK')).length===0);
 check('controlled compaction ran inside the same session',evidence(rsRun,'agent_session_compaction')?.status==='succeeded'&&after.entries.some(e=>e.kind==='compaction')&&seen.slice(mark).some(s=>s.summarization));
 check('post-compaction turn keeps summary and current referent',rsReq.all?.includes('SUMMARY-MARK')&&rsReq.lastUser?.includes('RESTART-MARK'));

 // ---------- 14. crash mid-turn: unknown outcome stated, never replayed ----------
 // The rejection handler is attached immediately so SIGKILL cannot crash this harness.
 const crash=chat(cA,'HANG2-MARK #toolhang 处理中被中断').catch(e=>({status:0,error:String(e)}));
 // Wait for the completed tool's receipt (not its durable session row) before killing.
 for(let i=0;i<100;i++){const d=db();const ready=d.prepare("SELECT 1 FROM entities WHERE type='runs' AND data LIKE '%HANG2-MARK%' AND data LIKE '%get_entity%' AND data LIKE '%tool_execution_end%' LIMIT 1").get();d.close();if(ready)break;await sleep(50);}
 await sleep(200);await stop('SIGKILL');await crash;
 let crashRun;{const d=db();crashRun=d.prepare("SELECT json_extract(data,'$.runId') runId FROM chat_requests WHERE json_extract(data,'$.userMessage.content') LIKE '%HANG2-MARK%'").get()?.runId;
  const durable=d.prepare("SELECT count(*) n FROM agent_session_entries WHERE run_id=? AND kind='message:toolResult'").get(crashRun).n;d.close();
  check('tool result completed before the kill is already durable',durable>=1,{crashRun,durable});}
 await start();mark=seen.length;const ac=await chat(cA,'AFTERCRASH-MARK 刚才那个怎么样了');const rc=turnRequests(mark).at(-1)||{};
 check('turn lost in crash is stated as not completed',ac.status===200&&rc.all?.includes('未进入本会话的早先轮次')&&rc.all.includes('HANG2-MARK'));
 check('restored context keeps the crashed turn tool result as a tool message',!!toolhangCallId&&(rc.toolResultIds||[]).includes(toolhangCallId),{toolhangCallId,ids:rc.toolResultIds});
 check('crashed turn is not replayed (no new prompt, no tool re-execution)',seen.slice(mark).filter(s=>s.lastUser.includes('HANG2-MARK')).length===0&&!toolNames(await run(ac.data.run?.id)).includes('get_entity'));
 // ---------- 15. failed durable storage must not return a successful response ----------
 const cP=await conv('持久化失败验收');await chat(cP,'PERSIST-SETUP 正常轮次');
 const pBefore=await view(cP);
 {const d=db();d.exec("CREATE TRIGGER acceptance_fail_session BEFORE INSERT ON agent_session_entries WHEN NEW.kind='entry:cyberme_turn_settled' BEGIN SELECT RAISE(FAIL,'synthetic persistence failure'); END");d.close();}
 const pf=await chat(cP,'PERSIST-FAIL 回答完成但轮末保存失败');
 check('settlement persistence failure rejects success',pf.status===500&&pf.data.error==='agent_session_persist_failed'&&pf.data.detail?.run?.status==='failed',pf);
 {const d=db();d.exec('DROP TRIGGER acceptance_fail_session');d.close();}
 const pr=await chat(cP,'PERSIST-RECOVER 继续');const pAfter=await view(cP);
 check('persistence failure restores same logical session in a new instance',pr.status===200&&pAfter.sessionId===pBefore.sessionId&&pAfter.instanceId!==pBefore.instanceId);
}catch(e){check('script completed',false,String(e));}
finally{try{await stop();}catch{}provider.close();
 const failed=checks.filter(c=>!c.pass);
 await writeFile(scope+'/result.json',JSON.stringify({scope,firstFailure:firstFailure||null,checks,providerRequests:seen.length,failed:failed.length},null,2));
 console.log(JSON.stringify({result:scope+'/result.json',passed:checks.length-failed.length,failed:failed.length}));
 process.exitCode=failed.length?1:0;}
