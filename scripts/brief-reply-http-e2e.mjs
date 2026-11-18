// End-to-end failures recorded first in output/brief-reply-20261105/FAILURE-CASES.md.
// Public fixtures only. Real chat/tool/HTTP persistence; controlled model, no external sends.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const keep=process.argv.includes('--serve'),port=46764,modelPort=46765;
const scope=resolve('.local/acceptance/brief-reply-'+randomUUID()),out=resolve('output/brief-reply-20261105');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-draft'}}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开起草验收'});S.setMeta('primaryConversationId','primary');
for(const [id,title,text] of [['request-a','演示时间','请确认公开演示安排在周五还是周六？'],['request-b','材料核对','请核对公开材料中的两处日期。'],['recalled','撤回的请求','不应显示的旧消息']]){
 const item=S.put('inbox',{id,title,sender:'公开同事',channel:'Internal',origin:'human',status:'pending',body:'过期容器摘要，不应显示',attentionOverride:true,messages:[{id:id+'-message',text,isMine:false,sentAt:new Date(Date.now()-60000).toISOString(),...(id==='recalled'?{recalled:true}:{})},{id:id+'-chatter',text:'尾部闲聊不应取代请求',isMine:false,sentAt:new Date().toISOString()}]});
 S.put('inbox_triages',{id,status:'succeeded',route:'quick_reply',priority:'medium',priorityReason:'A worthwhile explicit unresolved request to the owner, without evidenced urgency.',actionType:'reply',resolution:'open',reason:'direct_request',requestMessageId:id+'-message',sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,completedAt:S.now()});
}
S.put('inbox',{id:'body-only',title:'公开邮件',sender:'公开同事',channel:'Internal',status:'pending',body:'请确认邮件附件的目录。',attentionOverride:true});
S.put('inbox',{id:'precedent',title:'明确的展示字段',sender:'公开同事',channel:'Internal',status:'pending',attentionOverride:true,v6:{context:'已记录的事项说明',precedent:'已记录的历史参考'}});
for(const id of ['body-only','precedent']){const item=S.put('inbox',{...S.get('inbox',id),receivedAt:S.now()});S.put('inbox_triages',{id,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,completedAt:S.now()});}
let calls=0;
const model=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);calls++;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-draft',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 // Persistent AgentSession: the request carries the whole durable conversation. Only tool results after the
 // CURRENT user turn mean this turn's save_draft already ran; earlier turns' tool results must not suppress it.
 const userIndex=input.messages.findLastIndex(m=>m.role==='user');
 if(!input.messages.slice(userIndex+1).some(m=>m.role==='tool')){chunk({role:'assistant',tool_calls:[{index:0,id:'draft-call',type:'function',function:{name:'save_draft',arguments:JSON.stringify({itemId:'request-a',draft:'我先核对演示安排，确认后回复'})}}]});chunk({},'tool_calls')}
 else{chunk({role:'assistant',content:'草稿已保存，等你确认。'});chunk({},'stop')}
 res.end('data: [DONE]\n\n');
});await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');const A=await import('../server/src/agent-capabilities.ts');
const gate=new Hono();
gate.post('/__fixture/action',async c=>{try{const x=await c.req.json();const run=S.beginRun('chat','公开权限验收');return c.json(await A.executeApplicationAction(run.id,x.prompt,{...x.params,evidence:x.prompt},x.readOnly))}catch(e){return c.json({error:e.code||'error'},e.status||500)}});
gate.all('/api/*',c=>{if(/\/(send|approve|calendar)(\/|$)/.test(c.req.path))return c.json({error:'external_disabled'},403);return app.fetch(c.req.raw)});
gate.get('*',async c=>{const rel=c.req.path==='/'?'cyberme.html':c.req.path.slice(1),p=resolve('.local/brief-reply-web',rel);if(!p.startsWith(resolve('.local/brief-reply-web')+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});const checks=[];
async function request(path,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}`+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
function check(name,pass){checks.push({name,pass:!!pass});assert.ok(pass,name)}
try{
 for(const message of ['> 公开同事\n\n起草一封回复，等我确认','起草回复，等我确认','Draft a reply for my review']){
  const body={requestId:randomUUID(),conversationId:'primary',message,contextIds:['request-a'],preservePrimary:true};const r=await request('/api/chat','POST',body);
  check('chat saves draft: '+message.split('\n').at(-1),r.status===200&&r.data.run.tools.some(t=>t.name==='save_draft'&&t.status==='succeeded'));
  check('HTTP readback has draft, not approved or sent',S.get('inbox','request-a').draft==='我先核对演示安排，确认后回复'&&!S.get('inbox','request-a').approved&&S.get('inbox','request-a').status!=='sent');
  const count=calls;await request('/api/chat','POST',body);check('same request replays without model',calls===count);
 }
 const created=await request('/__fixture/action','POST',{prompt:'Draft a reply for my review',params:{action:'entity_create',resource:'inbox',input:{title:'公开新草稿',sender:'公开验收',channel:'Internal',draft:'公开新草稿正文'}}});
 check('draft intent creates a local draft',created.status===200&&created.data.draft==='公开新草稿正文'&&created.data.channel==='Internal');
 const extra=await request('/__fixture/action','POST',{prompt:'起草回复，等我确认',params:{action:'entity_update',resource:'inbox',id:'request-a',input:{draft:'forbidden',body:'forbidden'}}});check('draft intent cannot rewrite source body',extra.status===403);
 const version=await request('/__fixture/action','POST',{prompt:'起草回复，等我确认',params:{action:'entity_update',resource:'inbox',id:'request-a',input:{draft:'forbidden',baseUpdatedAt:'2000-01-01T00:00:00.000Z'}}});check('draft intent respects stale version conflict',version.status===409);
 const saved=S.get('inbox','request-a');
 for(const prompt of ['不要起草回复','不起草回复','不要保存草稿','> 起草回复，等我确认','翻译：起草回复，等我确认','Do not draft a reply','"Draft a reply for my review"']){
  const r=await request('/__fixture/action','POST',{prompt,params:{action:'entity_update',resource:'inbox',id:'request-a',input:{draft:'forbidden',baseUpdatedAt:saved.updatedAt}}});check('reject non-authorization: '+prompt,r.status===403);check('denied write unchanged',S.get('inbox','request-a').draft===saved.draft);
 }
 for(const [name,params,readOnly] of [
  ['approval',{action:'entity_update',resource:'inbox',id:'request-a',input:{draft:'forbidden',approved:true}}],
  ['sensitivity',{action:'entity_update',resource:'inbox',id:'request-a',input:{draft:'forbidden',sensitive:false}}],
  ['task',{action:'entity_create',resource:'tasks',input:{title:'forbidden'}}],
  ['send',{action:'inbox_send',id:'request-a',input:{}}],
  ['read only',{action:'entity_update',resource:'inbox',id:'request-a',input:{draft:'forbidden'}},true]]){
   const r=await request('/__fixture/action','POST',{prompt:'起草回复，等我确认',params,readOnly});check('draft cannot grant '+name,r.status===403);
 }
 for(const [code,error] of [['model_runtime_missing',"Cannot find module '/private/example.mjs'"],['model_timeout','AI 响应超时（streaming）'],['agent_failed','other private diagnosis']]){
  const run=S.beginRun('chat','公开失败');S.updateRun(run.id,{status:'failed',error});const id='failure-'+code;
  S.db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?)').run(id,'fixture','failed',JSON.stringify({runId:run.id,conversationId:'primary'}),S.now());
  const r=await request('/api/chat/requests/'+id);check('safe failure category '+code,r.data.failureCode===code&&!JSON.stringify(r.data).includes(error));
 }
 check('no outbound ledger',S.db.prepare('SELECT count(*) n FROM send_intents').get().n===0);
 await writeFile(out+'/http-result.json',JSON.stringify({scope:'isolated HTTP + controlled model, no external sending',checks,calls},null,2));console.log(JSON.stringify({pass:true,checks:checks.length,out}));
}catch(e){console.error(e);process.exitCode=1;await writeFile(out+'/http-result.json',JSON.stringify({checks,error:String(e)},null,2))}
if(keep&&!process.exitCode)console.log('Browser fixture http://127.0.0.1:'+port);else{server.close();model.close();process.exit(process.exitCode||0)} // supported lifecycle: no S.db.close() while module timers live
