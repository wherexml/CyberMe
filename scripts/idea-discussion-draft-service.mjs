// Public HTTP E2E: production agent/status routes, controlled streaming model, no private data.
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const root=process.cwd(),scope=resolve('.local/acceptance/idea-discussion-'+randomUUID()),assets=resolve('.local/idea-discussion-assets'),out=resolve('output/idea-discussion-20261023');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
const seed=new DatabaseSync(resolve(scope,'opstwin-advance.db'));seed.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO meta VALUES('initialized','true')");seed.close();
await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46673/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-stop-e2e'}}),{mode:0o600});
Object.assign(process.env,{OPSTWIN_API_PORT:'46672',OPSTWIN_WEB_PORT:'46672',OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
const S=await import('../server/src/store.ts');const {app}=await import('../server/src/index.ts');
S.put('conversations',{id:'stop-e2e',title:'公开停止状态验收'});S.setMeta('primaryConversationId','stop-e2e');S.patchSettings({identity:{language:'zh-CN'}});
let calls=0,started=0,aborted=0,posts=0,held=0;const submissions=[];
for(let i=0;i<8;i++)S.put('ideas',{id:'public-idea-'+i,title:'公开建议 '+i,description:'先核对方案，再补充讨论问题。',steps:['核对资料','确认下一步'],category:'insight',status:'new',contextIds:['public-note'],sourceIds:['public-source']});
for(const id of ['public-note','public-source'])S.put('memories',{id,title:'公开资料',body:'仅用于草稿回归。'});
const upstream=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const input=JSON.parse(body);calls++;const content=input.messages.at(-1)?.content;const text=typeof content==='string'?content:(content||[]).map(c=>c.text||'').join('');const current=text.split('当前用户请求：\n').at(-1).trim();if(current==='真实失败'){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:{message:'public provider failure',type:'invalid_request_error'}}))}
 res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-stop-e2e',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');chunk({role:'assistant',content:''});
 started++;if(current.startsWith('public-stop-')||current==='第一条公开消息'){held++;res.on('close',()=>{aborted++});return}chunk({content:'新消息完成'});chunk({},'stop');res.end('data: [DONE]\n\n');
});upstream.listen(46673,'127.0.0.1');
const gate=new Hono();gate.use('*',async(c,next)=>{if(c.req.header('host')!=='127.0.0.1:46672')return c.text('denied',403);await next()});
gate.get('/evidence',c=>c.json({calls,started,aborted,posts,held,submissions}));gate.post('/api/chat',async c=>{posts++;submissions.push(await c.req.raw.clone().json());return app.fetch(c.req.raw)});gate.all('/api/*',c=>app.fetch(c.req.raw));
gate.get('/favicon.ico',c=>c.body(null,204));
gate.get('*',async c=>{const p=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/desktop.html':c.req.path));if(!p.startsWith(assets+'/')||await realpath(p)!==p)return c.text('denied',403);c.header('Cache-Control','no-store');c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(p)]||'application/octet-stream');return c.body(await readFile(p))});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46672});console.log(JSON.stringify({ready:true,port:46672,scope}));
