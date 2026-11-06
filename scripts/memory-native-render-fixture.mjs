// Synthetic real HTTP/SQLite fixture; never opens the production database.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/memory-native-render-web
// Run: node --import tsx scripts/memory-library-fixture.mjs
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {createServer} from 'node:net';
await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(46886,'127.0.0.1',()=>s.close(ok));});
const scope=resolve('.local/acceptance/memory-library-'+randomUUID()),root=resolve('.local/memory-native-render-web'),out=resolve('output/memory-native-render-20261106');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_WEB_PORT:'46886',OPSTWIN_API_PORT:'46887',OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
const D=await import('../server/src/settings-documents.ts');
const M=await import('../server/src/conversation-memory.ts');
S.patchSettings({identity:{name:'林远',aliases:['Lynn'],role:'产品负责人',markdown:'# 林远\n\n## Agent 行为\n- 先核实消息发言人和原始时间。',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开记忆验收'});S.setMeta('primaryConversationId','primary');
D.saveSettingsDocument('memory',{content:'## 关于我\n- 我负责产品和团队管理。\n- 沟通时请先给结论，再说明依据。\n\n## 工作\n- 产品规划与团队协作。\n\n## 偏好\n- 用图表说明业务趋势。',version:D.settingsDocument('memory').version});
let seq=0;
function remember(content,slot='work:display'){const id='public-memory-'+(++seq);S.put('messages',{id,conversationId:'primary',role:'user',content});S.put('runs',{id:id+'-run',kind:'chat',status:'succeeded',tools:[]});return M.rememberFact({slot,category:'work',evidence:content},{prompt:content,messageId:id,requestId:id+'-request',conversationId:'primary',runId:id+'-run'});}
remember('我长期使用柱状图展示月度趋势。');
const wiki=resolve(scope,'people');await mkdir(wiki,{recursive:true});
await writeFile(resolve(wiki,'TEMPLATE.md'),'## 基本信息');
for(const p of [{name:'林远',alias:'Lynn',role:'产品负责人',relation:'本人'},{name:'陈宁',alias:'Ning',role:'运营总监',relation:'同级协作'},{name:'周岚',alias:'Lan',role:'产品经理',relation:'直属员工'}])await writeFile(resolve(wiki,p.name+'.md'),`# ${p.name}\n\n> 资料更新时间：2026-10-28\n\n## 基本信息\n\n| 字段 | 内容 |\n| --- | --- |\n| 中文名 | ${p.name} |\n| 英文名 | ${p.alias} |\n| 当前角色 | ${p.role} |\n| 与 Steve 的关系 | ${p.relation} |\n\n## 职责\n\n负责公开合成验收范围内的协作。`);
S.patchSettings({knowledgePaths:[{id:'public-people',path:wiki}]});
const {peopleContext}=await import('../server/src/people-context.ts');
const person=peopleContext().people.find(p=>p.name==='周岚');
S.put('memories',{id:'public-tracking',kind:'person_tracking',personId:person.id,body:'公开历史记录',observations:[{key:'public-history',kind:'delegation',summary:'此前交办了原型验证。',eventAt:'2026-10-28T02:30:00Z',evidence:[{sourceId:'public-chat',messageId:'public-message-1',actor:'owner',quote:'请你完成原型验证。',eventAt:'2026-10-28T02:30:00Z'}]}]});
const {app}=await import('../server/src/index.ts');
const gate=new Hono(),delays={},failures={},holds={},pending=[],receipts=[],counts={};
function keyFor(path){return path==='/api/memory-library/people'?'people':path==='/api/settings/documents/soul'?'soul':path==='/api/settings/documents/memory'?'memory':path==='/api/memories/automatic'?'automatic':path.endsWith('/revoke')?'forget':null;}
gate.get('/__memory/status',c=>c.json({scope,counts,receipts,pending:pending.map(x=>x.key)}));
gate.post('/__memory/control',async c=>{const v=await c.req.json();Object.assign(delays,v.delays||{});Object.assign(failures,v.failures||{});Object.assign(holds,v.holds||{});if(v.release)for(const p of pending.splice(0))p.release();if(v.document!==undefined)D.saveSettingsDocument('memory',{content:v.document,version:D.settingsDocument('memory').version});if(v.soul!==undefined)D.saveSettingsDocument('soul',{content:v.soul,version:D.settingsDocument('soul').version});if(v.remember)remember(v.remember.content,v.remember.slot);if(v.language)S.patchSettings({identity:{language:v.language}});if(v.removePeople)S.patchSettings({knowledgePaths:[]});if(v.clearAutomatic){for(const m of M.memoryState('primary').memories)M.revokeMemory(m.id,m.version,false);}return c.json({ok:true});});
gate.all('/api/*',async c=>{
 const key=keyFor(c.req.path);if(c.req.method!=='GET'&&!(c.req.method==='PATCH'&&['soul','memory'].includes(key))&&!(c.req.method==='POST'&&key==='forget'))return c.json({error:'fixture_write_denied'},403);
 if(key){counts[c.req.method+':'+key]=(counts[c.req.method+':'+key]||0)+1;if(key==='forget'){const b=await c.req.raw.clone().json();receipts.push({action:b.action,version:b.version,id:c.req.path.split('/').at(-2)});}if(failures[key])return c.json({message:'公开受控读取失败'},failures[key]);}
 const response=await app.fetch(c.req.raw); // Capture old response before holding, to verify late-response guards.
 if(key&&holds[key]&&(c.req.method==='GET'||key==='forget'))await new Promise(release=>pending.push({key,release}));
 if(key&&delays[key])await new Promise(r=>setTimeout(r,delays[key]));
 return response;
});
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46886});
await writeFile(resolve(out,'fixture.json'),JSON.stringify({scope,port:46886,sourceHashes:Object.fromEntries(await Promise.all(['web/src/v6/Memory.tsx','web/src/v6/MemoryLibrary.tsx','web/src/v6/memory-library.css','server/src/memory-library.ts','web/src/v6/memory-data.ts','server/src/conversation-memory.ts'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])) )},null,2));
console.log('Synthetic memory HTTP fixture http://127.0.0.1:46886');
process.on('SIGTERM',()=>{pending.splice(0).forEach(p=>p.release());server.close(()=>{S.db.close();process.exit(0)});});
