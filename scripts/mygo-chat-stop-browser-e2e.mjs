// Run service with node --import tsx scripts/mygo-chat-stop-e2e-service.mjs.
// Then CHAT_SPACE=<one space id> ego-browser nodejs < this file.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-chat-stop-20261019';
const t=await taskSpace(Number(process.env.CHAT_SPACE||2)),p=t.page('p1'),checks=[];
function check(name,pass,detail){checks.push({name,pass,detail});if(!pass)throw Error(name)}
try{
 await p.goto('http://127.0.0.1:46466/desktop.html');
 await p.waitForFunction(()=>!!window.OpsTwinsDesignChat&&!!window.OpsTwinsDesktop?.loadChat&&!document.querySelector('#desktop-boot'));
 for(const [id,status] of [['legacy-stop','cancelled'],['legacy-failure','failed'],['legacy-partial','partial']]){const r=await p.fetch('/api/chat/requests/'+id);check(id,JSON.parse(r.body).status===status)}
 const baseline=JSON.parse((await p.fetch('/evidence')).body);
 await p.fill('#input','第一条公开消息');await p.click('#send');await p.waitForFunction(async()=>(await(await fetch('/evidence')).json()).held>0);
 await p.fill('#input','第二条公开消息');await p.click('#send');await p.waitForFunction(()=>{const r=window.OpsTwinsDesignChat.entries();return r.length===2&&r[0].status==='cancelled'&&r[1].status==='succeeded'});
 const rows=await p.evaluate(()=>window.OpsTwinsDesignChat.entries().map(r=>({id:r.requestId,status:r.status,error:r.error,runId:r.runId})));
 check('new message stops old reply without failure',rows[0].status==='cancelled'&&rows[0].error==='已停止',rows);
 check('no retry on stopped card',await p.evaluate(()=>!document.querySelector('[data-status="cancelled"] .chat-retry')));
 for(const r of rows){const run=JSON.parse((await p.fetch('/api/runs/'+r.runId)).body);r.completedAt=run.completedAt;r.startedAt=run.events.find(e=>e.type==='agent_started')?.at;r.runStatus=run.status}
 check('new model starts after stopped run terminal',rows[0].runStatus==='cancelled'&&Date.parse(rows[1].startedAt)>=Date.parse(rows[0].completedAt));
 const prior=JSON.parse((await p.fetch('/evidence')).body);await p.reload();await p.waitForFunction(()=>window.OpsTwinsDesignChat?.entries().length===2&&!!document.querySelector('[data-status="cancelled"]'));
 check('reload does not replay',JSON.parse((await p.fetch('/evidence')).body).posts===prior.posts);
 const replay=await p.fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:rows[0].id,message:'第一条公开消息',conversationId:'stop-e2e',mode:'chat',contextIds:[],attachmentIds:[],preservePrimary:true,interruptCurrent:true})});check('cancelled request cannot be replayed',replay.status===409&&JSON.parse(replay.body).error==='chat_interrupted');
 await p.fill('#input','真实失败');await p.click('#send');await p.waitForFunction(()=>window.OpsTwinsDesignChat.entries().at(-1)?.status==='failed');check('real provider error retains failure and retry',await p.evaluate(()=>!!document.querySelector('[data-status="failed"] .chat-retry')));
 await p.screenshot({path:out+'/chat-stopped-and-failed.png'});
}catch(e){checks.push({name:String(e),pass:false})}
await fs.writeFile(out+'/browser.json',JSON.stringify({scope:'production HTTP + real desktop UI, controlled local model; installed app NOT_RUN',checks},null,2));console.log(checks);if(checks.every(c=>c.pass))await t.finish({keep:[]});
