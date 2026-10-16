// CHAT_SPACE=50 ego-browser nodejs < scripts/mygo-chat-order-browser-e2e.mjs
// After stopping/restarting the fixture, run with CHAT_PHASE=restart against the same space.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-chat-order-20261017-v3';await fs.mkdir(out,{recursive:true});
const task=await taskSpace(Number(process.env.CHAT_SPACE||50)),p=task.page('p1'),phase=process.env.CHAT_PHASE||'initial',checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass,detail});if(!pass)throw Error(name)};
const expected=['失败旧消息','执行失败，请查看记录','第二条新消息','已收到：第二条新消息','部分旧消息','已有部分操作完成，请查看原记录，不能重新执行','第四条新消息','已收到：第四条新消息'];
let expectedPosts=4;
const texts=()=>p.evaluate(()=>[...document.querySelectorAll('#messages .message .bubble')].map(e=>(e.querySelector('.chat-run-status')||e).textContent.trim()));
async function verify(label){const got=await texts();check(label,JSON.stringify(got)===JSON.stringify(expected),got);check(label+' no replay',(await p.evaluate(async()=>await(await fetch('/evidence')).json())).posts===expectedPosts);await fs.writeFile(out+'/'+label+'-dom.json',JSON.stringify(await p.evaluate(()=>({html:document.querySelector('#messages').outerHTML,records:window.OpsTwinsDesignChat.entries()})),null,2))}
try{
 await p.goto('http://127.0.0.1:46404/desktop.html');await p.waitForFunction(()=>!!window.OpsTwinsDesignChat&&!!document.querySelector('#input'));
 const baseline=await p.evaluate(async()=>await(await fetch('/evidence')).json());
 if(Object.values(baseline.requests).some(r=>r.userMessage.content==='原生重启后的新消息')){expected.push('原生重启后的新消息','已收到：原生重启后的新消息');expectedPosts=5}
 if(phase==='initial'){
 if(!(await p.evaluate(async()=>await(await fetch('/evidence')).json())).posts)for(const [message,status] of [['失败旧消息','failed'],['第二条新消息','succeeded'],['部分旧消息','partial'],['第四条新消息','succeeded']]){await p.fill('#input',message);await p.click('#send');await p.waitForFunction(({message,status})=>window.OpsTwinsDesignChat.entries().some(r=>r.message===message&&r.status===status),{message,status});await p.evaluate(()=>window.OpsTwinsDesktop.loadChat());}
 await verify('after-history-refresh');await p.reload();await p.waitForFunction(count=>document.querySelectorAll('#messages .message .bubble').length===count,expected.length);await verify('after-reload');
 }else{await p.waitForFunction(count=>document.querySelectorAll('#messages .message .bubble').length===count,expected.length);await verify('after-service-restart');await p.goto('about:blank');await p.goto('http://127.0.0.1:46404/desktop.html');await p.waitForFunction(count=>document.querySelectorAll('#messages .message .bubble').length===count,expected.length);await verify('after-client-reopen');}
}catch(e){checks.push({name:e.message,pass:false});await fs.writeFile(out+'/'+phase+'-failure-dom.json',JSON.stringify(await texts(),null,2))}finally{await fs.writeFile(out+'/'+phase+'.json',JSON.stringify({scope:'public controlled HTTP, real desktop browser; native process NOT_RUN',checks},null,2));console.log(checks)}
