// Isolated layout fixture. Run: node --import tsx scripts/chat-top-fade-fixture.mjs
// First build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/chat-top-fade-web
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/chat-top-fade-'+randomUUID()),root=resolve('.local/chat-top-fade-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开布局验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开布局验收'});S.setMeta('primaryConversationId','primary');
for(let i=0;i<6;i++)S.put('messages',{id:'fade-message-'+i,conversationId:'primary',role:i%2?'user':'assistant',content:i%2?'请继续说明公开演示的安排。':Array.from({length:12},(_,n)=>`${n+1}. 这是公开合成的长消息，用于检查顶部渐隐。滚动时文字与气泡边缘逐渐消失，正文区域保持清晰，主题切换不应出现横向色带。`).join('\n\n'),createdAt:new Date(Date.now()-60000+i*1000).toISOString()});
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'read_only_fixture'},403));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46776});
console.log('Read-only synthetic layout fixture: http://127.0.0.1:46776');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
