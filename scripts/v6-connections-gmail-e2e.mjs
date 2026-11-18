// Run: node --import tsx scripts/v6-connections-gmail-e2e.mjs [--serve]
// Failure cases: docs/sprints-1109/IMPLEMENTATION-FAILURES.md.
// Production HTTP and Chat SDK, isolated database, synthetic Google and model.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const scope=resolve('.local/acceptance/v6-connections-'+randomUUID());
const out=resolve('output/connection-implementation-20261109');
const port=46850,googlePort=46851,modelPort=46852;
const base='http://127.0.0.1:'+port,url=base+'/cyberme.html';
const build=resolve('.local/v6-connections-web');
const client='public-e2e.apps.googleusercontent.com';
const secret='PUBLIC-FIXTURE-GOOGLE-ACCESS';
const refresh='PUBLIC-FIXTURE-GOOGLE-REFRESH';
const mail='PUBLIC-FIXTURE-EXACT-BODY';
const checks=[],requests=[];
await mkdir(scope,{recursive:true,mode:0o700});
await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_WEB_PORT:String(port),OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_IDEAS_AUTO:'0'});
delete process.env.OPSTWIN_GOOGLE_CLIENT_ID;
delete process.env.OPSTWIN_GOOGLE_CLIENT_SECRET;
delete process.env.OPSTWIN_WECHAT_ATTACHMENT_SHA256;
process.env.OPSTWIN_LARK_CLI=scope+'/fixture-lark';
process.env.OPSTWIN_WECHAT_CLI=scope+'/fixture-wechat';
await writeFile(process.env.OPSTWIN_LARK_CLI,`#!${process.execPath}
if(process.argv.slice(2,4).join(' ')!=='auth status')process.exit(8);
console.log(JSON.stringify({identity:'user',verified:true,identities:{user:{status:'ready',tokenStatus:'valid',openId:'ou_fixture',userName:'许茂林'}}}));
`,{mode:0o700});
await writeFile(process.env.OPSTWIN_WECHAT_CLI,`#!${process.execPath}
const verb=process.argv[2];
if(!['source','chats'].includes(verb))process.exit(8);
console.log(JSON.stringify({ok:true,schema:'greenbubbles.query.v1',source:{identity:'public-fixture'},databaseCount:1,items:[],consistency:{coverageComplete:true}}));
`,{mode:0o700});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:'+modelPort+'/v1',apiKey:'public-fixture',api:'openai-completions',model:'public-connection-model'}}),{mode:0o600});
const seed=new DatabaseSync(resolve(scope,'opstwin-advance.db'));
seed.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
seed.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');
seed.close();

const respond=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))};
const listen=(server,port)=>new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done)});
let holdToken,tokenStarted,releaseToken;
const google=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://fixture.test');
 requests.push({path:u.pathname,method:req.method,search:u.searchParams.get('q')||undefined,authorized:req.headers.authorization==='Bearer '+secret});
 if(u.pathname==='/token'){
  if(holdToken){tokenStarted?.();await new Promise(r=>{releaseToken=r});holdToken=false;}
  return respond(res,{access_token:secret,refresh_token:refresh,expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
 }
 if(req.headers.authorization!=='Bearer '+secret)return respond(res,{error:'invalid_token'},401);
 if(u.pathname.endsWith('/profile'))return respond(res,{emailAddress:'public@example.test'});
 if(u.pathname.endsWith('/messages'))return respond(res,{messages:u.searchParams.get('q')==='nomatch'?[]:[{id:'fabc123',threadId:'fabc001'}],resultSizeEstimate:1});
 if(u.pathname.endsWith('/messages/fabc123')){
  const data=Buffer.from(mail).toString('base64url');
  return respond(res,{id:'fabc123',threadId:'fabc001',internalDate:'1794200000000',snippet:'公开示例短文',payload:{mimeType:'text/plain',body:{data},headers:[{name:'Subject',value:'公开验收 Gmail'},{name:'From',value:'fixture@example.test'}]}});
 }
 return respond(res,{error:'not_found'},404);
});
const event=(res,delta,reason)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public',choices:[{index:0,delta,finish_reason:reason}]})+'\n\n');
let lastToolResult,modelToolOffered;
const model=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const {messages,tools}=JSON.parse(raw);
 const i=messages.findLastIndex(m=>m.role==='user');
 const text=typeof messages[i]?.content==='string'?messages[i].content:messages[i]?.content?.[0]?.text;
 const action=text?.includes('fabc123')?'gmail_message':'gmail_search';
 const offered=tools?.find(t=>t.function?.name==='app_read')?.function?.parameters?.properties?.action?.enum;
 modelToolOffered=offered?.includes(action)??false;
 const answer=messages.slice(i+1).findLast(m=>m.role==='tool');
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(!answer&&modelToolOffered){
  const input=action==='gmail_message'?{messageId:'fabc123'}:{query:'subject:公开验收',limit:2};
  event(res,{role:'assistant',tool_calls:[{index:0,id:'gmail-fixture-call',type:'function',function:{name:'app_read',arguments:JSON.stringify({action,input})}}]},null);
  event(res,{},'tool_calls');
 }else{
  lastToolResult=answer?.content||'';
  const content=lastToolResult.includes(mail)?mail:lastToolResult.includes('fabc123')?'GMAIL_SEARCH_FIXTURE_RESULT':'未读取 Gmail';
  event(res,{role:'assistant',content},null);event(res,{},'stop');
 }
 res.end('data: [DONE]\n\n');
});
await listen(google,googlePort);await listen(model,modelPort);
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 const u=new URL(String(input instanceof Request?input.url:input));
 if(u.origin==='https://oauth2.googleapis.com'||u.origin==='https://gmail.googleapis.com'){
  return originalFetch('http://127.0.0.1:'+googlePort+u.pathname+u.search,options);
 }
 return originalFetch(input,options);
};
const S=await import('../server/src/store.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'main',title:'公开验收'});
S.setMeta('primaryConversationId','main');
S.put('connections',{id:'feishu-local',provider:'feishu',type:'CLI',name:'飞书',status:'connected',permissions:['read']});
S.put('connections',{id:'wechat-sync-local',provider:'wechat',type:'CLI',name:'微信',status:'connected',permissions:['read']});
S.put('connections',{id:'replaced-feishu',provider:'feishu',type:'CLI',name:'旧飞书',status:'disconnected',supersededBy:'feishu-local'});
S.put('connections',{id:'fixture-mcp',provider:'custom',type:'MCP',name:'已存测试 MCP',status:'connected',endpoint:'http://127.0.0.1:46853',permissions:[],capabilities:['mcp_safe']});
S.put('connections',{id:'legacy-mcp',provider:'custom',type:'MCP',name:'历史 MCP',status:'connected',endpoint:'http://127.0.0.1:46853',permissions:['mcp.call'],capabilities:['mcp_safe']});
const {app}=await import('../server/src/index.ts');
const {executeApplicationAction}=await import('../server/src/agent-capabilities.ts');
const gate=new Hono();
const methods={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.all('/api/*',c=>app.fetch(c.req.raw));
gate.get('/__fixture/evidence',c=>c.json({checks,requests,grant:!!S.get('connections','gmail-oauth'),url}));
gate.post('/__fixture/connect-gmail',async c=>{
 process.env.OPSTWIN_GOOGLE_CLIENT_ID=client;
 const begin=await app.request('/api/connections/google/authorize',{method:'POST'});
 const data=await begin.json();
 if(!begin.ok)return c.json({ok:false},502);
 const state=new URL(data.url).searchParams.get('state');
 const done=await app.request('/api/connections/google/callback?state='+encodeURIComponent(state)+'&code=PUBLIC-CODE');
 return c.json({ok:done.ok},done.ok?200:502);
});
gate.get('*',async c=>{
 const f=resolve(build,c.req.path==='/'?'cyberme.html':'.'+c.req.path);
 if(!f.startsWith(build+'/'))return c.notFound();
 try{return new Response(await readFile(f),{headers:{'content-type':methods[extname(f)]||'application/octet-stream'}})}catch{return c.notFound()}
});
const server=serve({fetch:gate.fetch,port,hostname:'127.0.0.1'});
const check=(name,pass)=>{checks.push({name,pass:!!pass});assert.ok(pass,name)};
const api=async(path,method='GET',data)=>{
 const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=text}
 return {status:r.status,body};
};
const callChat=(message,extra={})=>api('/api/chat','POST',{requestId:randomUUID(),conversationId:'main',message,...extra});
const messagesCount=()=>requests.filter(r=>r.path.includes('/messages')).length;
const applyGrant=read=>api('/api/connections/gmail-oauth/grants','PATCH',{read,baseUpdatedAt:S.get('connections','gmail-oauth').updatedAt});
let failure;
try{
 const status=await api('/api/connections/google/status');
 check('missing Google configuration is accurately reported',status.body.configured===false);
 check('missing client never returns an authorization URL',(await api('/api/connections/google/authorize','POST',{})).status===503);
 const grantPrompt='请修改这个连接，打开 MCP 工具权限。';
 const r=S.beginRun('chat','公开验收连接权限');
 for(const [action,p] of [
  ['entity_update',{id:'fixture-mcp',resource:'connections',input:{permissions:['mcp.call']}}],
  ['connection_test',{id:'fixture-mcp',input:{permissions:['mcp:mcp_safe']}}],
  ['connection_create_test',{input:{name:'自授权',type:'MCP',provider:'custom',endpoint:'http://127.0.0.1:46853',permissions:['mcp.call']}}],
 ]){
  const direct=action==='connection_create_test'?'请添加 MCP 连接并启用调用权限。':grantPrompt;
  let refused=false;try{await executeApplicationAction(r.id,direct,{action,evidence:direct,...p})}catch(e){refused=[400,403,409].includes(e.status)}
  check('Agent cannot self-grant via '+action,refused);
 }
 check('the existing MCP record was not modified',S.get('connections','fixture-mcp').permissions.length===0);
 const oldMcp=S.get('connections','legacy-mcp');
 const retestPrompt='请复测历史 MCP 连接';
 let retestDenied=false;
 try{await executeApplicationAction(r.id,retestPrompt,{action:'connection_test',id:'legacy-mcp',input:{},evidence:retestPrompt})}
 catch(e){retestDenied=e.status===403}
 check('Agent retest cannot widen the existing MCP wildcard',retestDenied&&JSON.stringify(S.get('connections','legacy-mcp'))===JSON.stringify(oldMcp));
 check('Feishu verifies the existing user identity through its CLI adapter',(await api('/api/connections/feishu-local/test','POST',{})).body.ok===true);
 check('WeChat verifies the local read-only CLI adapter',(await api('/api/connections/wechat-sync-local/test','POST',{})).body.ok===true&&S.get('connections','wechat-sync-local').permissions.join(',')==='read');
 check('controlled OAuth actually reads the profile',(await api('/__fixture/connect-gmail','POST',{})).body.ok===true&&requests.some(x=>x.path.endsWith('/profile')&&x.authorized));
 const noGrant=messagesCount();
 await callChat('请在 Gmail 搜索公开验收邮件');
 check('Google sign-in alone never grants mailbox reads',messagesCount()===noGrant);
 check('user can grant access to Gmail in Settings',(await applyGrant(true)).status===200);
 check('stale grant update is refused',(await api('/api/connections/gmail-oauth/grants','PATCH',{read:false,baseUpdatedAt:'2000-01-01T00:00:00.000Z'})).status===409);
 const unauthorized=messagesCount();
 await callChat('Gmail 的 OAuth 授权怎么配置？');
 await callChat('只解释这句话：“请在 Gmail 搜索公开验收邮件”。');
 await callChat('不要读邮件，只告诉我 Gmail 的 OAuth 怎么配置。');
 await callChat('请查看 Gmail 的授权状态');
 check('mention, quote and denial cannot initiate mailbox reads',messagesCount()===unauthorized);
 const read=await callChat('请在 Gmail 搜索公开验收邮件');
 check('real Chat → application action → Gmail API search',read.status===200&&read.body.assistantMessage?.content.includes('GMAIL_SEARCH_FIXTURE_RESULT')&&requests.some(x=>x.path.endsWith('/messages')&&x.search==='subject:公开验收'&&x.authorized));
 for(const message of ['Can you search Gmail for the login email?','请在 Gmail 搜索关于 OAuth 登录的邮件']){
  const result=await callChat(message);
  check('explicit mail read works: '+message,result.status===200&&result.body.assistantMessage?.content.includes('GMAIL_SEARCH_FIXTURE_RESULT'));
 }
 const exact=await callChat('请读取 Gmail 邮件 fabc123');
 check('exact message result is delivered through Chat',exact.status===200&&exact.body.assistantMessage?.content.includes(mail)&&requests.some(x=>x.path.endsWith('/messages/fabc123')));
 check('Gmail actions are reads with no committed writes',exact.body.run?.taskOutcome?.committedWrites===0);
 check('mail body is absent from tool audit',!JSON.stringify(exact.body.run?.tools||[]).includes(mail));
 check('token absent from bootstrap and OAuth state files encrypted',!JSON.stringify((await api('/api/bootstrap')).body).includes(secret)&&!(await readFile(scope+'/google-oauth/tokens.enc')).includes(Buffer.from(secret)));
 const before=messagesCount();
 const background=S.beginRun('ideas_refresh','合成后台任务');
 let denied=false;try{await executeApplicationAction(background.id,'请在 Gmail 搜索公开验收邮件',{action:'gmail_search',input:{query:'subject:公开验收',limit:2}},true)}catch(e){denied=[400,403,409].includes(e.status)}
 check('background action is refused before reaching Gmail',denied&&messagesCount()===before);
 check('revoking the local Gmail grant succeeds',(await applyGrant(false)).status===200);
 await callChat('请读取 Gmail 邮件 fabc123');
 check('revoked grant blocks the next explicit Chat read',messagesCount()===before);
 const late=await api('/api/connections/google/authorize','POST',{});
 const lateState=new URL(late.body.url).searchParams.get('state');
 holdToken=true;
 const waiting=new Promise(r=>{tokenStarted=r});
 const callback=api('/api/connections/google/callback?state='+encodeURIComponent(lateState)+'&code=PUBLIC-LATE');
 await Promise.race([waiting,callback.then(r=>{throw Error('OAuth callback ended before controlled token request: '+r.status)})]);
 check('disconnect succeeds while OAuth callback is in flight',(await api('/api/connections/gmail-oauth/disconnect','POST',{})).status===200);
 releaseToken?.();
 check('late OAuth callback cannot reconnect after disconnect',(await callback).status>=400&&(await api('/api/connections/google/status')).body.status==='disconnected');
 check('synthetic provider receives only fixed read routes and token POST',requests.every(x=>x.method==='GET'||x.path==='/token'&&x.method==='POST'));
 if(process.argv.includes('--serve')){
  delete process.env.OPSTWIN_GOOGLE_CLIENT_ID;
  S.db.prepare("DELETE FROM entities WHERE type='connections' AND id='gmail-oauth'").run();
 }
}catch(e){failure=e;releaseToken?.()}
finally{
 await writeFile(out+'/http.json',JSON.stringify({url,checks,requests,liveGoogle:'NOT_RUN',scope:'isolated production HTTP and Chat SDK with controlled Google and model'},null,2));
}
console.log(JSON.stringify({url,checks:checks.length,failure:failure?.message}));
if(!failure&&process.argv.includes('--serve'))await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r)});
{
 globalThis.fetch=originalFetch;
 await Promise.all([server,google,model].map(s=>new Promise(r=>s.close(r))));
 if(failure)throw failure;
}
