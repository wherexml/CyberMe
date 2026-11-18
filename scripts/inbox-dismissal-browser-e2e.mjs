// Use a fresh reply-card-judgment-fixture with an isolated port and inject spaceId, outputDir and origin.
const fs=await import('node:fs/promises');
const page=(await taskSpace(spaceId)).page('p1');
const url=origin+'/cyberme.html',checks=[];
const card=id=>'[data-item="'+id+'"]';
const dismiss=id=>page.click('css='+card(id)+' button:text-is("忽略")',{label:'忽略隔离请求卡片'});
const read=async path=>JSON.parse((await page.fetch(path)).body);
const change=(id,change)=>page.fetch('/__fixture/change-dismissal/'+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({change})});
const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
const ack=title=>page.waitForFunction(title=>document.querySelector('[data-dismiss-ack]')?.textContent.includes(title),title);
const screenshot=name=>page.screenshot({path:outputDir+'/'+name+'.png'});
await fs.mkdir(outputDir,{recursive:true});
try {
  await page.goto(url);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='洞察'));
  await page.click('xpath=//button[normalize-space(.)="洞察"]',{label:'打开验收洞察列表'});
  await page.waitForSelector(card('running'));
  await page.evaluate(async ()=>{
    const realFetch=window.fetch.bind(window);
    const old=await realFetch('/api/bootstrap?include=insightVisuals');
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    const state=window.dismissalRace={held:false,release,reads:0};
    window.fetch=async (url,options)=>{
      if(String(url).startsWith('/api/bootstrap?')){
        state.reads++;
        if(state.reads===1){state.held=true;await held;return old;}
      }
      if(String(url)==='/api/chat/work/conversations/main'&&state.held)await held;
      if(String(url)==='/api/inbox/saved/attention-dismissal'&&options?.method==='POST'){
        await realFetch(url,options);
        return new Response('{}',{status:502,headers:{'content-type':'application/json'}});
      }
      return realFetch(url,options);
    };
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(()=>window.dismissalRace?.held);
  const start=Date.now();
  await dismiss('running');
  const fast=await page.waitForFunction(sel=>!document.querySelector(sel)&&document.querySelector('[data-dismiss-ack]'),card('running'),{timeout:1500}).catch(()=>false);
  check('重算中的卡片在阻塞工作区和会话读取时仍立即移除',fast);
  const latencyMs=Date.now()-start;
  const saved=await read('/api/inbox/running');
  check('精确绑定旧请求，忽略已落库',saved.status==='dismissed'&&saved.attentionDismissal?.requestMessageId==='running-q');
  await screenshot('dismissed');
  await page.evaluate(sel=>{
    const state=window.dismissalRace;
    state.resurfaced=false;
    state.observer=new MutationObserver(()=>{if(document.querySelector(sel))state.resurfaced=true;});
    state.observer.observe(document.body,{childList:true,subtree:true});
    state.release();
  },card('running'));
  await page.waitForFunction(()=>window.dismissalRace?.reads>=2);
  check('先前请求的旧快照不能恢复卡片',await page.evaluate(()=>{const s=window.dismissalRace;s.observer.disconnect();return !s.resurfaced;}));
  await page.click('css=[data-dismiss-ack] button:text-is("撤销")',{label:'撤销已确认忽略'});
  await page.waitForSelector(card('running'));
  check('撤销恢复原来重新判断的请求',(await read('/api/inbox/running')).status==='pending');

  await change('waiting','metadata');
  await dismiss('waiting');
  await ack('资料交接');
  check('仅同步元数据变化仍能一次忽略',(await read('/api/inbox/waiting')).status==='dismissed');

  await change('backoff','edit');
  await dismiss('backoff');
  await page.waitForFunction(sel=>document.querySelector(sel)?.textContent.includes('事项已有更新'),card('backoff'));
  check('正文已编辑时保留事项',(await read('/api/inbox/backoff')).status==='pending');

  await dismiss('saved');
  await ack('设计联络组');
  const recovered=await read('/api/inbox/saved');
  check('响应丢失按原编号核对，草稿保留',recovered.status==='dismissed'&&recovered.draft==='我整理后发你资料。');
  await page.reload();
  await page.waitForSelector(card('running'));
  check('刷新后两个忽略状态仍有效',await page.evaluate(()=>!document.querySelector('[data-item="waiting"], [data-item="saved"]')));

  await page.waitForSelector(card('meeting'));
  await page.evaluate(()=>{
    const fetchNow=window.fetch.bind(window);
    window.fetch=async (url,options)=>{
      if(String(url)==='/api/inbox/meeting/attention-dismissal'&&options?.method==='POST')
        await fetchNow('/__fixture/change-dismissal/meeting',{method:'POST',body:JSON.stringify({change:'lock'})});
      return fetchNow(url,options);
    };
  });
  await dismiss('meeting');
  await page.waitForFunction(()=>document.querySelector('[data-item="meeting"]')?.textContent.includes('发送结果待核实'));
  check('并发进入发送结果未知时保留恢复卡片',(await read('/api/inbox/meeting')).status==='send_unknown');
  const evidence=await read('/__fixture/evidence');
  const dismissals=evidence.requests.filter(r=>r.path.endsWith('/attention-dismissal'));
  check('每次只提交一次忽略，零模型动作和外发',dismissals.length===5&&evidence.sends===0&&!evidence.requests.some(r=>r.type||r.force));
  await fs.writeFile(outputDir+'/timing.json',JSON.stringify({latencyMs,workspaceBlocked:true},null,2));
} finally {
  await fs.writeFile(outputDir+'/browser.json',JSON.stringify({url,checks},null,2));
  console.log({url,checks});
}
