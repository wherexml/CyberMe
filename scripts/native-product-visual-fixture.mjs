// Read-only, synthetic visual data. Never a business/Agent/OS acceptance substitute.
import http from 'node:http';
const stamp='2026-10-03T12:00:00.000Z', conversationId='ui-side-OPSADV-QA-VISUAL';
const conversations=[{id:conversationId,title:'验收会话',createdAt:stamp,updatedAt:stamp}];
const messages=[{id:'visual-user',conversationId,role:'user',content:'请整理今天的工作安排',createdAt:stamp},{id:'visual-assistant',conversationId,role:'assistant',content:'## 今天的工作安排\n\n先审阅收件箱，再处理需要你决策的事项\n\n- 核对来源与回复草稿\n- 查看任务的截止时间\n- 保留未完成事项供下次继续\n\n这是公开合成内容，仅用于界面比较',createdAt:stamp}];
const inbox=[{id:'inbox-OPSADV-QA-VISUAL',title:'今天的进度确认',sender:'验收联系人',senderId:'qa-contact',channel:'Internal',body:'请确认今天的工作进度，并说明下一步安排',messages:[{id:'visual-source',role:'other',isMine:false,type:'text',sentAt:Date.parse(stamp),senderName:'验收联系人',sender:'验收联系人',text:'请确认今天的工作进度，并说明下一步安排',content:'请确认今天的工作进度，并说明下一步安排',createdAt:stamp}],draft:'今天的安排已经整理好，我先核对进度，再同步下一步',status:'pending',sourceSystem:'opstwin',createdAt:stamp,updatedAt:stamp,eventAt:stamp,triage:{status:'succeeded',method:'jev',route:'quick_reply',needsReply:0.92,needsOwner:0.25,needsDeepThink:0.4,risk:0.1,reason:'需要明确进度和下一步安排'}}];
const tasks=[{id:'task-OPSADV-QA-VISUAL',title:'核对项目进度',notes:'检查来源并整理下一步工作安排',status:'active',dueDate:'2026-10-03',createdAt:stamp,updatedAt:stamp}];
const ideas=[{id:'idea-OPSADV-QA-VISUAL',title:'整理每周进度摘要',description:'从已保存的工作记录整理每周进度，让需要决策的事项更容易审阅',status:'pending',category:'insight',createdAt:stamp,updatedAt:stamp}];
const settings={identity:{name:'验收用户',role:'产品使用者',language:'zh-CN',about:'公开合成资料',instructions:'回复保持简洁'},autonomy:{holdSending:false,levels:{ack:'draft',meet:'draft',docs:'draft',commit:'draft',boss:'draft',sensitive:'observe'},deepThink:['vip'],quietFrom:'23:00',quietUntil:'07:00',alerts:'urgent_digest',transparency:true}};
const bootstrap={revision:1,conversations,messages,inbox,tasks,ideas,settings,activities:[],artifacts:[],automations:[],connections:[],memories:[],projects:[],sources:[]};
const page=items=>({items,total:items.length,offset:0,limit:50,hasMore:false,nextOffset:items.length});
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1:46193');let status=200,value;
 if(req.method!=='GET'){status=405;value={error:'visual_fixture_read_only'};}
 else if(u.pathname==='/api/native/version')value={apiVersion:1,revision:1,server:'SYNTHETIC-VISUAL-FIXTURE',features:['messages.page']};
 else if(u.pathname==='/api/health')value={ok:true,revision:1};
 else if(u.pathname==='/api/bootstrap')value=bootstrap;
 else if(u.pathname==='/api/conversations/primary')value={conversationId,conversation:conversations[0]};
 else if(u.pathname==='/api/conversations')value=page(conversations);
 else if(u.pathname.endsWith('/messages'))value={items:messages,hasMore:false,nextBefore:null};
 else if(u.pathname==='/api/chat/conversations/state')value={items:(u.searchParams.get('ids')||'').split(',').map(id=>({id,found:id===conversationId,running:false,partial:false,pending:0,locked:id!==conversationId}))};
 else if(u.pathname===`/api/chat/conversations/${conversationId}/unresolved`)value={conversationId,revision:1,total:0,partialCount:0,items:[],hasMore:false,nextBefore:null};
 else if(u.pathname.startsWith('/api/chat/continuation/'))value={running:false,items:[]};
 else if(u.pathname==='/api/inbox/query')value={...page(inbox),unknownTimeCount:0};
 else if(u.pathname==='/api/inbox/'+inbox[0].id)value=inbox[0];
 else if(u.pathname==='/api/tasks')value=page(tasks);
 else if(u.pathname==='/api/tasks/'+tasks[0].id)value=tasks[0];
 else if(u.pathname==='/api/ideas')value=page(ideas);
 else if(u.pathname==='/api/ideas/'+ideas[0].id)value=ideas[0];
 else if(u.pathname==='/api/settings')value=settings;
 else if(u.pathname==='/api/settings/models')value={version:1,channels:[],standard:{channel:'fixture',model:'fixture-read-only'},deep:{channel:'fixture',model:'fixture-read-only'}};
 else if(u.pathname==='/api/artifacts')value=page([]);
 else if(u.pathname==='/__qa/data')value=bootstrap;
 else {status=404;value={error:'not_found'};}
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));
}).listen(46193,'127.0.0.1',()=>console.log('SYNTHETIC visual fixture; reads only; 127.0.0.1:46193'));
