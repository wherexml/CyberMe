// Follow-up through the GENUINE Feishu and WeChat production adapter paths. Spec: docs/public/follow-up.md.
// Real API child + isolated SQLite + synthetic public CLIs (OPSTWIN_LARK_CLI / OPSTWIN_WECHAT_CLI, same
// pattern as feishu-context-http-e2e.mjs and wechat-background-sync-http-e2e.mjs) + controlled model.
// Feishu items are seeded in the real production shape (raw epoch create_time strings, replyToId,
// selfId, chatMode); WeChat items are produced by the real background sync. No real accounts, messages,
// credentials or sends. Ports: API 46936, controlled provider 46937.
//   node --import tsx scripts/follow-up-adapters-http-e2e.mjs
// Evidence: output/follow-up-adapters-<stamp>/result.json (codes, states, counts only).
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=resolve('.'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const scope=resolve('.local/acceptance/follow-up-adapters-'+randomUUID()),out=resolve('output/follow-up-adapters-'+stamp);
await mkdir(scope+'/data',{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const port=46936,modelPort=46937,base=`http://127.0.0.1:${port}`,MIN=60_000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[];let currentCase='setup';
const safe=v=>{try{const s=JSON.stringify(v);return s&&s.length>1200?s.slice(0,1200)+'…':v;}catch{return String(v);}};
const check=(name,pass,detail)=>{checks.push({case:currentCase,name,pass:!!pass,...(pass?{}:{detail:safe(detail)})});console.log((pass?'PASS ':'FAIL ')+currentCase+' :: '+name);return !!pass;};
async function scenario(name,fn){currentCase=name;try{await fn();}catch(e){check('scenario completed without exception',false,String(e?.stack||e).slice(0,800));}}

// ---------- isolated clock ----------
let offsetMs=0;const clockNow=()=>Date.now()+offsetMs,iso=ms=>new Date(clockNow()+ms).toISOString();
async function advance(ms){offsetMs+=ms;await writeFile(scope+'/data/follow-up-clock.json',JSON.stringify({offsetMs}));}

// ---------- synthetic CLI state ----------
const stateFile=join(scope,'state.json');const now=Date.now(),t0=now-3*3600_000,A=now-3600_000;
const fm=(id,chat,sender,text,at,extra={})=>({message_id:id,chat_id:chat,create_time:String(at),msg_type:'text',sender:{id:sender,id_type:'open_id',name:sender.replace('ou_','')},body:{content:JSON.stringify({text})},...extra});
const S={feishu:{mode:'ok',delayMs:0,rawFail:false,chats:{
  oc_alice:[fm('om_a0','oc_alice','ou_alice','上次的报价收到了吗',t0),fm('om_areq','oc_alice','ou_owner','请确认报价单 Q-17',A)],
  oc_carol:[fm('om_c0','oc_carol','ou_carol','材料我晚点发',t0),fm('om_creq','oc_carol','ou_owner','请把材料发我',A)],
  oc_team:[fm('om_e0','oc_team','ou_erin','我负责上线窗口',t0),fm('om_f0','oc_team','ou_frank','我在',t0+1000),fm('om_treq','oc_team','ou_owner','@Erin 请确认上线窗口',A)],
  oc_bob:[fm('om_b0','oc_bob','ou_bob','方案 A 看过了',t0),fm('om_breq','oc_bob','ou_owner','方案 B 你是否同意？',A)],
  oc_ivy:[fm('om_i0','oc_ivy','ou_ivy','你好',t0),fm('om_ireq','oc_ivy','ou_owner','请回复这份清单',A)]},raw:{}},
 wechat:{source:'public-a',coverageComplete:true,warnings:false,foreign:false,time:Math.floor(now/1000),messages:[
  {id:'wx-0',conversationId:'public-chat',sender:'public-incoming',senderDisplayName:'公开来信人',createdAtUnix:Math.floor(t0/1000),messageType:1,content:{Text:'之前的问题'}},
  {id:'wx-req',conversationId:'public-chat',sender:'public-owner',senderDisplayName:'公开本人',createdAtUnix:Math.floor(A/1000),messageType:1,content:{Text:'请确认时间'}}]}};
const save=()=>writeFile(stateFile,JSON.stringify(S));await save();
const lark=join(scope,'lark.mjs');await writeFile(lark,`#!/usr/bin/env node
import {readFileSync} from 'node:fs';const a=process.argv.slice(2),s=JSON.parse(readFileSync(${JSON.stringify(stateFile)},'utf8')).feishu,value=k=>a[a.indexOf(k)+1];
if(a[0]==='auth'){console.log(JSON.stringify({identity:'user',verified:true,identities:{user:{status:'ready',tokenStatus:'valid',openId:'ou_owner',userName:'许茂林'}}}));process.exit(0);}
if(s.mode==='fail'){console.log(JSON.stringify({ok:false,error:{subtype:'fixture_failure',message:'public failure'}}));process.exit(1);}
let data={};
if(a[0]==='api'){const id=a[2].split('/').at(-1);const hit=Object.values(s.chats).flat().find(m=>m.message_id===id);data={items:hit&&!s.rawFail?[{...hit,create_time:s.raw[id]||hit.create_time}]:[]};}
if(a[1]==='+chat-messages-list'){if(s.delayMs)await new Promise(r=>setTimeout(r,s.delayMs));const rows=(s.chats[value('--chat-id')]||[]).slice().reverse();const page=Number(a.includes('--page-token')?value('--page-token'):0);
 data=s.mode==='limited'?{items:rows.slice(0,1),has_more:true,page_token:String(page+1)}:{items:rows,has_more:false};}
console.log(JSON.stringify({ok:true,identity:'user',data}));`,{mode:0o700});
const wechat=join(scope,'greenbubbles.mjs');await writeFile(wechat,`#!/usr/bin/env node
import {readFileSync} from 'node:fs';const s=JSON.parse(readFileSync(${JSON.stringify(stateFile)},'utf8')).wechat,args=process.argv.slice(2),kind=args[0];
let items=[],payload={schema:'greenbubbles.query.v1',ok:true,source:{identity:s.source},consistency:{coverageComplete:s.coverageComplete},page:{hasMore:false},warnings:s.warnings?[{code:'public_warning'}]:[]};
if(kind==='source')payload.databaseCount=2;
if(kind==='contacts')items=[{id:'public-owner',displayName:'公开本人',isAccountHolder:true}];
if(kind==='chats')items=[{id:'public-chat',displayName:'公开会话',sortTimestamp:s.time+s.messages.length,summary:'公开'+s.messages.length}];
if(kind==='messages'){const cid=args[args.indexOf('--conversation')+1];items=s.messages.filter(m=>m.conversationId===cid).slice().reverse();if(s.foreign)items.push({...items[0],id:'wx-foreign',conversationId:'other-chat'});}
payload.items=items;console.log(JSON.stringify(payload));`,{mode:0o700});

// ---------- controlled provider (releasable hangs) ----------
const plan={verdict:{relevance:'related'},hang:false};let hung=[];const background=[];
const provider=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);const text=(input.messages||[]).map(m=>typeof m.content==='string'?m.content:(m.content||[]).map(p=>p.text||'').join('')).join('\n');
 const say=t=>{if(res.destroyed||res.headersSent)return;res.writeHead(200,{'content-type':'text/event-stream'});const c=(d,f=null)=>res.write('data: '+JSON.stringify({id:'a',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta:d,finish_reason:f}]})+'\n\n');c({role:'assistant',content:t});c({},'stop');res.end('data: [DONE]\n\n');};
 if(text.includes('CYBERME_FOLLOWUP_CHECK')){background.push((input.tools||[]).length);if(plan.hang){hung.push(say);return;}return say(JSON.stringify(plan.verdict));}
 say('OK');});
const release=()=>{const l=hung;hung=[];for(const s of l)s(JSON.stringify(plan.verdict));return l.length;};
await new Promise(r=>provider.listen(modelPort,'127.0.0.1',r));
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-follow-up'}}),{mode:0o600});

// ---------- production-shaped seed (synthetic) ----------
const fsItem=(chat,title,mode,seed)=>({id:'live-'+chat,title,sender:title,channel:'Feishu',sourceSystem:'feishu-cli',sourceId:chat,selfId:'ou_owner',chatMode:mode,origin:'human',status:'pending',body:seed.at(-1).text,
 messages:seed.map(m=>({id:m.message_id,sentAt:m.create_time,text:JSON.parse(m.body.content).text,senderName:m.sender.name,senderId:m.sender.id,isMine:m.sender.id==='ou_owner',...(m.parent_id?{replyToId:m.parent_id}:{})})),sourceScope:{id:'all',mode:'draft',chatMode:mode}});
const authority={'conv-alice':'帮我跟进 Alice，她回复了就算完成','conv-carol':'帮我跟进 Carol，她回复了就算完成','conv-team':'帮我盯一下 Erin 有没有回复我在群里问的上线窗口','conv-bob':'帮我跟进 Bob 是否同意方案 B','conv-bob2':'帮我跟进 Bob 是否同意方案 B（确认时撤销）','conv-wx':'帮我跟进公开来信人，回复了就算完成','conv-ivy':'帮我跟进 Ivy，她回复了就算完成'};
const boot=join(scope,'start.ts');await writeFile(boot,`import {put,setMeta} from '${root}/server/src/store.ts';
setMeta('initialized',true);
put('connections',{id:'feishu-local',name:'QA Feishu',provider:'Feishu',status:'connected',permissions:['read','draft'],config:{authMethod:'none',scopes:[{id:'all',enabled:true}]}});
for(const item of ${JSON.stringify(Object.entries(S.feishu.chats).map(([chat,seed])=>fsItem(chat,'QA '+chat.slice(3),chat==='oc_team'?'group':'p2p',seed)))})put('inbox',item);
for(const [id,content] of Object.entries(${JSON.stringify(authority)})){put('conversations',{id,title:id,mode:'chat',status:'active'});put('messages',{id:'auth-'+id,conversationId:id,role:'user',content,requestId:'req-'+id});}
await import('${root}/server/src/index.ts');`);
let child;
async function start(){child=spawn(process.execPath,['--import','tsx',boot],{cwd:root,stdio:['ignore','ignore','ignore'],env:{...process.env,OPSTWIN_DATA_DIR:scope+'/data',OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:'46938',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_LARK_CLI:lark,OPSTWIN_WECHAT_CLI:wechat,CYBERME_FOLLOWUP_WORKER:'1',CYBERME_FOLLOWUP_TICK_MS:'300',CYBERME_FOLLOWUP_TICK_WAIT_MS:'1500',CYBERME_FOLLOWUP_ISOLATED_CLOCK:'1'}});
 for(let i=0;i<200;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await sleep(100)}throw Error('API did not start');}
async function stop(){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await sleep(100);}
const api=async(method,path,body)=>{try{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});return {status:r.status,data:await r.json().catch(()=>({}))};}catch(e){return {status:0,data:{error:String(e)}};}};
const fu=async id=>(await api('GET',`/api/tasks/${id}/follow-up`)).data;
const tick=()=>api('POST','/api/follow-ups/tick',{});
const waitFor=async(fn,ms=6000)=>{const end=Date.now()+ms;let v;while(Date.now()<end){try{v=await fn();if(v)return v;}catch{}await sleep(150);}return v;};
async function dueAndTick(id){const next=Date.parse((await fu(id))?.followUp?.schedule?.nextCheckAt);if(Number.isFinite(next)&&next>clockNow())await advance(next-clockNow()+1000);return tick();}
const checkRows=fid=>{const d=new DatabaseSync(scope+'/data/opstwin-advance.db');try{return d.prepare("SELECT data FROM follow_up_checks WHERE json_extract(data,'$.followUpId')=? ORDER BY rowid").all(fid).map(r=>JSON.parse(r.data));}finally{d.close();}};
async function create(conv,itemId,body){const t=(await api('POST','/api/tasks',{title:'适配器跟进 '+conv,status:'active'})).data.id;
 const r=await api('POST',`/api/tasks/${t}/follow-up`,{operationId:'op-'+conv,conversationId:conv,authority:{messageId:'auth-'+conv,evidence:authority[conv]},itemId,checkAt:iso(MIN),...body});return {taskId:t,...r};}
const touch=id=>api('PATCH','/api/inbox/'+id,{title:'QA '+id});// a real inbox entity change (source event)
// Event + tick, then wait until a revalidation completed after the event (assertions are never vacuous).
async function revalidated(taskId,itemId){const before=(await fu(taskId))?.followUp?.runtime?.lastRevalidatedAt||'';await sleep(DEBOUNCE_WAIT);await touch(itemId);await tick();
 return waitFor(async()=>{const v=(await fu(taskId))?.followUp;return v?.runtime?.lastRevalidatedAt&&v.runtime.lastRevalidatedAt>before&&v;},6000);}
const DEBOUNCE_WAIT=1000;

const report={kind:'follow-up-adapters-http-e2e',ports:{api:port,provider:modelPort},startedAt:new Date().toISOString()};
try{
 {const d=new DatabaseSync(scope+'/data/opstwin-advance.db');d.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');d.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');d.close();}
 await advance(0);await start();
 let alice,carol,team,bob,wx;

 await scenario('feishu-epoch-creation',async()=>{
  const item=(await api('GET','/api/inbox/live-oc_alice')).data;
  check('seeded Feishu item keeps raw epoch create_time strings',/^\d{13}$/.test(String(item.messages?.[0]?.sentAt)),item.messages?.[0]?.sentAt);
  alice=await create('conv-alice','live-oc_alice',{requestMessageId:'om_areq',personId:'ou_alice',predicate:{kind:'reply_from_person'}});
  check('creation on a production-shaped Feishu item succeeds (no request_time_unknown)',alice.status===201,alice.data);
  check('anchor time normalized from epoch',alice.data?.followUp?.binding?.requestSentAt===new Date(A).toISOString(),alice.data?.followUp?.binding);
 });

 await scenario('feishu-cache-missing-live-candidate',async()=>{
  if(!alice?.taskId)return check('precondition',false);
  S.feishu.chats.oc_alice.push(fm('om_anew','oc_alice','ou_alice','收到，周五前确认',Date.now()));await save();
  await dueAndTick(alice.taskId);
  const v=await waitFor(async()=>{const x=await fu(alice.taskId);return x?.followUp?.state==='completed'&&x;});
  check('a fresh live reply that is not in the inbox cache completes',v?.followUp?.evidence?.messageId==='om_anew',v?.followUp?.state);
  check('the inbox cache still lacks it (live read, not cache)',!(await api('GET','/api/inbox/live-oc_alice')).data.messages.some(m=>m.id==='om_anew'));
  const v1=await revalidated(alice.taskId,'live-oc_alice');
  check('revalidation after a source event keeps the live evidence valid (cache miss is not retraction)',v1?.runtime?.lastRevalidation==='valid'&&v1?.evidence?.status==='valid',v1?.runtime);
 });

 await scenario('feishu-partial-is-not-recall',async()=>{
  if((await fu(alice?.taskId))?.followUp?.state!=='completed')return check('precondition',false);
  const keep=S.feishu.chats.oc_alice;S.feishu.chats.oc_alice=keep.filter(m=>m.message_id!=='om_anew');S.feishu.mode='limited';await save();
  const v2=await revalidated(alice.taskId,'live-oc_alice');
  check('limited pagination with the message absent is unknown; evidence stays valid',v2?.runtime?.lastRevalidation==='unknown'&&v2?.evidence?.status==='valid',v2?.runtime);
  S.feishu.mode='fail';await save();const v3=await revalidated(alice.taskId,'live-oc_alice');
  check('a failed read is unknown; evidence stays valid',v3?.runtime?.lastRevalidation==='unknown'&&v3?.evidence?.status==='valid',v3?.runtime);
  S.feishu.mode='ok';S.feishu.chats.oc_alice=keep.map(m=>m.message_id==='om_anew'?{...m,deleted:true}:m);await save();
  await touch('live-oc_alice');await tick();
  const f=await waitFor(async()=>{const x=(await fu(alice.taskId))?.followUp;return x?.evidence?.status==='invalid'&&x;});
  check('a real deletion under complete coverage marks evidence invalid; completion preserved',f?.state==='completed'&&f?.evidence?.invalidReason==='evidence_removed'&&!!f?.outcome?.at,f?.evidence);
 });

 await scenario('feishu-formatted-time-recovery',async()=>{
  carol=await create('conv-carol','live-oc_carol',{requestMessageId:'om_creq',personId:'ou_carol',predicate:{kind:'reply_from_person'}});
  if(!check('created',carol.status===201,carol.data))return;
  const at=Date.now();S.feishu.chats.oc_carol.push(fm('om_cnew','oc_carol','ou_carol','材料已发',at,{create_time:'2026-11-07 10:00:00'}));S.feishu.raw.om_cnew=String(at);S.feishu.rawFail=true;await save();
  await dueAndTick(carol.taskId);await sleep(500);
  check('formatted time without raw recovery is partial, not completion',(await fu(carol.taskId))?.followUp?.state==='waiting'&&(await fu(carol.taskId))?.lastCheck?.coverage!=='complete',(await fu(carol.taskId))?.lastCheck);
  S.feishu.rawFail=false;await save();await dueAndTick(carol.taskId);
  check('exact raw epoch recovered by message id completes',await waitFor(async()=>(await fu(carol.taskId))?.followUp?.state==='completed'));
 });

 await scenario('feishu-group-reply-relation',async()=>{
  team=await create('conv-team','live-oc_team',{requestMessageId:'om_treq',personId:'ou_erin',predicate:{kind:'reply_from_person'}});
  if(!check('created',team.status===201,team.data))return;
  S.feishu.chats.oc_team.push(fm('om_fr','oc_team','ou_frank','周四也行',Date.now(),{parent_id:'om_treq'}));await save();await dueAndTick(team.taskId);
  check('another person replying to the request does not complete',(await fu(team.taskId))?.followUp?.state==='waiting');
  S.feishu.chats.oc_team.push(fm('om_e1','oc_team','ou_erin','我晚点看日程',Date.now()));await save();await dueAndTick(team.taskId);
  check('the same person without a reply relation does not complete',(await fu(team.taskId))?.followUp?.state==='waiting');
  S.feishu.chats.oc_team.push(fm('om_e2','oc_team','ou_erin','确认周四 22:00',Date.now(),{parent_id:'om_treq'}));await save();await dueAndTick(team.taskId);
  check('the exact person replying to the anchored request (parent_id) completes',await waitFor(async()=>(await fu(team.taskId))?.followUp?.evidence?.messageId==='om_e2'));
 });

 await scenario('feishu-edit-during-model-and-confirm',async()=>{
  bob=await create('conv-bob','live-oc_bob',{requestMessageId:'om_breq',personId:'ou_bob',predicate:{kind:'judgment',criterion:'Bob 同意方案 B'}});
  if(!check('created',bob.status===201,bob.data))return;
  const fid=bob.data.followUp.id;S.feishu.chats.oc_bob.push(fm('om_b1','oc_bob','ou_bob','可以',Date.now()));await save();
  plan.hang=true;const h0=hung.length;await dueAndTick(bob.taskId);
  if(!check('inference started',await waitFor(()=>hung.length>h0)))return;
  S.feishu.chats.oc_bob=S.feishu.chats.oc_bob.map(m=>m.message_id==='om_b1'?{...m,body:{content:JSON.stringify({text:'可以……先别定'})}}:m);await save();
  plan.hang=false;release();
  const done=await waitFor(()=>checkRows(fid).find(c=>c.state==='evaluated'));
  check('a live edit while the model is pending blocks adoption',done?.adopted===false&&done?.discardReason==='candidate_changed',done);
  check('background calls were tool-less',background.length>0&&background.every(n=>n===0),background);
  await dueAndTick(bob.taskId);
  const nj=await waitFor(async()=>{const x=await fu(bob.taskId);return x?.followUp?.state==='needs_judgment'&&x;});
  if(!check('the current text becomes the candidate',!!nj))return;
  S.feishu.chats.oc_bob=S.feishu.chats.oc_bob.map(m=>m.message_id==='om_b1'?{...m,body:{content:JSON.stringify({text:'不行'})}}:m);await save();
  const d=await api('POST',`/api/tasks/${bob.taskId}/follow-up/decide`,{operationId:'op-bob-confirm',revision:nj.followUp.revision,checkId:nj.followUp.candidate.checkId,decision:'confirm'});
  check('confirm after a live edit is rejected (evidence_changed)',d.status===409&&d.data.error==='evidence_changed',d);
 });

 await scenario('feishu-authority-revoked-during-confirm',async()=>{
  const b2=await create('conv-bob2','live-oc_bob',{requestMessageId:'om_breq',personId:'ou_bob',predicate:{kind:'judgment',criterion:'Bob 同意'}});
  if(!check('created',b2.status===201,b2.data))return;
  await dueAndTick(b2.taskId);const nj=await waitFor(async()=>{const x=await fu(b2.taskId);return x?.followUp?.state==='needs_judgment'&&x;});
  if(!check('reached needs_judgment',!!nj))return;
  S.feishu.delayMs=1500;await save();
  const pending=api('POST',`/api/tasks/${b2.taskId}/follow-up/decide`,{operationId:'op-b2-confirm',revision:nj.followUp.revision,checkId:nj.followUp.candidate.checkId,decision:'confirm'});
  await sleep(400);await api('DELETE','/api/conversations/conv-bob2');
  const d=await pending;S.feishu.delayMs=0;await save();
  check('deleting the owning conversation during the confirm read prevents completion',d.status===409&&(await fu(b2.taskId))?.followUp?.state!=='completed',d);
 });

 await scenario('feishu-anchor-edited-or-deleted',async()=>{
  const ivy=await create('conv-ivy','live-oc_ivy',{requestMessageId:'om_ireq',personId:'ou_ivy',predicate:{kind:'reply_from_person'}});
  if(!check('created',ivy.status===201,ivy.data))return;
  const orig=S.feishu.chats.oc_ivy.find(m=>m.message_id==='om_ireq');
  S.feishu.chats.oc_ivy=S.feishu.chats.oc_ivy.map(m=>m.message_id==='om_ireq'?{...m,body:{content:JSON.stringify({text:'请回复另一份清单'})}}:m);
  S.feishu.chats.oc_ivy.push(fm('om_i1','oc_ivy','ou_ivy','收到',Date.now()));await save();await dueAndTick(ivy.taskId);await sleep(300);
  let v=await fu(ivy.taskId);
  check('edited request + later reply does not complete (anchor_changed)',v?.followUp?.state==='waiting'&&v?.lastCheck?.reason==='anchor_changed',v?.lastCheck);
  S.feishu.chats.oc_ivy=S.feishu.chats.oc_ivy.map(m=>m.message_id==='om_ireq'?{...orig,deleted:true}:m);await save();await dueAndTick(ivy.taskId);await sleep(300);
  v=await fu(ivy.taskId);
  check('deleted request under complete coverage + later reply does not complete (anchor_missing)',v?.followUp?.state==='waiting'&&v?.lastCheck?.reason==='anchor_missing',v?.lastCheck);
 });

 await scenario('feishu-scope-change-reads-nothing',async()=>{
  if(!bob?.taskId)return check('precondition',false);
  // The rejected confirm reopened the matter; the worker may already have raised the edited text again.
  let v=(await fu(bob.taskId))?.followUp;
  if(v?.state==='needs_judgment'){await api('POST',`/api/tasks/${bob.taskId}/follow-up/decide`,{operationId:'op-bob-cont',revision:v.revision,checkId:v.candidate.checkId,decision:'continue'});v=(await fu(bob.taskId))?.followUp;}
  if(!check('precondition: Bob waiting',v?.state==='waiting',v?.state))return;
  const p=await api('PATCH','/api/connections/feishu-local',{config:{authMethod:'none',scopes:[{id:'oc_other',chatId:'oc_other',enabled:true}]}});
  if(p.status!==200){checks.push({case:currentCase,name:'scope change via PATCH',pass:null,status:'NOT_RUN',why:'connection config PATCH refused: '+p.status});return;}
  S.feishu.chats.oc_bob.push(fm('om_b2','oc_bob','ou_bob','同意',Date.now()));await save();
  await dueAndTick(bob.taskId);await sleep(500);const last=(await fu(bob.taskId))?.lastCheck;
  check('after a read-scope change the bound matter reads nothing (unknown: connection_changed)',last?.result==='unknown'&&last?.reason==='connection_changed',last);
  check('and raises no candidate',(await fu(bob.taskId))?.followUp?.state==='waiting');
 });

 await scenario('wechat-live-candidate-and-coverage',async()=>{
  check('connect typed local source',(await api('POST','/api/wechat/connect',{})).data?.ok===true);
  const run=await api('POST','/api/wechat/sync',{});await waitFor(async()=>{const h=(await api('GET','/api/wechat/sync')).data?.history?.find(x=>x.id===run.data?.runId);return h&&h.status!=='running';},10000);
  const item=((await api('GET','/api/inbox')).data||[]).find(i=>i.channel==='WeChat');
  if(!check('real background sync produced the WeChat item',!!item&&item.messages?.some(m=>m.isMine===true)))return;
  wx=await create('conv-wx',item.id,{requestMessageId:'wx-req',personId:'public-incoming',predicate:{kind:'reply_from_person'}});
  if(!check('created on the synced WeChat item',wx.status===201,wx.data))return;
  S.wechat.coverageComplete=false;S.wechat.messages.push({id:'wx-new',conversationId:'public-chat',sender:'public-incoming',senderDisplayName:'公开来信人',createdAtUnix:Math.floor(Date.now()/1000),messageType:1,content:{Text:'时间可以'}});await save();
  await dueAndTick(wx.taskId);await sleep(500);
  check('fresh positive evidence completes even under incomplete coverage',(await fu(wx.taskId))?.followUp?.evidence?.messageId==='wx-new');
  check('inbox cache lacks the live reply',!(await api('GET','/api/inbox/'+item.id)).data.messages.some(m=>m.id==='wx-new'));
  S.wechat.messages=S.wechat.messages.filter(m=>m.id!=='wx-new');await save();let w=await revalidated(wx.taskId,item.id);
  check('absent under incomplete coverage is unknown, not retraction',w?.runtime?.lastRevalidation==='unknown'&&w?.evidence?.status==='valid',w?.runtime);
  S.wechat.coverageComplete=true;S.wechat.foreign=true;await save();w=await revalidated(wx.taskId,item.id);
  check('a foreign-conversation row makes the read partial (no retraction)',w?.runtime?.lastRevalidation==='unknown'&&w?.evidence?.status==='valid',w?.runtime);
  S.wechat.foreign=false;S.wechat.source='public-b';await save();w=await revalidated(wx.taskId,item.id);
  check('a changed account identity is unknown, not retraction',w?.runtime?.lastRevalidation==='unknown'&&w?.evidence?.status==='valid',w?.runtime);
  S.wechat.source='public-a';await save();await touch(item.id);await tick();
  check('complete coverage without the message marks it removed',await waitFor(async()=>(await fu(wx.taskId))?.followUp?.evidence?.status==='invalid'));
 });
}catch(e){currentCase='fatal';check('suite reached the end',false,String(e?.stack||e));}
finally{
 await stop();provider.close();await rm(scope+'/config.json',{force:true}).catch(()=>{});
 const failed=checks.filter(c=>c.pass===false).length,passed=checks.filter(c=>c.pass===true).length,notRun=checks.filter(c=>c.status==='NOT_RUN').length;
 Object.assign(report,{finishedAt:new Date().toISOString(),totals:{passed,failed,notRun},checks,boundary:'Production Feishu/WeChat adapter code over synthetic public CLIs; no real account, message or send; not browser/installed.'});
 await writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out:out+'/result.json',passed,failed,notRun}));process.exit(failed?1:0);
}
