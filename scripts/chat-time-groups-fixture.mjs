// Isolated HTTP fixture for the actual V6 UI. No model, sending or production data.
// npx vite build --config web/mygo.vite.config.ts --outDir ../.local/chat-time-groups-web
// node --import tsx scripts/chat-time-groups-fixture.mjs
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/chat-time-groups-'+randomUUID()),root=resolve('.local/chat-time-groups-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开时间验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开时间验收'});S.setMeta('primaryConversationId','primary');
const today=new Date();today.setHours(0,0,0,0);const at=(h,m=0,s=0)=>new Date(+today+h*3600000+m*60000+s*1000).toISOString();
const data=[['older',at(-1,58),'assistant','上一页连续消息'],['first',at(-1,59),'user','用户在午夜前发消息'],['midnight',at(0,1),'assistant','跨天两分钟也显示日期'],['user',at(10),'user','帮我整理一下'],['reply',at(10),'assistant','好的，这是一条即时回复。'],['under15',at(10,14,59),'user','14分59秒内继续'],['exact15',at(10,29,59),'assistant','间隔正好15分钟'],['keep1',at(10,39,59),'user','10分钟后继续'],['keep2',at(10,49,59),'assistant','再过10分钟，仍连续，不累计到上一标签'],['source',at(10,50),'assistant','带来源时间的洞察'],['missing',null,'user','未知时间不伪造'],['afterMissing',at(10,51),'assistant','重新提供时间定位']].map(([id,createdAt,role,content])=>({id,createdAt,role,content,conversationId:'primary',...(id==='source'?{ideaAnalysis:{occurredAt:at(-168)}}:{})}));
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.get('/api/conversations/primary/messages',c=>c.json({items:c.req.query('before')?[data[0]]:data.slice(1),hasMore:!c.req.query('before')}));
gate.get('/fixture/expected',c=>c.json({separators:['first','midnight','user','exact15','afterMissing'],afterPaging:['older','midnight','user','exact15','afterMissing'],pendingAt:at(10,52)}));
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'read_only_fixture'},403));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46787});console.log('Synthetic timeline ready: http://127.0.0.1:46787');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
