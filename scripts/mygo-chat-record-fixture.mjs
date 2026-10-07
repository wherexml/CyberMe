// Public isolated production API; no model, external send or private workspace data.
import {mkdir,realpath,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/chat-record-'+randomUUID()),assets=resolve('native/mygo/assets');
await mkdir(scope,{recursive:true,mode:0o700});const db=new DatabaseSync(resolve(scope,'opstwin-advance.db'));db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES('initialized','true')");db.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46378',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});S.put('conversations',{id:'record-chat',title:'公开执行记录'});S.setMeta('primaryConversationId','record-chat');
S.put('runs',{id:'record-run',kind:'chat',status:'succeeded',tools:[{id:'step1',name:'load_user_context',status:'succeeded',input:{contextIds:['public-note']},output:{items:[{title:'公开说明',content:'第一段：核对已保存的资料。\n\n第二段：'+('长文本换行验证。'.repeat(100))+' END-DETAIL'}],total:1}},{id:'step2',name:'app_read',status:'failed',input:{action:'search',query:'公开关键词'},output:{error:'公开读取失败，请检查连接后重试'}},{id:'step3',name:'app_read',status:'succeeded',input:{},output:null}],startedAt:S.now()});
S.put('messages',{id:'record-message',role:'assistant',conversationId:'record-chat',runId:'record-run',content:'已读取公开资料。可以打开下方记录，查看每一步的请求和结果。'});
const {app}=await import('../server/src/index.ts');const gate=new Hono();gate.use('*',async(c,next)=>{if(c.req.header('host')!=='127.0.0.1:46378'||c.req.header('origin')&&c.req.header('origin')!=='http://127.0.0.1:46378')return c.json({error:'origin_denied'},403);if(c.req.method!=='GET')return c.json({error:'read_only'},403);await next()});gate.all('/api/*',c=>app.fetch(c.req.raw));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/desktop.html':c.req.path));if(!path.startsWith(assets+'/')||await realpath(path)!==path)return c.text('denied',403);c.header('Cache-Control','no-store');c.header('Content-Type',types[extname(path)]||'application/octet-stream');return c.body(await readFile(path))});serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46378});console.log('Public record fixture on 46378');
