// Public deterministic browser E2E. Real desktop UI and isolated store; controlled chat responses, no model.
import {mkdir,realpath,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const port=46379,scope=resolve('.local/acceptance/chat-simple-'+randomUUID()),assets=resolve('native/mygo/assets');
await mkdir(scope,{recursive:true,mode:0o700});const db=new DatabaseSync(resolve(scope,'opstwin-advance.db'));db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES('initialized','true')");db.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});S.put('conversations',{id:'simple-chat',title:'公开聊天验收'});S.setMeta('primaryConversationId','simple-chat');
const {app}=await import('../server/src/index.ts');const gate=new Hono(),requests=new Map();let posts=0,gets=0;
gate.use('*',async(c,next)=>{if(c.req.header('host')!==`127.0.0.1:${port}`||c.req.header('origin')&&c.req.header('origin')!==`http://127.0.0.1:${port}`)return c.json({error:'origin_denied'},403);await next()});
gate.post('/api/chat',async c=>{const body=await c.req.json();posts++;if(requests.has(body.requestId))return c.json({error:'duplicate_post'},409);const row={...body,status:'running',started:Date.now()};requests.set(body.requestId,row);await new Promise(r=>setTimeout(r,7000));if(body.message==='失败验证'){row.status='failed';return c.json({error:'controlled_failure'},503)}if(body.message==='部分完成验证'){row.status='partial';return c.json({error:'partial_run_requires_review'},409)}const result={conversationId:body.conversationId,userMessage:{id:'u-'+body.requestId,role:'user',content:body.message,conversationId:body.conversationId},assistantMessage:{id:'a-'+body.requestId,role:'assistant',content:'已收到：'+body.message,conversationId:body.conversationId},artifacts:[]};row.status='succeeded';row.result=result;for(const m of [result.userMessage,result.assistantMessage])S.put('messages',m);return c.json(result)});
gate.get('/api/chat/requests/:id',c=>{gets++;const r=requests.get(c.req.param('id'));if(!r||Date.now()-r.started<2200)return c.json({error:'not_found'},404);return c.json({status:r.status,result:r.result,conversationId:r.conversationId})});
gate.get('/evidence',c=>c.json({posts,gets,statuses:[...requests.values()].map(r=>({requestId:r.requestId,status:r.status}))}));
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'fixture_write_denied'},403));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/desktop.html':c.req.path));if(!path.startsWith(assets+'/')||await realpath(path)!==path)return c.text('denied',403);c.header('Cache-Control','no-store');c.header('Content-Type',types[extname(path)]||'application/octet-stream');return c.body(await readFile(path))});serve({fetch:gate.fetch,hostname:'127.0.0.1',port});console.log('Public chat fixture on '+port);
