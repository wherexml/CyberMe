const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-chat-position-20261019';const t=await taskSpace(4),p=t.page('p1'),checks=[];
function check(name,pass,detail){checks.push({name,pass,detail});if(!pass)throw Error(name)}
try{
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#desktop-boot')&&document.querySelector('#messages').textContent.includes('公开滚动消息二'));
 await p.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 check('reload opens latest persisted messages',true);
 await p.evaluate(()=>document.querySelector('#timeline').scrollTop=100);
 await p.fill('#input','公开定位验收消息三');await p.click('#send');
 await p.waitForFunction(()=>window.OpsTwinsDesignChat.entries().at(-1)?.status==='succeeded');
 await p.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 const metrics=await p.evaluate(()=>{const t=document.querySelector('#timeline'),r=t.getBoundingClientRect(),m=[...document.querySelectorAll('#messages .message.user')].find(x=>x.textContent.includes('公开定位验收消息三')).getBoundingClientRect();return {top:t.scrollTop,gap:t.scrollHeight-t.scrollTop-t.clientHeight,messageTop:m.top-r.top,messageBottom:m.bottom-r.top,viewportHeight:r.height}});
 check('newly sent message is visible after response',metrics.messageTop>=0&&metrics.messageBottom<=metrics.viewportHeight,metrics);
 const posts=JSON.parse((await p.fetch('/evidence')).body).posts;await p.evaluate(()=>window.OpsTwinsDesktop.loadChat());
 await p.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});check('canonical refresh does not jump up',true);
 check('history refresh never reposts',JSON.parse((await p.fetch('/evidence')).body).posts===posts);
 await fs.writeFile(out+'/latest-visible-dom.json',JSON.stringify(await p.evaluate(()=>({lastMessages:[...document.querySelectorAll('#messages .message')].slice(-4).map(x=>({role:x.classList.contains('user')?'user':'assistant',text:x.textContent})),timelineHeight:document.querySelector('#timeline').scrollHeight})),null,2));
}catch(e){checks.push({name:String(e),pass:false})}
await fs.writeFile(out+'/round2.json',JSON.stringify({scope:'public desktop HTML and production HTTP with controlled model; screenshot timeout retained separately',checks},null,2));console.log(checks);
