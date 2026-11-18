// Read-only synthetic API + production MyGO bridge; native message delivery is recorded,
// not executed. Build .local/window-drag-web first, then run node --import tsx this file.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/window-drag-'+randomUUID()),root=resolve('.local/window-drag-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开窗口验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开窗口验收'});S.setMeta('primaryConversationId','primary');
S.put('messages',{id:'drag-intro',conversationId:'primary',role:'assistant',content:'窗口拖动验收',createdAt:new Date().toISOString()});
const {app}=await import('../server/src/index.ts'),gate=new Hono();
const mod=execFileSync('go',['list','-m','-f','{{.Dir}}','github.com/egoist/mygo'],{cwd:resolve('native/mygo'),encoding:'utf8'}).trim();
const bridge=await readFile(join(mod,'internal/bridge/bridge.js'),'utf8');
const adapter=`window.__MYGO_CONFIG__={secret:'fixture:',platform:'darwin',windowId:1,version:'0.2.15'};window.dragEvidence=[];let state={drafts:{}};window.webkit={messageHandlers:{mygo:{postMessage(raw){const m=JSON.parse(raw.slice(8));window.dragEvidence.push(m);if(m.t==='call'){let v=null;if(m.m==='Bridge.Scope')v='window-drag-fixture';if(m.m==='Bridge.ReadState')v=state;if(m.m==='Bridge.SaveState'){state=m.a[0];v=state}queueMicrotask(()=>window.__mygo.receive({t:'reply',k:m.k,id:m.id,ok:true,v}))}}}}};`;
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'read_only_fixture'},403));
gate.get('/fixture-host.js',c=>c.body(adapter+'\n'+bridge,200,{'Content-Type':'text/javascript'}));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{let b=await readFile(p);if(extname(p)==='.html')b=Buffer.from(b.toString().replace('<head>','<head><script src="/fixture-host.js"></script>'));c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46828});console.log('Synthetic window fixture: http://127.0.0.1:46828/cyberme.html');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
