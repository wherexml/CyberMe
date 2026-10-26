// Isolated public-data acceptance; never starts or updates the installed client.
import {mkdir,readFile,writeFile,realpath,lstat,cp,readdir} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scope=resolve(root,'.local/chat-native-real-20261023'),runtime=resolve(scope,'runtime'),data=resolve(scope,'data'),assets=resolve(scope,'assets');
const webPort=46650,apiPort=46651,origin=`http://127.0.0.1:${webPort}`;
// Failure-only injection lives in this isolated harness, never the product.
if(process.argv.includes('--fail-jev')){const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>String(input instanceof Request?input.url:input).startsWith('https://api.typesafe.ai/v1/systemone')?Promise.resolve(new Response('{}',{status:503,headers:{'Content-Type':'application/json'}})):nativeFetch(input,init);}
for(const dir of [scope,runtime,data,assets]){await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(await realpath(dir)!==dir||s.uid!==process.getuid()||(s.mode&0o777)!==0o700)throw Error('Invalid acceptance directory');}
if(process.argv.includes('--prepare-assets')){
 // Freeze only the asset assembler for this isolated preview; another task is editing Ideas assets.
 const assemblyPath=resolve(scope,'full-assets-preview.mjs');let assembly=await readFile(resolve(root,'scripts/mygo-full-assets.mjs'),'utf8');
 assembly=assembly.replace("'full/ideas-console.js','full/ideas-console-entry.js',",'').replace('<link rel=\"stylesheet\" href=\"full/ideas-console.css\">','').replace(/^.*await cp\(resolve\(root,'web\/src\/desktop\/full\/ideas-console.css'\).*$/m,'');
 await writeFile(assemblyPath,assembly,{mode:0o600});const {fullAssets}=await import(assemblyPath+'?'+Date.now());
 const source=resolve(root,'docs/design');let html=await readFile(resolve(source,'macos-ui-study.html'),'utf8');
 for(const m of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)){const name=m[1];if(name.startsWith('../../.local/'))continue;if(name.includes('..')||name.startsWith('/'))throw Error('Invalid reference');await mkdir(dirname(resolve(assets,name)),{recursive:true});await cp(resolve(source,name),resolve(assets,name));}
 await cp(resolve(source,'assets'),resolve(assets,'assets'),{recursive:true});
 html=html.replace(/<script src="\.\.\/\.\.\/\.local\/design\/macos-study-data.js"><\/script>/,'<script src="public-data.js"></script>').replace(/<script src="\.\.\/\.\.\/\.local\/design\/chat-capability.js"><\/script>/,'');
 if(html.includes('../../.local/'))throw Error('Private asset reference');
 await writeFile(resolve(assets,'index.html'),html);
 await writeFile(resolve(assets,'public-data.js'),'window.OPSTWINS_DESIGN_DATA={};');
 await cp(resolve(scope,'islands'),assets,{recursive:true});await fullAssets(root,assets);
 console.log(JSON.stringify({assetsPrepared:true}));process.exit(0);
}
// Only the configured model is copied, server-side into a private isolated runtime.
try{await lstat(resolve(runtime,'config.json'))}catch(e){if(e.code!=='ENOENT')throw e;const config=JSON.parse(await readFile(resolve(root,'.local/config.json'),'utf8'));await writeFile(resolve(runtime,'config.json'),JSON.stringify({llm:config.llm}),{mode:0o600,flag:'wx'});}
const deniedCLI=resolve(scope,'deny-external.mjs');await writeFile(deniedCLI,"#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ok:false,error:{message:'Acceptance external transport disabled'}}));process.exitCode=1;\n",{mode:0o700});
const seed=new DatabaseSync(resolve(data,'opstwin-advance.db'));seed.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');seed.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:data,OPSTWIN_PRIVATE_DIR:runtime,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(apiPort),OPSTWIN_WEB_PORT:String(webPort),OPSTWIN_LARK_CLI:deniedCLI,OPSTWIN_WECHAT_CLI:deniedCLI,OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const {app}=await import('../server/src/index.ts');const store=await import('../server/src/store.ts');
const cid='chat-work-public-primary';
if(!store.get('conversations',cid)){
 store.put('conversations',{id:cid,title:'评审资料整理',status:'active',mode:'chat'});store.setMeta('primaryConversationId',cid);
 store.put('memories',{id:'cw-public-plan',title:'评审方案 · 公开资料',body:'# 评审方案\n\n本轮代号 MINT-7319。目标是核对来源消息、对话、回复草稿和人工确认组成的核心流程。\n\n方案 A：先走通核心流程，连接配置留到下一轮。方案 B：先对齐两个版本差异，再确定本轮边界。\n\n验收必须保留失败和未确认状态，禁止用模型结束代替任务完成。计划准备一份评审文档，列出范围、差异、待确认问题和验收清单。',category:'工作',type:'note'});
 store.put('memories',{id:'cw-public-discussion',title:'评审讨论 · 公开资料',body:'# 评审讨论\n\n评审代号 MINT-7319。讨论倾向先确认核心流程，但仍需比较方案 A 和 B。连接配置暂不作为本轮验收内容。\n\n尚未确定：评审时间和主持人。不得编造这些信息。资料确认后的输出为 Markdown 评审文档。文件要能打开和保存，刷新不能重复创建任务。\n\n公开核对标记：PAPER-2846。',category:'工作',type:'note'});
 store.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
}
if(!store.get('tasks','cw-native-independent'))store.put('tasks',{id:'cw-native-independent',title:'独立执行隔离验收',status:'pending',completed:false});
const token=randomBytes(32).toString('hex'),gate=new Hono();
gate.use('*',async(c,next)=>{const supplied=c.req.header('X-Chat-Work-Acceptance')||'';if(Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return c.json({error:'acceptance_auth'},403);await next();});
gate.all('*',c=>{
 const p=c.req.path,m=c.req.method;
 const allowed=m==='GET'?(/^\/api\/(bootstrap|settings(?:\/[^/]+)*|models|memories(?:\/[^/]+)?|tasks(?:\/[^/]+)?|projects|conversations(?:\/[^/]+)*|messages|chat(?:\/[^/]+)*|artifacts(?:\/[^/]+)*|runs(?:\/[^/]+)*|capabilities)$/.test(p)||/^\/files\/[A-Za-z0-9_-]+$/.test(p)):
 /^\/api\/chat(?:\/[^/]+)*$/.test(p)||m==='POST'&&/^\/api\/conversations(?:\/[^/]+)*$/.test(p);
 const taskAgents=/^\/api\/task-agents\/(?:status|requests\/[a-f0-9-]{36}(?:\/stop|\/approvals\/[a-f0-9-]{36})?)$/.test(p);if(!allowed&&!taskAgents)return c.json({error:'acceptance_route_denied'},403);return app.fetch(c.req.raw);
});
const apiServer=serve({fetch:gate.fetch,port:apiPort,hostname:'127.0.0.1'});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
const webServer=createServer(async(req,res)=>{try{
 const topNavigation=req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
 if(req.headers.host!==`127.0.0.1:${webPort}`||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'&&!topNavigation){res.writeHead(403);return res.end('origin_denied');}
 const u=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/files/')){
  let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>1024*1024)throw Error('Request too large');chunks.push(b);}
  const headers={'X-Chat-Work-Acceptance':token};if(req.headers['x-opstwins-agent'])headers['X-Opstwins-Agent']=String(req.headers['x-opstwins-agent']);if(req.headers['x-opstwins-client'])headers['X-Opstwins-Client']=String(req.headers['x-opstwins-client']);if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];
  const upstream=await fetch(`http://127.0.0.1:${apiPort}${u.pathname}${u.search}`,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(240000)});
  res.statusCode=upstream.status;for(const h of ['content-type','content-disposition'])if(upstream.headers.has(h))res.setHeader(h,upstream.headers.get(h));return res.end(Buffer.from(await upstream.arrayBuffer()));
 }
 const path=resolve(assets,'.'+decodeURIComponent(u.pathname==='/'?'/desktop.html':u.pathname));if(!path.startsWith(assets+'/')||await realpath(path)!==path)throw Error('Invalid asset');res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));
}catch{res.statusCode=500;res.end('acceptance_request_failed');}});
webServer.listen(webPort,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,webPort,apiPort,isolated:true,externalTransport:false})));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{apiServer.close();webServer.close();});
