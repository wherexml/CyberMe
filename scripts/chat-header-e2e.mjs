const fs=await import('node:fs/promises');
const task=await taskSpace(53),page=task.page('p1');
const out='/Users/steve/Projects/opstwin-advance/output/chat-header-20261002';
const results=[];
for(const width of [1335,390]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:961,deviceScaleFactor:1,mobile:false});
 await page.goto('http://localhost:46100/chat');
 await page.waitForSelector('.working-label');
 const result=await page.evaluate(()=>{const bar=document.querySelector('.working-strip');return {width:innerWidth,oldHeader:!!document.querySelector('.chat-header'),label:bar.querySelector('.working-label')?.textContent,icon:!!bar.querySelector('.twin-mark'),buttons:bar.querySelectorAll('button').length,height:bar.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth,composer:!!document.querySelector('.chat-center textarea')};});
 if(result.oldHeader||!result.icon||result.buttons<2||result.overflow||!result.composer)throw Error(JSON.stringify(result));
 results.push(result);await page.screenshot({path:`${out}/${width}.png`});
}
await page.cdp('Emulation.clearDeviceMetricsOverride');
await fs.writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
console.log(results);await task.finish({keep:[]});
