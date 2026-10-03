// EGO_ALIGNMENT_SPACE=69 ego-browser nodejs < scripts/inbox-header-alignment-e2e.mjs
const {mkdir,writeFile}=await import('node:fs/promises');
const task=await taskSpace(Number(process.env.EGO_ALIGNMENT_SPACE||69)),page=task.page('p1');
const root='/Users/steve/Projects/opstwin-advance/output/inbox-alignment-20261003';await mkdir(root,{recursive:true});
const results=[];
for(const width of [1440,390]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
 await page.goto('http://127.0.0.1:46100/inbox');await page.waitForSelector('.op-message-top');
 const check=await page.evaluate(()=>{const rows=[...document.querySelectorAll('.op-message-row')];const checks=rows.map(row=>{const name=row.querySelector('.op-message-identity strong').getBoundingClientRect(),time=row.querySelector('.op-message-time').getBoundingClientRect(),signal=row.querySelector('.op-attention-bars').getBoundingClientRect();return {aligned:Math.max(name.bottom,time.bottom,signal.bottom)-Math.min(name.bottom,time.bottom,signal.bottom)<1,order:name.right<=time.left&&time.right<=signal.left,top:!!row.querySelector('.op-message-top > time'),nameWidth:name.width};});return {rows:rows.length,aligned:checks.every(x=>x.aligned),order:checks.every(x=>x.order),timeInHeader:checks.every(x=>x.top),visibleNames:checks.every(x=>x.nameWidth>0),noOverflow:document.documentElement.scrollWidth<=innerWidth};});
 results.push({width,...check});await page.screenshot({path:`${root}/${width}.png`});
}
await page.cdp('Emulation.clearDeviceMetricsOverride');
const pass=results.every(r=>r.rows>0&&r.aligned&&r.order&&r.timeInHeader&&r.visibleNames&&r.noOverflow);await writeFile(root+'/evidence.json',JSON.stringify({pass,results},null,2));console.log({pass,results});if(!pass)throw Error('Alignment failed');
