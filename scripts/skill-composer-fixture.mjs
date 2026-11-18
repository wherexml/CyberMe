// Isolated fixture for the V6 composer skill picker: production server app (real GET /api/skills,
// POST /api/chat, chat requests, SQLite) with synthetic skill roots, a synthetic data directory and a
// controlled OpenAI-compatible SSE provider. No production data, secrets, real provider or real sub2api.
// The synthetic `sub2api` skill only carries marker text; the provider never calls tools.
// Failure cases: /Users/steve/.local/state/m2max-claude-remote/runs/cyberme-skill-composer-20261113T114337-c6d759/FAILURE-CASES.md
//
// Build:  npx vite build --config web/mygo.vite.config.ts --outDir ../.local/skill-composer-web
// Run:    node --import tsx scripts/skill-composer-fixture.mjs
// Ports:  SKILL_COMPOSER_PORT (API + web, default 47531), SKILL_COMPOSER_MODEL_PORT (default 47532).
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const port=Number(process.env.SKILL_COMPOSER_PORT||47531),modelPort=Number(process.env.SKILL_COMPOSER_MODEL_PORT||47532);
const scope=resolve(process.env.SKILL_COMPOSER_SCOPE||'.local/acceptance/skill-composer-'+randomUUID());
const web=resolve(process.env.SKILL_COMPOSER_WEB||'.local/skill-composer-web');
await mkdir(scope,{recursive:true,mode:0o700});
const put=async(p,s)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,s,{mode:0o600})};
const manifest=(name,desc,body,extra='')=>`---\nname: ${name}\ndescription: ${desc}\n${extra}---\n${body}\n`;
const roots=[scope+'/skills',scope+'/moved'];
// Synthetic catalog: a sub2api-named marker skill, a manual-only skill, a description-only match,
// a long (80-char) name, a non-invocable name, and >300 rows so a tail skill tests unbounded scrolling.
await put(scope+'/skills/sub2api/SKILL.md',manifest('sub2api','Synthetic account pool maintenance marker. 合成账号池维护标记，仅用于验收。','SYNTH_BODY_sub2api\nMarker only. Never contact any service.'));
await put(scope+'/skills/sub2api-report/SKILL.md',manifest('sub2api-report','Synthetic weekly report marker for the account pool.','SYNTH_BODY_sub2api-report'));
await put(scope+'/skills/demo-manual/SKILL.md',manifest('demo-manual','仅手动点名的合成导出流程。','SYNTH_BODY_demo-manual','disable-model-invocation: true\n'));
await put(scope+'/skills/notes-tidy/SKILL.md',manifest('notes-tidy','Rearranges synthetic notes; mentions subscription keyword only in description.','SYNTH_BODY_notes-tidy'));
const longName='long-'+'x'.repeat(75);
await put(scope+'/skills/'+longName+'/SKILL.md',manifest(longName,'Long-name layout marker '+'with a very long description '.repeat(6),'SYNTH_BODY_long'));
await put(scope+'/skills/bad-name/SKILL.md',manifest('Bad Name With Spaces','Not invocable by the slash grammar; must not be offered.','SYNTH_BODY_bad'));
for(let i=0;i<320;i++){const n='catalog-'+String(i).padStart(3,'0');await put(scope+`/skills/${n}/SKILL.md`,manifest(n,'合成目录容量样本 '+i+'。','SYNTH_BODY_'+n))}
await put(scope+'/skills/zz-tail/SKILL.md',manifest('zz-tail','目录末尾的遥测哨兵（tail telemetry sentinel）。','SYNTH_BODY_zz-tail'));

Object.assign(process.env,{CYBERME_SKILL_ROOTS:JSON.stringify(roots),CYBERME_SKILL_CATALOG_TTL_MS:'0',OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await put(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-skill-composer'}}));
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开技能输入验收',language:'zh-CN'},autonomy:{holdSending:true}});
const now=new Date().toISOString();
S.put('conversations',{id:'primary',title:'公开技能输入验收'});S.setMeta('primaryConversationId','primary');
S.put('conversations',{id:'side',title:'合成侧对话'});
S.put('messages',{id:'composer-intro',conversationId:'primary',role:'assistant',content:'合成引用来源：SKILL_COMPOSER_QUOTE_SOURCE',createdAt:now});
S.put('messages',{id:'side-intro',conversationId:'side',role:'assistant',content:'合成侧对话开始。',createdAt:now});

// Controlled provider: no tools, replies with the markers it observed so the browser can see whether
// the existing server parser injected the selected skill body. Records every call.
const seen=[];let modelCalls=0;
const text=m=>typeof m?.content==='string'?m.content:(m?.content||[]).map(p=>p.text||'').join('');
const model=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;let body;try{body=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
 const all=(body.messages||[]).map(text).join('\n'),invoked=[...new Set(all.match(/SYNTH_BODY_[\w.-]+/g)||[])];
 seen.push({call:++modelCalls,invoked,tools:(body.tools||[]).length});
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'composer',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 if(!(body.tools||[]).length)chunk({role:'assistant',content:'SUMMARY: synthetic.'});
 else chunk({role:'assistant',content:'SKILL_COMPOSER_REPLY '+(invoked.length?'INVOKED:'+invoked.join(','):'NO_SKILL')});
 chunk({},'stop');res.end('data: [DONE]\n\n');
});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));

const {app}=await import('../server/src/index.ts');const {invalidateSkillCatalog}=await import('../server/src/skill-catalog.ts');
const gate=new Hono();
const posts=[];let skillReads=0,failSkills=0,delaySkills=0,holdChat=0;
const reset=()=>{invalidateSkillCatalog()};
gate.get('/fixture/state',c=>c.json({scope,port,modelPort,posts,skillReads,modelCalls,seen,
 commandOperations:S.list('command_operations').length,tasks:S.list('tasks').length,sendIntents:S.db.prepare('SELECT count(*) n FROM send_intents').get().n}));
gate.post('/fixture/skills',async c=>{const b=await c.req.json();failSkills=b.fail??failSkills;delaySkills=b.delayMs??delaySkills;return c.json({ok:true,failSkills,delaySkills})});
gate.post('/fixture/chat-hold',async c=>{holdChat=(await c.req.json()).ms||0;return c.json({ok:true,holdChat})});
// Disappearance and identity change: remove the directory, or move it to another root (same name, new id).
gate.post('/fixture/remove',async c=>{const {name}=await c.req.json();await rm(scope+'/skills/'+name,{recursive:true,force:true});reset();return c.json({ok:true})});
gate.post('/fixture/move',async c=>{const {name}=await c.req.json();await mkdir(scope+'/moved',{recursive:true});await rename(scope+'/skills/'+name,scope+'/moved/'+name);reset();return c.json({ok:true})});
gate.get('/api/skills',async c=>{skillReads++;if(delaySkills)await new Promise(r=>setTimeout(r,delaySkills));if(failSkills>0){failSkills--;return c.json({error:'synthetic_skill_catalog_failure'},503)}return app.fetch(c.req.raw)});
gate.post('/api/chat',async c=>{const raw=await c.req.raw.clone().json().catch(()=>null);posts.push({at:Date.now(),requestId:raw?.requestId,conversationId:raw?.conversationId,message:raw?.message,contextIds:raw?.contextIds,mode:raw?.mode});if(holdChat)await new Promise(r=>setTimeout(r,holdChat));return app.fetch(c.req.raw)});
gate.all('/api/*',c=>app.fetch(c.req.raw));
gate.get('*',async c=>{const p=resolve(web,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(web+'/'))return c.notFound();try{c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(p)]||'application/octet-stream');return c.body(await readFile(p))}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log(JSON.stringify({ready:true,port,modelPort,scope,url:`http://127.0.0.1:${port}/cyberme.html`,longName}));
process.on('SIGTERM',()=>{server.closeAllConnections?.();server.close();model.closeAllConnections();model.close();S.db.close();process.exit(0)});
