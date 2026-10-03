const fs=await import('node:fs/promises');const task=await taskSpace(Number(process.env.OPSADV_QA_SPACE||54)),page=task.page(process.env.OPSADV_QA_PAGE||'p1');const evidence=[];
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1335,height:961,deviceScaleFactor:1,mobile:false});
if(!await page.evaluate(()=>!!document.querySelector('.floating-twin')))await page.click('.twin-entry');
await page.waitForSelector('.floating-twin');
for(const width of [1335,390]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:961,deviceScaleFactor:1,mobile:false});
 await page.waitForFunction(()=>{const r=document.querySelector('.floating-twin').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight});
 const v=await page.evaluate(()=>{const f=document.querySelector('.floating-twin'),r=f.getBoundingClientRect();return {backgroundInert:document.querySelector('.chat-center .chat-composer-wrap').inert,width:innerWidth,banner:!!f.querySelector('.continuation-bar'),oldCard:!!f.querySelector('.continuation-item'),inputEnabled:!f.querySelector('.chat-composer>textarea').disabled,withinViewport:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}});evidence.push(v);
 if(!v.backgroundInert||v.banner||v.oldCard||!v.inputEnabled||!v.withinViewport)throw Error(JSON.stringify(v));
 await page.screenshot({path:`/Users/steve/Projects/opstwin-advance/output/chat-composer-20261002/float-${width}.png`});
}
await fs.writeFile('/Users/steve/Projects/opstwin-advance/output/chat-composer-20261002/float.json',JSON.stringify(evidence,null,2));console.log(evidence);await page.keyboard.press('Escape');await page.cdp('Emulation.clearDeviceMetricsOverride');
