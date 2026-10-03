// Run: ego-browser nodejs < scripts/inbox-dismiss-e2e.mjs
const fs = await import('node:fs/promises');
const out = '/Users/steve/Projects/opstwin-advance/output/inbox-dismiss-20261002';
const task = await taskSpace(57); const page = task.page('p1');
const marker = `OPSADV-QA-DISMISS-${Date.now()}`;
const evidence = {marker, checks:[]};
async function check(name, fn) { if (!await fn()) throw new Error(name); evidence.checks.push({name,status:'PASS'}); }
// First invocation may already have the create modal open.
for (const suffix of ['A','B']) {
 if (!await page.evaluate(()=>!!document.querySelector('[role="dialog"]'))) await page.click('loc=role:button[name="创建测试消息"]');
 await page.fill('loc=role:textbox[name="测试消息标题"]', `${marker}-${suffix}`);
 await page.fill('loc=role:textbox[name="测试消息正文"]', `${marker}-${suffix} 本地忽略交互验收，不发送。`);
 await page.click('loc=role:button[name="创建消息"]');
 await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
}
await page.fill('loc=role:textbox[name="搜索收件箱"]',marker);
console.log(await page.snapshot());
const before = await page.url();
await page.click('loc=role:button[name="忽略"]');
await page.waitForFunction(()=>document.querySelectorAll('.op-message-row').length===1);
await check('advance to next visible message and URL',async()=>await page.url()!==before && await page.evaluate(()=>document.querySelector('.op-message-row[aria-current="true"]')?.textContent.includes('-A')));
await page.screenshot({path:out+'/next-message.png'});
await page.click('loc=role:button[name="忽略"]');
await page.waitForFunction(()=>document.querySelectorAll('.op-message-row').length===0);
await check('last matching message clears detail and URL',async()=>!(await page.url()).includes('item=') && await page.evaluate(()=>!document.querySelector('.op-original-message')));
await page.click('loc=role:button[name="已完成"]');
await page.waitForFunction(()=>document.querySelectorAll('.op-message-row').length===2);
await check('Done rows show dismissed instead of waiting review',()=>page.evaluate(()=>[...document.querySelectorAll('.op-message-row')].every(row=>row.textContent.includes('已忽略')&&!row.textContent.includes('等待你审核')&&!row.textContent.includes('草稿已就绪'))));
await page.screenshot({path:out+'/dismissed-rows.png'});
await page.reload();
await page.click('loc=role:button[name="已完成"]');
await page.fill('loc=role:textbox[name="搜索收件箱"]',marker);
await page.waitForFunction(()=>document.querySelectorAll('.op-message-row').length===2);
await check('dismissed state persists after reload',()=>page.evaluate(()=>[...document.querySelectorAll('.op-message-row')].every(row=>row.textContent.includes('已忽略'))));
evidence.snapshot=await page.snapshot();
await fs.writeFile(out+'/e2e.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
