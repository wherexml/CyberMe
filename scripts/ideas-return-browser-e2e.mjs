// Public fixture only. Run with ego-browser nodejs < this file after starting ideas-chat-e2e-service.
const fs=await import('node:fs/promises'),p=(await taskSpace(28)).page('p1'),checks=[];
function check(name,pass,detail){checks.push({name,pass,detail});if(!pass)throw Error(name)}
await p.reload();await p.waitForSelector('.idea-chat-source a');
await p.evaluate(()=>{
 window.originalIdeaApi=window.OpsTwinsDesktop.api;
 window.OpsTwinsDesktop.api=async(method,path,...args)=>{if(path==='/api/ideas/return-public'){if(window.returnDelay)await new Promise(r=>window.releaseIdea=r);if(window.returnFailure)throw Error('公开读取失败')}return window.originalIdeaApi(method,path,...args)};
 data.messages.push({id:'ordinary-message',conversationId:window.OpsTwinsChatSessions.selected(),role:'assistant',content:'普通消息\n\n灵感提醒\n\n此处是正文',createdAt:new Date().toISOString()});renderChat();
});
await p.fill('textarea[placeholder="输入消息…"]','公开未发送草稿');
check('only projection label hidden',await p.evaluate(()=>!document.querySelector('.idea-chat-source').closest('[data-message-id]').textContent.includes('灵感提醒')&&document.querySelector('[data-message-id="ordinary-message"]').textContent.includes('灵感提醒')));
await p.click('.idea-chat-source a');await p.waitForSelector('#detail-dialog[open]');
check('exact detail over chat',await p.evaluate(()=>current==='chat'&&document.querySelector('#dialog-title').textContent==='公开灵感详情'));
await p.click('#close-dialog');
check('close retains chat and draft',await p.evaluate(()=>current==='chat'&&!document.querySelector('#detail-dialog').open&&document.querySelector('textarea[placeholder="输入消息…"]').value==='公开未发送草稿'));
await p.click('.idea-chat-source a');await p.waitForSelector('#detail-dialog[open]');await p.press('#close-dialog','Escape');
check('escape retains chat',await p.evaluate(()=>current==='chat'&&!document.querySelector('#detail-dialog').open));
await p.evaluate(()=>window.returnFailure=true);await p.click('.idea-chat-source a');await p.waitForFunction(()=>document.body.textContent.includes('公开读取失败'));
check('failure keeps chat',await p.evaluate(()=>current==='chat'&&!document.querySelector('#detail-dialog').open));
await p.evaluate(()=>{window.returnFailure=false;window.returnDelay=true});await p.click('.idea-chat-source a');await p.click('button[aria-label="灵感"]');await p.evaluate(()=>window.releaseIdea());
check('late response does not open after navigation',await p.evaluate(()=>current==='ideas'&&!document.querySelector('#detail-dialog').open));
await fs.writeFile('/Users/steve/Projects/opstwin-advance/output/ideas-return-20261024/browser.json',JSON.stringify({checks},null,2));console.log(checks);console.log(await p.snapshot());
