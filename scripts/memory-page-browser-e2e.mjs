// Run fixture first; ego-browser nodejs < scripts/memory-page-browser-e2e.mjs
// Failure inventory: output/memory-upgrade-20261105/FAILURE-CASES.md
const task=await taskSpace('CyberMe 记忆读取与语义验证'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/memory-upgrade-20261105',base='http://127.0.0.1:46826';
await fs.mkdir(out,{recursive:true});const checks=[];const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const control=async value=>{const r=await fetch(base+'/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw Error('fixture control');};
const status=async()=>await (await fetch(base+'/__memory/status')).json();
const text=()=>page.evaluate(()=>document.querySelector('[data-memory-page]')?.textContent||'');
const idle=()=>page.waitForFunction(()=>document.querySelector('[data-memory-page]')?.dataset.memoryRefreshing==='false',undefined,{timeout:15000});
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const waitText=t=>page.waitForFunction(t=>document.querySelector('[data-memory-page]')?.textContent.includes(t),t,{timeout:25000});
try{
 await control({failures:{memory:0,soul:0,automatic:0,forget:0},delays:{memory:0},holds:{soul:true,memory:true,automatic:true}});
 await page.goto(base);await page.waitForSelector('textarea');await page.click('text="记忆"');
 await page.waitForSelector('[data-memory-loading="memory"]');
 check('pending requests never show empty state',!(await text()).includes('还没有记住'));
 check('new memory disabled until document arrives',await page.evaluate(()=>[...document.querySelectorAll('[data-memory-page] button')].find(b=>b.textContent.includes('新建记忆'))?.disabled));
 await page.screenshot({path:out+'/01-loading.png'});
 await control({holds:{soul:false,memory:false,automatic:false},delays:{memory:4000},release:true});
 await waitText('企业经营管理者');await waitText('我长期使用柱状图展示月度趋势');
 check('soul and automatic render before delayed memory',await page.evaluate(()=>!!document.querySelector('[data-memory-loading="memory"]')));
 await waitText('我偏好用图表说明业务趋势');await control({delays:{memory:0}});await idle();
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:out+'/02-loaded.png'});
 await control({holds:{soul:true,memory:true,automatic:true}});await focus();
 await page.click('text="任务"');await page.click('text="记忆"');
 check('tab remount retains loaded cards without false empty', (await text()).includes('我偏好用图表说明业务趋势')&&!(await text()).includes('还没有记住'));
 const counts=(await status()).counts;await focus();await focus();check('concurrent refreshes deduplicated',JSON.stringify((await status()).counts)===JSON.stringify(counts));
 await control({holds:{soul:false,memory:false,automatic:false},release:true});await idle();
 await control({failures:{memory:503}});await focus();await page.waitForSelector('[data-memory-error="memory"]');
 check('failed refresh preserves cached document',(await text()).includes('我偏好用图表说明业务趋势'));
 await page.evaluate(async()=>{await fetch('/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({failures:{memory:0}})});document.querySelector('[data-memory-error="memory"] button')?.click()});await page.waitForFunction(()=>!document.querySelector('[data-memory-error="memory"]'));
 check('explicit retry recovers resource',true);await idle();
 await control({remember:{content:'我长期偏好用折线图展示趋势。',slot:'work:display'}});
 await waitText('我长期偏好用折线图展示趋势');check('visible page receives background correction via actual timer',!(await text()).includes('我长期使用柱状图展示月度趋势'));
 // Hold an old automatic GET while forgetting the newly corrected slot.
 await idle();await control({holds:{automatic:true}});await focus();
 await page.waitForFunction(async()=>{const s=await (await fetch('/__memory/status')).json();return s.pending.includes('automatic')});
 await page.hover('button[aria-label="忘记：我长期偏好用折线图展示趋势。"]');
 await page.click('button[aria-label="忘记：我长期偏好用折线图展示趋势。"]');
 await page.waitForFunction(()=>!document.querySelector('[data-memory-page]').textContent.includes('我长期偏好用折线图展示趋势'));
 const receipts=(await status()).receipts;check('forget sends required action exactly once',receipts.length===1&&receipts[0].action==='forget');
 await control({holds:{automatic:false},release:true});await focus();
 const forgotten=await (await fetch(base+'/api/memories/automatic')).json();check('forget removes current and superseded preference',forgotten.items.length===0);
 await page.reload();await page.waitForSelector('[data-memory-page]');await waitText('我偏好用图表说明业务趋势');
 check('forgotten item stays absent after old response and reload',!(await text()).includes('我长期偏好用折线图')&&!(await text()).includes('我长期使用柱状图'));
 // Edit against a frozen baseline while remote document changes and refresh/save fail.
 await control({failures:{memory:503}});
 await page.click('[data-memory-page] .cm-row >> nth=1');
 await page.fill('[data-memory-page] textarea','## 工作偏好\n- 我偏好保留公开本机修改。');
 await control({document:'## 新的前置章节\n- 公开远端新增。\n\n## 工作偏好\n- 公开远端改动。'});await focus();
 await page.waitForSelector('[data-memory-error="memory"]');
 check('failed refresh preserves edit text',await page.evaluate(()=>document.querySelector('[data-memory-page] textarea').value.includes('公开本机修改')));
 await control({failures:{memory:0}});await focus();
 await page.click('[data-memory-page] button:text-is("完成")');
 await page.waitForFunction(()=>document.querySelector('[data-memory-page]').textContent.includes('重新载入'));
 check('version conflict preserves editor and canonical remote document',await page.evaluate(async()=>document.querySelector('[data-memory-page] textarea').value.includes('公开本机修改')&&(await (await fetch('/api/settings/documents/memory')).json()).content.includes('公开远端改动')));
 await page.screenshot({path:out+'/03-conflict.png'});
 await page.click('[data-memory-page] button:text-is("重新载入")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page]').textContent.includes('重新载入'));await page.click('[data-memory-page] button:text-is("完成")');
 await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));
 const doc=await (await fetch(base+'/api/settings/documents/memory')).json();check('explicit reload reanchors section and preserves unrelated remote addition',doc.content.includes('公开本机修改')&&doc.content.includes('公开远端新增')&&!doc.content.includes('公开远端改动'));
 // A held read times out visibly, without erasing cached cards.
 await idle();await control({holds:{memory:true}});await focus();await page.waitForSelector('[data-memory-error="memory"]',{timeout:16000});
 check('bounded timeout retains cached content',(await text()).includes('公开本机修改'));
 await page.evaluate(async()=>{await fetch('/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({holds:{memory:false},release:true})});document.querySelector('[data-memory-error="memory"] button')?.click()});await page.waitForFunction(()=>!document.querySelector('[data-memory-error]'));
 await control({soul:'',document:'',clearAutomatic:true});await focus();await waitText('还没有记住任何内容');check('confirmed empty displays only after successful reads',await page.evaluate(()=>!document.querySelector('[data-memory-loading]')));
 await page.click('[data-memory-page] button:has-text("新建记忆")');await page.waitForSelector('[data-memory-page] textarea');await page.fill('[data-memory-page] textarea','## 验收笔记\n- 公开新建内容');await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));
 await page.reload();await waitText('公开新建内容');check('create save refresh persists actual document',true);
 await page.screenshot({path:out+'/04-created.png'});
 // Failed and conflicted forget calls never optimistically remove a record.
 await control({remember:{content:'我长期偏好简明的公开报告。',slot:'work:failure'}});await focus();await waitText('我长期偏好简明的公开报告');await idle();
 await control({failures:{forget:503}});let before=(await status()).receipts.length;
 await page.hover('button[aria-label="忘记：我长期偏好简明的公开报告。"]');await page.click('button[aria-label="忘记：我长期偏好简明的公开报告。"]');
 await page.waitForFunction(()=>document.body.textContent.includes('暂未确认'));await idle();
 check('failed forget retains visible and canonical record',(await text()).includes('我长期偏好简明的公开报告')&&(await (await fetch(base+'/api/memories/automatic')).json()).items.some(m=>m.content==='我长期偏好简明的公开报告。'));
 check('failed forget is not automatically retried',(await status()).receipts.length===before+1);
 await control({failures:{forget:0},holds:{automatic:true},remember:{content:'我长期偏好详尽的公开报告。',slot:'work:failure'}});await focus();
 await page.hover('button[aria-label="忘记：我长期偏好简明的公开报告。"]');await page.click('button[aria-label="忘记：我长期偏好简明的公开报告。"]');
 await page.waitForFunction(()=>document.body.textContent.includes('已在别处修改'));
 check('stale forget surfaces conflict without removing cached row',(await text()).includes('我长期偏好简明的公开报告'));
 await control({holds:{automatic:false},release:true});await idle();await waitText('我长期偏好详尽的公开报告');
 check('conflicted forget did not revoke newer correction',(await (await fetch(base+'/api/memories/automatic')).json()).items.some(m=>m.content==='我长期偏好详尽的公开报告。'));
 await control({holds:{forget:true}});before=(await status()).receipts.length;
 await page.hover('button[aria-label="忘记：我长期偏好详尽的公开报告。"]');await page.click('button[aria-label="忘记：我长期偏好详尽的公开报告。"]');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="忘记：我长期偏好详尽的公开报告。"]')?.disabled);
 await page.evaluate(()=>document.querySelector('button[aria-label="忘记：我长期偏好详尽的公开报告。"]')?.click());
 check('pending forget blocks duplicate POST and retains row until confirmation',(await status()).receipts.length===before+1&&(await text()).includes('我长期偏好详尽的公开报告'));
 await control({holds:{forget:false},release:true});await page.waitForFunction(()=>!document.querySelector('[data-memory-page]').textContent.includes('我长期偏好详尽的公开报告'));
 check('confirmed retry forget clears record',true);

 await fs.writeFile(out+'/browser-result.json',JSON.stringify({status:'PASS',scope:'Built V6 + real isolated HTTP/SQLite, controlled latency/errors, Chromium; not installed WebKit',checks,receipts:(await status()).receipts},null,2));
 console.log({status:'PASS',checks:checks.length,out});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({status:'FAIL',checks,error:String(e)},null,2));console.log(await page.snapshot());throw e}
