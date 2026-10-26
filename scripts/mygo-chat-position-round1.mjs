// Start mygo-chat-scroll-e2e-service.mjs, then use one approved Ego TaskSpace.
// CHAT_SPACE=<id> ego-browser nodejs < scripts/mygo-chat-scroll-browser-e2e.mjs
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-chat-position-20261019/baseline';

const task=await taskSpace(4),page=task.page('p1'),checks=[];
await fs.mkdir(out,{recursive:true});
const geometry=()=>page.evaluate(()=>{const t=document.querySelector('#timeline');return{top:t.scrollTop,height:t.scrollHeight,client:t.clientHeight,gap:t.scrollHeight-t.scrollTop-t.clientHeight}});
const check=(name,pass,detail)=>{checks.push({name,pass,detail});if(!pass)throw Error(name)};
try{
 await page.goto('http://127.0.0.1:46476');
 await page.waitForFunction(()=>!!window.OpsTwinsDesktop?.loadChat&&!document.querySelector('#desktop-boot')&&document.querySelectorAll('#messages > [data-message-id]').length>=100);
 await page.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 check('long history initially opens at latest',true,await geometry());
 await page.evaluate(()=>document.querySelector('#timeline').scrollTop=300);
 await page.fill('#input','公开滚动消息一');await page.click('#send');
 await page.waitForFunction(()=>window.OpsTwinsDesignChat.entries().at(-1)?.status==='succeeded');
 await page.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 check('send from history follows latest reply',true,await geometry());
 await page.evaluate(()=>window.OpsTwinsDesktop.loadChat());
 await page.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 check('canonical history refresh stays at bottom',true,await geometry());
 // Exercise real wheel input, so explicit reading cancels pending follow.
 await page.mouse.move(800,400);await page.mouse.wheel(0,-700,{label:'read earlier chat messages'});
 const read=await geometry();check('manual history scroll leaves bottom',read.gap>100,read);
 await page.evaluate(()=>window.OpsTwinsDesktop.loadChat());
 const after=await geometry();check('refresh preserves manual reading position',Math.abs(after.top-read.top)<3,{read,after});
 await page.fill('#input','公开滚动消息二');await page.click('#send');
 await page.waitForFunction(()=>window.OpsTwinsDesignChat.entries().at(-1)?.status==='succeeded');
 await page.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 check('sending again resumes bottom following',true,await geometry());
 await page.screenshot({path:out+'/latest-after-send.png'});
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#desktop-boot')&&document.querySelector('#messages').textContent.includes('公开滚动消息二'));
 await page.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 check('reload returns to latest persisted history',true,await geometry());
 await page.screenshot({path:out+'/latest-after-reload.png'});
}catch(error){checks.push({name:String(error),pass:false});}
await fs.writeFile(out+'/browser.json',JSON.stringify({scope:'production HTTP and desktop HTML, public isolated history and controlled model; native WKWebView NOT_RUN',checks},null,2));
console.log(checks);
