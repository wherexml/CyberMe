// Start the fresh fixture, then feed this script to ego-browser nodejs with absolute outputDir and the TaskSpace id injected.
const fs = await import('node:fs/promises');
const task = await taskSpace(spaceId);
const page = task.page('p1');
const base = globalThis.REPLY_FIXTURE_ORIGIN || 'http://127.0.0.1:47941';
const url = base+'/cyberme.html';
const checks = [];
const expect = (name, ok) => {
  checks.push({name, ok:!!ok});
  if (!ok) throw Error(name);
};
const row = id => '[data-item="'+id+'"]';
const contents = id => page.evaluate(sel=>document.querySelector(sel)?.innerText || '',row(id));
const includes = (id,text) => page.waitForFunction(({sel,text})=>document.querySelector(sel)?.innerText.includes(text),
  {sel:row(id),text},{timeout:35000});
const take = async (id,name) => {
  await page.evaluate(sel=>document.querySelector(sel)?.scrollIntoView({block:'center'}),row(id));
  const clip = await page.evaluate(sel=>{
    const r=document.querySelector(sel).getBoundingClientRect();
    return {x:r.left+scrollX-4,y:r.top+scrollY-4,width:r.width+8,height:r.height+8,scale:1.5};
  },row(id));
  const png = await page.cdp('Page.captureScreenshot',{format:'png',clip});
  await fs.writeFile(outputDir+'/'+name+'.png',Buffer.from(png.data,'base64'));
};
const read = async path => JSON.parse((await page.fetch(path)).body);
await fs.mkdir(outputDir,{recursive:true});
try {
  await page.goto(url);
  const legacy = await read('/__fixture/legacy-refusal');
  await page.evaluate(receipt=>localStorage.setItem('cyberme-v6-ui',JSON.stringify({actions:{'inbox:meeting:draft_reply':receipt}})),legacy);
  await page.reload();
  await includes('meeting','判断失败');
  const failed = await contents('meeting');
  expect('保留原句并在失败时停止推荐', failed.includes('本周演示预计三点开始') && failed.includes('重新判断') &&
    !/来源有更新|正在重新判断|推荐|起草回复/.test(failed));
  expect('当前判断状态取代旧起草拒绝文案', !failed.includes(legacy.message));
  for (const [id,status] of [['waiting','等待判断'],['running','正在重新判断']]) {
    const card = await contents(id);
    expect(status+'时不允许新起草', card.includes(status) && !/待回复|推荐|起草回复/.test(card));
  }
  const missing = await contents('unbound');
  expect('未定位请求时不误报时间或挪用聊天摘录', missing.includes('未定位到具体请求') && missing.includes('查看详情') &&
    !/时间待核实|背景消息/.test(missing));
  expect('真实缺时间时保留原句与时间状态', (await contents('bad-time')).includes('消息时间待核实') &&
    (await contents('bad-time')).includes('请确认样稿的颜色'));
  expect('有重试计划时可区分，禁止新起草', /重试/.test(await contents('backoff')) && !/推荐|起草回复/.test(await contents('backoff')));
  expect('已有草稿在列表可读', (await contents('saved')).includes('我整理后发你资料。'));
  expect('已判断为决策的事项不会推荐起草', !(await contents('decision')).includes('起草回复'));
  await page.waitForSelector('[data-message-actions]');
  expect('历史提醒不允许对失败判断新起草', await page.evaluate(()=> {
    const actions = document.querySelector('[data-message-actions]');
    return !!actions && ![...actions.querySelectorAll('button')].some(b=>!b.disabled && b.textContent.includes('起草回复')) &&
      !actions.innerText.includes('当前事项不在有效回复待处理中');
  }));
  await take('meeting','failed-card');
  await take('unbound','unlocated-request');
  // Hold one real pre-judgment workspace response while the user re-evaluates the request.
  await page.evaluate(async ()=>{
    const fetchNow=window.fetch.bind(window);
    const oldWorkspace=await fetchNow('/api/bootstrap?include=insightVisuals');
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    const race=window.replyCardRace={started:false,finished:false,release};
    window.fetch=async (url,opts)=>{
      if(!race.started && String(url).startsWith('/api/bootstrap?')){
        race.started=true;
        await held;
        return oldWorkspace;
      }
      const response=await fetchNow(url,opts);
      if(String(url)==='/api/inbox/meeting/triage' && opts?.method==='POST')race.finished=true;
      return response;
    };
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(()=>window.replyCardRace?.started);
  await page.click(row('meeting')+' button:has-text("重新判断")',{label:'重新判断演示时间'});
  await page.waitForFunction(()=>window.replyCardRace?.finished);
  await page.evaluate(()=>window.replyCardRace.release());
  await includes('meeting','重新判断完成');
  const completed=await contents('meeting');
  expect('完成提示出现时已有最新起草入口', completed.includes('起草回复') && !/判断失败|正在重新判断/.test(completed));
  await includes('meeting','起草回复');
  const reopened = await read('/api/inbox/meeting');
  expect('重新判断后绑定有效请求', reopened.triage?.status==='succeeded' &&
    reopened.triage?.requestMessageId==='meeting-q' && !reopened.draft);
  expect('新判断完成后旧报错不回潮且原回执可追溯', !(await contents('meeting')).includes(legacy.message) &&
    await page.evaluate(id=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).actions['inbox:meeting:draft_reply']?.operationId===id,legacy.operationId));
  await page.click(row('meeting')+' button:has-text("起草回复")',{label:'起草演示时间回复'});
  await includes('meeting','请稍等，我核对三点的安排后答复。');
  await take('meeting','draft-ready');
  await page.reload();
  await includes('meeting','请稍等，我核对三点的安排后答复。');
  const stored = await read('/api/inbox/meeting');
  expect('刷新后显示持久草稿且待确认', stored.draft==='请稍等，我核对三点的安排后答复。' && !stored.approved);
  const evidence = await read('/__fixture/evidence');
  expect('一次强制判断，一次起草，零发送', evidence.requests.filter(x=>x.path==='/api/inbox/meeting/triage'&&x.force===true).length===1 &&
    evidence.requests.filter(x=>x.type==='draft_reply').length===1 && evidence.sends===0);
} finally {
  await fs.writeFile(outputDir+'/browser.json',JSON.stringify({url,checks},null,2));
  console.log({checks,url});
}
