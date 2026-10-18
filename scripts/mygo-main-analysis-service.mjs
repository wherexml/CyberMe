// Own public QA scope, production Hono/SQLite/Jev/model; no external-send routes.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';import {randomBytes,timingSafeEqual} from 'node:crypto';
import {serve} from '@hono/node-server';import {Hono} from 'hono';import {DatabaseSync} from 'node:sqlite';
const scope=resolve('.local/mygo-main-analysis-20261018/runtime');await mkdir(scope,{recursive:true,mode:0o700});
const source=JSON.parse(await readFile('.local/config.json','utf8'));
try{await writeFile(resolve(scope,'config.json'),JSON.stringify({llm:source.llm}),{mode:0o600,flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}
const seed=new DatabaseSync(resolve(scope,'opstwin-advance.db'));seed.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT OR REPLACE INTO meta VALUES('initialized','true')");seed.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_CHAT_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
const {app}=await import('../server/src/index.ts');const S=await import('../server/src/store.ts');const {startInboxTriage}=await import('../server/src/inbox-triage.ts');const {startDefaultDrafts}=await import('../server/src/default-drafts.ts');
if(!S.get('conversations','main-analysis-primary')){S.put('conversations',{id:'main-analysis-primary',title:'主会话'});S.setMeta('primaryConversationId','main-analysis-primary');S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});}
const token=randomBytes(32).toString('hex'),gate=new Hono();let timers=[];
const itemId='main-analysis-live',at=()=>new Date().toISOString();
gate.use('*',async(c,next)=>{const supplied=c.req.header('X-OpsTwins-Pilot')||'';if(supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return c.json({error:'unauthorized'},403);await next()});
gate.all('*',async c=>{
 if(c.req.path==='/api/pilot/main-analysis'&&c.req.method==='POST'){
  const input=await c.req.json();
  if(input.action==='seed'){
   if(S.get('inbox',itemId))return c.json({error:'already_seeded'},409);
   S.put('tasks',{id:'main-analysis-fact',title:'MINT-8421演示材料',status:'completed',notes:'演示材料已经整理好并完成本地检查，无需上传或发送文件。'});
   return c.json(S.put('inbox',{id:itemId,title:'确认演示材料准备情况',sender:'公开同事',channel:'manual',origin:'human',status:'pending',receivedAt:at(),context:['main-analysis-fact'],messages:[{id:'main-analysis-source',isMine:false,senderName:'公开同事',sentAt:at(),body:'请确认MINT-8421演示材料是不是已经准备好了？只需要回复确认当前情况，不用再做任何事情'}],body:'请确认MINT-8421演示材料是不是已经准备好了？只需要回复确认当前情况，不用再做任何事情'}));
  }
  if(input.action==='start'){if(!timers.length)timers=[startInboxTriage(),startDefaultDrafts()];return c.json({started:true})}
  if(input.action==='case'){
   if(!['ready','unknown','candidate','send_unknown','old_failure','closed','failed','revoke','new_unavailable'].includes(input.kind))return c.json({error:'invalid_case'},400);
   const id='boundary-'+input.kind,old=S.get('inbox',id),stamp=at();
   const item=S.put('inbox',{...old,id,title:'公开边界 '+input.kind,sender:'公开同事',channel:input.revoke||input.kind==='new_unavailable'?'Feishu':'manual',origin:'human',status:input.kind==='send_unknown'?'send_unknown':input.kind==='closed'?'done':'pending',receivedAt:stamp,body:'公开确认事项',draft:'HUMAN-'+input.kind,editedByUser:true,...(input.kind==='unknown'?{draftPreparation:{requestId:'public-unknown',status:'unknown'}}:{}),...(input.kind==='candidate'?{draftCandidate:{requestId:'candidate-public',text:'CANDIDATE-NOT-ADOPTED',runId:'public-fixture'}}:{})});
   if(input.revoke)S.put('connections',{id:'feishu-local',title:'公开断开连接',status:'disconnected'});
   const failed=['failed','old_failure'].includes(input.kind);S.put('inbox_triages',{id,sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,status:failed?'failed':'succeeded',method:'public_fixture',route:failed?'review':'quick_reply',priority:'medium',actionType:'reply',resolution:'open',needsReply:.99,missingContext:0,risk:0,error:failed?'Jev HTTP 402':undefined,updatedAt:input.kind==='old_failure'?'2000-01-01T00:00:00.000Z':stamp});
   if(input.kind==='old_failure'){const row=S.get('inbox_triages',id);S.db.prepare("UPDATE entities SET data=? WHERE type='inbox_triages' AND id=?").run(JSON.stringify({...row,updatedAt:'2000-01-01T00:00:00.000Z'}),id)}
   return c.json({id});
  }
  if(input.action==='recover'){const x=S.get('inbox',itemId),row=S.db.prepare('SELECT state FROM draft_requests WHERE id=?').get(x.draftPreparation.requestId);if(row?.state!=='succeeded')return c.json({error:'receipt_not_succeeded'},409);return c.json(S.put('inbox',{...x,draftPreparation:{requestId:x.draftPreparation.requestId,status:'succeeded'}}))}
  if(input.action==='qualified'){const x=S.get('inbox',itemId);return c.json(S.put('inbox_triages',{id:itemId,sourceVersion:S.inboxTriageVersion(x),policyVersion:S.TRIAGE_POLICY_VERSION,status:input.running?'running':'succeeded',method:'public_fixture',model:'public-controlled-fixture',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',requestMessageId:'main-analysis-source',needsReply:.99,needsOwner:.1,needsDeepThink:.1,missingContext:0,risk:0,reason:'direct_request',completedAt:at()}))}
  if(input.action==='stop'){timers.forEach(clearInterval);timers=[];return c.json({stopped:true})}
  // Canonical state injection is public recovery coverage, never claimed as real model.
  if(input.action==='fault'){
   const x=S.get('inbox',itemId);if(!x)return c.json({error:'missing'},404);
   if(input.kind==='unknown')return c.json(S.put('inbox',{...x,draftPreparation:{...x.draftPreparation,status:'unknown',code:'server_interrupted'}}));
   if(input.kind==='source-change')return c.json(S.put('inbox',{...x,body:x.body+'\n公开新增资料 CHANGED-8421',messages:[...x.messages,{id:'source-new-'+Date.now(),isMine:false,sentAt:at(),body:'补充，请核对新范围 CHANGED-8421'}]}));
   if(input.kind==='deleted'){S.remove('inbox',itemId);return c.json({deleted:true})}
  }
  return c.json({error:'invalid_action'},400)
 }
 if(c.req.path==='/api/pilot/main-analysis'&&c.req.method==='GET')return c.json({item:S.get('inbox',itemId),messages:S.list('messages').filter(m=>m.inboxAnalysis),draftRequests:S.db.prepare('SELECT id,state FROM draft_requests').all(),primary:S.meta('primaryConversationId',null)});
 if(/\/(send|undo|calendar|call-tool)(\/|$)/.test(c.req.path)||/\/api\/(import|notifications|autonomous-dispatches)/.test(c.req.path))return c.json({error:'external_disabled'},403);
 return app.fetch(c.req.raw);
});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46510},async()=>{await mkdir('.local/mygo-v17-public',{recursive:true,mode:0o700});await writeFile('.local/mygo-v17-public/connection.json',JSON.stringify({port:46510,token}),{mode:0o600});console.log(JSON.stringify({ready:true,port:46510,scope:'main-analysis-public'}))});

for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{timers.forEach(clearInterval);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref()});
