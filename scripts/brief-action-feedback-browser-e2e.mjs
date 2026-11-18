// Build and start brief-action-feedback-fixture.mjs. Define absolute `out` before running with ego-browser nodejs.
const task=await taskSpace('CyberMe 洞察卡点击反馈 20261110'),page=task.page('p1');
const fs=await import('node:fs/promises');
const url='http://127.0.0.1:46877/cyberme.html';
const checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const evidence=async()=>JSON.parse((await page.fetch('/__fixture/evidence')).body);
const action=(id,type='draft_reply')=>'[data-item="'+id+'"] [data-action="'+type+'"]';
const draftRow=action('reply');
const hasLabel=(selector,label)=>page.waitForFunction(({selector,label})=>document.querySelector(selector)?.textContent.includes(label),{selector,label});
const click=(selector,label)=>page.click(selector,{label});
const screenshot=async name=>{await page.screenshot({path:out+'/'+name+'.png'})};
await fs.mkdir(out,{recursive:true});
console.log({spaceId:task.spaceId});
try{
 await page.goto(url);
 await page.waitForSelector(draftRow);
 await page.fill('textarea','保留这段聊天输入。');
 await click(draftRow,'点击起草公开回复');
 await hasLabel(draftRow,'正在起草…');
 check('即时显示起草状态，锁定同卡重复操作',await page.evaluate(selector=>{
  const button=document.querySelector(selector);
  return button.disabled&&button.getAttribute('aria-busy')==='true'&&button.parentElement.querySelector('[data-action="create_task"]').disabled;
 },draftRow));
 await screenshot('drafting');
 await page.fetch('/__fixture/hold-bootstrap',{method:'POST'});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(async()=>(await (await fetch('/__fixture/evidence')).json()).bootstrapHeld);
 await click(action('cooling','create_task'),'把另一件事转成任务');
 await page.waitForFunction(async()=>(await (await fetch('/__fixture/evidence')).json()).tasks.some(t=>t.inboxId==='cooling'));
 await page.fetch('/__fixture/release-bootstrap',{method:'POST'});
 await page.waitForFunction(()=>!!document.querySelector('[data-item="cooling"] [data-linked-task]'));
 check('另一张卡可执行，旧快照结束后立即显示真实任务', (await evidence()).tasks.filter(t=>t.inboxId==='cooling').length===1);
 await click(action('cooling','create_task'),'再点原任务动作');
 await page.waitForFunction(()=>!document.querySelector('[data-item="cooling"] [data-action="create_task"]')?.disabled);
 check('重复任务动作复用已有任务', (await evidence()).tasks.filter(t=>t.inboxId==='cooling').length===1);
 await page.fetch('/__fixture/release',{method:'POST'});
 await hasLabel(draftRow,'查看草稿');
 check('起草只提交一次，保留聊天输入', (await evidence()).actionPosts.filter(x=>x.entityId==='reply').length===1&&await page.evaluate(()=>document.querySelector('textarea').value==='保留这段聊天输入。'));
 await screenshot('draft-ready');
 await click(draftRow,'打开刚生成的草稿');
 await page.waitForFunction(()=>document.body.innerText.includes('我会先核对公开演示的时间，再回复你。'));
 await screenshot('draft-detail');
 const item=JSON.parse((await page.fetch('/api/inbox/reply')).body);
 check('打开正确正文，草稿已持久保存且待确认',item.draft==='我会先核对公开演示的时间，再回复你。'&&!item.approved&&item.status==='pending');

 await page.reload();
 await hasLabel(draftRow,'查看草稿');
 check('刷新保留查看入口',true);
 await hasLabel(action('existing'),'查看草稿');
 await click(action('existing'),'打开已存在的草稿');
 await page.waitForFunction(()=>document.body.innerText.includes('已有草稿的正文。'));
 check('查看已有草稿无需再次起草',(await evidence()).modelCalls===1);
 await click('[aria-label="Back"]','回到洞察卡列表');

 await click(action('cooling'),'点击仍在冷却的事项');
 await hasLabel('[data-item="cooling"] [role="alert"]','消息冷却中');
 check('409 显示真实拒绝原因',await page.evaluate(()=>!document.querySelector('[data-item="cooling"] [role="alert"]').textContent.includes('事项已变化')));
 await screenshot('draft-refused');

 await click(action('lost'),'起草并模拟响应中断');
 await hasLabel(action('lost'),'查看草稿');
 const end=await evidence();
 check('响应中断后用原 ID 回读且不重发',end.lostReadbacks===1&&end.actionPosts.filter(x=>x.entityId==='lost').length===1&&end.modelCalls===2);
 await click(action('legacy'),'选择旧版未绑定事项');
 await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('起草回复，等我确认'));
 check('旧选项仍进入输入框且无外发',end.externalAttempts===0&&end.sends===0&&!(await evidence()).actionPosts.some(x=>x.entityId==='legacy'));
 await fs.writeFile(out+'/http-evidence.json',JSON.stringify(end,null,2));
}finally{
 await fs.writeFile(out+'/browser.json',JSON.stringify({url,scope:'built V6, production HTTP and SQLite, synthetic Feishu and controlled oMLX',checks},null,2));
 console.log(JSON.stringify({url,passed:checks.filter(c=>c.pass).length,total:checks.length}));
}
await task.finish({keep:[]});
