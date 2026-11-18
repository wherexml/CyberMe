// Isolated fixture for the sent-message skill capsule: production server app (real GET /api/skills, POST /api/chat,
// chat requests, messages, SQLite) on a fresh synthetic data directory, synthetic skill roots, seeded historical user
// messages (canonical, multiline/quoted, skill-only, long name and false positives) and a controlled SSE provider.
// No production data, secrets, real provider or real sub2api; the synthetic skills only carry marker text.
// Failure cases: /Users/steve/.local/state/m2max-claude-remote/runs/cyberme-sent-skill-20261113T142444-d0c21a/FAILURE-CASES.md
//
// Build:  npx vite build --config web/mygo.vite.config.ts --outDir ../.local/skill-message-web
// Run:    node --import tsx scripts/skill-message-fixture.mjs
// Ports:  SKILL_MESSAGE_PORT (API + web, default 47551), SKILL_MESSAGE_MODEL_PORT (default 47552).
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const port=Number(process.env.SKILL_MESSAGE_PORT||47551),modelPort=Number(process.env.SKILL_MESSAGE_MODEL_PORT||47552);
const scope=resolve(process.env.SKILL_MESSAGE_SCOPE||'.local/acceptance/skill-message-'+randomUUID());
const web=resolve(process.env.SKILL_MESSAGE_WEB||'.local/skill-message-web');
await mkdir(scope,{recursive:true,mode:0o700});
const put=async(p,s)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,s,{mode:0o600})};
const manifest=(name,desc,body,extra='')=>`---\nname: ${name}\ndescription: ${desc}\n${extra}---\n${body}\n`;
const longName='long-'+'x'.repeat(75);
await put(scope+'/skills/sub2api/SKILL.md',manifest('sub2api','Synthetic account pool marker. 合成标记，仅用于验收。','SYNTH_BODY_sub2api\nMarker only. Never contact any service.'));
await put(scope+'/skills/demo-manual/SKILL.md',manifest('demo-manual','仅手动点名的合成流程。','SYNTH_BODY_demo-manual','disable-model-invocation: true\n'));
await put(scope+'/skills/'+longName+'/SKILL.md',manifest(longName,'Long-name layout marker.','SYNTH_BODY_long'));

Object.assign(process.env,{CYBERME_SKILL_ROOTS:JSON.stringify([scope+'/skills']),OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await put(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-skill-message'}}));
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开技能消息验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开技能消息验收'});S.setMeta('primaryConversationId','primary');

// Seeded history: stored exactly as the composer/raw users would have sent it. Rendering must never rewrite these.
export const HISTORY={
 'hist-skill':'/skill:sub2api SKILL_MSG_HISTORY_TASK 历史任务',
 'hist-multi':'/skill:sub2api 第一行\n第二行\n\n> 引用第一行\n> 引用第二行',
 'hist-only':'/skill:demo-manual',
 'hist-only-quote':'/skill:demo-manual\n\n> 只有引用',
 'hist-long':'/skill:'+longName+' 长名称任务 '+'很长的任务文字'.repeat(8),
 'hist-legacy-quote':'> 旧版引用\n\n旧版正文 LEGACY_QUOTE_MARKER',
 'fp-alias':'/sub2api FP_ALIAS',
 'fp-space':'  /skill:sub2api FP_SPACE',
 'fp-quote':'> /skill:sub2api FP_QUOTE\n\nFP_QUOTE_BODY',
 'fp-code':'`/skill:sub2api` FP_CODE',
 'fp-mid':'see /skill:sub2api FP_MID',
 'fp-path':'/skill:sub2api/x FP_PATH',
 'fp-colon':'/skill:a:b FP_COLON',
 'fp-long':'/skill:'+'y'.repeat(81)+' FP_OVERLONG',
 'fp-url':'https://example.invalid/skill:sub2api FP_URL',
};
let t=Date.parse('2026-11-12T08:00:00.000Z');
for(const [id,content] of Object.entries(HISTORY)){
 S.put('messages',{id,conversationId:'primary',role:'user',content,createdAt:new Date(t+=60000).toISOString()});
 S.put('messages',{id:id+'-reply',conversationId:'primary',role:'assistant',content:'合成回复 '+id,createdAt:new Date(t+=1000).toISOString()});
}
const storedHash=()=>JSON.stringify(Object.keys(HISTORY).map(id=>S.get('messages',id)?.content??null));
const seededHash=storedHash();

// Controlled provider: no tools are called; replies with a marker.
let modelCalls=0;
const model=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;let body;try{body=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
 modelCalls++;res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'msg',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 chunk({role:'assistant',content:(body.tools||[]).length?'SKILL_MSG_REPLY':'SUMMARY: synthetic.'});chunk({},'stop');res.end('data: [DONE]\n\n')});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));

const {app}=await import('../server/src/index.ts');
const gate=new Hono();const posts=[];let skillReads=0,holdChat=0;
gate.get('/fixture/state',c=>c.json({scope,port,modelPort,longName,history:HISTORY,posts,skillReads,modelCalls,storedUnchanged:storedHash()===seededHash}));
gate.post('/fixture/chat-hold',async c=>{holdChat=(await c.req.json()).ms||0;return c.json({ok:true,holdChat})});
gate.get('/api/skills',c=>{skillReads++;return app.fetch(c.req.raw)});
gate.get('/api/skills/*',c=>{skillReads++;return app.fetch(c.req.raw)});
gate.post('/api/chat',async c=>{const raw=await c.req.raw.clone().text();let b=null;try{b=JSON.parse(raw)}catch{}posts.push({at:Date.now(),requestId:b?.requestId,message:b?.message,raw});if(holdChat)await new Promise(r=>setTimeout(r,holdChat));return app.fetch(c.req.raw)});
gate.all('/api/*',c=>app.fetch(c.req.raw));
gate.get('*',async c=>{const p=resolve(web,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(web+'/'))return c.notFound();try{c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(p)]||'application/octet-stream');return c.body(await readFile(p))}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log(JSON.stringify({ready:true,port,modelPort,scope,url:`http://127.0.0.1:${port}/cyberme.html`,longName}));
process.on('SIGTERM',()=>{server.closeAllConnections?.();server.close();model.closeAllConnections();model.close();S.db.close();process.exit(0)});
