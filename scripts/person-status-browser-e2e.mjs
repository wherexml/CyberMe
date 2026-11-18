// Build V6 and start scripts/person-status-http-e2e.mjs --serve first.
const task=await taskSpace('CyberMe 人物状态 20261109'),page=task.page('p1'),fs=await import('node:fs/promises');
const url='http://127.0.0.1:46930/',out='/Users/steve/Projects/CyberMe/output/person-status-20261109';
const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
const report='周岚 已经离职了';
const fixture=path=>page.evaluate(path=>fetch(path,{method:'POST'}).then(r=>r.ok),path);
await page.goto(url);await page.waitForSelector('textarea');
console.log(await page.snapshot());
// Hold the memory worker before the Memory tab mounts, so its 15s poll cannot fire inside the deadline below.
check('shared memory worker is held on a model summary',await fixture('/__fixture/block-summary'));
await page.click('loc=role:button[name="记忆"]');
await page.click('[data-memory-folder="people"]');
await page.click('.mem-person-row:has-text("周岚")');
await page.waitForSelector('[data-person-profile]');
check('original profile opens in right pane',await page.evaluate(()=>document.querySelector('.mem-source-body').textContent.includes('状态：在岗')&&!document.querySelector('[data-person-status]')));
await page.fill('textarea',report);
await page.click('loc=role:button[name="Send"]');
await page.waitForFunction(()=>document.querySelector('[data-person-status]')?.textContent.includes('已离职'),undefined,{timeout:8000});
check('left composer updates the already open right-side profile well before the old poll',await page.evaluate(()=>document.querySelector('[data-person-status]').textContent.includes('已离职')));
await fixture('/__fixture/release-summary');
await page.click('text=聊天来源');
check('exact source quote and separately archived original',await page.evaluate(report=>{
 const blocks=[...document.querySelectorAll('[data-person-profile] details.mem-source')];
 return blocks[0].open&&blocks[0].querySelector('blockquote').textContent===report&&!blocks[1].open&&blocks[1].textContent.includes('状态：在岗');
},report));
await page.screenshot({path:out+'/profile-updated.png'});
await page.reload();await page.waitForSelector('textarea');
await page.click('loc=role:button[name="记忆"]');
await page.click('[data-memory-folder="people"]');
await page.click('.mem-person-row:has-text("周岚")');
await page.waitForSelector('[data-person-status]');
check('status survives reload',await page.evaluate(()=>document.querySelector('[data-person-status]').textContent.includes('已离职')));
await fs.writeFile(out+'/browser.json',JSON.stringify({status:'PASS',url,synthetic:true,checks,screenshot:'profile-updated.png'},null,2));
await task.finish({keep:[]});
console.log(JSON.stringify({status:'PASS',url,checks}));
