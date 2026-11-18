// Isolated real settings routes, Node/SQLite and protocol adapters, with controlled providers.
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';

const port=46991,upstreamPort=46992;
const isolated=resolve(process.env.PROVIDER_CATALOG_STATE||'.local/acceptance/model-catalog-'+randomUUID());
if(!isolated.startsWith(resolve('.local/acceptance')+'/'))throw Error('Use isolated acceptance data');
await mkdir(isolated,{mode:0o700,recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:isolated,OPSTWIN_PRIVATE_DIR:isolated,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',
 OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const root='http://127.0.0.1:'+upstreamPort, key='public-fixture-existing-key',newKey='public-fixture-draft-key';
const model=id=>({id,smart:false,contextWindow:32000,maxTokens:1024,reasoning:false,vision:false});
const file=isolated+'/config.json';
await writeFile(file,JSON.stringify({llm:{
 standardProviderId:'openai-test',deepProviderId:'openai-test',model:'saved-chat',deepModel:'saved-chat',
 baseUrl:root+'/v1',api:'openai-completions',apiKey:key,modelOptions:model('saved-chat'),
 modelProviders:[
  {id:'openai-test',name:'示例 OpenAI',baseUrl:root+'/v1',api:'openai-completions',apiKey:key,definitions:[model('saved-chat')]},
  {id:'anthropic-test',name:'示例 Anthropic',baseUrl:root+'/anthropic',api:'anthropic-messages',apiKey:key,compatibility:'claude-code',definitions:[model('saved-claude')]},
 ],
}}),{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});

const calls=[],posts=[];
let catalogState='default',losePost=false,active=0,peak=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const sse=(res,type,data)=>res.write((type?'event: '+type+'\n':'')+'data: '+JSON.stringify(data)+'\n\n');
const catalogRows=[{id:'saved-chat'},{id:'public-good',context_window:32000,max_output_tokens:800,input_modalities:['text']},
 {id:'public-denied'},{id:'public-empty'},{id:'public-good'},{id:'not a model id'}];
const upstream=createServer(async(req,res)=>{
 const url=new URL(req.url,root),path=url.pathname;
 if(req.method==='GET'){
  const auth=req.headers.authorization==='Bearer '+key||req.headers.authorization==='Bearer '+newKey;
  calls.push({kind:'catalog',path,after:url.searchParams.get('after_id'),auth});
  if(!auth){res.writeHead(401);res.end();return;}
  if(catalogState==='redirect'){res.writeHead(302,{location:root+'/redirected'});res.end();return;}
  if(catalogState==='unsupported'||path==='/proxy/models'){res.writeHead(404);res.end();return;}
  if(catalogState==='invalid'){res.writeHead(200,{'content-type':'text/html'});res.end('private upstream HTML');return;}
  const json=(obj)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(obj));};
  if(catalogState==='empty'){json({data:[]});return;}
  if(path==='/anthropic/v1/models'){
   if(req.headers['anthropic-version']!=='2023-06-01'||req.headers['x-api-key']!==key){res.writeHead(401);res.end();return;}
   const after=url.searchParams.get('after_id');
   json(after?{data:[{id:'public-claude-new'},{id:'saved-claude'}]}:{data:[{id:'saved-claude'}],has_more:true,last_id:'saved-claude'});return;
  }
  if(path.endsWith('/models')){json({data:[...catalogRows,{id:req.headers.authorization.slice(7)}]});return;}
  res.writeHead(404);res.end();return;
 }
 let raw='';for await(const part of req)raw+=part;
 const body=JSON.parse(raw);
 const auth=req.headers.authorization==='Bearer '+key||req.headers.authorization==='Bearer '+newKey;
 const compatibility=url.searchParams.get('beta')==='true'&&req.headers['anthropic-beta']?.includes('claude-code-20250219');
 const serialized=JSON.stringify(body);
 const tiny=serialized.includes('Reply with OK.')&&!body.tools?.length&&!body.system&&!body.instructions;
 calls.push({kind:'test',path,model:body.model,auth,compatibility:!!compatibility,tiny});
 if(!auth||body.model==='public-denied'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'private vendor failure'}}));return;}
 active++;peak=Math.max(peak,active);
 try{
  await delay(body.model==='public-hang'?16000:500);
  if(res.destroyed)return;
  if(path==='/anthropic/v1/messages'&&!compatibility){res.writeHead(403);res.end();return;}
  const answer=body.model==='public-empty'?'':'OK';
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(path==='/anthropic/v1/messages'){
   const event=(type,props)=>sse(res,type,{type,...props});
   event('message_start',{message:{id:'msg-public',role:'assistant',type:'message',model:body.model,content:[],usage:{input_tokens:1,output_tokens:0}}});
   event('content_block_start',{index:0,content_block:{type:'text',text:''}});
   event('content_block_delta',{index:0,delta:{type:'text_delta',text:answer}});
   event('content_block_stop',{index:0});
   event('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});
   event('message_stop',{});
  }else if(path==='/v1/responses'){
   const item={type:'message',id:'msg-response',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
   const response={id:'resp-public',object:'response',model:body.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
   const event=(type,props)=>sse(res,type,{type,...props});
   event('response.created',{response});
   event('response.output_item.added',{item:{...item,content:[]}});
   event('response.content_part.added',{part:{type:'output_text',text:'',annotations:[]}});
   event('response.output_text.delta',{item_id:item.id,delta:answer});
   event('response.output_item.done',{item});
   event('response.completed',{response});
  }else{
   for(const [delta,finish_reason] of [[{role:'assistant',content:answer},null],[{},'stop']])
    sse(res,'',{id:'public',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]});
   res.write('data: [DONE]\n\n');
  }
  res.end();
 }finally{active--;}
});
await new Promise((done,reject)=>{upstream.once('error',reject);upstream.listen(upstreamPort,'127.0.0.1',done)});

const S=await import('../server/src/store.ts');
S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
S.put('conversations',{id:'main',title:'示例会话',mode:'chat'});S.setMeta('primaryConversationId','main');
const {app}=await import('../server/src/index.ts');
const proxy=new Hono(),assets=resolve('.local/v6-model-discovery-web');
proxy.get('/__fixture/evidence',async c=>c.json({calls,posts,peak,compatibilityPreserved:JSON.parse(await readFile(file,'utf8')).llm.modelProviders.find(p=>p.id==='anthropic-test')?.compatibility==='claude-code'}));
proxy.post('/__fixture/control',async c=>{
 const command=await c.req.json();
 if(command.catalogState)catalogState=command.catalogState;
 if('losePost' in command)losePost=command.losePost;
 if(command.clear){calls.length=0;posts.length=0;peak=0;}
 return c.json({ok:true});
});
proxy.all('/api/*',async c=>{
 const {method,path}=c.req;
 if(method==='GET'||(method==='PATCH'&&path==='/api/settings/models/providers')||(method==='POST'&&path==='/api/settings/models/providers/discover'))return app.fetch(c.req.raw);
 if(method==='POST'&&path==='/api/settings/models/provider-tests'){
  const input=await c.req.raw.clone().json();posts.push(input.requestId);
  const response=await app.fetch(c.req.raw);
  if(losePost){losePost=false;return c.json({error:'fixture_response_lost'},503);}
  return response;
 }
 return c.notFound();
});
proxy.get('*',async c=>{
 const file=resolve(assets,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));
 if(!file.startsWith(assets+'/'))return c.notFound();
 const bytes=await readFile(file).catch(()=>null);
 if(!bytes)return c.notFound();
 const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
 return c.body(bytes,200,{'content-type':type[extname(file)]||'application/octet-stream'});
});
serve({fetch:proxy.fetch,port,hostname:'127.0.0.1'},()=>console.log('Model provider fixture at http://127.0.0.1:'+port+'/cyberme.html'));
