// Isolated production HTTP/SQLite for reliable typed Insight actions (docs/public/intent-handling.md, 2026-11-12).
// Synthetic Feishu records only; controlled local oMLX endpoint; no sends, workers, credentials or production state.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/insight-action-recovery-web
// Run:   node --import tsx scripts/insight-recovery-actions-fixture.mjs   (restart between the HTTP and browser journeys)
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';

const port=46913,modelPort=46914;
const scope=resolve('.local/acceptance/insight-action-recovery-'+randomUUID()),assets=resolve('.local/insight-action-recovery-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{
 OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',
 OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',
 OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',
 OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),
 OPSTWIN_OMLX_BASE_URL:'http://127.0.0.1:'+modelPort+'/v1',OPSTWIN_OMLX_KEY:'synthetic-fixture',
});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const {app}=await import('../server/src/index.ts');
const {peopleContext}=await import('../server/src/people-context.ts');
const {messageRevision}=await import('../shared/inbox-surfacing.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'main',title:'公开主对话'});S.setMeta('primaryConversationId','main');

const title=id=>'公开动作 '+id;
const createdAt=new Date(Date.now()-600000).toISOString();
const CARDS={
 lost:{},            // lost POST after commit, then held/failed GETs, reload and remount
 dup:{},             // card and derived message share one operation
 save:{},            // local save failure: zero POST, then explicit same-ID retry
 late:{},            // POST never reaches the server, GET 404, explicit same-ID retry, delayed original arrives
 stale:{},           // binding changes as the POST arrives: real 409 action_stale
 ambiguous:{},       // committed, then a 503 response: settled by GET
 proof:{},           // server op forced to unknown, positive draft evidence
 absent:{},          // create_task op forced to unknown: no exact proof, stays unconfirmed
 task:{},            // known task view, then a new request on the same record
 'label-old':{draft:'公开旧草稿。',draftStale:true},
 'label-candidate':{draftCandidate:{text:'公开候选草稿。'}},
 'label-current':{draft:'公开当前草稿。'},
 cool:{},            // cooling wait preserved
 held:{},            // server completes, the response is held past the client's POST timeout
 slow:{},            // real draft completes, POST response lost; GETs of that op are fault-injected as 'running' until released
 late2:{},           // 404 retry whose local save fails: the uncertainty is kept, zero POST
 'detail-pending':{}, // a pending shared draft takes precedence over Proposal in the detail
 'label-both':{draft:'公开旧草稿二。',draftStale:true,draftCandidate:{text:'公开候选草稿二。'}},
};
function request(id,messageId,body,extra={}){
 const messages=[...(S.get('inbox',id)?.messages||[]),{id:messageId,text:body,senderName:'公开同事',sentAt:new Date().toISOString(),isMine:false}];
 const item=S.put('inbox',{...(S.get('inbox',id)||{}),id,title:title(id),body,origin:'human',status:'pending',sender:'公开同事',channel:'Feishu',chatMode:'p2p',receivedAt:createdAt,messages,...extra});
 S.put('inbox_triages',{id,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',reason:'direct_request',
  requestMessageId:messageId,needsReply:.9,missingContext:0,risk:.1,sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,peopleFingerprint:peopleContext().fingerprint});
 setDeadline(id,-60);
 return S.get('inbox',id);
}
function setDeadline(id,seconds){S.db.prepare("UPDATE entities SET data=json_set(data,'$.copilot.notBefore',?) WHERE type='inbox' AND id=?").run(new Date(Date.now()+seconds*1000).toISOString(),id);S.bump()}
for(const [id,extra] of Object.entries(CARDS))request(id,id+'-m','请确认「'+title(id)+'」的安排。',extra);
setDeadline('cool',3600);
// One derived chat message with typed actions for the dup card (the shared MessageActions caller).
{const d=S.get('inbox','dup'),m=d.messages[0];
 S.put('messages',{id:'derived-dup',conversationId:'main',role:'assistant',content:'公开动作提醒：'+title('dup'),
  inboxAnalysis:{itemId:'dup',deliveryId:'fixture-delivery-dup',actions:['draft_reply','create_task','snooze'],requestMessageId:m.id,requestRevision:messageRevision(m)}});}

// A derived informational idea: its discussion action is read-only (composer only, no POST).
S.put('ideas',{id:'idea-info',title:'公开观察 idea-info',description:'公开观察：试点安排有变化。',category:'insight',intent:'information',status:'new',sourceIds:[]});
S.put('messages',{id:'derived-idea',conversationId:'main',role:'assistant',content:'公开观察提醒',ideaAnalysis:{ideaId:'idea-info'}});
// Typed dismiss acknowledgements: one settles immediately, one only after its undo window has passed.
for(const id of ['idea-ack','idea-late']){
 S.put('ideas',{id,title:'公开观察 '+id,description:'公开观察：'+id,category:'insight',intent:'information',status:'new',sourceIds:[]});
 S.put('messages',{id:'derived-'+id,conversationId:'main',role:'assistant',content:'公开观察提醒 '+id,ideaAnalysis:{ideaId:id}});
}

// Controlled local model: counts calls per card; a held card waits for a release.
const modelCalls={},holdModel=new Set(),heldModel=[];
const model=new Hono();
model.post('/v1/chat/completions',async c=>{
 const input=await c.req.json().catch(()=>null),text=JSON.stringify(input?.messages||[]);
 // Longest matching title wins, so 'late' never claims 'late2' (title(late) is a prefix of title(late2)).
 const id=Object.keys(CARDS).filter(k=>text.includes(title(k))).sort((a,b)=>b.length-a.length)[0]||'other';modelCalls[id]=(modelCalls[id]||0)+1;
 if(holdModel.has(id))await new Promise(r=>heldModel.push({id,r}));
 return c.json({model:'fixture-draft',choices:[{message:{content:'我会核对「'+title(id)+'」后回复你。'},finish_reason:'stop'}]});
});
serve({fetch:model.fetch,hostname:'127.0.0.1',port:modelPort});

// Gate: evidence plus one-shot faults keyed by entity on POST /api/attention/actions, and op-read control.
const gate=new Hono(),actionPosts=[],faults={},opRead={},heldReads=[],delayed=[],maskRunning=new Set();let externalAttempts=0,opReads=0;
// Restart-like interruption: the op record looks as it would had the server stopped mid-run (no result, no completion),
// exactly as the start-up sweep writes it. Canonical side effects (draft ledger, task, snooze/dismissal) are left in place.
const forceUnknown=operationId=>{const op=S.get('attention_ops',operationId);if(!op)return;const {result:_result,completedAt:_completed,...running}=op;S.put('attention_ops',{...running,status:'unknown',error:'server_interrupted',completedAt:S.now()})};
gate.get('/__fixture/evidence',c=>c.json({maskRunning:[...maskRunning],modelCalls,actionPosts,externalAttempts,opReads,heldReads:heldReads.length,delayed:delayed.length,
 tasks:S.list('tasks').map(t=>({id:t.id,inboxId:t.inboxId,status:t.status})),sends:S.db.prepare('SELECT count(*) n FROM send_intents').get().n,
 ops:S.list('attention_ops').map(o=>({id:o.id,type:o.type,entityId:o.entityId,status:o.status}))}));
// kinds: hold-response (commit, hold the response 60 s, then lose it) | after (commit, lose response) | delay (hold unforwarded, lose response) | stale (change binding on arrival)
//        ambiguous (commit, answer 503) | unknown (commit, force op unknown, lose response)
gate.post('/__fixture/fault',async c=>{const {entityId,kind}=await c.req.json();faults[entityId]=kind;return c.json({armed:kind})});
gate.post('/__fixture/release-delayed',async c=>{const out=[];for(const d of delayed.splice(0)){const r=await app.fetch(new Request(d.url,{method:'POST',headers:{'content-type':'application/json'},body:d.body}));out.push({status:r.status,body:await r.json().catch(()=>null)})}return c.json(out)});
// Fault-injected readback: GETs of operations on this entity report 'running' (result and completion hidden) until released.
// The stored production op record is never modified; a live model is never held past the production 90 s timeout.
gate.post('/__fixture/mask-running',async c=>{const {entityId,on}=await c.req.json();if(on)maskRunning.add(entityId);else maskRunning.delete(entityId);return c.json({masked:[...maskRunning]})});
gate.post('/__fixture/op-read',async c=>{const {mode}=await c.req.json();opRead.mode=mode;return c.json({mode})});
gate.post('/__fixture/op-read-release',async c=>{const {outcome}=await c.req.json();const all=heldReads.splice(0);all.forEach(h=>h(outcome));return c.json({released:all.length})});
gate.post('/__fixture/model-hold',async c=>{const {id,hold}=await c.req.json();if(hold)holdModel.add(id);else{holdModel.delete(id);for(const h of heldModel.filter(x=>x.id===id)){heldModel.splice(heldModel.indexOf(h),1);h.r()}}return c.json({ok:true})});
// A new request on the same record: new incoming message and triage binding (the old task stays linked by inboxId).
gate.post('/__fixture/new-request',async c=>{const {id}=await c.req.json();const m=id+'-m'+Date.now();request(id,m,'新的请求：请再确认「'+title(id)+'」。');return c.json({requestMessageId:m})});
gate.all('/api/*',async c=>{
 if(/\/(send|approve|calendar)(\/|$)/.test(c.req.path)){externalAttempts++;return c.json({error:'external_disabled'},403)}
 if(c.req.method==='GET'&&c.req.path.startsWith('/api/attention/actions/')){
  opReads++;
  let outcome=opRead.mode==='fail'?'fail':'ok';
  if(opRead.mode==='hold')outcome=await new Promise(r=>heldReads.push(r));
  if(outcome==='fail')return c.json({error:'fixture_read_unavailable'},503);
  const real=await app.fetch(c.req.raw);
  if(real.status!==200||!maskRunning.size)return real;
  const op=await real.json();
  if(!maskRunning.has(op.entityId))return c.json(op);
  const {result:_r,completedAt:_c,error:_e,...rest}=op;
  return c.json({...rest,status:'running',fixtureInjected:'running'});
 }
 if(c.req.method==='POST'&&c.req.path==='/api/attention/actions'){
  const body=await c.req.raw.clone().text(),input=JSON.parse(body||'{}');
  actionPosts.push({entityId:input.entityId,type:input.type,operationId:input.operationId,until:input.until,requestRevision:input.requestRevision,at:Date.now()});
  const kind=faults[input.entityId];delete faults[input.entityId];
  const lost=()=>c.body('',200,{'Content-Type':'application/json'});
  if(kind==='delay'){delayed.push({url:c.req.url,body});return lost()}
  if(kind==='stale'){const i=S.get('inbox',input.entityId),m=i.messages[0];S.put('inbox',{...i,messages:[{...m,text:m.text+'（已编辑）'},...i.messages.slice(1)]});setDeadline(input.entityId,-60);return app.fetch(c.req.raw)}
  if(kind){const r=await app.fetch(c.req.raw);await r.arrayBuffer();
   if(kind==='hold-response'){await new Promise(res=>setTimeout(res,60000));return lost()}
   if(kind==='ambiguous')return c.json({error:'fixture_gateway'},503);
   if(kind==='unknown')forceUnknown(input.operationId);
   return lost()}
 }
 return app.fetch(c.req.raw);
});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*',async c=>{
 const path=resolve(assets,'.'+(c.req.path==='/'?'/cyberme.html':decodeURIComponent(c.req.path)));
 if(!path.startsWith(assets+'/'))return c.notFound();
 try{return new Response(await readFile(path),{headers:{'Content-Type':types[extname(path)]||'application/octet-stream','cache-control':'no-store'}})}catch{return c.notFound()}
});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log(JSON.stringify({ready:true,url:'http://127.0.0.1:'+port+'/cyberme.html',scope}));
