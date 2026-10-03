// Run after composer-clear-e2e.mjs in the same TaskSpace.
const fs=await import('node:fs/promises');
const task=await taskSpace(Number(process.env.OPSADV_EGO_SPACE||49));const page=task.page('p1');
const out='/Users/steve/Projects/opstwin-advance/output/composer-clear-20261002';
const original=JSON.parse(await fs.readFile(`${out}/pending.json`,'utf8'));
await page.waitForFunction(()=>!document.querySelector('textarea').disabled,undefined,{timeout:60000});
const completed=await page.evaluate(()=>({value:document.querySelector('textarea').value,error:document.querySelector('[role=alert]')?.textContent,last:[...document.querySelectorAll('.user-bubble,.assistant-content')].slice(-2).map(n=>n.textContent)}));
if(completed.value!==''||completed.error||!completed.last[0].includes(original.marker)||!completed.last[1].includes('收到'))throw new Error(JSON.stringify(completed));
await page.reload();await page.waitForSelector('textarea');
const reloaded=await page.evaluate(()=>document.querySelector('textarea').value);
if(reloaded!=='')throw new Error('Sent draft returned after reload');
const failedDraft=`${original.marker} offline draft`;
await page.fill('textarea',failedDraft);
await page.cdp('Network.enable');
let failed;
try{
 await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await page.press('textarea','Enter');
 await page.waitForFunction(()=>!document.querySelector('textarea').disabled&&!!document.querySelector('[role=alert]'),undefined,{timeout:10000});
 failed=await page.evaluate(()=>({value:document.querySelector('textarea').value,draft:sessionStorage.getItem('opsadv-chat-draft'),error:document.querySelector('[role=alert]')?.textContent}));
 if(failed.value!==failedDraft||failed.draft!==failedDraft)throw new Error(JSON.stringify(failed));
 await page.screenshot({path:`${out}/failure-restored.png`});
}finally{await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
await page.reload();await page.waitForSelector('textarea');
if(await page.evaluate(()=>document.querySelector('textarea').value)!==failedDraft)throw new Error('Failed draft lost after reload');
await fs.writeFile(`${out}/result.json`,JSON.stringify({completed,reloaded,failed,failedDraftSurvivesReload:true,status:'PASS'},null,2));
await page.fill('textarea','');
console.log('PASS: pending clear, successful reply, reload clear, offline draft recovery, recovery reload');
