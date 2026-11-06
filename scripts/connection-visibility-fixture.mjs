// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/connection-visibility-web
// Serve: node --import tsx scripts/connection-visibility-fixture.mjs
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/connection-visibility-'+randomUUID()),root=resolve('.local/connection-visibility-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开连接验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开连接验收'});S.setMeta('primaryConversationId','primary');
for(const c of [
 {id:'old-feishu',name:'Feishu',provider:'feishu',status:'disconnected',supersededBy:'feishu-local'},
 {id:'old-wechat',name:'WeChat Claw',provider:'wechat',status:'disconnected',supersededBy:'wechat-sync-local'},
 {id:'feishu-local',name:'Feishu',provider:'feishu',status:'connected'},
 {id:'wechat-sync-local',name:'微信',provider:'wechat',status:'connected'},
 {id:'another-feishu',name:'另一飞书连接',provider:'feishu',status:'disconnected'},
 {id:'gmail',name:'Gmail',provider:'gmail',status:'setup_required'},
 {id:'error-connection',name:'错误连接',provider:'custom',status:'error',message:'公开错误状态'},
])S.put('connections',{type:'CLI',permissions:['read'],config:{syncInterval:'manual'},...c});
const digest=()=>createHash('sha256').update(JSON.stringify(S.db.prepare("SELECT id,data,deleted FROM entities WHERE type='connections' ORDER BY id").all())).digest('hex');
const initial=digest();let writeAttempts=0;
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.get('/fixture/evidence',c=>c.json({unchanged:initial===digest(),writeAttempts,initial,final:digest(),records:S.list('connections').map(({id,supersededBy,status})=>({id,supersededBy,status}))}));
gate.all('/api/*',async c=>{
 if(c.req.method!=='GET'){writeAttempts++;return c.json({error:'read_only_fixture'},403)}
 const response=await app.fetch(c.req.raw);
 if(c.req.path==='/api/bootstrap'&&c.req.header('referer')?.includes('case=all-replaced')){const data=await response.json();data.connections=data.connections.filter(x=>x.supersededBy);return c.json(data)}
 return response;
});
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46776});
console.log('Read-only synthetic connection fixture: http://127.0.0.1:46776');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
