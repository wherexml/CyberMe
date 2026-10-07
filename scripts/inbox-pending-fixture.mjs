// Public-only production HTTP fixture. No outbound actions; data remains in this project.
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';import {serve} from '@hono/node-server';
const root=resolve('.'),scope=resolve(process.env.PENDING_QA_SCOPE||'.local/acceptance/inbox-pending-'+Date.now()),port=46376;
if(!scope.startsWith(resolve(root,'.local/acceptance')+'/inbox-pending-'))throw Error('Invalid public scope');
await mkdir(scope,{recursive:true,mode:0o700});
const db0=new DatabaseSync(resolve(scope,'opstwin-advance.db'));db0.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db0.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');db0.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_LARK_CLI:resolve(scope,'disabled'),OPSTWIN_WECHAT_CLI:resolve(scope,'disabled'),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');
const {prepareDefaultDrafts}=await import('../server/src/default-drafts.ts');
const at=Date.now(),day=86400000,iso=n=>new Date(n).toISOString();
function seed(id,extra={},judgment={}){const row=S.put('inbox',{id:'public-'+id,title:'公开 '+id,sender:'public-'+id,body:'请确认这个公开演示事项',channel:'manual',origin:'human',status:'pending',eventAt:iso(at-day),draft:'保留草稿 '+id,...extra});S.put('inbox_triages',{id:row.id,sourceVersion:S.inboxTriageVersion(row),policyVersion:S.TRIAGE_POLICY_VERSION,status:'succeeded',method:'jev',route:'quick_reply',needsReply:.98,needsOwner:.01,needsDeepThink:.02,risk:.01,missingContext:.01,priority:'medium',priorityReason:'公开固定判断，非真实模型',actionType:'reply',resolution:'open',...judgment});}
if(!S.meta('pendingSeeded',false)){
 S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});S.put('conversations',{id:'public-primary',title:'公开会话'});S.setMeta('primaryConversationId','public-primary');
 seed('medium');seed('high',{}, {priority:'high'});
 seed('old',{eventAt:iso(at-10*day),editedByUser:true});
 seed('boundary',{eventAt:iso(at-7*day+10000)});
 seed('no-reply',{editedByUser:true,draftCandidate:{text:'保留候选'}},{route:'no_reply',actionType:'none',resolution:'none',priority:'low'});
 seed('low',{}, {priority:'low'});
 seed('unknown-time',{eventAt:undefined});seed('future',{eventAt:iso(at+day)});
 seed('failed',{}, {status:'failed',error:'公开判断失败'});seed('priority-unknown',{}, {priority:undefined});
 seed('send-unknown',{status:'send_unknown',eventAt:iso(at-10*day),sendKey:'public-existing'});
 seed('decision',{}, {route:'no_reply',actionType:'decision',needsOwner:.95,priority:'high'});
 seed('contradiction',{}, {priority:'low',needsOwner:.95});
 seed('sensitive',{sensitive:true},{route:'no_reply',actionType:'none',resolution:'none'});
 const incoming={id:'request',sentAt:iso(at-day),isMine:false,text:'请确认星期五的公开演示时间'};
 const outgoing={id:'answer',sentAt:iso(at-day+60000),isMine:true,text:'确认星期五下午两点'};
 seed('replied',{eventAt:undefined,messages:[incoming,outgoing]}, {route:'no_reply',requestMessageId:'request',replyMessageId:'answer',resolution:'replied',actionType:'none'});
 seed('unrelated',{eventAt:undefined,chatMode:'group',messages:[incoming,{...outgoing,text:'另一个话题的材料已发'}]}, {requestMessageId:'request'});
 seed('recalled',{eventAt:undefined,messages:[incoming,{...outgoing,recalled:true}]},{requestMessageId:'request',replyMessageId:'answer',resolution:'replied'});
 seed('sync',{eventAt:undefined,messages:[incoming]}, {requestMessageId:'request'});
 seed('no-reply-empty',{draft:''},{route:'no_reply',priority:'low',actionType:'none',resolution:'none'});
 seed('low-empty',{draft:''},{priority:'low'});
 seed('old-empty',{draft:'',eventAt:iso(at-10*day)});
 seed('real-closed',{status:'done',closedAt:iso(at-2*day),eventAt:undefined,chatMode:'p2p',messages:[{...incoming,text:'请确认收到这份公开通知，只需回复收到即可。'}]},{status:'failed'});
 seed('real-ended',{body:'公开通知：演示取消，无需回复。',draft:''},{status:'failed'});
 seed('real-group',{eventAt:undefined,chatMode:'group',messages:[{...incoming,text:'@公开验收 请在明天中午前批准公开演示预算，否则团队无法继续。'},{...outgoing,text:'另一个话题：午餐我点了面条。'}]},{status:'failed'});
 seed('real-replied',{eventAt:undefined,chatMode:'p2p',messages:[incoming,outgoing]},{status:'failed'});
 S.setMeta('pendingSeeded',true);
}
const {app}=await import('../server/src/index.ts');const gate=new Hono();let failSave=false;
gate.use('*',async(c,next)=>{if(c.req.header('host')!==`127.0.0.1:${port}`||(c.req.header('origin')&&c.req.header('origin')!==`http://127.0.0.1:${port}`))return c.json({error:'origin_denied'},403);await next()});
gate.get('/qa/ready',c=>c.json({ready:true,scope}));
gate.get('/qa/counts',c=>c.json({runs:S.list('runs').length,drafts:S.db.prepare('SELECT count(*) n FROM draft_requests').get().n,sends:S.db.prepare('SELECT count(*) n FROM send_intents').get().n}));
gate.post('/qa/review-cases',c=>{
 const source=S.get('inbox','public-replied'),t=source.triage;
 for(const [id,status,judgment] of [['review-recalled','recalled',t],['review-stale-sent','sent',{...t,resolution:'open',replyMessageId:undefined}],['review-old-all','pending',{...t,requestMessageId:undefined,route:'no_reply',resolution:'none'}]]){
  const row=S.put('inbox',{...source,id:'public-'+id,status,closedAt:undefined,sentAt:undefined,receipt:undefined,messages:id==='review-old-all'?source.messages.map(m=>({...m,sentAt:iso(Date.now()-9*day)})):source.messages});
  S.put('inbox_triages',{...judgment,id:row.id,sourceVersion:S.inboxTriageVersion(row)});
 }
 return c.json({ok:true});
});
gate.post('/qa/failed-draft',c=>{const requestId='public-failed-retry',itemId='public-old-empty',fingerprint=S.hash({itemId,mode:'auto',conversationId:null,baseUpdatedAt:null});S.db.prepare('INSERT OR REPLACE INTO draft_requests VALUES(?,?,?,?,?)').run(requestId,fingerprint,'failed',JSON.stringify({itemId,requestId,policy:{mode:'chat'}}),new Date().toISOString());return c.json({requestId})});
gate.post('/qa/default',async c=>{await prepareDefaultDrafts();return c.json({ok:true})});
gate.post('/qa/fail-save',c=>{failSave=true;return c.json({ok:true})});
gate.post('/qa/arm-boundary',c=>{const row=S.get('inbox','public-boundary');const next=S.put('inbox',{...row,eventAt:iso(Date.now()-7*day+2500)});S.put('inbox_triages',{...row.triage,id:next.id,sourceVersion:S.inboxTriageVersion(next),policyVersion:S.TRIAGE_POLICY_VERSION,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open'});return c.json({ok:true})});
gate.post('/qa/expire',c=>{const row=S.get('inbox','public-medium');const next=S.put('inbox',{...row,eventAt:iso(Date.now()-8*day)});return c.json({ok:true})});
gate.post('/qa/sync-reply',c=>{const row=S.get('inbox','public-sync');S.put('inbox',{...row,messages:[...row.messages,{id:'new-answer',sentAt:iso(Date.now()),isMine:true,text:'确认，星期五下午两点'}]});return c.json({ok:true})});
gate.all('/api/*',async c=>{
 const path=c.req.path,method=c.req.method;
 if(method==='PATCH'&&path==='/api/inbox/public-medium'&&failSave){failSave=false;return c.json({error:'public_failure',message:'公开保存失败'},503)}
 const allowed=method==='GET'&&/^\/api\/(bootstrap|settings(?:\/models)?|conversations(?:\/primary|\/[^/]+(?:\/messages)?)?|inbox(?:\/query|\/(?:public-[\w-]+|round-[a-f0-9]+)(?:\/messages)?)?|tasks(?:\/task-[\w-]+)?|chat\/conversations\/[^/]+\/unresolved)$/.test(path)||method==='PATCH'&&/^\/api\/inbox\/public-[\w-]+$/.test(path)||method==='POST'&&/^\/api\/inbox\/public-[\w-]+\/(triage|surface|draft)$/.test(path)||method==='POST'&&path==='/api/tasks';
 if(!allowed)return c.json({error:'public_gate'},403);return app.fetch(c.req.raw);
});
const assets=resolve(root,'native/mygo/assets');
gate.get('*',async c=>{const path=resolve(assets,'.'+(c.req.path==='/'?'/desktop.html':c.req.path));try{if(!path.startsWith(assets+'/')||await realpath(path)!==path)return c.notFound();return new Response(await readFile(path),{headers:{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream','cache-control':'no-store'}})}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port},()=>console.log(JSON.stringify({ready:true,port,scope})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
