// Public synthetic GUI fixture. No credentials, production access, or model calls.
import http from 'node:http';
const port=46306, cid='text-layout-public';
const text='请回复我收到公开测试计划就行。只需确认收到，没有任何承诺；不需要查资料，不发送消息。中文标点、English words、emoji 👩🏽‍💻 都应该正常换行。'.repeat(4);
const stamp='2026-10-04T01:11:00.000Z';
const inbox=[0,1].map(i=>({id:'layout-inbox-'+i,sender:'OPSADV-QA Public Collection '+i,title:'公开文字布局',body:text,status:'pending',channel:'Internal',createdAt:stamp,updatedAt:stamp,eventAt:stamp,triage:{status:'succeeded',method:'jev',route:'observe',needsReply:0,needsOwner:0,needsDeepThink:0,risk:0}}));
const ideas=[{id:'layout-idea',title:'公开长描述两行省略',description:text,status:'pending',category:'insight',createdAt:stamp}];
const conversations=[{id:cid,title:'公开文字布局',createdAt:stamp}];
const data={conversations,inbox,ideas,tasks:[],connections:[],messages:[{id:'readable-message',conversationId:cid,role:'assistant',content:"正文与列表裁切复验\n\n普通段落：中文正文与 English 混排应完整显示，不能遮挡右侧。中文正文与 English 混排应完整显示，不能遮挡右侧。中文正文与 English 混排应完整显示，不能遮挡右侧。中文正文与 English 混排应完整显示，不能遮挡右侧。中文正文与 English 混排应完整显示，不能遮挡右侧。中文正文与 English 混排应完整显示，不能遮挡右侧。\n\n- 群**「公开朋友们⑮」确实存在，ID `PUBLIC-CHAT@chatroom`，最后活跃时间约今天 23:24 SGT**——说明该群今天有消息，但是正文必须全部显示到行末。\n- 会话列表第 1 页（20 条）里没有第二个同名群；另有公众号「公开」，与它是两回事。列表 `hasMore=true`、覆盖不完整，所以不能说只有这一个。\n- 连续中文列表内容及标点，检查所有可见行末字符完整。连续中文列表内容及标点，检查所有可见行末字符完整。连续中文列表内容及标点，检查所有可见行末字符完整。连续中文列表内容及标点，检查所有可见行末字符完整。连续中文列表内容及标点，检查所有可见行末字符完整。尾标 END-LIST\n\n> 引用段落正文必须按缩进后的实际宽度断行。引用段落正文必须按缩进后的实际宽度断行。引用段落正文必须按缩进后的实际宽度断行。引用段落正文必须按缩进后的实际宽度断行。引用段落正文必须按缩进后的实际宽度断行。END-QUOTE",runId:'readable-run',createdAt:stamp}],memories:[],artifacts:[],activities:[],automations:[],revision:1};
const page=items=>({items,total:items.length,hasMore:false});
http.createServer((req,res)=>{
 let status=200,value;const u=new URL(req.url,'http://127.0.0.1:'+port),p=u.pathname;
 if(req.method!=='GET'){status=405;value={error:'synthetic_read_only',message:'公开只读布局验收，不执行模型或写操作'};}
 else if(p==='/api/health')value={ok:true,revision:1};
 else if(p==='/api/native/version')value={apiVersion:1,revision:1,features:['messages.page']};
 else if(p==='/api/bootstrap')value=data;
 else if(p==='/api/conversations/primary')value={conversationId:cid,conversation:conversations[0]};
 else if(p==='/api/conversations')value=page(conversations);
 else if(p==='/api/conversations/'+cid)value=conversations[0];
 else if(p==='/api/conversations/'+cid+'/messages')value={...page(data.messages),nextBefore:null};
 else if(p==='/api/chat/conversations/state')value={items:[{id:cid,found:true,running:false,partial:false,pending:0,locked:false}]};
 else if(p==='/api/chat/conversations/'+cid+'/unresolved')value={...page([]),conversationId:cid,revision:1,partialCount:0,nextBefore:null};
 else if(p.startsWith('/api/chat/continuation/'))value={running:false,items:[]};
 else if(p==='/api/inbox/query')value={...page(inbox),unknownTimeCount:0};
 else if(inbox.some(i=>p==='/api/inbox/'+i.id))value=inbox.find(i=>p==='/api/inbox/'+i.id);
 else if(p==='/api/messages/readable-message')value=data.messages[0];
 else if(p==='/api/runs/readable-run')value={id:'readable-run',status:'succeeded',startedAt:stamp,completedAt:stamp,taskOutcome:{status:'partial'},tools:[{name:'list_entities',effect:'read',status:'succeeded',input:{raw:'INTERNAL_JSON_NOT_FOR_UI'}},{name:'create_task',effect:'write',status:'succeeded'},{name:'app_action',effect:'write',status:'failed'}],output:'INTERNAL_JSON_NOT_FOR_UI'};
 else if(p==='/api/ideas')value=page(ideas);
 else if(p==='/api/settings')value={identity:{language:'zh-CN'},autonomy:{holdSending:true}};
 else if(['/api/tasks','/api/artifacts','/api/connections'].includes(p))value=page([]);
 else {status=404;value={error:'not_found'};}
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));
}).listen(port,'127.0.0.1',()=>console.log('PUBLIC_TEXT_LAYOUT_FIXTURE '+port));
