// Run: ego-browser nodejs < scripts/composer-clear-e2e.mjs
// Set OPSADV_EGO_SPACE to resume the task's shared space.
const fs=await import('node:fs/promises');
const task=await taskSpace(Number(process.env.OPSADV_EGO_SPACE||49));
const page=task.page('p1');
const out='/Users/steve/Projects/opstwin-advance/output/composer-clear-20261002';
await fs.mkdir(out,{recursive:true});
await page.goto('http://127.0.0.1:46100/chat');
await page.waitForSelector('textarea');
const marker=`OPSADV-QA-COMPOSER-${Date.now()}`;
const message=`${marker} 输入框验证。只回复“收到”，不要使用工具或修改数据。`;
await page.fill('textarea',message);
await page.press('textarea','Enter');
const pending=await page.evaluate(()=>({value:document.querySelector('textarea').value,disabled:document.querySelector('textarea').disabled,draft:sessionStorage.getItem('opsadv-chat-draft')}));
if(pending.value!==''||pending.draft!==''||!pending.disabled)throw new Error(JSON.stringify(pending));
await page.screenshot({path:`${out}/pending.png`});
await fs.writeFile(`${out}/pending.json`,JSON.stringify({marker,message,pending},null,2));
console.log({marker,pending});
