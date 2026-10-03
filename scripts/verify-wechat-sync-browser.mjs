// Repeat: ego-browser nodejs < scripts/verify-wechat-sync-browser.mjs
// Only counts and statuses are saved. Never store message text or raw CLI output.
const task=await taskSpace('OpsTwin wechat-sync connection');const page=task.page('p1');
const fs=await import('node:fs/promises');const out='/Users/steve/Projects/opstwin-advance/output/wechat-sync-20261003';
const cases=[];const check=(name,ok,detail={})=>{cases.push({name,status:ok?'PASS':'FAIL',...detail});if(!ok)throw Error(name);};
await page.goto('http://127.0.0.1:46100/settings/connections');
await page.waitForSelector('[data-provider="wechat"]');
check('Unsupported cards removed',await page.evaluate(()=>!document.querySelector('[data-provider="slack"],[data-provider="teams"]')));
check('Personal WeChat branding',await page.evaluate(()=>document.querySelector('[data-provider="wechat"]').textContent.includes('wechat-sync')&&!document.body.textContent.includes('企业微信')));
await page.goto('http://127.0.0.1:46100/settings/connections/wechat-sync-local');
console.log(await page.snapshot());
const connected=await page.evaluate(()=>document.body.textContent.includes('已连接 · 只读'));
if(!connected){await page.click('loc=role:button[name="连接本机微信"]');await page.waitForSelector('loc=role:button[name="查看会话"]');}
await page.screenshot({path:out+'/wechat-connected.png'});
await page.click('loc=role:button[name="查看会话"]');
await page.waitForSelector('.wechat-chat-row');
const count=await page.evaluate(()=>document.querySelectorAll('.wechat-chat-row').length);check('Real bounded conversations load',count>0&&count<=20,{count});
await page.click('.wechat-chat-row >> nth=0');await page.waitForSelector('.wechat-message');
const messages=await page.evaluate(()=>({count:document.querySelectorAll('.wechat-message').length,nonempty:[...document.querySelectorAll('.wechat-message p')].every(p=>p.textContent.length>0)}));check('Selected conversation reads real messages',messages.count>0&&messages.count<=50&&messages.nonempty,{count:messages.count});
const older=await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='加载更早消息'));
if(older){await page.click('loc=role:button[name="加载更早消息"]');await page.waitForFunction(n=>document.querySelectorAll('.wechat-message').length>n,messages.count);check('Older-message pagination',true);}
await page.goto('http://127.0.0.1:46100/settings/connections/wechat-sync-local');
await page.waitForSelector('loc=role:button[name="查看会话"]');check('Saved connection survives refresh without importing history',await page.evaluate(()=>!document.querySelector('.wechat-message')&&!document.querySelector('.wechat-chat-row')));
await page.click('loc=role:button[name="断开连接"]');await page.waitForSelector('loc=role:button[name="连接本机微信"]');
const blocked=await page.fetch('/api/wechat/chats');check('Disconnected connection rejects reading',blocked.status===409);
await page.click('loc=role:button[name="连接本机微信"]');await page.waitForSelector('loc=role:button[name="查看会话"]');check('Reconnect succeeds',true);
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});check('Mobile layout fits',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/wechat-mobile.png'});await page.cdp('Emulation.clearDeviceMetricsOverride');
await page.goto('http://127.0.0.1:46100/settings/channels');
check('Unsupported/bot channels removed',await page.evaluate(()=>!document.querySelector('[data-channel="slack"],[data-channel="teams"],[data-channel="wechat"],[data-channel="whatsapp"],[data-channel="telegram"]')));
await page.goto('http://127.0.0.1:46100/settings/connections');await page.waitForSelector('[data-provider="wechat"]');await page.screenshot({path:out+'/connections.png'});
await fs.writeFile(out+'/browser-checks.json',JSON.stringify({cases,privateContentSaved:false},null,2));console.log(cases);
