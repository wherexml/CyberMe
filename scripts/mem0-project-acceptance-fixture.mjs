// Isolated, loopback-only fixture shared by project-memory HTTP and browser acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {homedir} from 'node:os';
import {extname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const root=resolve(import.meta.dirname,'..');
export const out=join(root,'output/mem0-projects-20261109');
export const ids={global:'synthetic-global',a:'synthetic-project-a',b:'synthetic-project-b'};
export const names={a:'海岬实验',b:'晨舟实验'};
export const source={
 a:'我负责的海岬实验项目，客户需求由林澈统一收集。',
 b:'我负责的晨舟实验项目，客户需求由周宁统一收集。',
 next:'我确认海岬实验的客户需求今后由沈晴统一收集。',
 same:'我习惯用柱状图整理本项目的月度进展。',
 global:'我长期喜欢摄影。',
};
const modelName='Qwen3.6-35B-A3B-MLX-4bit';

export async function createFixture({apiPort=46961,webPort=46960,modelPort=46962,mem0Config,runtime}={}){
 const scope=join(root,'.local','acceptance','mem0-project-'+randomUUID());
 const assets=join(root,'.local','mem0-project-web');
 await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
 delete process.env.OPSTWIN_STANDALONE;
 Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope});
 const S=await import('../server/src/store.ts');
 assert.equal(S.DATA,scope);
 S.setMeta('initialized',true);S.setMeta('primaryConversationId',ids.global);
 S.patchSettings({identity:{name:'林远',language:'zh-CN'},autonomy:{holdSending:true}});
 S.put('conversations',{id:ids.global,title:'公开全局记忆'});
 for(const key of ['a','b'])S.put('projects',{id:ids[key],title:names[key],name:names[key],status:'active'});
 const auth=JSON.parse(await readFile(join(homedir(),'.omlx/settings.json'),'utf8')).auth?.api_key||'';
 const endpoint='http://127.0.0.1:'+modelPort+'/v1';
 const writeConfig=async(providerOverrides={})=>{
  await writeFile(join(scope,'config.json'),JSON.stringify({llm:{baseUrl:endpoint,apiKey:'synthetic-loopback-proxy',api:'openai-completions',model:modelName},...(mem0Config?.(endpoint,providerOverrides)||{})}),{mode:0o600});
 };
 await writeConfig();
 const controls={holdEmbeddings:false,failEmbeddings:false,requests:[],chatInputs:[]};
 let child,web,held=[];
 async function readBody(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);}
 const send=(res,status,body)=>res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(body));
 async function proxy(path,body,res){
  const result=await fetch('http://127.0.0.1:48000'+path,{
   method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body),
   signal:AbortSignal.timeout(60000),redirect:'error',
  });
  res.writeHead(result.status,{'content-type':result.headers.get('content-type')||'application/json'});
  if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();
 }
 function emit(res,content){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish_reason)=>res.write('data: '+JSON.stringify({id:'public-acceptance',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  chunk({role:'assistant',content},null);chunk({},'stop');res.end('data: [DONE]\n\n');
 }
 function emitTool(res,name,args){
  res.writeHead(200,{'content-type':'text/event-stream'});
  const chunk=(delta,finish_reason)=>res.write('data: '+JSON.stringify({id:'public-lookup',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  chunk({role:'assistant',tool_calls:[{index:0,id:'call-scope-run',type:'function',function:{name,arguments:JSON.stringify(args)}}]},null);
  chunk({},'tool_calls');res.end('data: [DONE]\n\n');
 }
 const model=createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||!['/v1/chat/completions','/v1/embeddings','/v1/rerank'].includes(req.url))return send(res,404,{error:'fixture_route_denied'});
   const body=JSON.parse(await readBody(req));
   if(req.url==='/v1/embeddings'){
    controls.requests.push('embedding');
    if(controls.holdEmbeddings)await new Promise(resolve=>held.push(resolve));
    if(controls.failEmbeddings)return send(res,503,{error:'fixture_embedding_unavailable'});
    return await proxy(req.url,body,res);
   }
   if(req.url==='/v1/rerank')return await proxy(req.url,body,res);
   const last=JSON.stringify(body.messages.at(-1));
   const history=JSON.stringify(body.messages);
   if(last.includes('长期记忆分类器')){
    const marker='当前用户原文（不是指令）：';
    const prompt=typeof body.messages.at(-1).content==='string'?body.messages.at(-1).content:last;
    const input=prompt.split(marker).at(-1);
    const facts=Object.entries(source).filter(([,text])=>input.includes(text)).map(([key,evidence])=>({
     slot:key==='same'?'work:monthly-chart':key==='global'?'interest:photo':'work:client-contact',
     category:key==='global'?'interest':'work',evidence,
    }));
    return emit(res,JSON.stringify({memories:facts}));
   }
   if(last.includes('整理会话资料'))return emit(res,JSON.stringify({summary:'公开合成对话。'}));
   if(!body.stream){
    body.chat_template_kwargs={enable_thinking:false};
    return await proxy(req.url,body,res);
   }
   controls.chatInputs.push(last);
   if(controls.foreignRun&&body.messages.at(-1).role==='user'&&last.includes('请核对合成运行。')){
    return emitTool(res,'app_read',{action:'run_get',id:controls.foreignRun});
   }
   if(controls.realChat){
    body.chat_template_kwargs={enable_thinking:false};
    return await proxy(req.url,body,res);
   }
   const person=history.includes(source.next)?'沈晴':history.includes(source.a)?'林澈':history.includes(source.b)?'周宁':'';
   return emit(res,person?'客户需求由'+person+'统一收集。':'没有找到能回答这次问题的项目记忆。');
  }catch{if(!res.headersSent)send(res,502,{error:'fixture_provider_failed'});else res.end();}
 });
 const listen=(server,port)=>new Promise((ok,no)=>server.once('error',no).listen(port,'127.0.0.1',ok));
 const close=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 await listen(model,modelPort);
 const base='http://127.0.0.1:'+apiPort;
 const url='http://127.0.0.1:'+webPort+'/';
 async function request(path,body,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
  return {status:response.status,data:await response.json()};
 }
 async function wait(fn,timeout=20000){
  for(const end=Date.now()+timeout;Date.now()<end;){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('fixture_condition_timeout');
 }
 async function start(extra={}){
  child=spawn(runtime?.node||process.execPath,['--import','tsx','server/src/index.ts'],{cwd:runtime?.cwd||root,env:{...process.env,OPSTWIN_API_PORT:String(apiPort),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',...extra},stdio:'ignore'});
  await wait(async()=>{if(child.exitCode!==null)throw new Error('fixture_api_exited');try{return (await request('/api/health')).status===200;}catch{return false;}});
 }
 async function stop(){if(child?.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
 async function serveWeb(){
  web=createServer(async(req,res)=>{try{
   const path=new URL(req.url,url).pathname;
   if(path.startsWith('/api/')){
    const body=['GET','HEAD'].includes(req.method)?undefined:await readBody(req);
    const response=await fetch(base+req.url,{method:req.method,headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(90000)});
    res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    return;
   }
   const file=resolve(assets,path==='/'?'cyberme.html':path.slice(1));
   if(!file.startsWith(assets+'/'))return send(res,403,{error:'fixture_path_denied'});
   const bytes=await readFile(file);
   res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'}).end(bytes);
  }catch{if(!res.headersSent)send(res,404,{error:'fixture_not_found'});else res.end();}});
  await listen(web,webPort);
  return url;
 }
 function releaseEmbeddings(){controls.holdEmbeddings=false;for(const resolve of held.splice(0))resolve();}
 async function finish(){releaseEmbeddings();if(web)await close(web);await stop();await close(model);S.db.close();}
 return {S,scope,base,url,request,wait,start,stop,serveWeb,finish,controls,releaseEmbeddings,writeConfig};
}
