// Isolated production HTTP/SQLite for the Insight draft cooling wait (docs/public/inbox-omlx-cooldown.md, 2026-11-12).
// Synthetic Feishu records only; controlled local oMLX endpoint; no sends, workers, credentials or production state.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/insight-cooling-web
// Run:   node --import tsx scripts/insight-cooling-fixture.mjs   (restart between the HTTP and browser journeys)
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';

const port=46905,modelPort=46906;
const scope=resolve('.local/acceptance/insight-cooling-'+randomUUID()),assets=resolve('.local/insight-cooling-web');
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

// Cards. Every one is a pending synthetic Feishu p2p request with a succeeded triage; deadlines are set per journey via /__fixture/deadline.
const createdAt=new Date(Date.now()-600000).toISOString();
const CARDS={
 waiting:{draft:'公开旧草稿正文。',draftStale:true}, // known cooling with a stale draft: must not look reviewable or be overwritten
 'current-draft':{draft:'公开当前草稿正文。'},      // cooling, but a current saved draft stays viewable
 soon:{},                                            // expires during the journey
 extend:{},                                          // deadline extended before it expires
 race:{},                                            // looks ready; the source updates as the POST arrives
 replied:{},                                         // reply_not_ready stays an honest refusal
 fail:{},                                            // a real model failure stays a red failure
};
const title=id=>'公开冷却 '+id;
for(const [id,extra] of Object.entries(CARDS)){
 const body='请确认「'+title(id)+'」的安排。';
 const messages=[{id:id+'-m',text:body,senderName:'公开同事',sentAt:createdAt,isMine:false}];
 if(id==='replied')messages.push({id:id+'-r',text:'已确认，我来安排。',senderName:'公开验收',sentAt:new Date(Date.now()-300000).toISOString(),isMine:true});
 const item=S.put('inbox',{id,title:title(id),body,origin:'human',status:'pending',sender:'公开同事',channel:'Feishu',chatMode:'p2p',receivedAt:createdAt,messages,...extra});
 S.put('inbox_triages',{id,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',reason:'direct_request',
  requestMessageId:messages[0].id,needsReply:.9,missingContext:0,risk:.1,sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,peopleFingerprint:peopleContext().fingerprint});
}
// The durable deadline the production stamp would write after a new message; only its time is controlled here.
function setDeadline(id,seconds){
 S.db.prepare("UPDATE entities SET data=json_set(data,'$.copilot.notBefore',?) WHERE type='inbox' AND id=?").run(new Date(Date.now()+seconds*1000).toISOString(),id);
 S.bump();
 return S.get('inbox',id).copilot;
}
for(const id of Object.keys(CARDS))setDeadline(id,-60);
// One derived chat message with typed actions on the cooling card (the shared MessageActions caller).
{const w=S.get('inbox','waiting'),m=w.messages[0];
 S.put('messages',{id:'derived-waiting',conversationId:'main',role:'assistant',content:'公开冷却提醒：'+title('waiting'),
  inboxAnalysis:{itemId:'waiting',deliveryId:'fixture-delivery-waiting',actions:['draft_reply','create_task','snooze'],requestMessageId:m.id,requestRevision:messageRevision(m)}});}

// Controlled local model: counts calls per card; 'fail' answers with an upstream error.
const modelCalls={};
const model=new Hono();
model.post('/v1/chat/completions',async c=>{
 const input=await c.req.json().catch(()=>null),text=JSON.stringify(input?.messages||[]);
 const id=Object.keys(CARDS).find(k=>text.includes(title(k)))||'other';modelCalls[id]=(modelCalls[id]||0)+1;
 if(id==='fail')return c.json({error:{message:'synthetic upstream failure'}},500);
 return c.json({model:'fixture-draft',choices:[{message:{content:'我会核对「'+title(id)+'」后回复你。'},finish_reason:'stop'}]});
});
serve({fetch:model.fetch,hostname:'127.0.0.1',port:modelPort});

const gate=new Hono(),actionPosts=[];let raceArmed=null,externalAttempts=0;
// Exact record reads (the client's read-only reconciliation). Per-id mode: 'hold' waits for a release, 'fail' answers 503.
const reads={},readMode={},heldReads=[];
gate.get('/__fixture/evidence',c=>c.json({modelCalls,actionPosts,externalAttempts,reads,heldReads:heldReads.map(h=>h.id),
 tasks:S.list('tasks').length,sends:S.db.prepare('SELECT count(*) n FROM send_intents').get().n,
 cards:Object.fromEntries(Object.keys(CARDS).map(id=>{const x=S.get('inbox',id);return [id,{draft:x.draft,draftStale:!!x.draftStale,copilot:x.copilot}]}))}));
gate.post('/__fixture/deadline',async c=>{const {id,seconds}=await c.req.json();return c.json(setDeadline(id,Number(seconds)))});
// One-shot race: the source settles into a new cooling window the moment the target draft request arrives.
gate.post('/__fixture/arm-race',async c=>{const {id,seconds}=await c.req.json();raceArmed={id,seconds:Number(seconds)};return c.json({armed:true})});
gate.post('/__fixture/inbox-read',async c=>{const {id,mode}=await c.req.json();if(mode&&mode!=='normal')readMode[id]=mode;else delete readMode[id];return c.json({mode:readMode[id]||'normal'})});
gate.post('/__fixture/inbox-read-release',async c=>{const {id,outcome}=await c.req.json();const mine=heldReads.filter(h=>h.id===id);for(const h of mine){heldReads.splice(heldReads.indexOf(h),1);h.resolve(outcome)}return c.json({released:mine.length})});
gate.all('/api/*',async c=>{
 const exact=c.req.method==='GET'&&c.req.path.match(/^\/api\/inbox\/([^/]+)$/);
 if(exact){
  const id=decodeURIComponent(exact[1]);reads[id]=(reads[id]||0)+1;
  let outcome=readMode[id]==='fail'?'fail':'ok';
  if(readMode[id]==='hold')outcome=await new Promise(resolve=>heldReads.push({id,resolve}));
  if(outcome==='fail')return c.json({error:'fixture_read_unavailable'},503);
 }
 if(/\/(send|approve|calendar)(\/|$)/.test(c.req.path)){externalAttempts++;return c.json({error:'external_disabled'},403)}
 if(c.req.method==='POST'&&c.req.path==='/api/attention/actions'){
  const {entityId,type}=await c.req.raw.clone().json().catch(()=>({}));
  actionPosts.push({entityId,type,at:Date.now()});
  if(raceArmed&&raceArmed.id===entityId&&type==='draft_reply'){const r=raceArmed;raceArmed=null;setDeadline(r.id,r.seconds)}
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
