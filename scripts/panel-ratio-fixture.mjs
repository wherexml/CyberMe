// Isolated layout fixture. Run: node --import tsx scripts/panel-ratio-fixture.mjs
// First build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/panel-ratio-web
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/panel-ratio-'+randomUUID()),root=resolve('.local/panel-ratio-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开布局验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开布局验收'});S.setMeta('primaryConversationId','primary');
S.put('messages',{id:'layout-message',conversationId:'primary',role:'assistant',content:'这是公开合成的布局验收内容。\n\n1. 窗口缩小时，左右区域保持相同比例。\n2. 拖动分隔线后，重新打开仍保留该比例。\n3. 聊天文字随可用宽度自然换行。',createdAt:S.now()});
S.put('inbox',{id:'layout-decision',title:'公开演示安排',sender:'公开同事',channel:'Internal',status:'pending',attentionOverride:true,body:'请确认公开演示的时间和材料。',receivedAt:S.now()});
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'read_only_fixture'},403));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46774});
console.log('Read-only synthetic layout fixture: http://127.0.0.1:46774');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
