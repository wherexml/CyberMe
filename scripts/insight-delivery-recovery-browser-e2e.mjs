// Start scripts/insight-delivery-recovery-e2e.mjs --serve after building .local/insight-delivery-web.
// ego-browser nodejs < scripts/insight-delivery-recovery-browser-e2e.mjs
const task=await taskSpace('CyberMe 新洞察与摘要恢复验收 '+Date.now()),page=task.page('p1'),fs=await import('node:fs/promises');
const out='/Users/steve/Projects/CyberMe/output/insight-delivery-recovery-20261108',checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
await page.goto('http://127.0.0.1:46970/cyberme.html');await page.waitForSelector('[data-insight-feed]',{timeout:20000});
const initialEvidence=JSON.parse((await page.fetch('/__fixture/evidence')).body);
await page.waitForSelector('[data-insight-visual]');
check('new observations show validated comparison graphics',await page.evaluate(()=>document.querySelectorAll('[data-insight-visual="comparison"]').length===2));
check('main conversation shows a neutral summary',await page.evaluate(()=>document.querySelector('[data-digest]').textContent.includes('最新动态')&&document.querySelector('[data-digest]').textContent.includes('发布计划从周三调整为周五')&&!document.querySelector('[data-digest]').textContent.includes('等你')));
check('observations offer no task action',await page.evaluate(()=>!document.querySelector('[data-action="create_task"]')));
await page.screenshot({path:out+'/browser-recovered.png'});
await page.fill('textarea','保留正在编辑的想法');
await page.click('[data-digest] button >> nth=0');await page.waitForSelector('button[aria-label="Back"]');
check('summary opens the exact insight and preserves composer',await page.evaluate(()=>document.querySelector('textarea').value==='保留正在编辑的想法'&&document.body.innerText.includes('发布计划从周三调整为周五')));
await page.click('button[aria-label="Back"]');await page.waitForSelector('[data-insight-feed]');
await page.reload();await page.waitForSelector('[data-digest]');
check('summary and draft survive reload without duplicates',await page.evaluate(()=>document.querySelectorAll('[data-digest]').length===1&&document.querySelector('textarea').value==='保留正在编辑的想法'));
if(!await page.evaluate(()=>!!document.querySelector('[data-message-actions]'))){await page.fetch('/__fixture/individual',{method:'POST'});await page.reload()}await page.waitForSelector('[data-message-actions]');
check('individual information reminder offers discuss instead of creating owner work',await page.evaluate(()=>!!document.querySelector('[data-message-actions] [data-action="discuss"]')&&!document.querySelector('[data-message-actions] [data-action="create_task"]')));
await page.cdp('Emulation.setDeviceMetricsOverride',{width:900,height:800,deviceScaleFactor:1,mobile:false});
check('compact window has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:out+'/browser-900.png'});
const evidence=JSON.parse((await page.fetch('/__fixture/evidence')).body);check('browser interactions create no tasks or model calls',evidence.tasks===0&&evidence.toolCalls===0&&evidence.calls===initialEvidence.calls);
await fs.writeFile(out+'/browser.json',JSON.stringify({url:await page.url(),scope:'production V6/HTTP, synthetic isolated data, controlled model',checks,screenshots:[out+'/browser-recovered.png',out+'/browser-900.png']},null,2));console.log({checks});await task.finish({keep:[]});
