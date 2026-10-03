// ego-browser nodejs < scripts/inbox-self-browser-e2e.mjs
const {writeFile}=await import('node:fs/promises');
const task=await taskSpace(Number(process.env.EGO_SELF_SPACE||65)),page=task.page('p1');
const root='/Users/steve/Projects/opstwin-advance/output/inbox-self-20261002/';
const id='inbo-7fb1d841-0a06-49d3-9c03-1dea1e967763';
await page.goto('http://127.0.0.1:46100/inbox?item='+id);
await page.waitForSelector('.op-triage-card[data-triage-status="succeeded"]');
const inspect=()=>{const card=document.querySelector('.op-triage-card'),detail=document.querySelector('.op-inbox-detail');return {ruleReason:card.textContent.includes('这是发给本人的测试记录，无需回复自己'),noProbability:!card.textContent.includes('是的概率'),noOwnReview:!detail.textContent.includes('等待你审核'),neutralSource:detail.textContent.includes('本人测试消息')&&!detail.textContent.includes('对方的消息'),noOverflow:document.documentElement.scrollWidth<=innerWidth};};
const desktop=await page.evaluate(inspect);
await page.screenshot({path:root+'desktop.png'});
await page.click('loc=role:button[name="重新判断"]');
await page.waitForSelector('.op-triage-card[data-triage-status="succeeded"]');
await page.reload();await page.waitForSelector('.op-triage-card[data-triage-status="succeeded"]');
const refreshed=await page.evaluate(inspect);
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const mobile=await page.evaluate(inspect);await page.screenshot({path:root+'mobile.png'});
await page.cdp('Emulation.clearDeviceMetricsOverride');
const evidence={id,taskSpace:task.spaceId,desktop,refreshed,mobile,status:[desktop,refreshed,mobile].every(c=>Object.values(c).every(Boolean))?'PASS':'FAIL'};
await writeFile(root+'browser-e2e.json',JSON.stringify(evidence,null,2));console.log(evidence);if(evidence.status!=='PASS')throw new Error('Browser verification failed');
