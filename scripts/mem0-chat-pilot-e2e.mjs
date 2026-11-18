// Real V6 HTTP and Pi chat with oMLX, synthetic data only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {homedir} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=resolve(import.meta.dirname,'..'),data=join(root,'.local','mem0-evaluation','pilot-'+randomUUID());
const out=join(root,'output/mem0-memory-20261109'),assets=join(root,'.local/mem0-pilot-web');
const apiPort=46952,webPort=46953,modelPort=46954;
const api='http://127.0.0.1:'+apiPort,webUrl='http://127.0.0.1:'+webPort;
await mkdir(data,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
delete process.env.OPSTWIN_STANDALONE;
Object.assign(process.env,{OPSTWIN_PRIVATE_DIR:data,OPSTWIN_DATA_DIR:data});
const key=JSON.parse(await readFile(join(homedir(),'.omlx/settings.json'),'utf8')).auth?.api_key||'';
const model='Qwen3.6-35B-A3B-MLX-4bit';
await writeFile(join(data,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:'+modelPort+'/v1',apiKey:'synthetic-local-proxy',api:'openai-completions',model}}),{mode:0o600});
const S=await import('../server/src/store.ts');
assert.equal(S.DATA,data);
S.setMeta('initialized',true);
S.patchSettings({identity:{name:'林远',language:'zh-CN'},autonomy:{holdSending:true}});
for(const id of ['learn','verify','after','fallback','browser'])S.put('conversations',{id,title:'Mem0 合成验收'});
S.setMeta('primaryConversationId','browser');
const checks=[];
function check(name,pass,detail={}){checks.push({name,passed:!!pass,...detail});console.log(JSON.stringify(checks.at(-1)));assert.ok(pass,name);}
const listen=(server,port)=>new Promise((ok,no)=>server.once('error',no).listen(port,'127.0.0.1',ok));
async function forward(q,s,target,body,headers){
 const r=await fetch(target,{method:q.method,headers,body,redirect:'error',signal:AbortSignal.timeout(65000)});
 s.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});
 if(r.body)Readable.fromWeb(r.body).pipe(s);else s.end();
}
async function readBody(q){const chunks=[];for await(const b of q)chunks.push(b);return Buffer.concat(chunks);}
const proxy=createServer(async(q,s)=>{try{
 if(q.method!=='POST'||q.url!=='/v1/chat/completions'){s.writeHead(404).end();return;}
 const body=JSON.parse(await readBody(q));body.chat_template_kwargs={enable_thinking:false};
 await forward(q,s,'http://127.0.0.1:48000'+q.url,JSON.stringify(body),{authorization:'Bearer '+key,'content-type':'application/json'});
}catch{s.writeHead(502).end();}});
await listen(proxy,modelPort);
let child,web,status='FAIL';
async function req(path,body){const r=await fetch(api+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});return {status:r.status,data:await r.json()};}
async function wait(fn,timeout=50000){for(const end=Date.now()+timeout;Date.now()<end;){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error('condition_timeout');}
async function start(pilotKey=key){
 child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(apiPort),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',CYBERME_MEM0_PILOT:'1',CYBERME_MEM0_PILOT_KEY:pilotKey},stdio:'ignore'});
 await wait(async()=>{try{return (await req('/api/health')).status===200}catch{return false}},10000);
}
async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
async function drainMemory(){
 await wait(async()=>{
  const catalog=(await req('/api/memories/automatic')).data;
  if(catalog.jobs?.some(j=>j.status==='failed'||j.status==='stale'))throw Error('pilot_memory_job_failed');
  return !catalog.jobs?.some(j=>j.status==='queued'||j.status==='running');
 });
}
const evidence=run=>run?.tools?.find(t=>t.name==='load_user_context')?.output;
async function chat(conversationId,message){
 const response=await req('/api/chat',{conversationId,requestId:randomUUID(),message,preservePrimary:true});
 assert.equal(response.status,200,response.data.error||response.data.message);
 return response.data;
}
const fact='我习惯用折线图展示营收走势。';
const query='营业额的变化用哪种可视化形式？';
try{
 await start();
 const learned=await chat('learn',fact);
 const item=await wait(async()=>{
  const rows=(await req('/api/memories/automatic')).data;
  const item=rows.items?.find(m=>m.messageId===learned.userMessage.id);
  if(!item&&rows.jobs?.some(j=>j.id===learned.requestId&&j.status==='failed'))throw Error('live_extraction_failed');
  return item;
 });
 check('direct chat writes exact evidence through existing background workflow',item.content===fact);
 const remembered=await chat('verify',query),used=evidence(remembered.run);
 check('fresh chat recalls exact source through Mem0 and local answerability model',used?.recall?.method==='mem0-validated-pilot'&&used.memoryIds.includes(item.id)&&remembered.assistantMessage.content.includes('折线图'),{method:used?.recall?.method});
 const unrelated=await chat('after','我用什么图展示库存周转？'),rejected=evidence(unrelated.run);
 check('closely related topic with no answer does not enter the model context',rejected?.recall?.method==='mem0-validated-pilot'&&!rejected.memoryIds.includes(item.id));
 await drainMemory();
 await stop();await start('intentionally-invalid-pilot-key');
 const fallback=await chat('fallback','我用什么图展示营收走势？'), fallbackEvidence=evidence(fallback.run);
 check('embedding authentication failure falls back and main chat completes',fallbackEvidence?.recall?.method==='bounded-lexical-v1'&&fallbackEvidence.memoryIds.includes(item.id));
 await drainMemory();
 await stop();await start();
 const forgotten=await req('/api/memories/automatic/'+item.id+'/revoke',{version:item.version,action:'forget'});
 const post=await chat('after',query),postEvidence=evidence(post.run);
 check('forget removes the source from subsequent chat context',forgotten.status===200&&postEvidence?.recall?.method==='mem0-validated-pilot'&&!postEvidence.memoryIds.includes(item.id));
 // A new direct statement after forgetting creates a new source for browser acceptance.
 if(process.argv.includes('--serve')){
  const seed=await chat('learn',fact);
  await wait(async()=> (await req('/api/memories/automatic')).data.items?.some(m=>m.messageId===seed.userMessage.id));
 }
 status='PASS';
}catch(e){console.error(String(e));process.exitCode=1;}
await writeFile(join(out,'chat-http.json'),JSON.stringify({status,checks,url:webUrl,realModel:model,synthetic:true},null,2));
if(status==='PASS'&&process.argv.includes('--serve')){
 web=createServer(async(q,s)=>{try{
  const path=new URL(q.url,webUrl).pathname;
  if(path.startsWith('/api/')){const body=q.method==='GET'||q.method==='HEAD'?undefined:await readBody(q);await forward(q,s,api+q.url,body,{'content-type':'application/json'});return;}
  const file=resolve(assets,path==='/'?'cyberme.html':path.slice(1));if(!file.startsWith(assets+'/')){s.writeHead(403).end();return;}
  s.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'}).end(await readFile(file));
 }catch{s.writeHead(404).end();}});
 await listen(web,webPort);
 console.log('CyberMe Mem0 browser pilot '+webUrl);
 process.on('SIGTERM',async()=>{web.closeAllConnections();web.close();await stop();proxy.closeAllConnections();proxy.close();S.db.close();process.exit(0);});
}else{await stop();proxy.closeAllConnections();proxy.close();S.db.close();}
