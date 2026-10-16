// Start scripts/mygo-chat-simple-fixture.mjs. CHAT_SPACE=7 ego-browser nodejs < this file.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-chat-simple-20261016';await fs.mkdir(out,{recursive:true});
const task=await taskSpace(Number(process.env.CHAT_SPACE||7)),p=task.page('p1'),checks=[];
const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
try{
 await p.goto('http://127.0.0.1:46379/desktop.html');await p.evaluate(()=>localStorage.clear());await p.reload();await p.waitForFunction(()=>!!window.OpsTwinsDesignChat&&document.querySelector('#input')&&!document.body.textContent.includes('正在连接工作区…'));
 await p.fill('#input','你好，简单聊天');await p.click('#send');await p.waitForSelector('.chat-thinking-dots');
 check('three dots only, no normal recovery controls',await p.evaluate(()=>{const c=document.querySelector('[data-chat-request]');return c.querySelectorAll('.chat-thinking-dots i').length===3&&!c.querySelector('.chat-recover,.chat-retry,.chat-run-status')&&!c.querySelector('.message.user details')}));
 await p.screenshot({path:out+'/browser-thinking.png'});
 await p.waitForFunction(()=>document.querySelector('[data-status="running"] .chat-thinking-dots'));
 check('early receipt 404 does not flash recovery',await p.evaluate(()=>!document.querySelector('[data-chat-request] .chat-recover')));
 await p.waitForFunction(()=>document.querySelector('[data-status="succeeded"] .chat-agent-result')?.textContent.includes('已收到：你好，简单聊天'));
 check('fresh reply has no trailing blank line',await p.evaluate(()=>{const e=document.querySelector('[data-status="succeeded"] .chat-agent-result'),p=e.querySelector('p');return e.getBoundingClientRect().height-p.getBoundingClientRect().height<25}));
 check('automatic response removes dots',await p.evaluate(()=>!document.querySelector('.chat-thinking-dots')));await p.screenshot({path:out+'/browser-result.png'});
 await p.fill('#input','刷新恢复验证');await p.click('#send');await p.waitForFunction(()=>document.querySelectorAll('[data-status="running"]').length===1);await p.reload();
 await p.waitForFunction(()=>document.querySelector('[data-status="succeeded"] .chat-agent-result')?.textContent.includes('刷新恢复验证'));
 check('reload recovered without re-post',await p.evaluate(async()=>{const e=await (await fetch('/evidence')).json();return e.posts===2}));
 await p.fill('#input','失败验证');await p.click('#send');await p.waitForSelector('[data-status="failed"] .chat-retry');check('real failure retains recovery',await p.evaluate(()=>document.querySelector('[data-status="failed"]').textContent.includes('执行失败')));
 await p.fill('#input','部分完成验证');await p.click('#send');await p.waitForSelector('[data-status="partial"]');check('partial visible and cannot retry',await p.evaluate(()=>{const e=document.querySelector('[data-status="partial"]');return e.textContent.includes('部分操作')&&!e.querySelector('.chat-retry')}));
 await p.screenshot({path:out+'/browser-failure-partial.png'});
 await fs.writeFile(out+'/browser-http.json',JSON.stringify(await p.evaluate(async()=>await(await fetch('/evidence')).json()),null,2));
}catch(e){checks.push({name:e.message,pass:false});await p.screenshot({path:out+'/browser-failure.png'})}finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'controlled public HTTP and real desktop rendering, not native or real model',checks},null,2));console.log(checks)}
