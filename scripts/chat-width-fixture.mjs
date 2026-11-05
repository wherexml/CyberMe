// Isolated layout fixture. Run: node --import tsx scripts/chat-width-fixture.mjs
// First build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/chat-width-web
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/chat-width-'+randomUUID()),root=resolve('.local/chat-width-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开布局验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开布局验收'});S.setMeta('primaryConversationId','primary');
const paragraph='这是公开合成的排版内容，用于检查长段落是否自然使用气泡的完整宽度。左右内边距应保持一致，窗口变宽时，输入框与上方消息也随左侧区域一起变宽。';
const cases=[['long','assistant',paragraph.repeat(5)+'\n\n1. 保持编号与正文自然换行。\n2. 引用按钮不遮挡内容。'],['short','assistant','好的。'],['format','assistant','普通软换行\n继续同一段。\n\n明确换行  \n下一行。\n\n```text\nfirst line\nsecond line\n```\n\n| 列一 | 列二 |\n| --- | --- |\n| 公开内容 | '+ 'longword'.repeat(30)+' |'],['user','user','保留手动换行\n第二行']];
for(const [id,role,content] of cases)S.put('messages',{id,conversationId:'primary',role,content,createdAt:new Date(Date.now()-60000+cases.findIndex(c=>c[0]===id)*1000).toISOString()});
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'read_only_fixture'},403));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46778});
console.log('Read-only synthetic layout fixture: http://127.0.0.1:46778');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
