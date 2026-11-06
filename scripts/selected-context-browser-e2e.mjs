// After: node --import tsx scripts/selected-context-http-e2e.mjs --serve
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/selected-context-web
// Run: ego-browser nodejs < scripts/selected-context-browser-e2e.mjs
const task=await taskSpace('CyberMe 点选内容指代修复'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/selected-context-20261105',checks={};
await page.goto('http://127.0.0.1:46882');
await page.waitForSelector('css=button:text-is("灵感")');await page.click('css=button:text-is("灵感")');
await page.click('css=div:text-is("订阅服务试点：先核算持续交付成本")');
await page.click('css=button:text-is("讨论")');await page.fill('textarea','你怎么看这个？');
await page.waitForFunction(()=>{const d=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').drafts?.primary;return d?.text==='你怎么看这个？'&&d?.refs?.includes('selected')});
checks.clickBindsExactId=true;
await page.screenshot({path:out+'/selected-before-send.png'});
await page.reload();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='你怎么看这个？');
checks.restoredDraft=await page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).drafts.primary.refs.join(',')==='selected');
await page.click('button[aria-label="Send"]');
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).requests.some(r=>r.status==='succeeded'&&r.contextIds.join(',')==='selected'));
const result=await page.evaluate(async()=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui'));const r=ui.requests.findLast(r=>r.contextIds.join(',')==='selected');const receipt=await (await fetch('/api/chat/requests/'+r.requestId)).json();const prompts=await (await fetch('/__fixture/calls')).json();return {id:r.requestId,ids:receipt.result.userMessage.contextIds,tools:receipt.result.run.tools.map(t=>t.name),prompt:prompts.at(-1)}});
checks.serverKeptId=result.ids.join(',')==='selected';
checks.modelReceivedFullSelection=result.prompt.includes('每月产出、人工工时和续费条件');
checks.noAmbientReminderBatch=!result.tools.includes('load_idea_reminders');
await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('公开受控响应：已收到本轮资料。'));
checks.durableResponse=await page.evaluate(id=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).requests.some(r=>r.requestId===id&&r.status==='succeeded'&&r.contextIds[0]==='selected'),result.id);
await page.screenshot({path:out+'/selected-after-reload.png'});
// Removing the attached record must remove the next request association as well.
await page.click('css=button:text-is("灵感")');await page.click('css=div:text-is("订阅服务试点：先核算持续交付成本")');await page.click('css=button:text-is("讨论")');
await page.click('button[aria-label="Remove"]');await page.fill('textarea','只讨论当前输入');
await page.waitForFunction(()=>{const d=JSON.parse(localStorage.getItem('cyberme-v6-ui')).drafts.primary;return d?.text==='只讨论当前输入'&&d.refs.length===0});checks.removeClearsAssociation=true;
await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'production V6 + actual HTTP/SDK/SQLite; synthetic records and controlled model',checks},null,2));console.log(checks);
if(Object.values(checks).some(x=>!x))throw Error('Selected context browser failure');
await task.finish({keep:[]});
