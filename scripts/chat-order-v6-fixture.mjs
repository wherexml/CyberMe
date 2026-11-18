// Synthetic V6 + real bootstrap/SQLite; no model or external writes.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
const scope=resolve('.local/acceptance/chat-order-v6-20261108'),root=resolve('.local/chat-order-v6-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开排序验收',language:'zh-CN'},autonomy:{holdSending:true}});
for(const id of ['primary','side'])S.put('conversations',{id,title:id==='primary'?'排序验收':'侧会话'});S.setMeta('primaryConversationId','primary');
const at=(day,time='08:00:00.000')=>`2026-11-${day}T${time}Z`;
const record=(id,status,createdAt,extra={})=>({requestId:id,conversationId:'primary',message:id,contextIds:[],attachmentIds:[],status,createdAt,...extra});
const records=[record('old-failure','failed',at('05'),{failureCode:'agent_failed'}),record('saved-failure','failed',at('06')),
 record('saved-partial','partial',at('06','09:00:00.000'),{runId:'run-partial'}),
 record('saved-success','succeeded',at('07'),{runId:'run-success'}),
 record('same-time-first','failed',at('07','10:00:00.000')),record('same-time-second','succeeded',at('07','10:00:00.000'),{runId:'run-second'}),
 record('same-text','failed',at('07','11:00:00.000'),{message:'same-time-first'}),
 record('idless','failed',at('05','07:00:00.000'),{conversationId:''})];
const msg=(id,role,content,createdAt,extra={})=>({id,conversationId:'primary',role,content,createdAt,...extra});
const base=[msg('u-failure','user','saved-failure',at('06'),{requestId:'saved-failure'}),
 msg('u-partial','user','saved-partial',at('06','09:00:00.000'),{runId:'run-partial'}),
 msg('u-success','user','saved-success',at('07'),{requestId:'saved-success'}),
 // Completion time differs from turn anchor and must not move this answer after the next turn.
 msg('u-second','user','same-time-second',at('07','10:00:00.000'),{requestId:'same-time-second'}),
 msg('tie-history','assistant','同毫秒历史消息',at('07','10:00:00.000')),
 msg('a-success','assistant','回复 saved-success',at('07','12:00:00.000'),{runId:'run-success'}),
 msg('a-second','assistant','回复 same-time-second',at('07','13:00:00.000'),{runId:'run-second'})];
const path=resolve(scope,'evidence.json');let evidence={posts:[],messages:[],requests:{}};try{evidence=JSON.parse(await readFile(path,'utf8'))}catch{}
const persist=()=>writeFile(path,JSON.stringify(evidence),{mode:0o600});
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.get('/fixture/seed',c=>c.json(records));gate.get('/fixture/evidence',c=>c.json(evidence));
gate.get('/api/conversations/:id/messages',c=>{const primary=c.req.param('id')==='primary',older=!!c.req.query('before');return c.json({items:primary?(older?[msg('older-only','assistant','更早的历史',at('04'))]:[...base,...evidence.messages]):[msg('side-only','assistant','侧会话内容',at('08'))],hasMore:primary&&!older,nextBefore:primary&&!older?'u-failure':null})});
gate.post('/api/chat',async c=>{const b=await c.req.json();evidence.posts.push(b.requestId);const userMessage=msg('u-'+b.requestId,'user',b.message,new Date().toISOString(),{requestId:b.requestId});const assistantMessage=msg('a-'+b.requestId,'assistant','最新回复',new Date().toISOString(),{runId:'run-'+b.requestId});evidence.messages.push(userMessage,assistantMessage);const r=evidence.requests[b.requestId]={status:'succeeded',conversationId:'primary',runId:'run-'+b.requestId};await persist();return c.json({...r,run:{id:r.runId},userMessage,assistantMessage})});
gate.get('/api/chat/requests/:id',c=>evidence.requests[c.req.param('id')]?c.json(evidence.requests[c.req.param('id')]):c.json({error:'not_found'},404));
gate.all('/api/*',c=>c.req.method==='GET'?app.fetch(c.req.raw):c.json({error:'read_only_fixture'},403));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{const b=await readFile(p);c.header('Cache-Control','no-store');c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46818});console.log('Synthetic V6 order fixture http://127.0.0.1:46818');
process.on('SIGTERM',()=>server.close(()=>{S.db.close();process.exit(0)}));
