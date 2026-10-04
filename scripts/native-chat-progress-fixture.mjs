// Public GUI transport fixture: holds POST while independently answering receipt GET.
// No real model, credentials, user data or external sends. Fresh RAM state each run.
import http from 'node:http';
const port=46264, cid='QA-CHAT-PROGRESS', requests=new Map(), calls=[];
let revision=1, readFailure=false;
const conversations=[{id:cid,title:'公开处理状态验收'},{id:cid+'-B',title:'公开独立会话'}];
const messages=[];
const page=items=>({items,total:items.length,hasMore:false,nextBefore:null});
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
http.createServer(async(req,res)=>{
 const u=new URL(req.url,`http://127.0.0.1:${port}`),p=u.pathname;
 if(p==='/__qa/state'&&req.method==='GET')return reply(res,200,{calls,requests:[...requests.values()].map(r=>({requestId:r.requestId,status:r.status,conversationId:r.conversationId})),readFailure});
 if(p==='/__qa/read-failure'&&req.method==='POST'){readFailure=u.searchParams.get('on')==='1';return reply(res,200,{readFailure});}
 if(p==='/__qa/finish'&&req.method==='POST'){
  const r=[...requests.values()].find(r=>r.status==='running');if(!r)return reply(res,404,{});
  r.status=u.searchParams.get('status')||'succeeded';revision++;
  if(r.status==='succeeded'){
   const assistantMessage={id:'assistant-'+r.requestId,role:'assistant',content:'公开验收：处理完成。',conversationId:r.conversationId,createdAt:new Date().toISOString()};messages.push(assistantMessage);
   r.result={conversationId:r.conversationId,requestId:r.requestId,userMessage:r.userMessage,assistantMessage,run:{id:r.runId,status:'succeeded'},artifacts:[]};
   // Deliberately keep original response unresolved when requested: GET must recover.
   if(u.searchParams.get('hold')!=='1')reply(r.res,200,r.result);
  }else if(u.searchParams.get('hold')!=='1')reply(r.res,502,{error:'agent_failed',message:'公开验收故障'});
  return reply(res,200,{status:r.status});
 }
 if(p==='/api/chat'&&req.method==='POST'){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)return reply(res,413,{});}
  let b;try{b=JSON.parse(raw);}catch{return reply(res,400,{});}
  if(!conversations.some(c=>c.id===b.conversationId)||typeof b.requestId!=='string'||!b.message.startsWith('OPSADV-QA'))return reply(res,400,{error:'public_fixture_only'});
  calls.push({method:'POST',requestId:b.requestId});
  if(requests.has(b.requestId))return reply(res,409,{error:'request_in_progress'});
  const userMessage={id:'user-'+b.requestId,role:'user',content:b.message,requestId:b.requestId,conversationId:b.conversationId,createdAt:new Date().toISOString()};messages.push(userMessage);
  requests.set(b.requestId,{requestId:b.requestId,conversationId:b.conversationId,runId:'run-'+b.requestId,status:'running',userMessage,res});revision++;return;
 }
 if(req.method!=='GET')return reply(res,405,{error:'fixture_method'});
 if(p.startsWith('/api/chat/requests/')){
  const id=p.split('/').at(-1),r=requests.get(id);calls.push({method:'GET',requestId:id,status:readFailure?503:r?200:404});
  if(readFailure)return reply(res,503,{error:'fixture_read_failure',message:'公开回查故障'});
  return r?reply(res,200,{requestId:id,conversationId:r.conversationId,runId:r.runId,status:r.status,runStatus:r.status,result:r.result,userMessage:r.userMessage,...(r.status==='partial'?{completedWrites:[{id:'QA-write'}]}:{})}):reply(res,404,{error:'request_not_found'});
 }
 let value,status=200;
 if(p==='/api/health')value={ok:true,revision};
 else if(p==='/api/native/version')value={apiVersion:1,revision,features:['messages.page']};
 else if(p==='/api/bootstrap')value={conversations,messages,inbox:[],ideas:[],tasks:[],connections:[],memories:[],artifacts:[],activities:[],automations:[],revision};
 else if(p==='/api/conversations/primary')value={conversationId:cid,conversation:conversations[0]};
 else if(p==='/api/conversations')value=page(conversations);
 else if(p.match(/^\/api\/conversations\/[^/]+\/messages$/))value={...page(messages.filter(m=>m.conversationId===p.split('/')[3])),revision};
 else if(p==='/api/chat/conversations/state')value={items:conversations.map(c=>({id:c.id,found:true,running:[...requests.values()].some(r=>r.conversationId===c.id&&r.status==='running'),partial:false,pending:0,locked:false}))};
 else if(p.endsWith('/unresolved'))value={...page([]),conversationId:p.split('/')[4],revision,partialCount:0};
 else if(p.startsWith('/api/chat/continuation/'))value={running:false,items:[]};
 else if(p==='/api/settings')value={identity:{language:'zh-CN'},autonomy:{holdSending:true}};
 else if(p==='/api/inbox/query')value={...page([]),unknownTimeCount:0};
 else if(['/api/tasks','/api/ideas','/api/artifacts','/api/connections'].includes(p))value=page([]);
 else {status=404;value={error:'not_found'};}
 return reply(res,status,value);
}).listen(port,'127.0.0.1',()=>console.log(`PUBLIC_CHAT_PROGRESS_FIXTURE ${port}`));
