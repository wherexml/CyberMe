// Real V6 HTTP routes and SQLite with a controlled local model. No installed data.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const port=46981, modelPort=46982;
const scope=resolve('.local/acceptance/v6-models-'+randomUUID());
const assets=resolve('.local/v6-model-settings-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{
 OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_NO_LISTEN:'1',
 OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',
 OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',
});
const config=scope+'/config.json', key='synthetic-model-key-only';
const baseUrl='http://127.0.0.1:'+modelPort;
const definition=id=>({id,smart:false,contextWindow:32000,maxTokens:1024,reasoning:false,vision:false});
async function seed(){
 await writeFile(config,JSON.stringify({unrelated:{enabled:true},llm:{
   baseUrl,apiKey:key,api:'openai-completions',model:'public-chat',modelOptions:{...definition('public-chat'),thinkingFormat:'deepseek'},
   deepBaseUrl:baseUrl,deepApiKey:key,deepApi:'openai-completions',deepModel:'public-deep',
   standardProviderId:'local-a',deepProviderId:'local-b',
   modelProviders:[
    {id:'local-a',name:'示例网关 A',baseUrl,apiKey:key,api:'openai-completions'},
    {id:'local-b',name:'示例网关 B',baseUrl,apiKey:key,api:'openai-completions',definitions:[definition('public-deep')]},
    {id:'local-off',name:'停用示例网关',baseUrl,apiKey:key,api:'openai-completions',enabled:false,definitions:[definition('public-off')]},
   ],
  }}),{mode:0o600});
}
if(!process.argv.includes('--empty'))await seed();

let unavailable=false, stall=false, failModel=false, loseProbeResponse=false, catalogReads=0;
const calls=[],posts=[];
const model=createServer(async(req,res)=>{
 const raw=[];for await(const part of req)raw.push(part);
 const input=JSON.parse(Buffer.concat(raw).toString('utf8'));
 calls.push({model:input.model,authenticated:req.headers.authorization==='Bearer '+key,tools:input.tools?.length||0});
 if(failModel){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture private upstream response'}}));return;}
 await new Promise(r=>setTimeout(r,600));
 res.writeHead(200,{'content-type':'text/event-stream'});
 for(const [delta,finish_reason] of [[{role:'assistant',content:'OK'},null],[{},'stop']]){
  res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 }
 res.end('data: [DONE]\n\n');
});
await new Promise((done,reject)=>{model.once('error',reject);model.listen(modelPort,'127.0.0.1',done)});

const S=await import('../server/src/store.ts');
S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
S.put('conversations',{id:'main',title:'示例主会话',mode:'chat'});
S.setMeta('primaryConversationId','main');
S.put('conversations',{id:'old-chat',title:'示例普通历史',mode:'chat'});
S.put('conversations',{id:'old-deep',title:'示例深度历史',mode:'deep'});
S.put('messages',{id:'legacy-deep-msg',conversationId:'old-deep',role:'user',content:'旧会话的示例消息'});

const {app}=await import('../server/src/index.ts');
const proxy=new Hono();
proxy.get('/__fixture/evidence',async c=>{
 const saved=JSON.parse(await readFile(config,'utf8').catch(()=> 'null'));
 return c.json({calls,posts,catalogReads,unrelatedPreserved:saved?.unrelated?.enabled===true,legacyOptionPreserved:saved?.llm.modelOptions?.thinkingFormat==='deepseek'});
});
proxy.post('/__fixture/switches',async c=>{
 const input=await c.req.json();
 if('unavailable' in input)unavailable=input.unavailable;
 if('stall' in input)stall=input.stall;
 if('failModel' in input)failModel=input.failModel;
 if('loseProbeResponse' in input)loseProbeResponse=input.loseProbeResponse;
 if(input.reseed)await seed();
 return c.json({ok:true});
});
proxy.all('/api/*',async c=>{
 const {method,path}=c.req;
 if(method==='GET'&&path==='/api/settings/models'){
  catalogReads++;
  if(unavailable)return c.json({error:'fixture_unavailable'},503);
  if(stall)await new Promise(r=>setTimeout(r,12000));
 }
 if(method==='POST'&&path==='/api/settings/models/test'){
  const input=await c.req.raw.clone().json();posts.push(input.requestId);
  const response=await app.fetch(c.req.raw);
  if(loseProbeResponse){loseProbeResponse=false;return c.json({error:'fixture_lost_response'},503);}
  return response;
 }
 const writes=method==='PATCH'&&['/api/settings/models','/api/settings/models/providers'].includes(path)
  ||method==='POST'&&path==='/api/conversations/side';
 if(method!=='GET'&&!writes)return c.notFound();
 return app.fetch(c.req.raw);
});
proxy.get('*',async c=>{
 const name=c.req.path==='/'?'cyberme.html':c.req.path.slice(1);
 const file=resolve(assets,name);
 if(!file.startsWith(assets+'/'))return c.notFound();
 const body=await readFile(file).catch(()=>null);
 if(!body)return c.notFound();
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
 return c.body(body,200,{'content-type':mime[extname(file)]||'application/octet-stream'});
});
serve({fetch:proxy.fetch,port,hostname:'127.0.0.1'},()=>console.log('V6 model settings fixture http://127.0.0.1:'+port+'/cyberme.html'));
