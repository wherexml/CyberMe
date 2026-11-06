// Failure cases: docs/public/intent-handling.md. Public synthetic data, isolated SQLite, controlled judgment model and no external sending.
// Run: node --import tsx scripts/intent-handling-http-e2e.mjs
// Browser fixture: node --import tsx scripts/intent-handling-http-e2e.mjs --serve
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const keep=process.argv.includes('--serve');
const restartScope=process.argv.find(a=>a.startsWith('--restart-check='))?.split('=')[1];
const port=46840,modelPort=46841;
const scope=restartScope||resolve('.local/acceptance/intent-handling-'+randomUUID()),out=resolve('output/intent-handling');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
if(!restartScope)await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-draft'}}),{mode:0o600});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',JEV_API_KEY:'public-fixture-key'});

// Controlled judgment provider: every model call is counted and nothing leaves this process.
let modelCalls=0,modelPlan=()=>({kind:'no_action'}),onModelCall=null,lastJudgmentState=null;
const callsByTitle={};
const realFetch=globalThis.fetch;
const noul=n=>({type:'noul',noul:n});
const choice=c=>({type:'choice',choice:c,confidence:.95,probabilities:{[c]:.95}});
function modelAnswer(state,plan){
 const at=id=>state.recentMessages.findIndex(m=>m.id===id);
 const base={reply:noul(.05),owner:noul(.05),deep:noul(.05),missing:noul(.05),risk:noul(.05),answered:noul(.05),reason:{...choice('fyi'),probabilities:{fyi:.95}},priority:choice('low'),action:choice('none'),resolution:choice('none'),request:choice('unknown'),replyEvidence:choice('none')};
 if(plan.kind==='no_action'&&plan.requestId)base.request=choice('m'+at(plan.requestId));
 if(plan.kind==='open')Object.assign(base,{reply:noul(.95),owner:noul(.3),reason:{...choice('direct_request'),probabilities:{direct_request:.95}},priority:choice('medium'),action:choice('reply'),resolution:choice('open'),request:choice('m'+at(plan.requestId))});
 if(plan.kind==='unidentified')Object.assign(base,{reply:noul(.9),owner:noul(.4),reason:{...choice('unclear'),probabilities:{unclear:.95}},priority:choice('unknown'),action:choice('unknown'),resolution:choice('unknown')});
 return {model:'public-judgment',answers:base,usage:{}};
}
globalThis.fetch=async(url,init)=>{
 if(!String(url).startsWith('https://api.typesafe.ai/'))return realFetch(url,init);
 modelCalls++;const input=JSON.parse(init.body);lastJudgmentState=input.state;callsByTitle[input.state.message.title]=(callsByTitle[input.state.message.title]||0)+1;
 if(onModelCall){const hook=onModelCall;onModelCall=null;await hook(input);}
 const plan=modelPlan(input.state);
 if(plan.kind==='http')return new Response('{}',{status:plan.status,headers:{'content-type':'application/json'}});
 return new Response(JSON.stringify(modelAnswer(input.state,plan)),{status:200,headers:{'content-type':'application/json'}});
};

const S=await import('../server/src/store.ts');
const checks=[];
function check(name,pass,evidence){checks.push({name,pass:!!pass,...(evidence===undefined?{}:{evidence})});assert.ok(pass,name+(evidence===undefined?'':' '+JSON.stringify(evidence)))}

if(restartScope){
 // A new process over the same data directory: the dismissal must be read from canonical state.
 const row=S.get('inbox','restart-dismissed');
 check('dismissal survives process restart',row?.status==='dismissed'&&!!row.attentionDismissal?.id&&row.attention?.surface==='none',row?.status);
 console.log(JSON.stringify({pass:true,checks:checks.length}));S.db.close();process.exit(0);
}

// Controlled draft model: a real agent run over HTTP that can be held open past a dismissal.
let draftArrived=()=>{},draftHold=Promise.resolve();
const draftModel=createServer(async(req,res)=>{for await(const _ of req);draftArrived();await draftHold;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-draft',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 chunk({role:'assistant',content:'公开生成的候选草稿'});chunk({},'stop');res.end('data: [DONE]\n\n');
});await new Promise(r=>draftModel.listen(modelPort,'127.0.0.1',r));

S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开验收'});S.setMeta('primaryConversationId','primary');

const iso=(minutes=-60)=>new Date(Date.now()+minutes*60000).toISOString();
const m=(id,text,minutes=-60,extra={})=>({id,text,isMine:false,senderId:'public-contact',senderName:'公开联系人',sentAt:iso(minutes),...extra});
const ok={status:'succeeded',method:'jev',model:'public-judgment',needsReply:.05,needsOwner:.05,needsDeepThink:.05,missingContext:.05,risk:.05,route:'no_reply',priority:'low',actionType:'none',resolution:'none',reason:'fyi'};
const open=requestMessageId=>({...ok,route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',needsReply:.95,reason:'direct_request',requestMessageId});
function seed(id,fields,triage){
 const item=S.put('inbox',{id,title:'公开事项 '+id,sender:'公开联系人',senderId:'public-contact-'+id,channel:'Internal',origin:'human',status:'pending',body:'公开合成正文',...fields});
 if(triage)S.put('inbox_triages',{id,...triage,sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,completedAt:S.now()});
 return S.get('inbox',id);
}
function seedScenarios(){
 seed('fyi-system',{title:'联系人变更通知',messages:[m('fyi-system-1','系统提示：公开联系人已更新名片')]},ok);
 seed('fyi-marketing',{title:'限时优惠活动',messages:[m('fyi-marketing-1','本周限时优惠，欢迎了解')]},ok);
 seed('ordinary-chat',{title:'普通闲聊',messages:Array.from({length:30},(_,i)=>m('chat-'+i,'今天天气不错，随便聊聊 '+i,-120+i))},ok);
 seed('short-request',{title:'简短请求',messages:[m('short-1','能确认吗？')]},open('short-1'));
 seed('resolved',{title:'已解决的讨论',messages:[m('resolved-1','请确认周五可以吗？',-90),{...m('resolved-2','可以，周五见',-60),isMine:true,senderId:'owner',senderName:'本人'}]},{...ok,resolution:'replied',reason:'acknowledgement',requestMessageId:'resolved-1',replyMessageId:'resolved-2'});
 seed('promised',{title:'只承诺未完成',messages:[m('promised-1','请把合同发给我',-90),{...m('promised-2','好，我晚点发',-60),isMine:true,senderId:'owner',senderName:'本人'}]},{...open('promised-1'),actionType:'decision',route:'review'});
 seed('time-fyi',{title:'无时间通知',messages:[{id:'time-fyi-1',text:'系统通知，无需处理',isMine:false,senderId:'public-contact'}]},ok);
 seed('time-risk',{title:'无时间的高风险请求',messages:[{id:'time-risk-1',text:'请今天批准这笔付款',isMine:false,senderId:'public-contact'}]},{...open('time-risk-1'),actionType:'decision',priority:'high',risk:.9,needsOwner:.9});
 seed('failed-plain',{title:'判断失败的普通消息',messages:[m('failed-plain-1','公开消息')]},{status:'failed',route:'review',error:'Jev 网络请求失败或超时，可重试；请人工判断。'});
 seed('failed-sensitive',{title:'判断失败的敏感事项',sensitive:true,messages:[m('failed-sensitive-1','公开敏感消息')]},{status:'failed',route:'review',error:'Jev 网络请求失败或超时，可重试；请人工判断。'});
 seed('read-failed',{title:'来源不可用',channel:'WeChat',messages:[m('read-failed-1','公开消息')]});
 seed('read-failed-open',{title:'来源不可用但有未决请求',channel:'WeChat',messages:[m('read-failed-open-1','请确认')]},open('read-failed-open-1'));
 seed('missing-question',{title:'缺资料的请求',v6:{question:'这份报表使用哪个季度的数据？'},messages:[m('missing-question-1','请发我报表')]},{...open('missing-question-1'),route:'review',missingContext:.9,reason:'missing_material'});
 seed('missing-state',{title:'缺资料但没有明确问题',body:'{"raw":"不应显示"}',messages:[m('missing-state-1','请发我报表')]},{...open('missing-state-1'),route:'review',missingContext:.9,reason:'missing_material'});
 seed('manual-draft',{title:'无需回复但有人工草稿',draft:'人工草稿',editedByUser:true,messages:[m('manual-draft-1','公开通知')]},ok);
 seed('candidate-draft',{title:'无需回复但有候选稿',draftCandidate:{requestId:'public-candidate',text:'候选稿',artifactIds:[]},messages:[m('candidate-draft-1','公开通知')]},ok);
 seed('sending',{title:'发送中',status:'sending',draft:'公开草稿',messages:[m('sending-1','公开消息')]});
 seed('send-unknown',{title:'发送结果未知',status:'send_unknown',draft:'公开草稿',messages:[m('send-unknown-1','公开消息',-20000)]});
 seed('dismiss-a',{title:'待忽略的请求',draft:'保留的草稿',editedByUser:true,messages:[m('dismiss-a-1','请确认公开安排')]},open('dismiss-a-1'));
 seed('dismiss-classic',{title:'经典界面忽略',messages:[m('dismiss-classic-1','请确认经典界面')]},open('dismiss-classic-1'));
 seed('ignored-old',{title:'已忽略的旧请求',messages:[m('ignored-old-1','请确认旧安排')]},open('ignored-old-1'));
 seed('ignored-new',{title:'已忽略后来新请求',messages:[m('ignored-new-1','请确认旧安排')]},open('ignored-new-1'));
 seed('ignored-unclear',{title:'已忽略后不可识别',messages:[m('ignored-unclear-1','请确认旧安排')]},open('ignored-unclear-1'));
 seed('reeval-open',{title:'未决请求期间来源变化',messages:[m('reeval-open-1','请批准这项合同',-90)]},{...open('reeval-open-1'),actionType:'decision',priority:'high',needsOwner:.9,risk:.9});
 seed('race',{title:'分析期间来源变化',messages:[m('race-1','公开消息')]});
 seed('dedupe',{title:'并发判断',messages:[m('dedupe-1','公开消息')]});
 seed('edit-notice',{title:'被原地编辑的通知',messages:[m('edit-notice-1','系统通知：公开活动已结束')]},{...ok,requestMessageId:'edit-notice-1'});
 seed('idea-new',{title:'灵感来源有新请求',messages:[m('idea-new-1','请确认旧安排')]},open('idea-new-1'));
 seed('idea-pending',{title:'灵感来源判断待定',messages:[m('idea-pending-1','请确认旧安排')]},open('idea-pending-1'));
 seed('late-draft-manual',{title:'生成期间忽略且有人工草稿',draft:'人工草稿',editedByUser:true,messages:[m('late-draft-manual-1','请确认公开安排')]},open('late-draft-manual-1'));
 seed('late-draft-empty',{title:'生成期间忽略且无草稿',messages:[m('late-draft-empty-1','请确认公开安排')]},open('late-draft-empty-1'));
 for(const id of ['same-a','same-b'])seed(id,{title:'同发送者 '+id,senderId:'public-shared-sender',messages:[m(id+'-1','请确认公开安排 '+id)]},open(id+'-1'));
 S.put('source_jobs',{id:'public-job-queued',itemId:'processing-queued',mode:'draft',status:'queued'});
 seed('processing-queued',{title:'资料处理排队',sourceProcessing:{jobId:'public-job-queued',mode:'draft',status:'failed'},messages:[m('processing-queued-1','请确认公开资料')]},open('processing-queued-1'));
 seed('restart-dismissed',{title:'重启后仍忽略',messages:[m('restart-dismissed-1','请确认重启')]},open('restart-dismissed-1'));
}

const {app}=await import('../server/src/index.ts');
const T=await import('../server/src/inbox-triage.ts');
const {ideaSourcesClosed}=await import('../shared/inbox-attention.ts');
const gate=new Hono();
// Isolated fixture only: lets the browser check a real 200/failed judgment.
gate.post('/__fixture/model',async c=>{const plan=await c.req.json();modelPlan=()=>plan;return c.json({ok:true})});
gate.all('/api/*',c=>{if(/\/(send|approve|calendar)(\/|$)/.test(c.req.path))return c.json({error:'external_disabled'},403);return app.fetch(c.req.raw)});
gate.get('*',async c=>{const web=resolve('.local/intent-handling-web'),rel=c.req.path==='/'?'cyberme.html':c.req.path.slice(1),p=resolve(web,rel);if(!p.startsWith(web+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
async function request(path,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}`+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data}}
const read=async id=>(await request('/api/inbox/'+id)).data;
const dismiss=(row,operationId=randomUUID())=>request('/api/inbox/'+row.id+'/attention-dismissal','POST',{operationId,baseUpdatedAt:row.updatedAt});
const undo=(row,dismissalId=row.attentionDismissal?.id)=>request('/api/inbox/'+row.id+'/attention-dismissal/undo','POST',{dismissalId,baseUpdatedAt:row.updatedAt});
const chatCount=()=>S.db.prepare('SELECT count(*) n FROM chat_requests').get().n;
const sendCount=()=>S.db.prepare('SELECT count(*) n FROM send_intents').get().n;
const addMessage=(id,message)=>{const row=S.get('inbox',id);S.put('inbox',{...row,messages:[...row.messages,message]});};

let timer;
try{
 if(keep){
  seedScenarios();
  S.put('ideas',{id:'idea-closed-source',title:'来源已忽略的灵感',description:'不应显示',category:'insight',action:'task',status:'new',sourceIds:['ignored-old']});
  S.put('ideas',{id:'idea-live-source',title:'来源仍有效的灵感',description:'应当显示',category:'insight',action:'task',status:'new',sourceIds:['short-request']});
  await dismiss(await read('ignored-old'));
 }else{
  seedScenarios();
  const att=async id=>(await read(id)).attention;

  // Judgment → attention.
  for(const id of ['fyi-system','fyi-marketing','ordinary-chat','resolved','time-fyi']){
   const a=await att(id);check(id+' stays out of the Brief without dismissal',a.state==='quiet'&&a.surface==='none',a);
  }
  check('quiet record keeps raw access',(await read('fyi-marketing')).messages.length===1&&(await read('fyi-marketing')).status==='pending');
  const short=await att('short-request');check('short direct request is actionable',short.state==='actionable'&&short.surface==='decision',short);
  const longChat=await read('ordinary-chat');check('long chat is not inherently actionable',longChat.messages.length===30&&longChat.attention.surface==='none');
  const promised=await att('promised');check('a promise is not resolved work',promised.state==='actionable'&&promised.surface==='decision',promised);
  const timeRisk=await att('time-risk');check('time_unknown with a positive high-risk request surfaces',timeRisk.state==='actionable'&&timeRisk.surface==='insight'&&timeRisk.reason==='time_unknown',timeRisk);

  // Failures are system facts, not user tasks; protected states stay visible.
  const failed=await att('failed-plain');check('model failure alone produces no user card',failed.state==='system_error'&&failed.surface==='none',failed);
  check('model failure stays a diagnostic in the full Inbox',(await read('failed-plain')).disposition.placement==='verify');
  const failedSensitive=await att('failed-sensitive');check('failed judgment does not hide a sensitive item',failedSensitive.surface==='insight'&&failedSensitive.reason==='sensitive',failedSensitive);
  const readFailed=await att('read-failed');check('read failure alone produces no user card',readFailed.state==='system_error'&&readFailed.surface==='none',readFailed);
  const readOpen=await att('read-failed-open');check('read failure does not hide an open request',readOpen.surface==='insight'&&readOpen.reason==='source_unavailable',readOpen);
  const missingQ=await att('missing-question');check('explicit evidence exposes a specific question',missingQ.reason==='missing_context'&&missingQ.question==='这份报表使用哪个季度的数据？',missingQ);
  const missingS=await att('missing-state');check('no invented question without evidence',missingS.reason==='missing_context'&&!missingS.question&&missingS.detail==='missing_material',missingS);
  check('attention never carries raw JSON',!JSON.stringify(missingS).includes('不应显示'));
  for(const id of ['manual-draft','candidate-draft']){const a=await att(id);check(id+' stays visible despite a no-action judgment',a.surface==='insight'&&a.reason==='manual_draft',a);}

  // Unknown execution can never be dismissed or replayed.
  for(const id of ['sending','send-unknown']){
   const row=await read(id),a=row.attention;
   check(id+' stays visible and cannot be dismissed',a.state==='execution'&&a.surface==='insight'&&a.canDismiss===false,a);
   const r=await dismiss(row);check(id+' dismissal rejected',r.status===409&&r.data.error==='dismiss_blocked',r);
   check(id+' status unchanged',(await read(id)).status===row.status);
  }

  // Legacy closures and classic writes cannot hide a still-unknown generation result.
  seed('draft-unknown',{title:'生成结果未知',draftPreparation:{status:'unknown'},messages:[m('draft-unknown-1','请确认')]});
  seed('closed-draft-unknown',{title:'旧关闭记录的生成结果未知',status:'dismissed',draftPreparation:{status:'unknown'},messages:[m('closed-draft-unknown-1','请确认')]});
  for(const id of ['draft-unknown','closed-draft-unknown']){
   const row=await read(id);check(id+' unknown generation remains visible',row.attention.state==='execution'&&row.attention.canDismiss===false,row.attention);
   check(id+' direct dismissal blocked',(await dismiss(row)).status===409);
  }
  const unknownDraft=await read('draft-unknown');
  check('classic dismissal of unknown draft blocked',(await request('/api/inbox/draft-unknown','PATCH',{status:'dismissed',baseUpdatedAt:unknownDraft.updatedAt})).status===409);
  check('classic refusal preserves unknown draft',(await read('draft-unknown')).status==='pending');

  // Direct dismissal, refresh and version races.
  const chatBefore=chatCount(),modelBefore=modelCalls;
  const a0=await read('dismiss-a');
  check('stale dismissal rejected',(await request('/api/inbox/dismiss-a/attention-dismissal','POST',{operationId:randomUUID(),baseUpdatedAt:'2000-01-01T00:00:00.000Z'})).status===409);
  check('stale dismissal changes nothing',(await read('dismiss-a')).status==='pending');
  const op=randomUUID(),d1=await dismiss(a0,op);
  check('dismiss succeeds directly',d1.status===200&&d1.data.item.status==='dismissed'&&d1.data.item.attention.surface==='none',d1.status);
  const a1=await read('dismiss-a');
  check('refresh agrees with dismissal',a1.status==='dismissed'&&a1.attentionDismissal.requestMessageId==='dismiss-a-1');
  check('dismissal does not touch the draft',a1.draft==='保留的草稿');
  check('dismissal records a closure time',!!a1.closedAt);
  const replay=await dismiss(a0,op);check('dismiss replay is idempotent',replay.status===200&&replay.data.replayed===true&&replay.data.item.attentionDismissal.id===a1.attentionDismissal.id,replay.status);
  check('forged dismissal binding rejected',(await request('/api/inbox/short-request','PATCH',{attentionDismissal:{id:'forged'}})).status===403);
  check('forged attention projection rejected',(await request('/api/inbox/short-request','PATCH',{attention:{state:'quiet'}})).status===403);
  check('list projection agrees with the record',(await request('/api/inbox/query?status=dismissed&limit=200')).data.items.some(r=>r.id==='dismiss-a'));
  check('dismissing one matter does not block the sender',(await request('/api/inbox/dismiss-a/feedback')).status===200&&(await att('short-request')).surface==='decision');
  check('stale undo rejected',(await request('/api/inbox/dismiss-a/attention-dismissal/undo','POST',{dismissalId:a1.attentionDismissal.id,baseUpdatedAt:'2000-01-01T00:00:00.000Z'})).status===409);
  check('wrong dismissal id rejected',(await undo(a1,'other-dismissal')).status===409);
  S.put('inbox',{...S.get('inbox','dismiss-a'),draft:'之后更新的草稿',editedByUser:true});
  const a2=await read('dismiss-a'),u1=await undo(a2);
  check('undo restores the exact prior status',u1.status===200&&u1.data.item.status==='pending'&&!u1.data.item.attentionDismissal,u1.status);
  check('undo does not overwrite a newer draft',(await read('dismiss-a')).draft==='之后更新的草稿');
  check('undo clears the closure',!(await read('dismiss-a')).closedAt);
  check('undo does not fake a manual override',!(await read('dismiss-a')).attentionOverride);
  check('undo deactivates sender feedback',(await read('dismiss-a')).dismissalFeedbackActive===false);
  const a3=await read('dismiss-a');check('undo replay is idempotent',(await undo(a3,a2.attentionDismissal.id)).data.replayed===true);
  const a4=(await dismiss(a3)).data.item;check('old undo cannot revert a newer dismissal',(await undo(a4,a2.attentionDismissal.id)).status===409&&(await read('dismiss-a')).status==='dismissed');
  check('simple actions make no chat or model calls',chatCount()===chatBefore&&modelCalls===modelBefore,{chat:chatCount()-chatBefore,model:modelCalls-modelBefore});

  // Classic and V6 agree because they share canonical state.
  const c0=await read('dismiss-classic'),c1=await request('/api/inbox/dismiss-classic','PATCH',{status:'dismissed',baseUpdatedAt:c0.updatedAt});
  check('classic dismissal writes the same binding',c1.status===200&&(await read('dismiss-classic')).attentionDismissal.requestMessageId==='dismiss-classic-1');
  check('classic dismissal is quiet in V6',(await att('dismiss-classic')).surface==='none');
  const c2=await read('dismiss-classic'),c3=await undo(c2);check('V6 undo reverses a classic dismissal',c3.status===200&&c3.data.item.status==='pending');
  const c4=await read('dismiss-classic');await request('/api/inbox/dismiss-classic','PATCH',{status:'dismissed',baseUpdatedAt:c4.updatedAt});
  const c5=await read('dismiss-classic');await request('/api/inbox/dismiss-classic','PATCH',{status:'pending',baseUpdatedAt:c5.updatedAt});
  const c6=await read('dismiss-classic');check('classic reopen clears the binding and surfaces',c6.status==='pending'&&!c6.attentionDismissal&&c6.attention.surface==='decision',c6.attention);

  // Ignored request plus unrelated follow-up, versus a genuinely new request.
  await dismiss(await read('ignored-old'));
  addMessage('ignored-old',m('ignored-old-2','顺便说一句今天天气不错',-1));
  const pendingOld=await att('ignored-old');check('unrelated follow-up does not revive while judgment is pending',pendingOld.state==='reevaluating'&&pendingOld.surface==='none',pendingOld);
  modelPlan=()=>({kind:'open',requestId:'ignored-old-1'});
  const sameTriage=await request('/api/inbox/ignored-old/triage','POST',{force:true});
  check('same request after follow-up stays dismissed',sameTriage.status===200&&(await read('ignored-old')).disposition.primaryReason==='dismissed'&&(await att('ignored-old')).surface==='none',await att('ignored-old'));
  check('same request creates no round',!(await request('/api/inbox')).data.some?.(r=>r.sourceParentInboxId==='ignored-old'));
  modelPlan=()=>({kind:'no_action',requestId:'ignored-old-2'});
  await request('/api/inbox/ignored-old/triage','POST',{force:true});check('no-action follow-up stays dismissed',(await att('ignored-old')).surface==='none');

  await dismiss(await read('ignored-new'));
  addMessage('ignored-new',m('ignored-new-2','另外请确认新的合同条款',-1));
  modelPlan=()=>({kind:'open',requestId:'ignored-new-2'});
  await request('/api/inbox/ignored-new/triage','POST',{force:true});
  const rounds=(await request('/api/inbox')).data.filter(r=>r.sourceParentInboxId==='ignored-new');
  check('genuine new request re-enters as an independent round',rounds.length===1&&rounds[0].attention.surface==='decision'&&rounds[0].requestRoundId==='ignored-new-2',rounds.map(r=>r.attention));
  const oldRound=await read('ignored-new');check('the old dismissed matter keeps its state',oldRound.status==='dismissed'&&oldRound.attention.surface==='none');
  const blocked=await undo(oldRound);check('undo cannot pull back a forwarded matter',blocked.status===409&&blocked.data.error==='dismissal_forwarded',blocked);
  await request('/api/inbox/ignored-new/triage','POST',{force:true});check('repeat analysis creates no duplicate round',(await request('/api/inbox')).data.filter(r=>r.sourceParentInboxId==='ignored-new').length===1);

  await dismiss(await read('ignored-unclear'));
  addMessage('ignored-unclear',m('ignored-unclear-2','这个到底怎么处理？',-1));
  modelPlan=()=>({kind:'unidentified'});
  await request('/api/inbox/ignored-unclear/triage','POST',{force:true});
  const unclear=await att('ignored-unclear');check('unidentified strong request is not permanently suppressed',unclear.surface==='insight'&&unclear.reason==='new_request',unclear);

  // In-place edits: metadata stays quiet, substantive edits re-enter, rounds never duplicate or reuse keys.
  const rewrite=(id,change)=>{const row=S.get('inbox',id);S.put('inbox',{...row,messages:row.messages.map(change)})};
  const roundsOf=async id=>(await request('/api/inbox')).data.filter(r=>r.sourceParentInboxId===id);
  await dismiss(await read('edit-notice'));
  rewrite('edit-notice',x=>({...x,senderName:'公开联系人新名片',avatarUrl:'https://example.invalid/a.png',createdAt:iso(-1),syncedAt:iso(0)}));
  const meta=await att('edit-notice');check('metadata-only change stays quiet before judgment',meta.state==='quiet'&&meta.surface==='none',meta);
  modelPlan=()=>({kind:'open',requestId:'edit-notice-1'});
  await request('/api/inbox/edit-notice/triage','POST',{force:true});
  check('metadata-only change stays quiet after judgment',(await att('edit-notice')).surface==='none'&&(await roundsOf('edit-notice')).length===0);
  const editTo=text=>rewrite('edit-notice',x=>({...x,text}));
  editTo('请今天批准这笔公开付款');
  const editing=await att('edit-notice');check('substantive edit stays silent until reevaluated',editing.state==='reevaluating'&&editing.surface==='none',editing);
  modelPlan=()=>({kind:'no_action',requestId:'edit-notice-1'});
  await request('/api/inbox/edit-notice/triage','POST',{force:true});
  check('edit judged as no action stays dismissed',(await att('edit-notice')).surface==='none'&&(await roundsOf('edit-notice')).length===0);
  editTo('请今天批准这笔公开付款，金额已调整');
  modelPlan=()=>({kind:'open',requestId:'edit-notice-1'});
  await request('/api/inbox/edit-notice/triage','POST',{force:true});
  const edited=await roundsOf('edit-notice');
  check('same-id substantive edit re-enters as one round',edited.length===1&&edited[0].attention.surface==='decision'&&edited[0].requestRoundId==='edit-notice-1',edited.map(r=>r.attention));
  check('edited round carries no draft or send key',!edited[0].draft&&!edited[0].sendKey&&!edited[0].approved);
  check('old dismissed record stays quiet after forwarding',(await read('edit-notice')).status==='dismissed'&&(await att('edit-notice')).surface==='none');
  editTo('请今天批准这笔公开付款，金额再次调整');
  await request('/api/inbox/edit-notice/triage','POST',{force:true});
  const editedAgain=await roundsOf('edit-notice');
  check('editing a forwarded request with an open round adds no round',editedAgain.length===1&&editedAgain[0].id===edited[0].id);
  check('the open round received the edit',editedAgain[0].messages[0].text==='请今天批准这笔公开付款，金额再次调整');
  await request('/api/inbox/'+edited[0].id,'PATCH',{status:'done',baseUpdatedAt:editedAgain[0].updatedAt});
  await request('/api/inbox/edit-notice/triage','POST',{force:true});
  check('reanalysis of the same revision adds no round',(await roundsOf('edit-notice')).length===1);
  editTo('请今天批准这笔公开付款，这是新的金额');
  await request('/api/inbox/edit-notice/triage','POST',{force:true});
  const third=await roundsOf('edit-notice'),fresh=third.find(r=>r.id!==edited[0].id);
  check('edit after a finished round creates a separate round',third.length===2&&!!fresh&&fresh.attention.surface==='decision',third.map(r=>r.id));
  check('the finished round is untouched',(await read(edited[0].id)).status==='done');
  check('the new round reuses no outbound key',!fresh.draft&&!fresh.sendKey&&!fresh.approved&&!fresh.receipt);
  await request('/api/inbox/edit-notice/triage','POST',{force:true});check('repeat analysis keeps two rounds',(await roundsOf('edit-notice')).length===2);

  // Same-sender feedback invalidates judgments once, without hiding or blocking.
  const sameBefore=await read('same-b');const same=await read('same-a');
  await dismiss(same);
  const sameAfter=await read('same-b');
  check('feedback invalidates the other judgment',sameBefore.triage?.status==='succeeded'&&!sameAfter.triage);
  check('open request stays visible while invalidated',sameAfter.attention.surface==='decision'&&sameAfter.attention.reason==='reevaluating_open',sameAfter.attention);
  const sameCalls=modelCalls;await request('/api/bootstrap');await read('same-b');check('invalidation alone calls no model',modelCalls===sameCalls);
  modelPlan=()=>({kind:'open',requestId:'same-b-1'});
  await request('/api/inbox/same-b/triage','POST',{});
  check('feedback reaches the model as weak evidence',lastJudgmentState?.dismissalFeedback?.some(f=>f.itemId==='same-a'));
  check('reevaluation calls the model once',modelCalls===sameCalls+1);
  check('sender is not blocked',(await att('same-b')).surface==='decision');
  await undo(await read('same-a'));
  check('undo restores the dismissed matter',(await read('same-a')).status==='pending');
  check('undo keeps the other request visible',(await att('same-b')).surface==='decision');
  modelPlan=()=>({kind:'open',requestId:'same-b-1'});
  await request('/api/inbox/same-b/triage','POST',{});
  check('feedback is inactive after undo',!lastJudgmentState?.dismissalFeedback?.some(f=>f.itemId==='same-a'));

  // A real draft generation that finishes after the dismissal.
  for(const [id,manual] of [['late-draft-manual','人工草稿'],['late-draft-empty',undefined]]){
   let release;draftHold=new Promise(r=>{release=r});
   const arrived=new Promise(r=>{draftArrived=r});
   const pendingDraft=request('/api/inbox/'+id+'/draft','POST',{requestId:'public-late-'+id,mode:'chat'});
   await arrived;
   const before=(await dismiss(await read(id))).data.item;
   check(id+' dismissed while generation is running',before.status==='dismissed');
   release();const finished=await pendingDraft;
   const after=await read(id);
   check(id+' generation really finished after the dismissal',!!after.draftCandidate?.text&&after.draftCandidate.text.includes('公开生成的候选草稿'),{status:finished.status,candidate:after.draftCandidate?.text});
   check(id+' canonical dismissal is kept',after.status==='dismissed'&&after.attentionDismissal?.id===before.attentionDismissal.id);
   check(id+' stays quiet',after.attention.surface==='none',after.attention);
   check(id+' manual data is not dropped',after.draft===manual&&(manual?after.editedByUser===true:true));
   const restored=await undo(after);
   check(id+' undo keeps the draft and candidate',restored.status===200&&restored.data.item.status==='pending'&&restored.data.item.draft===manual&&!!restored.data.item.draftCandidate);
  }
  draftHold=Promise.resolve();

  // Recheck responses: HTTP 200 does not mean finished.
  modelPlan=()=>({kind:'http',status:500});
  const failedRecheck=await request('/api/inbox/failed-plain/triage','POST',{force:true});
  check('failed judgment is an HTTP 200 with failed status',failedRecheck.status===200&&failedRecheck.data.status==='failed',failedRecheck.status);
  const queuedRecheck=await request('/api/inbox/processing-queued/process-source/retry','POST',{});
  check('source retry only reports queued',queuedRecheck.status===200&&queuedRecheck.data.status==='queued',queuedRecheck);
  modelPlan=()=>({kind:'no_action'});

  // Consequential request stays visible while its judgment is stale.
  addMessage('reeval-open',m('reeval-open-2','有消息吗',-1));
  const reeval=await att('reeval-open');check('open request stays visible during reevaluation',reeval.surface==='decision'&&reeval.reason==='reevaluating_open',reeval);
  modelPlan=()=>({kind:'http',status:500});
  await request('/api/inbox/reeval-open/triage','POST',{force:true});
  const reevalFailed=await att('reeval-open');check('open request stays visible after a failed reevaluation',reevalFailed.surface==='decision'&&reevalFailed.reason==='reevaluating_open',reevalFailed);

  // Source change during analysis and duplicate calls.
  modelPlan=()=>({kind:'no_action'});
  onModelCall=async()=>{addMessage('race',m('race-2','分析期间到达的新消息',-1))};
  const race=await request('/api/inbox/race/triage','POST',{});
  check('source change during analysis rejects the stale judgment',race.status===409&&race.data.error==='triage_source_changed',race);
  check('stale judgment was not adopted',(await read('race')).attention.state==='reevaluating');
  const before=modelCalls,[d1a,d1b]=await Promise.all([request('/api/inbox/dedupe/triage','POST',{}),request('/api/inbox/dedupe/triage','POST',{})]);
  check('concurrent analysis calls the model once',d1a.status===200&&d1b.status===200&&modelCalls===before+1,modelCalls-before);
  const reading=modelCalls;for(let i=0;i<5;i++){await request('/api/bootstrap');await request('/api/inbox')}
  check('reading makes no model calls',modelCalls===reading);

  // Second surfaces.
  const inboxRows=(await request('/api/inbox')).data;
  check('idea with only closed sources is suppressed',ideaSourcesClosed({sourceIds:['ignored-old']},inboxRows)===true);
  check('idea with a live source is kept',ideaSourcesClosed({sourceIds:['ignored-old','short-request']},inboxRows)===false);
  check('idea with an unlinked source is kept',ideaSourcesClosed({sourceIds:['ignored-old','memory-public']},inboxRows)===false);
  check('idea without sources is kept',ideaSourcesClosed({sourceIds:[]},inboxRows)===false);
  check('idea on a dismissed source with a pending round is kept',ideaSourcesClosed({sourceIds:['ignored-new']},inboxRows)===false);
  check('idea on a dismissed source with an unidentified request is kept',ideaSourcesClosed({sourceIds:['ignored-unclear']},inboxRows)===false);
  await dismiss(await read('idea-pending'));
  addMessage('idea-pending',m('idea-pending-2','后续新消息',-1));
  check('idea on a dismissed source awaiting judgment is kept',ideaSourcesClosed({sourceIds:['idea-pending']},(await request('/api/inbox')).data)===false);
  await dismiss(await read('idea-new'));
  addMessage('idea-new',m('idea-new-2','另外请确认新条款',-1));
  modelPlan=()=>({kind:'open',requestId:'idea-new-2'});
  await request('/api/inbox/idea-new/triage','POST',{force:true});
  check('idea is kept while the new round is open',ideaSourcesClosed({sourceIds:['idea-new']},(await request('/api/inbox')).data)===false);
  const ideaRound=(await request('/api/inbox')).data.find(r=>r.sourceParentInboxId==='idea-new');
  await request('/api/inbox/'+ideaRound.id,'PATCH',{status:'done',baseUpdatedAt:ideaRound.updatedAt});
  check('old suggestion is suppressed once the whole matter is closed',ideaSourcesClosed({sourceIds:['idea-new']},(await request('/api/inbox')).data)===true);

  // Bounded background retries, without duplicate in-flight calls.
  S.put('inbox',{id:'retry',title:'后台重试',sender:'公开联系人',senderId:'public-contact-retry',channel:'Internal',origin:'human',status:'pending',body:'公开正文',messages:[m('retry-1','公开消息')]});
  modelPlan=()=>({kind:'http',status:500});
  timer=T.startInboxTriage();
  const until=async(fn,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return true;await new Promise(r=>setTimeout(r,200))}return false};
  await until(()=>S.get('inbox_triages','retry')?.status==='failed');
  const first=S.get('inbox_triages','retry');check('first background failure schedules a bounded retry',first.attempt===1&&Date.parse(first.nextRetryAt)>Date.now(),first);
  await new Promise(r=>setTimeout(r,4000));
  check('failure is not retried before its backoff',S.get('inbox_triages','retry').attempt===1);
  for(const expected of [2,3]){
   S.put('inbox_triages',{...S.get('inbox_triages','retry'),nextRetryAt:iso(-1)});
   await until(()=>S.get('inbox_triages','retry').attempt===expected);
   check('retry attempt '+expected+' recorded',S.get('inbox_triages','retry').attempt===expected);
  }
  const last=S.get('inbox_triages','retry');check('retries stop at the bound',last.attempt===3&&!last.nextRetryAt,last);
  await new Promise(r=>setTimeout(r,4000));
  check('each attempt called the model exactly once, and none follow the bound',callsByTitle['后台重试']===3&&S.get('inbox_triages','retry').attempt===3,callsByTitle['后台重试']);
  clearInterval(timer);timer=undefined;
  S.put('inbox',{id:'quota',title:'额度不足',sender:'公开联系人',senderId:'public-contact-quota',channel:'Internal',origin:'human',status:'pending',body:'公开正文',messages:[m('quota-1','公开消息')]});
  modelPlan=()=>({kind:'http',status:402});
  await request('/api/inbox/quota/triage','POST',{});check('quota failure is not auto-retried',!S.get('inbox_triages','quota').nextRetryAt);

  // Nothing external happened, and persistence holds across a real process restart.
  check('external send remains gated',(await request('/api/inbox/send-unknown/send','POST',{})).status===403);
  check('no outbound ledger entries',sendCount()===0);
  check('unknown send still unknown',(await read('send-unknown')).status==='send_unknown');
  await dismiss(await read('restart-dismissed'));
  const child=spawnSync(process.execPath,['--import','tsx','scripts/intent-handling-http-e2e.mjs','--restart-check='+scope],{encoding:'utf8',env:process.env});
  check('new process reads the same dismissal',child.status===0,child.stderr?.slice(-400));
  await writeFile(out+'/http-result.json',JSON.stringify({scope:'isolated HTTP + controlled judgment model, no external sending',checks,modelCalls},null,2));
  console.log(JSON.stringify({pass:true,checks:checks.length,out}));
 }
}catch(e){console.error(e);process.exitCode=1;await writeFile(out+'/http-result.json',JSON.stringify({checks,error:String(e)},null,2))}
if(timer)clearInterval(timer);
if(keep&&!process.exitCode)console.log('Browser fixture http://127.0.0.1:'+port);else{server.close();draftModel.close();S.db.close();process.exit(process.exitCode||0)}
