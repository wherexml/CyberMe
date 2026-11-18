// ego-browser nodejs < scripts/chat-queue-browser-e2e.mjs; start chat-queue-fixture first.
const task=await taskSpace('CyberMe 连续消息排队修复'),page=task.page('p1');
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/chat-queue-20261111',url='http://127.0.0.1:46831';await fs.mkdir(out,{recursive:true});
const checks=[],check=(name,ok)=>{checks.push({name,pass:!!ok});if(!ok)throw Error(name)};
const api=async(method,path,body)=>(await page.fetch(path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})).body;
const json=x=>typeof x==='string'?JSON.parse(x):x;
const state=async()=>json(await api('GET','/fixture/state'));
const records=()=>page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));return s.requests.filter(r=>r.conversationId===s.conversationId)});
const waitStatus=status=>page.waitForFunction(status=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui')),r=s.requests.filter(r=>r.conversationId===s.conversationId&&r.message.startsWith('QUEUE-UI'));return r.length===3&&r.every(r=>r.status===status)},status,{timeout:30000});
try{
 const c=json(await api('POST','/api/conversations',{title:'公开连发验收'}));
 await page.evaluate(id=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...s,conversationId:id}))},c.id);
 await page.reload();await page.waitForSelector('textarea');
 const before=(await state()).posts;
 await page.fill('textarea','QUEUE-UI-HOLD 第一条：请先完成这件事。');await page.click('button[aria-label="Send"]');
 await page.waitForFunction(async()=>(await(await fetch('/fixture/state')).json()).held.includes('QUEUE-UI-HOLD'));
 await page.fill('textarea','QUEUE-UI-B 第二条：完成后再分析下一步。');await page.press('textarea','Enter');
 await page.fill('textarea','QUEUE-UI-C 第三条：最后整理结论。');await page.click('button[aria-label="Send"]');
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));return s.requests.filter(r=>r.conversationId===s.conversationId&&r.message.startsWith('QUEUE-UI')).length===3});
 await page.waitForFunction(async()=>{const s=await(await fetch('/fixture/state')).json();return s.requests.filter(r=>r.state==='queued').length===2});
 const r=(await records()).filter(r=>r.message.startsWith('QUEUE-UI'));check('all three messages retained',r.length===3);check('new messages opt into queue',r.every(r=>r.queueCurrent===true));check('one running, later queued',(await state()).held.includes('QUEUE-UI-HOLD')&&(await state()).requests.filter(r=>r.state==='queued').length===2);
 check('composer clears and remains usable',await page.evaluate(()=>document.querySelector('textarea').value===''));
 await page.screenshot({path:out+'/queued.png'});
 await page.reload();await page.waitForSelector('textarea');check('refresh does not repost',(await state()).posts===before+3);
 await api('POST','/fixture/fail-reads',{count:3});
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));return s.requests.some(r=>r.conversationId===s.conversationId&&r.message.startsWith('QUEUE-UI')&&r.status==='unknown')},undefined,{timeout:10000});check('temporary read failure is truthful',true);
 await api('POST','/fixture/release',{tag:'QUEUE-UI-HOLD'});await waitStatus('succeeded');
 check('temporary read errors recover automatically',true);check('read recovery never reposts',(await state()).posts===before+3);
 const s=await state(),calls=s.seen.filter(x=>x.tag.startsWith('QUEUE-UI'));check('each queued turn calls model once',calls.map(x=>x.tag).join(',')==='QUEUE-UI-HOLD,QUEUE-UI-B,QUEUE-UI-C');check('follow-up sees previous answer',calls[1].all.includes('QUEUE-UI-HOLD 已完成。'));
 await page.waitForFunction(()=>document.body.innerText.includes('QUEUE-UI-C 已完成。'),undefined,{timeout:15000});
 check('all answers visible and no stopped/error card',await page.evaluate(()=>!document.body.innerText.includes('已停止。')&&!document.body.innerText.includes('结果暂未确认')));
 await page.fill('textarea','还可以继续输入。');await page.screenshot({path:out+'/completed.png'});
 console.log({checks:checks.length,pass:true,url,out});
}finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify({url,scope:'Built V6 + production HTTP/SDK; synthetic data and controlled provider; Chromium, not installed WebKit',checks},null,2))}
