const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-chat-position-20261019',t=await taskSpace(4),p=t.page('p1'),checks=[];
function check(name,pass,detail){checks.push({name,pass,detail});if(!pass)throw Error(name)}
const geometry=()=>p.evaluate(()=>{const t=document.querySelector('#timeline'),r=t.getBoundingClientRect(),m=[...document.querySelectorAll('#messages .message.user')].at(-1).getBoundingClientRect();return {gap:t.scrollHeight-t.scrollTop-t.clientHeight,top:t.scrollTop,messageTop:m.top-r.top,messageBottom:m.bottom-r.top,height:r.height}});
try{
 await p.evaluate(()=>document.querySelector('#timeline').scrollTop=120);await p.fill('#input','第一条公开消息');await p.click('#send');
 await p.waitForFunction(async()=>(await(await fetch('/evidence')).json()).held>0);
 const pending=await geometry();check('pending sent message stays visible',pending.messageTop>=0&&pending.messageBottom<=pending.height&&pending.gap<3,pending);
 await p.fill('#input','公开定位打断后的消息');await p.click('#send');await p.waitForFunction(()=>window.OpsTwinsDesignChat.entries().at(-1)?.status==='succeeded');await p.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});
 const completed=await geometry();check('interrupt callbacks keep newest message visible',completed.messageTop>=0&&completed.messageBottom<=completed.height,completed);
 const records=await p.evaluate(()=>window.OpsTwinsDesignChat.entries().slice(-2).map(r=>r.status));check('interrupted state remains stopped',records[0]==='cancelled'&&records[1]==='succeeded',records);
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#desktop-boot')&&document.querySelector('#messages').textContent.includes('公开定位打断后的消息'));await p.waitForFunction(()=>{const t=document.querySelector('#timeline');return t.scrollHeight-t.scrollTop-t.clientHeight<3});check('reload after interruption stays latest',true,await geometry());
}catch(e){checks.push({name:String(e),pass:false})}
await fs.writeFile(out+'/round3.json',JSON.stringify({scope:'public long history and real production interruption API, controlled model',checks},null,2));console.log(checks);
