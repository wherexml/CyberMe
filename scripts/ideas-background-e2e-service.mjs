// Public production-HTTP fixture. Failure matrix is documented before implementation.
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=process.env.IDEAS_E2E_SCOPE||resolve('.local/acceptance/ideas-'+randomUUID()),port=46610;
if(!scope.startsWith(resolve('.local/acceptance')+'/'))throw Error('Invalid scope');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0'});
await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46611/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-ideas'}}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
if(!S.get('conversations','public-primary')){S.put('conversations',{id:'public-primary',title:'公开主会话'});S.setMeta('primaryConversationId','public-primary');S.patchSettings({identity:{name:'公开验收用户',language:'zh-CN'}})}
const {app}=await import('../server/src/index.ts');
let calls=0,mode='normal',held=[],seenTools=[],lastResponse=null;
const model=createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;const input=JSON.parse(body);calls++;seenTools.push(input.tools?.length||0);
 const content=input.messages.at(-1).content,text=typeof content==='string'?content:content.map(c=>c.text||'').join('');
 const ctx=JSON.parse(text.split('资料 JSON：\n').at(-1));
 const refs=ctx.sources,source=refs.find(x=>x.id==='public-source'),candidates=ctx.existingIdeas;
 let result={ideas:[],retire:[]};
 if(source){
  const old=candidates.find(x=>x.title.includes('试点')&&!x.id.includes('duplicate'));
  if(source.body.includes('已完成')){result.retire=candidates.filter(x=>x.title.includes('试点')&&!x.protected).map(x=>({id:x.id,reason:'resolved',evidence:[{sourceId:source.id,quote:'试点已完成'}]}))}
  else {result.ideas=[{title:source.body.includes('新版')?'确定试点新日期':'确认试点日期',description:'核对试点日期。\n\n**下一步**\n- 确认开始时间',topicKey:'公开试点日期',category:'insight',sourceIds:[source.id],...(old?{existingId:old.id}:{}),mergeIds:candidates.filter(x=>x.id.includes('duplicate')).map(x=>x.id),evidence:[{sourceId:source.id,quote:source.body}]}]}
 }
 if(mode==='invalid')result={ideas:[{title:'坏输出'}],retire:[]};
 if(mode==='forged'&&result.ideas.length)result.ideas[0].evidence=[{sourceId:'missing',quote:'不存在的证据'}];
 if(mode==='duplicate'&&result.ideas.length)result.ideas.push({...result.ideas[0]});
 lastResponse=result;
 const send=()=>{res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-ideas',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');chunk({role:'assistant',content:JSON.stringify(result)});chunk({},'stop');res.end('data: [DONE]\n\n')};
 if(mode==='hold')held.push(send);else send();
});model.listen(46611,'127.0.0.1');
const B=await import('../server/src/ideas-background.ts');let timer=B.startIdeasBackground({pollMs:100,debounceMs:200,cooldownMs:400});
const gate=new Hono();gate.use('*',async(c,next)=>{if(c.req.header('host')!==`127.0.0.1:${port}`||c.req.header('origin')&&c.req.header('origin')!==`http://127.0.0.1:${port}`)return c.json({error:'denied'},403);await next()});
gate.get('/fixture',c=>c.json({calls,held:held.length,tools:seenTools,primary:S.meta('primaryConversationId',null),state:B.ideasBackgroundStatus(),scope}));
gate.post('/fixture',async c=>{const b=await c.req.json();if(b.mode)mode=b.mode;if(b.release){const pending=held;held=[];for(const send of pending)send()}if(b.stop)clearInterval(timer);if(b.start){clearInterval(timer);timer=B.startIdeasBackground({pollMs:100,debounceMs:200,cooldownMs:400})}if(b.seed)S.put(b.seed.type,b.seed.value);if(b.meta)S.setMeta('ideas-background-v1',b.meta);return c.json({ok:true})});
gate.all('/api/*',c=>app.fetch(c.req.raw));
const assets=resolve('native/mygo/assets');gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/desktop.html':c.req.path));if(!path.startsWith(assets+'/')||await realpath(path).catch(()=>null)!==path)return c.text('not found',404);c.header('Cache-Control','no-store');c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]||'application/octet-stream');return c.body(await readFile(path))});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
process.on('SIGTERM',()=>{clearInterval(timer);server.close();model.close();process.exit(0)});
console.log(JSON.stringify({ready:true,scope,port}));
