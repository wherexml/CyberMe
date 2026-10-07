// Public isolated production API + built MyGO assets. Run: node --import tsx scripts/mygo-inbox-parity-fixture.mjs
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const root=resolve('.'),scope=resolve(root,'.local/acceptance/mygo-inbox-'+randomUUID()),assets=resolve(root,'native/mygo/assets');
await mkdir(scope,{recursive:true,mode:0o700});const db0=new DatabaseSync(resolve(scope,'opstwin-advance.db'));db0.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db0.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','true');db0.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_LARK_CLI:resolve(scope,'disabled-cli'),OPSTWIN_WECHAT_CLI:resolve(scope,'disabled-cli'),OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46374',OPSTWIN_WEB_PORT:'46374',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
if(process.argv.includes('--real-model')){const privateConfig=JSON.parse(await readFile(resolve(root,'.local/config.json'),'utf8'));await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:privateConfig.llm}),{mode:0o600,flag:'wx'});}
const S=await import('../server/src/store.ts');const {prepareDefaultDrafts}=await import('../server/src/default-drafts.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});S.put('conversations',{id:'public-primary',title:'公开对话'});S.setMeta('primaryConversationId','public-primary');
function seed(id,body,extra={},triage){const item=S.put('inbox',{id,title:id,sender:id,channel:'manual',origin:'human',status:'pending',body,...extra});if(triage)S.put('inbox_triages',{id,sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,status:'succeeded',method:'jev',needsReply:.02,needsOwner:.02,risk:.02,missingContext:.02,needsDeepThink:.02,route:'no_reply',reason:'acknowledgement',...triage});}
seed('public-ok','OK',{draft:'旧自动草稿'},{});
seed('public-ended','谢谢，已处理完，不用回复',{},{});
seed('public-manual','OK',{draft:'人工保留稿',editedByUser:true},{});
seed('public-sensitive','收到',{sensitive:true},{});
seed('public-unknown-send','OK',{status:'send_unknown',draft:'原发送'},{});
seed('public-decision','OK，请你确认预算',{draft:'待决策'},{needsOwner:.9,risk:.9});
seed('public-failed','请确认时间',{}, {status:'failed',route:'review',error:'公开判断服务暂不可用'});
seed('public-reply','请确认演示时间。END-SOURCE',{draft:'公开初始草稿'}, {route:'quick_reply',needsReply:.98});
seed('public-empty','请给出建议',{draftPreparation:{status:'unknown',requestId:'public-original'}},{route:'quick_reply',needsReply:.98});
seed('public-own','我已经回复了',{isMine:true});
seed('public-excluded','通知中的例行确认',{sourceId:'public-excluded-source'},{route:'quick_reply',needsReply:.9});
S.put('inbox_source_rules',{id:S.hash(['manual','public-excluded-source']),active:true,name:'公开来源规则'});
seed('public-recover','请确认演示时间',{draftPreparation:{status:'running',requestId:'public-recovery-original'}},{route:'quick_reply',needsReply:.98});
S.put('runs',{id:'public-interrupted-run',status:'running',tools:[],events:[]});
S.db.prepare('INSERT INTO draft_requests VALUES(?,?,?,?,?)').run('public-recovery-original',S.hash({itemId:'public-recover',mode:'auto',conversationId:null,baseUpdatedAt:null}),'running',JSON.stringify({itemId:'public-recover',runId:'public-interrupted-run',conversationId:'public-recovery-conversation'}),S.now());
const {app}=await import('../server/src/index.ts');
// Mirror the production Inbox-only startup recovery without starting an interval in this fixture.
const recovering=S.get('inbox','public-recover');S.put('inbox',{...recovering,draftPreparation:{...recovering.draftPreparation,status:'unknown'}});
const gate=new Hono();let saveMode='pass';
gate.use('*',async(c,next)=>{if(c.req.header('host')!=='127.0.0.1:46374'||c.req.header('origin')&&c.req.header('origin')!=='http://127.0.0.1:46374')return c.json({error:'origin_denied'},403);await next()});
gate.post('/qa/save-mode',async c=>{saveMode=(await c.req.json()).mode;return c.json({ok:true})});
gate.post('/qa/default',async c=>{await prepareDefaultDrafts();return c.json({ok:true})});
gate.get('/qa/counts',c=>c.json({runs:S.list('runs').length,drafts:S.db.prepare('SELECT count(*) n FROM draft_requests').get().n}));
gate.all('/api/*',async c=>{
 if(c.req.method==='PATCH'&&c.req.path==='/api/inbox/public-reply'&&saveMode!=='pass'){const mode=saveMode;saveMode='pass';if(mode==='fail')return c.json({error:'public_failure',message:'公开保存失败'},503);if(mode==='conflict'){const item=S.get('inbox','public-reply');S.put('inbox',{...item,draft:'公开其他编辑'});return c.json({error:'edit_conflict',message:'公开版本冲突'},409)}}
 if(c.req.method==='POST'&&c.req.path==='/api/chat'){const body=await c.req.raw.clone().json();if(body.readOnly!==true||body.preservePrimary!==true||!body.contextIds?.includes('public-reply'))return c.json({error:'scope_required'},403);return app.fetch(c.req.raw)}
 const allowed=c.req.method==='GET'&&/^\/api\/(bootstrap|settings(?:\/models)?|conversations(?:\/primary|\/[^/]+(?:\/messages)?)?|inbox(?:\/[^/]+(?:\/(?:messages|draft-requests\/[^/]+))?)?|runs(?:\/[^/]+)?|chat\/(?:conversations\/[^/]+\/unresolved|requests\/[^/]+))$/.test(c.req.path)||c.req.method==='PATCH'&&/^\/api\/inbox\/public-[\w-]+$/.test(c.req.path)||c.req.method==='POST'&&/^\/api\/(?:inbox\/public-[\w-]+\/(triage|surface|draft)|conversations\/side)$/.test(c.req.path);
 if(!allowed)return c.json({error:'public_gate',message:'公开验收禁止外发与其他写入'},403);return app.fetch(c.req.raw);
});
gate.get('*',async c=>{const path=resolve(assets,'.'+(c.req.path==='/'?'/desktop.html':c.req.path));try{if(!path.startsWith(assets+'/')||await realpath(path)!==path)return c.notFound();const bytes=await readFile(path);return new Response(bytes,{headers:{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream','cache-control':'no-store'}})}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46374},()=>console.log(JSON.stringify({ready:true,port:46374,scope})));
process.on('SIGTERM',()=>server.close());
