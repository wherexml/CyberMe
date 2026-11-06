// Start memory-library-fixture.mjs after building .local/memory-library-web.
// Failure inventory: docs/public/memory-library.md. Only synthetic local data is used.
const task=await taskSpace('CyberMe 记忆资料库设计'),page=task.page('p1');
const fs=await import('node:fs/promises'),base='http://127.0.0.1:46870',out=process.cwd()+'/output/memory-library-20261106';
await fs.mkdir(out,{recursive:true});const checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const control=async v=>{const r=await fetch(base+'/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});if(!r.ok)throw Error('fixture control')};
const doc=async()=>await (await fetch(base+'/api/settings/documents/memory')).json();
const text=()=>page.evaluate(()=>document.querySelector('[data-memory-page]')?.textContent||'');
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const idle=()=>page.waitForFunction(()=>document.querySelector('[data-memory-page]')?.dataset.memoryRefreshing==='false',undefined,{timeout:18000});
const home=async()=>{await page.click('.mem-breadcrumb');await page.waitForSelector('.mem-overview')};
try{
 await page.goto(base);await page.waitForSelector('textarea');
 if(!await page.evaluate(()=>!!document.querySelector('[data-memory-page]')))await page.click('text="记忆"');
 await page.waitForSelector('.mem-overview');await idle();
 const baseline=await doc();
 const profiles=await (await fetch(base+'/api/memory-library/people')).json();
 check('configured profiles and explicit identity',profiles.people.length===3&&profiles.owner.name==='林远'&&profiles.owner.aliases.includes('Lynn'));
 check('overview uses stored facts, never Agent instructions',(await text()).includes('我对 林远 的了解')&&!(await page.evaluate(()=>document.querySelector('.mem-overview').textContent)).includes('先核实消息'));
 check('folders preserve Markdown headings',await page.evaluate(()=>[...document.querySelectorAll('[data-memory-folder^="section:"] .mem-folder-title')].map(e=>e.textContent).join('|')==='关于我|工作|偏好'));
 await page.focus('[data-memory-folder="section:1"]');await page.press('[data-memory-folder="section:1"]','Enter');await page.waitForSelector('[data-memory-view="section:1"]');
 check('keyboard opens complete original section',(await text()).includes('产品规划与团队协作。'));
 await home();check('navigation makes no document mutation',(await doc()).version===baseline.version);
 await page.click('[data-memory-folder="people"]');await page.waitForSelector('[data-memory-people]');console.log(await page.snapshot());
 await page.fill('input[aria-label="搜索人物"]','运营总监');
 check('people search uses explicit roles',await page.evaluate(()=>document.querySelectorAll('.mem-person-row').length===1&&document.querySelector('.mem-person-row').textContent.includes('陈宁')));
 await page.click('.mem-person-row');await page.waitForSelector('[data-person-profile]');
 check('executive relationship stays peer, date from source',(await text()).includes('同级协作')&&(await text()).includes('2026-10-28'));
 await page.click('.mem-breadcrumb');await page.fill('input[aria-label="搜索人物"]','周岚');await page.click('.mem-person-row');
 await page.waitForSelector('.mem-observation');await page.click('.mem-observation summary');
 check('historical tracking preserves event date, direction and message ID',(await text()).includes('2026/10/28')&&(await text()).includes('本人发言')&&(await text()).includes('public-message-1'));
 await page.screenshot({path:out+'/02-person-history.png'});
 await control({failures:{people:503}});await focus();await page.waitForSelector('[data-memory-error="people"]');
 check('failed profile refresh does not present stale profile as current',!await page.evaluate(()=>!!document.querySelector('[data-person-profile]')));
 await control({failures:{people:0}});await page.click('[data-memory-error="people"] button');await page.waitForSelector('[data-person-profile]');await idle();
 await page.click('.mem-breadcrumb');await home();
 await page.click('[data-memory-folder="soul"]');await page.waitForSelector('[data-memory-view="soul"]');
 check('Agent instructions stay in explicit settings entry',(await text()).includes('身份与 Agent 设定')&&(await text()).includes('先核实消息发言人'));
 await home();
 await control({failures:{memory:503}});await page.click('[data-memory-folder="section:1"]');await page.click('[data-memory-page] .cm-row');
 await page.fill('[data-memory-page] textarea','## 工作\n- 公开本机草稿需要保留。');
 await page.waitForFunction(()=>document.querySelector('[data-memory-page]').textContent.includes('保存失败'),undefined,{timeout:7000});
 await page.click('.mem-breadcrumb');check('failed save blocks return and keeps draft',await page.evaluate(()=>document.querySelector('[data-memory-page] textarea')?.value.includes('公开本机草稿')));
 await page.reload();await page.waitForSelector('[data-memory-page] textarea');
 check('failed draft survives reload in correct folder',await page.evaluate(()=>document.querySelector('[data-memory-page]').dataset.memoryView==='section:1'&&document.querySelector('[data-memory-page] textarea').value.includes('公开本机草稿')));
 const remote='## 新的远端章节\n- 公开远端新增。\n\n'+baseline.content.replace('产品规划与团队协作。','公开远端改动。');
 await control({document:remote,failures:{memory:0}});await focus();await idle();
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>document.querySelector('[data-memory-page]').textContent.includes('重新载入'));
 check('409 preserves typed draft and server copy',await page.evaluate(()=>document.querySelector('[data-memory-page] textarea').value.includes('公开本机草稿'))&&(await doc()).content===remote);
 await page.screenshot({path:out+'/03-conflict.png'});
 await page.click('[data-memory-page] button:text-is("重新载入")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page]').textContent.includes('重新载入'));
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));
 const saved=await doc();check('explicit reconcile preserves unrelated remote section',saved.content.includes('公开本机草稿')&&saved.content.includes('公开远端新增'));
 await home();await page.click('[data-memory-folder="automatic"]');await page.waitForSelector('[aria-label^="忘记："]');await idle();
 await control({holds:{automatic:true}});await focus();await page.waitForFunction(async()=>{const s=await(await fetch('/__memory/status')).json();return s.pending.includes('automatic')});
 await page.click('[aria-label^="忘记："]');await page.waitForFunction(()=>!document.querySelector('[aria-label^="忘记："]'));
 await control({holds:{automatic:false},release:true});await idle();
 check('forget is not reversed by stale in-flight response',!await page.evaluate(()=>!!document.querySelector('[aria-label^="忘记："]')));
 const receipts=await(await fetch(base+'/__memory/status')).json();check('forget recorded exactly once with version',receipts.receipts.length===1&&receipts.receipts[0].action==='forget'&&!!receipts.receipts[0].version);
 await home();await page.click('[aria-label="新建记忆"]');await page.waitForSelector('[data-memory-page] textarea');
 await page.fill('[data-memory-page] textarea','## 新建公开资料\n- 通过资料库新建。');await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));await home();
 check('new folder backed by persisted Markdown',(await doc()).content.includes('## 新建公开资料')&&(await text()).includes('新建公开资料'));
 await control({document:baseline.content,remember:{content:'我长期偏好用折线图展示趋势。',slot:'work:display'}});await focus();await idle();
 for(const theme of ['quiet','night']){
  await page.evaluate(theme=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,theme,tab:'memory'}))},theme);await page.reload();await page.waitForSelector('.mem-overview');await idle();
  for(const width of [1000,1400]){await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await page.waitForFunction(w=>innerWidth===w,width);await page.waitForFunction(w=>{const p=document.querySelector('[data-memory-page]');return w===1000?p.clientWidth<380:p.clientWidth>380},width);
   const layout=await page.evaluate(()=>{const p=document.querySelector('[data-memory-page]'),g=document.querySelector('.mem-folder-grid');return {overflow:p.scrollWidth>p.clientWidth+1,columns:getComputedStyle(g).gridTemplateColumns.split(' ').length,width:p.clientWidth}});
   check(theme+' '+width+' responsive without overflow',!layout.overflow&&(width!==1000||layout.columns===1),layout);
   await page.screenshot({path:out+'/overview-'+theme+'-'+width+'.png'});
  }
 }
 await control({language:'en'});await page.reload();await page.waitForFunction(()=>document.querySelector('.mem-overview h2')?.textContent.includes('What I know about'));check('English labels use same real owner',(await text()).includes('What I know about 林远')&&(await text()).includes('Identity & agent settings'));await page.screenshot({path:out+'/overview-english.png'});await control({language:'zh-CN'});
 await page.evaluate(()=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,theme:'quiet'}))});await page.reload();await page.waitForSelector('.mem-overview');
 await page.click('[data-memory-folder="people"]');await page.fill('input[aria-label="搜索人物"]','周岚');await page.click('.mem-person-row');await page.waitForSelector('[data-person-profile]');await control({removePeople:true});await focus();await idle();
 check('removed profile does not linger in detail',(await text()).includes('该人物档案已不可用')&&!await page.evaluate(()=>!!document.querySelector('[data-person-profile]')));
 console.log({passed:checks.length,checks});
}finally{await fs.writeFile(out+'/checks.json',JSON.stringify({checks},null,2));}
