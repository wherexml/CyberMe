const fs=await import('node:fs/promises');
const t=await taskSpace('OpsTwin toast regression'),p=t.page('p1');
const results=[];
for(const width of [1440,390]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto('http://127.0.0.1:46100/activity');
 await p.waitForSelector('text="导出日志"');
 await p.evaluate(()=>{window.toastEvidence={};new MutationObserver(()=>{const el=document.querySelector('.app-toast');if(el&&!window.toastEvidence.started){const r=el.getBoundingClientRect();window.toastEvidence={started:performance.now(),right:innerWidth-r.right,bottom:innerHeight-r.bottom,left:r.left,width:r.width,text:el.textContent};}else if(!el&&window.toastEvidence.started&&!window.toastEvidence.duration){window.toastEvidence.duration=performance.now()-window.toastEvidence.started;}}).observe(document.body,{childList:true,subtree:true});});
 const download=p.waitForEvent('download');await p.click('text="导出日志"');await (await download).saveAs(`/Users/steve/Projects/opstwin-advance/output/toast-20261002/export-${width}.json`);
 await p.waitForSelector('.app-toast');
 await p.screenshot({path:`/Users/steve/Projects/opstwin-advance/output/toast-20261002/toast-${width}.png`});
 await p.waitForFunction(()=>window.toastEvidence.duration>0,undefined,{timeout:5000});
 const result=await p.evaluate(()=>window.toastEvidence);result.viewport=width;result.pass=Math.abs(result.right-24)<1&&Math.abs(result.bottom-24)<1&&result.left>=0&&result.duration>=1900&&result.duration<2600;results.push(result);
}
await fs.writeFile('/Users/steve/Projects/opstwin-advance/output/toast-20261002/results.json',JSON.stringify(results,null,2));console.log(results);console.log(await p.snapshot());if(results.some(r=>!r.pass))throw Error('Toast verification failed');await t.finish({keep:[]});
