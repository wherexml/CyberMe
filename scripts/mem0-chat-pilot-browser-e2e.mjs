// Start scripts/mem0-chat-pilot-e2e.mjs --serve before this script.
const task=await taskSpace('CyberMe Mem0 记忆试点 20261109');
const page=task.page('p1');
const fs=await import('node:fs/promises');
const url='http://127.0.0.1:46953/';
const out='/Users/steve/Projects/cyberme/output/mem0-memory-20261109';
await page.goto(url);
await page.waitForSelector('textarea');
console.log(await page.snapshot());
await page.click('loc=role:button[name="记忆"]');
await page.click('[data-memory-folder="automatic"]');
await page.waitForFunction(()=>document.querySelector('[data-memory-view="automatic"]')?.textContent.includes('我习惯用折线图展示营收走势。'));
await page.fill('textarea','营业额的变化用哪种可视化形式？');
await page.click('loc=role:button[name="Send"]');
await page.waitForFunction(()=>[...document.querySelectorAll('[data-ai-text]')].some(el=>el.textContent.includes('折线图')),undefined,{timeout:45000});
const proof=await page.evaluate(async()=>{
 const data=await (await fetch('/api/runs?limit=30')).json();
 const rows=Array.isArray(data)?data:data.items;
 const run=rows?.find(r=>r.kind==='chat'&&r.conversationId==='browser'&&r.status==='succeeded');
 const recall=run?.tools?.find(t=>t.name==='load_user_context')?.output;
 return {method:recall?.recall?.method,usedCount:recall?.memoryIds?.length||0};
});
if(proof.method!=='mem0-validated-pilot'||proof.usedCount!==1)throw Error('Browser answer missing verified Mem0 recall receipt: '+JSON.stringify(proof));
await page.screenshot({path:out+'/cyberme-mem0-recall.png'});
await fs.writeFile(out+'/browser.json',JSON.stringify({status:'PASS',url,synthetic:true,checks:['right pane exact source','main chat recalls source from another conversation','run evidence confirms Mem0 and exact single memory'],proof,screenshot:'cyberme-mem0-recall.png'},null,2));
await task.finish({keep:[]});
console.log(JSON.stringify({status:'PASS',url,...proof}));
