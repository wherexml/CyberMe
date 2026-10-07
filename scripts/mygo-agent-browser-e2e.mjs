// Public isolated workspace only. Real Chat → agent write → task UI → exact GET.
const fs=await import('node:fs/promises'),root='/Users/steve/Projects/opstwin-advance';
const out=root+'/output/mygo-1007/agent-browser-'+Date.now();await fs.mkdir(out,{recursive:true});
const p=(await taskSpace(1)).page('p1'),cases=[],title='OPSADV-QA-AGENT-'+Date.now();let conversationId,requestId;
const check=(name,value)=>{cases.push({name,status:value?'PASS':'FAIL'});if(!value)throw Error(name)};
try{
 await p.goto('http://127.0.0.1:46300/desktop.html');await p.waitForFunction(()=>window.OpsTwinsDesktop?.loadChat&&!document.querySelector('#desktop-boot'));
 const primary=await p.evaluate(async()=>(await(await fetch('/api/conversations/primary')).json()).conversationId);
 const prior=await p.evaluate(()=>window.OpsTwinsChatSessions.selected());if(await p.evaluate(()=>document.querySelector('#session-toggle').getAttribute('aria-expanded')!=='true'))await p.click('#session-toggle');await p.click('#session-new');await p.waitForFunction(id=>window.OpsTwinsChatSessions.selected()!==id,prior);
 conversationId=await p.evaluate(()=>window.OpsTwinsChatSessions.selected());
 await p.fill('#input','请实际调用工具，仅创建一个标题完全等于“'+title+'”的任务，备注完全等于“公开真实 Agent 验收 END-MYGO-AGENT”，不要修改其他记录，也不要发送任何外部消息。完成后用一句话说明结果。');
 await p.click('#send');
 await p.waitForFunction(()=>window.OpsTwinsDesignChat.entries().some(r=>['running','succeeded','failed','partial'].includes(r.status)));
 requestId=await p.evaluate(id=>window.OpsTwinsDesignChat.entries().findLast(r=>r.conversationId===id)?.requestId,conversationId);
 const deadline=Date.now()+180000;let receipt;
 while(Date.now()<deadline){receipt=await p.evaluate(async id=>{const r=await fetch('/api/chat/requests/'+encodeURIComponent(id));return r.ok?await r.json():{status:'missing'}},requestId);if(['succeeded','failed','partial'].includes(receipt.status))break;await new Promise(r=>setTimeout(r,1500))}
 check('real-agent-request-succeeded',receipt.status==='succeeded');
 const evidence=await p.evaluate(async({title,primary})=>{const search=await(await fetch('/api/workspace/search?kind=tasks&q='+encodeURIComponent(title)+'&limit=100')).json();const matches=search.items.filter(x=>x.title===title);const row=matches.length===1?await(await fetch('/api/tasks/'+encodeURIComponent(matches[0].id))).json():null;return {taskId:row?.id,exactlyOne:matches.length===1,notes:row?.notes,primaryUnchanged:(await(await fetch('/api/conversations/primary')).json()).conversationId===primary}},{title,primary});
 check('one-real-task-with-exact-content',evidence.exactlyOne&&evidence.notes==='公开真实 Agent 验收 END-MYGO-AGENT');check('primary-pointer-preserved',evidence.primaryUnchanged);
 await p.screenshot({path:out+'/chat.png'});await p.click('[data-page="tasks"]');await p.waitForFunction(title=>document.querySelector('#task-items').textContent.includes(title),title);check('agent-write-visible-in-tasks',true);await p.screenshot({path:out+'/tasks.png'});
 await p.click('button[aria-label="全局搜索"]');await p.fill('#workspace-query',title);await p.waitForFunction(()=>document.querySelector('.search-result[data-kind="tasks"]'));await p.click('.search-result[data-kind="tasks"]');await p.waitForFunction(()=>document.querySelector('#task-dialog').open);check('exact-task-opened',await p.evaluate(()=>document.querySelector('.task-notes-input').value==='公开真实 Agent 验收 END-MYGO-AGENT'));await p.screenshot({path:out+'/task-detail.png'});
}catch(e){cases.push({name:'execution',status:'FAIL',error:e.message});await p.screenshot({path:out+'/failure.png'})}
finally{await fs.writeFile(out+'/result.json',JSON.stringify({scope:'public-isolated-real-agent',title,conversationId,requestId,cases},null,2));console.log(JSON.stringify({out,cases}))}
