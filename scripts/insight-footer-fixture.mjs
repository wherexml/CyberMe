// Isolated production HTTP/SQLite for the 洞察 footer (docs/public/insight-footer.md). Synthetic data only; no sends,
// workers, credentials or production state. A controlled local model answers the real /api/ideas/refresh.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/insight-footer-web
// Run:   node --import tsx scripts/insight-footer-fixture.mjs
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const port=46881,modelPort=46882;
const scope=resolve('.local/acceptance/insight-footer-'+randomUUID()),assets=resolve(process.env.INSIGHT_FOOTER_ASSETS||'.local/insight-footer-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',
 OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',
 OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port)});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-footer'}}),{mode:0o600});

// ---------- Controlled model: one bounded source search, then a fixed answer per mode.
let mode='update',modelCalls=0,malformedModelRequests=0,held=[];
const MARK='资料 JSON：\n';
const textOf=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.map(c=>c?.text||'').join(''):'';
async function answerModel(req,res){
 let raw='';for await(const c of req)raw+=c;modelCalls++;
 // A malformed request is answered as an error and counted; it never crashes the fixture.
 const reject=why=>{malformedModelRequests++;if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture_malformed_request: '+why}}))};
 let input;try{input=JSON.parse(raw)}catch{return reject('body')}
 if(!Array.isArray(input?.messages))return reject('messages');
 const stream=(delta,finish)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-footer',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 if(input.tools?.some(t=>t.function?.name==='search_idea_sources')&&!input.messages.some(m=>m.role==='tool')){
  res.writeHead(200,{'content-type':'text/event-stream'});
  stream({role:'assistant',tool_calls:[{index:0,id:'public-search',type:'function',function:{name:'search_idea_sources',arguments:JSON.stringify({query:'公开'})}}]},null);stream({},'tool_calls');res.end('data: [DONE]\n\n');return;
 }
 // The validator may append a corrective user turn (修正输出：…); the source JSON stays in the original turn marked 资料 JSON：.
 const original=input.messages.findLast(m=>m?.role==='user'&&textOf(m).includes(MARK));
 let data;try{data=JSON.parse(textOf(original).split(MARK).at(-1))}catch{data=null}
 // The intentional invalid output needs no source data, so the real API still returns its 502 and keeps every card.
 if(!data&&mode!=='invalid')return reject('source_json');
 const source=data?.sources?.find?.(x=>x.id==='footer-source'),live=data?.existingIdeas?.find?.(x=>x.id==='live');
 let result={ideas:[],retire:[],personUpdates:[]};
 // Updates the existing record in place: the client must read counts, not compare IDs.
 // 'hold' prepares exactly the same valid update as 'update' now and only delays sending it.
 const answer=mode==='hold'?'update':mode;
 if(answer==='update'&&source&&live)result.ideas=[{title:'公开试点安排',description:'试点日期已更新，按新日期准备。',topicKey:'公开试点',category:'insight',intent:'information',sourceIds:[source.id],existingId:live.id,mergeIds:[],evidence:[{sourceId:source.id,quote:source.body}],events:[]}];
 if(mode==='invalid')result={ideas:[{title:'坏输出'}],retire:[]};
 const send=()=>{res.writeHead(200,{'content-type':'text/event-stream'});stream({role:'assistant',content:JSON.stringify(result)},null);stream({},'stop');res.end('data: [DONE]\n\n')};
 if(mode==='hold')held.push(send);else send();
}
// Any unexpected handler error becomes a 500 for that call only; the fixture process keeps serving.
const model=createServer((req,res)=>{answerModel(req,res).catch(e=>{malformedModelRequests++;try{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture_model_error: '+String(e?.message||e)}}))}catch{}})});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));

const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const {app}=await import('../server/src/index.ts'),B=await import('../server/src/ideas-background.ts'),{ideaProvenance}=await import('../shared/attention-actions.ts');
// The production bootstrap withholds new generated ideas without a ready reviewed visual. The fixture satisfies that real gate
// with the shared reviewed-cache helper; bootstrap, visual policy and product code are untouched.
const {seedApprovedInsight}=await import('./lib/approved-insight-fixture.mjs'),{visualFingerprint}=await import('../server/src/insight-visuals.ts');
const visualSeedErrors=[];
function approveVisible(){
 for(const idea of S.list('ideas')){
  if(idea.status!=='new')continue;
  try{
   const row=S.db.prepare('SELECT fingerprint,status FROM insight_visuals WHERE idea_id=?').get(idea.id);
   if(row?.status==='ready'&&row.fingerprint===visualFingerprint(idea))continue;
   seedApprovedInsight(idea);
  }catch(e){visualSeedErrors.push({id:idea.id,error:String(e?.message||e),at:Date.now()})}
 }
}
const forward=async request=>{const method=request.method,response=await app.fetch(request);if(method!=='GET')approveVisible();return response};
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
S.put('conversations',{id:'main',title:'公开主对话'});S.setMeta('primaryConversationId','main');
const call=async(method,path,body)=>{const r=await forward(new Request('http://127.0.0.1:'+port+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));const data=await r.json().catch(()=>null);if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(data));return data};
const at=ms=>new Date(Date.now()+ms).toISOString(),H=36e5,D=24*H;

// ---------- Synthetic inbox: real dismiss/snooze through the production routes so bindings and saved times are genuine.
function request(id,title,extra={}){
 const messages=[{id:id+'-m',body:'请确认「'+title+'」。',senderName:'公开同事',sentAt:at(-H),isMine:false}];
 S.put('inbox',{id,title,sender:'公开同事',channel:'飞书',origin:'human',status:'pending',body:messages[0].body,messages,...extra});
 S.put('inbox_triages',{id,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',requestMessageId:messages[0].id,needsReply:.9,needsOwner:.5,missingContext:0,risk:.1,reason:'direct_request',sourceVersion:S.inboxTriageVersion(S.get('inbox',id)),policyVersion:S.TRIAGE_POLICY_VERSION});
}
const dismissInbox=id=>call('POST','/api/inbox/'+id+'/attention-dismissal',{operationId:'seed-dismiss-'+id,baseUpdatedAt:S.get('inbox',id).updatedAt});
const snoozeInbox=(id,ms)=>call('POST','/api/inbox/'+id+'/attention-snooze',{operationId:'seed-snooze-'+id,baseUpdatedAt:S.get('inbox',id).updatedAt,until:at(ms)});
for(const [id,title] of [['same','同号收件箱事项'],['conflict','会被别处修改的事项'],['lost-inbox','响应丢失的忽略'],['other-inbox','并发恢复的另一事项']]){request(id,title);await dismissInbox(id)}
request('snoozed-inbox','推迟的收件箱事项');await snoozeInbox('snoozed-inbox',2*D);
request('decided','已选择的公开决定');
// Not restore candidates: an expired snooze (visible again) and a forwarded dismissal.
request('expired-snooze','推迟已到期的事项',{attentionSnooze:{id:'snz-old',operationId:'old-op',until:at(-H),requestMessageId:'expired-snooze-m',at:at(-2*D)}});
request('forwarded','已转出的事项');await dismissInbox('forwarded');S.put('inbox',{...S.get('inbox','forwarded'),forwardedRequestId:'forwarded-m'});

// ---------- Synthetic ideas.
S.put('tasks',{id:'footer-source',title:'公开试点资料',notes:'公开试点：请确认日期。',status:'active'});
const fp=()=>B.sources().find(x=>x.id==='footer-source').fingerprint;
const idea=(id,title,extra={})=>S.put('ideas',{id,title,description:'公开判断：'+title,category:'insight',status:'new',autoGenerated:true,refreshedAt:S.now(),sourceIds:['footer-source'],sourceFingerprints:{'footer-source':fp()},evidence:[{sourceId:'footer-source',quote:'公开试点：请确认日期。'}],...extra});
const ideaAction=(id,action,until)=>{const i=S.get('ideas',id);return call('POST','/api/ideas/'+id+'/attention',{action,operationId:'seed-'+action+'-'+id,baseUpdatedAt:i.updatedAt,baseProvenanceKey:ideaProvenance(i),...(until?{until}:{})})};
idea('live','公开试点安排');
for(const [id,title] of [['same','同号灵感'],['lost-idea','回读未确认的灵感'],['other-idea','并发恢复的灵感']]){idea(id,title);await ideaAction(id,'dismiss')}
idea('deferred-timed','有时限推迟的灵感');await ideaAction('deferred-timed','snooze',at(3*D));
idea('legacy-untimed','旧版无时限推迟',{status:'deferred'}); // legacy: no deferredUntil, no attentionAction
idea('local-mark','仅本机隐藏的灵感');
// More than 30 history rows: nothing may be silently truncated.
for(let n=0;n<32;n++)idea('bulk-'+String(n).padStart(2,'0'),'历史忽略 '+(n+1),{status:'dismissed',attentionAction:{operationId:'bulk-op-'+n,kind:'dismiss',priorStatus:'new',at:at(-(n+2)*H)}});
approveVisible(); // initial eligible ideas (live, local-mark)
const EXPECTED_ROWS=4+1+3+1+1+1+32; // inbox dismissed + inbox snoozed + ideas dismissed + timed + untimed + local + bulk

// ---------- Gate: one-shot transport faults and evidence.
const posts=[],faults=[];
const gate=new Hono();
gate.get('/__fixture/evidence',c=>c.json({modelCalls,malformedModelRequests,visualSeedErrors,held:held.length,posts,expectedRows:EXPECTED_ROWS,
 refreshPosts:posts.filter(p=>p.path==='/api/ideas/refresh').length,background:B.ideasBackgroundStatus(),
 tasks:S.list('tasks').length,messages:S.list('messages').length,sends:S.db.prepare('SELECT count(*) n FROM send_intents').get().n}));
gate.post('/__fixture/mode',async c=>{mode=(await c.req.json()).mode;return c.json({mode})});
gate.post('/__fixture/release',c=>{const p=held;held=[];p.forEach(f=>f());return c.json({released:p.length})});
// kind 'after': the server commits, the response body is lost. kind 'before': the request never reaches the server.
// kind 'readback' / 'readback-mismatch': real commit, response in readbackRequired form (matching / other run ID). kind 'unavailable': 503 without forwarding. kind 'after-resnooze': commit, lose response, new snooze. kind 'conflict': edit the inbox record on arrival, then forward (real 409).
gate.post('/__fixture/fault',async c=>{const f=await c.req.json();faults.push(f);return c.json({armed:faults.length})});
gate.post('/__fixture/source',async c=>{const {body}=await c.req.json();S.put('tasks',{...S.get('tasks','footer-source'),notes:body});approveVisible();return c.json({ok:true})});
// Another device edits the record: its version moves, so the held baseUpdatedAt is stale.
gate.post('/__fixture/touch',async c=>{const {id}=await c.req.json();S.put('inbox',{...S.get('inbox',id),note:'changed '+Date.now()});return c.json({ok:true})});
// Another device snoozes the same record again: a new snooze with a different operationId.
const resnooze=async id=>{const i=S.get('inbox',id);await call('POST','/api/inbox/'+id+'/attention-snooze',{operationId:'resnooze-'+Date.now(),baseUpdatedAt:i.updatedAt,until:at(D)})};
// Fixture-only empty dataset: soft-deletes the synthetic inbox records and ideas through the store's normal remove (which
// bumps the workspace revision). API and attention semantics are untouched; nothing outside this isolated SQLite exists.
gate.post('/__fixture/empty',c=>{for(const type of ['inbox','ideas'])for(const x of S.list(type))S.remove(type,x.id);return c.json({inbox:S.list('inbox').length,ideas:S.list('ideas').length})});
// Restore everything except one key through the production routes (prepares the last-row case).
gate.post('/__fixture/restore-all-except',async c=>{
 const {keep}=await c.req.json();
 for(const i of S.list('inbox'))if('inbox:'+i.id!==keep){
  if(i.status==='dismissed'&&i.attentionDismissal&&!i.forwardedRequestId)await call('POST','/api/inbox/'+i.id+'/attention-dismissal/undo',{dismissalId:i.attentionDismissal.id,baseUpdatedAt:i.updatedAt}).catch(()=>{});
  else if(i.attentionSnooze&&i.id!=='expired-snooze')await call('POST','/api/inbox/'+i.id+'/attention-snooze/undo',{operationId:i.attentionSnooze.operationId}).catch(()=>{});
 }
 for(const i of S.list('ideas'))if('idea:'+i.id!==keep&&['dismissed','deferred'].includes(i.status))await call('POST','/api/ideas/'+i.id+'/attention',{action:'restore',operationId:'restore-all-'+i.id,baseUpdatedAt:i.updatedAt,baseProvenanceKey:ideaProvenance(i)});
 return c.json({ok:true});
});
gate.all('/api/*',async c=>{
 if(/\/(send|approve|calendar)(\/|$)/.test(c.req.path))return c.json({error:'external_disabled'},403);
 if(c.req.method!=='GET')posts.push({method:c.req.method,path:c.req.path,at:Date.now()});
 const i=faults.findIndex(f=>f.method===c.req.method&&f.path===c.req.path);
 if(i<0)return forward(c.req.raw);
 const [f]=faults.splice(i,1);
 if(f.kind==='before')return c.body('',200,{'Content-Type':'application/json'});
 // 'conflict': another device edits the real record the moment the target request arrives; the now-stale request
 // is then forwarded unchanged, so the production route itself returns its real 409.
 if(f.kind==='conflict'){const id=decodeURIComponent(f.path.split('/')[3]);S.put('inbox',{...S.get('inbox',id),note:'changed '+Date.now()});return forward(c.req.raw)}
 if(f.kind==='unavailable')return c.json({error:'fixture_unavailable'},503); // a failed read, nothing forwarded
 const response=await forward(c.req.raw);
 // readbackRequired: the real refresh has committed; only the response is reshaped to the server's own readback form.
 if(f.kind==='readback'||f.kind==='readback-mismatch'){
  const data=await response.json();
  return c.json({ideas:[],counts:data.counts,run:{id:f.kind==='readback'?data.run?.id:'run-not-this-one',status:'succeeded'},readbackRequired:true},response.status);
 }
 await response.arrayBuffer();
 // 'after-resnooze': our undo commits, the response is lost, then another device snoozes the record again.
 if(f.kind==='after-resnooze')await resnooze(f.path.split('/')[3]);
 return c.body('',200,{'Content-Type':'application/json'});
});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/cyberme.html':c.req.path));if(!path.startsWith(assets+'/'))return c.notFound();try{return new Response(await readFile(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store'}})}catch{return c.notFound()}});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log(JSON.stringify({ready:true,url:`http://127.0.0.1:${port}/cyberme.html`,expectedRows:EXPECTED_ROWS}));
