// Public synthetic GUI fixture. No credentials, production access, or model calls.
import http from 'node:http';
const port=46262, cid='text-layout-public';
const text='请回复我收到公开测试计划就行。只需确认收到，没有任何承诺；不需要查资料，不发送消息。中文标点、English words、emoji 👩🏽‍💻 都应该正常换行。'.repeat(4);
const stamp='2026-10-04T01:11:00.000Z';
const inbox=[0,1].map(i=>({id:'layout-inbox-'+i,sender:'OPSADV-QA Public Collection '+i,title:'公开文字布局',body:text,status:'pending',channel:'Internal',createdAt:stamp,updatedAt:stamp,eventAt:stamp,triage:{status:'succeeded',method:'jev',route:'observe',needsReply:0,needsOwner:0,needsDeepThink:0,risk:0}}));
const ideas=[{id:'layout-idea',title:'公开长描述两行省略',description:text,status:'pending',category:'insight',createdAt:stamp}];
const conversations=[{id:cid,title:'公开文字布局',createdAt:stamp}];
const data={conversations,inbox,ideas,tasks:[],connections:[],messages:[],memories:[],artifacts:[],activities:[],automations:[],revision:1};
const page=items=>({items,total:items.length,hasMore:false});
const pending = new Map(), calls = [], saves=[]; let saveMode='pass', heldSave;
for(const item of inbox)item.draft='公开可编辑草稿 '+item.id;
const reply=(res,status,value)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(value));};
http.createServer(async (req,res)=>{
 let status=200,value;const u=new URL(req.url,'http://127.0.0.1:'+port),p=u.pathname;
 if(p==='/__qa/state' && req.method==='GET') return reply(res,200,{calls,pending:[...pending.keys()],saves,heldSave:!!heldSave,items:inbox});
 if(p==='/__qa/save-mode' && req.method==='POST') {saveMode=u.searchParams.get('mode');return reply(res,200,{saveMode});}
 if(p==='/__qa/release-save' && req.method==='POST') {if(!heldSave)return reply(res,404,{});heldSave();heldSave=undefined;return reply(res,200,{});}
 const patch=inbox.find(i=>p==='/api/inbox/'+i.id);
 if(patch&&req.method==='PATCH') {
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);saves.push({id:patch.id,...body});
   const complete=()=>{if(body.baseUpdatedAt!==patch.updatedAt)return reply(res,409,{error:'edit_conflict',message:'公开版本冲突',detail:{entity:patch}});
    patch.draft=body.draft;patch.editedByUser=true;patch.updatedAt=new Date().toISOString();return reply(res,200,patch);};
   if(saveMode==='hold'){heldSave=complete;saveMode='pass';return;}
   if(saveMode==='fail'){saveMode='pass';return reply(res,503,{error:'fixture_save_failed',message:'公开自动保存故障'});}
   if(saveMode==='conflict'){saveMode='pass';patch.updatedAt=new Date().toISOString();patch.draft='公开并发版本';return complete();}
   return complete();
 }
 if(p==='/__qa/release'  && req.method==='POST') {
   const id=u.searchParams.get('id'), held=pending.get(id);
   if(!held)return reply(res,404,{error:'no_pending'});
   pending.delete(id);
   if(u.searchParams.get('fail')==='1')reply(held.res,503,{error:'fixture_unavailable',message:'公开验收故障，请稍后重试'});
   else {held.item.draft='公开后台草稿 '+id;reply(held.res,200,{item:held.item,replayed:false});}
   return reply(res,200,{released:id});
 }
 const item=inbox.find(i=>p==='/api/inbox/'+i.id+'/draft');
 if(item && req.method==='POST') {
   let raw=''; for await(const chunk of req){raw+=chunk;if(raw.length>4096)return reply(res,413,{});}
   const body=JSON.parse(raw); calls.push({id:item.id,requestId:body.requestId});
   if(pending.has(item.id))return reply(res,409,{error:'request_in_progress'});
   pending.set(item.id,{res,item});return;
 }
 if(req.method!=='GET'){status=405;value={error:'synthetic_read_only',message:'公开只读布局验收，不执行模型或写操作'};}
 else if(p==='/api/health')value={ok:true,revision:1};
 else if(p==='/api/native/version')value={apiVersion:1,revision:1,features:['messages.page']};
 else if(p==='/api/bootstrap')value=data;
 else if(p==='/api/conversations/primary')value={conversationId:cid,conversation:conversations[0]};
 else if(p==='/api/conversations')value=page(conversations);
 else if(p==='/api/conversations/'+cid)value=conversations[0];
 else if(p==='/api/conversations/'+cid+'/messages')value={...page([]),nextBefore:null};
 else if(p==='/api/chat/conversations/state')value={items:[{id:cid,found:true,running:false,partial:false,pending:0,locked:false}]};
 else if(p==='/api/chat/conversations/'+cid+'/unresolved')value={...page([]),conversationId:cid,revision:1,partialCount:0,nextBefore:null};
 else if(p.startsWith('/api/chat/continuation/'))value={running:false,items:[]};
 else if(p==='/api/inbox/query')value={...page(inbox),unknownTimeCount:0};
 else if(inbox.some(i=>p==='/api/inbox/'+i.id))value=inbox.find(i=>p==='/api/inbox/'+i.id);
 else if(p==='/api/ideas')value=page(ideas);
 else if(p==='/api/settings')value={identity:{language:'zh-CN'},autonomy:{holdSending:true}};
 else if(['/api/tasks','/api/artifacts','/api/connections'].includes(p))value=page([]);
 else {status=404;value={error:'not_found'};}
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));
}).listen(port,'127.0.0.1',()=>console.log('PUBLIC_INBOX_AUTOSAVE_FIXTURE '+port));
