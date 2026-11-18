// Isolated production API/SQLite and a controlled local oMLX endpoint. No external traffic or sending.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';

const port=46877,modelPort=46878;
const scope=resolve('.local/acceptance/brief-action-feedback-'+randomUUID());
const assets=resolve('.local/brief-action-feedback-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{
 OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',
 OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',
 OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',
 OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),
 OPSTWIN_OMLX_BASE_URL:'http://127.0.0.1:'+modelPort+'/v1',OPSTWIN_OMLX_KEY:'synthetic-fixture',
});
const S=await import('../server/src/store.ts');
S.setMeta('initialized',true);
const {app}=await import('../server/src/index.ts');
const {peopleContext}=await import('../server/src/people-context.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'main',title:'公开主对话'});
S.setMeta('primaryConversationId','main');
const now=Date.now(),createdAt=new Date(now-600000).toISOString();
const reply='我会先核对公开演示的时间，再回复你。';
for(const [id,title,extra,channel] of [
 ['reply','公开演示时间',{}],
 ['existing','已有回复草稿',{draft:'已有草稿的正文。'}],
 ['cooling','冷却中的公开事项',{}],
 ['lost','响应中断的公开事项',{}],
 ['legacy','未绑定消息的旧事项',{},'Internal'],
]){
 const body='请确认「'+title+'」的安排。';
 const messages=id==='legacy'?[]:[{id:id+'-message',text:body,senderName:'公开同事',sentAt:createdAt,isMine:false}];
 const row={id,title,body,origin:'human',status:'pending',sender:'公开同事',channel:channel||'Feishu',chatMode:'p2p',receivedAt:createdAt,messages,...extra};
 const item=S.put('inbox',row);
 // Keep the normal ingestion stamp, with a deterministic deadline for the test.
 if(messages.length)S.db.prepare("UPDATE entities SET data=json_set(data,'$.copilot.notBefore',?) WHERE type='inbox' AND id=?").run(id==='cooling'?new Date(now+600000).toISOString():createdAt,id);
 S.put('inbox_triages',{
  id,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',
  reason:'direct_request',requestMessageId:messages[0]?.id,needsReply:.9,missingContext:0,risk:.1,
  sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,peopleFingerprint:peopleContext().fingerprint,
 });
}
const model=new Hono();
let releaseModel;
const held=new Promise(resolve=>{releaseModel=resolve});
let modelCalls=0,externalAttempts=0,lostReadbacks=0;
const actionPosts=[];
model.post('/v1/chat/completions',async c=>{
 const input=await c.req.json();
 modelCalls++;
 if(input.messages.at(-1).content.includes('公开演示时间'))await held;
 return c.json({model:'fixture-draft',choices:[{message:{content:reply},finish_reason:'stop'}]});
});
serve({fetch:model.fetch,hostname:'127.0.0.1',port:modelPort});

const gate=new Hono();
let holdBootstrap=false,bootstrapHeld=false,releaseBootstrap;
gate.post('/__fixture/release',c=>{releaseModel();return c.json({released:true})});
gate.post('/__fixture/hold-bootstrap',c=>{holdBootstrap=true;return c.json({armed:true})});
gate.post('/__fixture/release-bootstrap',c=>{releaseBootstrap?.();return c.json({released:true})});
gate.get('/__fixture/evidence',c=>c.json({
 modelCalls,externalAttempts,lostReadbacks,actionPosts,bootstrapHeld,
 tasks:S.list('tasks').map(t=>({id:t.id,inboxId:t.inboxId,title:t.title})),
 sends:S.db.prepare('SELECT count(*) n FROM send_intents').get().n,
}));
gate.all('/api/*',async c=>{
 if(/\/(send|approve|calendar)(\/|$)/.test(c.req.path)){externalAttempts++;return c.json({error:'external_disabled'},403)}
 if(holdBootstrap&&c.req.path==='/api/bootstrap'){
  holdBootstrap=false;
  const response=await app.fetch(c.req.raw);
  bootstrapHeld=true;
  await new Promise(resolve=>{releaseBootstrap=resolve});
  bootstrapHeld=false;
  return response;
 }
 if(c.req.method==='POST'&&c.req.path==='/api/attention/actions'){
  const {entityId,type}=await c.req.raw.clone().json();
  actionPosts.push({entityId,type});
  const response=await app.fetch(c.req.raw);
  // Simulate losing the committed response body. The real GET must recover the original operation.
  if(entityId==='lost'&&response.ok)return c.body('',200,{'Content-Type':'application/json'});
  return response;
 }
 if(c.req.method==='GET'&&c.req.path.startsWith('/api/attention/actions/'))lostReadbacks++;
 return app.fetch(c.req.raw);
});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*',async c=>{
 const path=resolve(assets,'.'+(c.req.path==='/'?'/cyberme.html':c.req.path));
 if(!path.startsWith(assets+'/'))return c.notFound();
 try{return new Response(await readFile(path),{headers:{'Content-Type':types[extname(path)]||'application/octet-stream'}})}
 catch{return c.notFound()}
});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log('http://127.0.0.1:'+port+'/cyberme.html');
