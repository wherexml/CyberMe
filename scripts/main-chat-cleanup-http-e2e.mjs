// Production HTTP/SQLite integration with public controlled judgments; no model calls.
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {randomBytes,createHash} from 'node:crypto';
const port=46536,base='http://127.0.0.1:'+port,kind='inbox-analysis-v1';
if(process.argv.includes('--serve')){
 const {DatabaseSync}=await import('node:sqlite');const seed=new DatabaseSync(path.join(process.env.OPSTWIN_DATA_DIR,'opstwin-advance.db'));seed.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT OR REPLACE INTO meta VALUES('initialized','true')");seed.close();
 const S=await import('../server/src/store.ts'),{app}=await import('../server/src/index.ts'),{Hono}=await import('hono'),{serve}=await import('@hono/node-server'),{syncInboxChat}=await import('../server/src/inbox-chat.ts');
 const gate=new Hono();gate.use('*',async(c,next)=>{if(c.req.header('X-E2E')!==process.env.E2E_TOKEN)return c.json({error:'forbidden'},403);await next()});
 gate.post('/__fixture',async c=>{const x=await c.req.json(),stamp=new Date().toISOString();
  if(x.op==='init'){
   S.put('conversations',{id:'public-primary',title:'公开主会话'});S.setMeta('primaryConversationId','public-primary');S.patchSettings({identity:{language:'zh-CN'}});
   S.put('conversations',{id:'public-side',sideChat:true,title:'公开侧会话'});
   for(const role of ['user','assistant'])S.put('messages',{id:'ordinary-'+role,conversationId:'public-primary',role,content:role==='user'?'公开人工消息':'公开正常助手消息'});
   S.put('messages',{id:'inbox-analysis-failures',conversationId:'public-primary',role:'assistant',content:'旧批量失败',inboxAnalysis:{kind,aggregate:true,itemId:'failed'}});
   S.put('messages',{id:'orphan-derived',conversationId:'public-primary',role:'assistant',content:'旧孤儿',inboxAnalysis:{kind,itemId:'missing'}});
  }else{
   const id=x.id,source='source-'+id,previous=S.get('inbox',id),item=S.put('inbox',{...previous,id,title:'公开事项 '+id,sender:'公开同事',channel:'manual',origin:'human',status:'pending',receivedAt:stamp,body:'请在周五前确认项目预算是否通过。',messages:[{id:source,isMine:false,direction:'incoming',body:'请在周五前确认项目预算是否通过。',sentAt:stamp}],draft:'预算已核对，请批准后回复。',...x.item});
   S.put('inbox_triages',{id,sourceVersion:S.inboxTriageVersion(item),policyVersion:S.TRIAGE_POLICY_VERSION,status:'succeeded',route:'quick_reply',priority:'medium',actionType:'reply',resolution:'open',requestMessageId:source,needsReply:.99,needsOwner:.1,missingContext:0,risk:0,reason:'direct_request',...x.triage});
   if(x.legacy)S.put('messages',{id:'inbox-analysis-'+S.hash(id).slice(0,32),conversationId:'public-primary',role:'assistant',content:'旧垃圾提示',inboxAnalysis:{kind,itemId:id,state:'closed'}});
  }
  const protectedHash=()=>S.hash(S.db.prepare("SELECT type,id,data,deleted FROM entities WHERE NOT(type='messages' AND COALESCE(json_extract(data,'$.inboxAnalysis.kind'),'')=?) ORDER BY type,id").all(kind)),before=protectedHash();
  syncInboxChat();return c.json({ok:true,preserved:before===protectedHash()});
 });
 gate.get('/__proof',c=>{const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');return c.json({revision:S.revision(),primary:S.meta('primaryConversationId',null),derived:S.list('messages').filter(m=>m.inboxAnalysis),protected:hash(S.db.prepare("SELECT type,id,data,deleted FROM entities WHERE NOT(type='messages' AND COALESCE(json_extract(data,'$.inboxAnalysis.kind'),'')=?) ORDER BY type,id").all(kind))})});
 gate.all('*',c=>{if(c.req.method!=='GET')return c.json({error:'no_business_writes'},403);return app.fetch(c.req.raw)});
 const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port},()=>console.log('READY'));
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));await new Promise(()=>{});
}else{
 const tag=Date.now(),out='output/mygo-main-chat-cleanup-20261019/http-'+tag,scope=path.resolve('.local/main-chat-cleanup-'+tag);await fs.mkdir(out,{recursive:true});await fs.mkdir(scope,{recursive:true,mode:0o700});
 const token=randomBytes(32).toString('hex'),checks=[];let child;
 const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
 const api=async(p,body)=>{const r=await fetch(base+p,{method:body?'POST':'GET',headers:{'X-E2E':token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('HTTP '+r.status);return r.json()};
 const start=async()=>{child=spawn(process.execPath,['--import','tsx',import.meta.filename,'--serve'],{env:{...process.env,OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_INBOX_CHAT_BACKGROUND:'1',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',E2E_TOKEN:token},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',b=>err+=b);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('start timeout '+err.slice(-500))),20000);child.once('exit',()=>{clearTimeout(timer);reject(Error('child exit '+err.slice(-500)))});child.stdout.on('data',b=>{if(b.toString().includes('READY')){clearTimeout(timer);resolve()}})})};
 const stop=async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}};
 const seed=async(id,item={},triage={},legacy=true)=>{const result=await api('/__fixture',{id,item,triage,legacy});if(!result.preserved)throw Error('Cleanup changed canonical records: '+id);return result};
 const rows=async()=>{const r=await api('/api/conversations/public-primary/messages?limit=200');return r.items};
 try{
  const net=await import('node:net');const busy=await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.on('connect',()=>{s.destroy();r(true)});s.on('error',()=>r(false))});if(busy)throw Error('Fixture port occupied');
  await start();await api('/__fixture',{op:'init'});
  for(const [id,item,triage] of [
   ['closed',{status:'done'},{}],['dismissed',{status:'dismissed'},{}],['fyi',{}, {actionType:'none',resolution:'unknown',reason:'fyi',route:'review'}],['unclear',{}, {actionType:'unknown',resolution:'unknown',reason:'unclear',route:'review'}],['ack',{messages:[],body:'ok',draft:'ok'},{}],['emoji',{messages:[],body:'👍'},{}],['type-label',{messages:[],body:'[图片]'},{}],['failed',{}, {status:'failed',error:'公开分析失败'}],['running',{}, {status:'running'}],['low',{}, {priority:'low'}],['no-reply',{}, {route:'no_reply',actionType:'none'}],['missing-request',{}, {requestMessageId:'absent'}],['expired',{messages:[],receivedAt:'2000-01-01T00:00:00Z'},{}],['revoked',{channel:'WeChat'},{}]
  ]){await seed(id,item,triage);check(id+' 旧提示退出',!(await rows()).some(m=>m.inboxAnalysis?.itemId===id))}
  check('批量失败及孤儿提示清理',!(await rows()).some(m=>['inbox-analysis-failures','orphan-derived'].includes(m.id)));
  await seed('action');let action=(await rows()).find(m=>m.inboxAnalysis?.itemId==='action');check('明确请求显示具体原文和精确来源',action.content.includes('请在周五前确认项目预算是否通过')&&action.contextIds[0]==='action');const stableId=action.id,createdAt=action.createdAt;
  await seed('decision',{}, {actionType:'decision',reason:'decision',route:'review'});check('明确个人决策保留',(await rows()).some(m=>m.inboxAnalysis?.itemId==='decision'&&m.content.includes('需要你决策')));
  await seed('tiny-draft',{draft:'ok'});check('ok草稿不展示但真实请求保留',(await rows()).some(m=>m.inboxAnalysis?.itemId==='tiny-draft'&&!m.content.includes('> ok')&&m.content.includes('请在周五前')));
  await seed('progress',{draftPreparation:{status:'queued',requestId:'queued-public'}});check('队列状态不刷屏而请求仍保留',(await rows()).some(m=>m.inboxAnalysis?.itemId==='progress'&&!m.content.includes('排队')));
  await seed('send-unknown',{status:'send_unknown'}, {status:'failed'});check('发送未知保留恢复且不暴露草稿',(await rows()).some(m=>m.inboxAnalysis?.itemId==='send-unknown'&&m.inboxAnalysis.state==='unknown'&&!m.content.includes('预算已核对')));
  await seed('draft-unknown',{draftPreparation:{status:'unknown',requestId:'original-public'}}, {status:'failed'});check('生成未知保留原请求ID',(await rows()).some(m=>m.inboxAnalysis?.itemId==='draft-unknown'&&m.inboxAnalysis.requestId==='original-public'));
  await seed('action',{status:'done'},{},false);check('已显示的事项结束后退出',!(await rows()).some(m=>m.id===stableId));await seed('action',{}, {},false);action=(await rows()).find(m=>m.id===stableId);check('重新合格复用原ID与时间',action?.createdAt===createdAt);
  let proof=await api('/__proof');await new Promise(r=>setTimeout(r,3500));let after=await api('/__proof');check('空转不写revision',proof.revision===after.revision);check('只清理派生消息不改业务记录',proof.protected===after.protected);check('普通人工及助手聊天保留',(await rows()).filter(m=>m.id.startsWith('ordinary-')).length===2);check('GET无写副作用',after.revision===(await api('/__proof')).revision);check('侧会话无派生提示',!(await api('/api/conversations/public-side/messages?limit=200')).items.length);
  await stop();await start();after=await api('/__proof');check('重启消息集合及ID稳定',JSON.stringify(proof.derived.map(m=>m.id).sort())===JSON.stringify(after.derived.map(m=>m.id).sort()));check('重启业务记录及主指针保持',proof.protected===after.protected&&after.primary==='public-primary');check('重启不恢复垃圾提示',after.derived.every(m=>!['closed','waiting','failed','analyzing'].includes(m.inboxAnalysis.state)));
  await fs.writeFile(out+'/public-messages.json',JSON.stringify(after.derived,null,2));
 }catch(e){await fs.writeFile(out+'/error.txt',String(e));process.exitCode=1}finally{await stop();await fs.writeFile(out+'/result.json',JSON.stringify({checks,scope:'production HTTP, SQLite, controlled public judgments; no live model or native GUI claim'},null,2));console.log(JSON.stringify({out,checks},null,2))}
}
