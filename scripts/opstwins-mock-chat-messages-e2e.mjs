// Run with ego-browser nodejs; reuse the goal's TaskSpace via OPSTWIN_MOCK_SPACE.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-chat-messages-20261017/'+Date.now();
await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins chat messages only'),page=task.page('p1');
const results=[],key='opstwins-product-mock-v1';let original,backedUp=false;
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
const click=a=>page.click(`button[data-action="${a}"]`);
const state=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
const clean=()=>page.evaluate(()=>!document.querySelector('.inbox-automation,.attention-result,.attention-source,.attention-draft,.attention-trace,.attention-actions')&&[...document.querySelector('.reading').children].every(x=>x.matches('.message')));
async function shot(name){await page.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await page.snapshot());}
try{
 await page.goto('http://127.0.0.1:46400/?v=8#chat');await page.waitForSelector('[name=message]');
 original=await page.evaluate(key=>localStorage.getItem(key),key);backedUp=true;
 await page.evaluate(async key=>{const {initial}=await import('./data.js');const s=structuredClone(initial);s.inboxRuns=['completed','running','unknown'].map((status,i)=>({id:'public-old-'+i,itemId:'i'+(i+1),status,sessionId:'main',phase:2,trace:['公开旧分析'],messageIndex:1}));localStorage.setItem(key,JSON.stringify({version:1,data:s}))},key);
 await page.goto('http://127.0.0.1:46400/?v=8&fixture='+Date.now()+'#chat');await page.waitForSelector('[name=message]');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1010,height:961,deviceScaleFactor:1,mobile:false});
 const mainCount=(await state()).sessions.find(x=>x.id==='main').messages.length,reviewCount=(await state()).sessions.find(x=>x.id==='review').messages.length;
 check('含旧分析记录的主会话只显示消息',await clean());
 check('现有用户助手消息及Markdown保留',await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='main').messages.length&&!!document.querySelector('.message.assistant strong')));
 check('没有加载旧卡片调度模块',await page.evaluate(()=>!performance.getEntriesByType('resource').some(x=>x.name.includes('/inbox-automation.js'))));
 const oldRuns=JSON.stringify((await state()).inboxRuns),inboxBefore=(await state()).inbox;
 await page.fill('[name=message]','公开对话草稿保留');await page.reload();await page.waitForSelector('[name=message]');
 check('刷新后草稿与纯消息布局保留',await clean()&&await page.evaluate(()=>document.querySelector('[name=message]').value==='公开对话草稿保留'));
 await page.press('[name=message]','Enter');
 check('发送仅追加两条普通消息',(await state()).sessions.find(x=>x.id==='main').messages.length===mainCount+2&&await clean()&&await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='main').messages.length&&document.querySelector('.reading').lastElementChild.matches('.message.assistant')));
 check('消息复制和执行记录入口保留',await page.evaluate(()=>document.querySelectorAll('.message [aria-label="复制消息"]').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='main').messages.length&&document.querySelectorAll('.message [aria-label="查看执行记录"]').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='main').messages.filter(x=>x.role==='assistant').length));
 await click('sidebar');await click('session:review');await page.fill('[name=message]','公开侧会话草稿');
 check('侧会话只显示自身消息',await clean()&&await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='review').messages.length));
 await click('session:main');check('返回主会话不混入侧会话',await clean()&&await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='main').messages.length&&document.querySelector('[name=message]').value===''));
 await click('session:review');check('侧会话草稿独立保留',await page.evaluate(()=>document.querySelector('[name=message]').value==='公开侧会话草稿'));await click('session:main');
 await click('nav:inbox');await page.waitForSelector('#reply-draft');
 check('独立收件箱与草稿保持原值',await page.evaluate(value=>document.querySelector('#reply-draft').value===value,inboxBefore[0].draft));
 check('旧主会话卡片跳转入口移除',await page.evaluate(()=>!document.querySelector('[data-action^="attention-"]')));
 await page.fill('#reply-draft','公开独立Inbox草稿');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='已保存');
 await click('nav:chat');check('Inbox草稿不会变成对话卡片',await clean());
 check('旧分析记录不删除也不继续调度',JSON.stringify((await state()).inboxRuns)===oldRuns);
 await click('scenario:unknown');check('必要未知恢复保留且无事项UI',await page.evaluate(()=>!!document.querySelector('.recovery')&&!document.querySelector('.inbox-automation,.attention-result')));await click('scenario:normal');
 await page.reload();await page.waitForSelector('[name=message]');check('再次刷新仍只有原对话消息',await clean()&&await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===window.OpsTwinsMock.getState().sessions.find(x=>x.id==='main').messages.length));
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await shot('chat-1010');
 const hashes={};for(const file of ['app.js','pages.js'])hashes[file]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+file)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({scope:'public Mock chat messages only',spaceId:task.spaceId,results,hashes},null,2));console.log({passed:results.length,out,spaceId:task.spaceId});
}catch(error){await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(error)},null,2));await shot('failure');throw error}
finally{
 if(backedUp){await page.evaluate(({key,original})=>original===null?localStorage.removeItem(key):localStorage.setItem(key,original),{key,original});await page.goto('http://127.0.0.1:46400/?v=8&restored='+Date.now()+'#chat');await page.waitForSelector('[name=message]');const after=await page.evaluate(key=>localStorage.getItem(key),key);await fs.writeFile(out+'/restoration.json',JSON.stringify({exactMatch:after===original},null,2));if(after!==original)throw Error('Mock restoration mismatch');await shot('final-chat')}
}
