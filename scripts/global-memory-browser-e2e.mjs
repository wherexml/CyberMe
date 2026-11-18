// Global personal memory browser journey (docs/public/global-memory.md F5, F21).
// Build V6 to .local/global-memory-web, start `node --import tsx scripts/global-memory-http-e2e.mjs --serve`,
// then run: ego-browser nodejs < scripts/global-memory-browser-e2e.mjs
const task=await taskSpace('CyberMe 全局记忆 20261111'),page=task.page('p1'),fs=await import('node:fs/promises'),path=await import('node:path');
// ego-browser Node runs with a different cwd, so the evidence path is absolute.
const url='http://127.0.0.1:47182/',out='/Users/steve/Projects/cyberme/output/global-memory-20261111';
await fs.mkdir(out,{recursive:true});
const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
await page.goto(url);await page.waitForSelector('textarea');
check('F21 composer has no 记忆范围 selector',await page.evaluate(()=>!document.querySelector('[data-memory-scope]')&&!document.body.textContent.includes('记忆范围')&&!document.body.textContent.includes('Memory scope')));
const draft='合成草稿，切换标签后应保留';
await page.fill('textarea',draft);
await page.click('loc=role:button[name="记忆"]');
await page.click('text=自动记住');
await page.waitForFunction(()=>document.body.textContent.includes('合成脚本整理周报'),undefined,{timeout:8000});
check('F6/F21 legacy removed-project fact appears in 自动记住 without a project label',await page.evaluate(()=>{const t=document.querySelector('[data-memory-view="automatic"]').textContent;return t.includes('合成脚本整理周报')&&t.includes('合成摄影')&&!t.includes('项目已移除')&&!t.includes('Project removed')&&!t.includes('合成旧项目');}));
check('F16 forgotten and superseded facts are absent from the memory list while chat history stays visible',await page.evaluate(()=>{const t=document.querySelector('[data-memory-view="automatic"]').textContent;return !t.includes('合成乙型电脑')&&!t.includes('合成观鸟')&&!t.includes('合成马拉松');}));
await page.screenshot({path:out+'/automatic.png'});
check('F5 composer draft survives switching to the 记忆 tab',await page.evaluate(d=>document.querySelector('textarea').value===d,draft));
const replies=await page.evaluate(()=>document.body.textContent.split('收到。').length);
await page.fill('textarea','我有什么兴趣爱好？');
await page.click('loc=role:button[name="Send"]');
await page.waitForFunction(n=>document.body.textContent.split('收到。').length>n,replies,{timeout:15000});
check('F21 new chat completes without memory scope errors',await page.evaluate(()=>!document.body.textContent.includes('记忆范围')&&!document.body.textContent.includes('没有发送给模型')));
await page.screenshot({path:out+'/chat.png'});
await fs.writeFile(out+'/browser.json',JSON.stringify({status:'PASS',url,synthetic:true,checks,screenshots:['automatic.png','chat.png']},null,2));
await task.finish({keep:[]});
console.log(JSON.stringify({status:'PASS',url,checks}));
