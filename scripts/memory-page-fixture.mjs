// Synthetic real HTTP/SQLite fixture; never opens the production database.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/memory-upgrade-web
// Run: node --import tsx scripts/memory-page-fixture.mjs
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {createServer} from 'node:net';
await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(46826,'127.0.0.1',()=>s.close(ok));});
const scope=resolve('.local/acceptance/memory-page-'+randomUUID()),root=resolve('.local/memory-upgrade-web'),out=resolve('output/memory-upgrade-20261105');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_WEB_PORT:'46826',OPSTWIN_API_PORT:'46827',OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const D=await import('../server/src/settings-documents.ts');
const M=await import('../server/src/conversation-memory.ts');
S.patchSettings({identity:{name:'公开记忆验收',markdown:'企业经营管理者\n\n优先核实资料。',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开记忆验收'});S.setMeta('primaryConversationId','primary');
D.saveSettingsDocument('memory',{content:'## 工作偏好\n- 我偏好用图表说明业务趋势。',version:D.settingsDocument('memory').version});
let seq=0;
function remember(content,slot='work:display'){const id='public-memory-'+(++seq);S.put('messages',{id,conversationId:'primary',role:'user',content});S.put('runs',{id:id+'-run',kind:'chat',status:'succeeded',tools:[]});return M.rememberFact({slot,category:'work',evidence:content},{prompt:content,messageId:id,requestId:id+'-request',conversationId:'primary',runId:id+'-run'});}
remember('我长期使用柱状图展示月度趋势。');
const {app}=await import('../server/src/index.ts');
const gate=new Hono(),delays={},failures={},holds={},pending=[],receipts=[],counts={};
function keyFor(path){return path==='/api/settings/documents/soul'?'soul':path==='/api/settings/documents/memory'?'memory':path==='/api/memories/automatic'?'automatic':path.endsWith('/revoke')?'forget':null;}
gate.get('/__memory/status',c=>c.json({scope,counts,receipts,pending:pending.map(x=>x.key)}));
gate.post('/__memory/control',async c=>{const v=await c.req.json();Object.assign(delays,v.delays||{});Object.assign(failures,v.failures||{});Object.assign(holds,v.holds||{});if(v.release)for(const p of pending.splice(0))p.release();if(v.document!==undefined)D.saveSettingsDocument('memory',{content:v.document,version:D.settingsDocument('memory').version});if(v.soul!==undefined)D.saveSettingsDocument('soul',{content:v.soul,version:D.settingsDocument('soul').version});if(v.remember)remember(v.remember.content,v.remember.slot);if(v.clearAutomatic){for(const m of M.memoryState('primary').memories)M.revokeMemory(m.id,m.version,false);}return c.json({ok:true});});
gate.all('/api/*',async c=>{
 const key=keyFor(c.req.path);if(c.req.method!=='GET'&&!(c.req.method==='PATCH'&&['soul','memory'].includes(key))&&!(c.req.method==='POST'&&key==='forget'))return c.json({error:'fixture_write_denied'},403);
 if(key){counts[c.req.method+':'+key]=(counts[c.req.method+':'+key]||0)+1;if(key==='forget'){const b=await c.req.raw.clone().json();receipts.push({action:b.action,version:b.version,id:c.req.path.split('/').at(-2)});}if(failures[key])return c.json({message:'公开受控读取失败'},failures[key]);}
 const response=await app.fetch(c.req.raw); // Capture old response before holding, to verify late-response guards.
 if(key&&holds[key]&&(c.req.method==='GET'||key==='forget'))await new Promise(release=>pending.push({key,release}));
 if(key&&delays[key])await new Promise(r=>setTimeout(r,delays[key]));
 return response;
});
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46826});
await writeFile(resolve(out,'fixture.json'),JSON.stringify({scope,port:46826,sourceHashes:Object.fromEntries(await Promise.all(['web/src/v6/Memory.tsx','web/src/v6/memory-data.ts','server/src/conversation-memory.ts'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])) )},null,2));
console.log('Synthetic memory HTTP fixture http://127.0.0.1:46826');
process.on('SIGTERM',()=>{pending.splice(0).forEach(p=>p.release());server.close(()=>{S.db.close();process.exit(0)});});
