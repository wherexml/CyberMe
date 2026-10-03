// Run: ego-browser nodejs < scripts/twin-popup-e2e.mjs (TaskSpace 50 must exist).
const task=await taskSpace(50),page=task.page('p1');
const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/twin-popup-20261002';
const checks=[];
const assert=(name,ok,data)=>{console.log(name,!!ok);checks.push({name,pass:!!ok,data});if(!ok)throw new Error(name)};
const box=()=>page.evaluate(()=>document.querySelector('.floating-twin')?.getBoundingClientRect().toJSON());
await page.goto('http://127.0.0.1:46100');await page.click('.twin-entry');
let b=await box();let anchor=await page.evaluate(()=>document.querySelector('.twin-entry').getBoundingClientRect().toJSON());
assert('opens right of trigger',b.left>=anchor.right,b);
await page.click('.floating-header strong');assert('inside remains open',await box());
await page.click('.twin-entry');assert('trigger toggles closed',!await box());
await page.click('.twin-entry');await page.click('.brand');assert('outside closes',!await box());
await page.click('.twin-entry');
for(let i=0;i<10;i++){await page.press('.twin-resize-ne','ArrowRight');await page.press('.twin-resize-ne','ArrowUp');}
for(const corner of ['nw','ne','sw','se']){
 console.log('drag',corner);const before=await box();const r=await page.evaluate(c=>{const e=document.querySelector('.twin-resize-'+c),b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,cursor:getComputedStyle(e).cursor,text:e.textContent}},corner);
 assert(corner+' invisible diagonal cursor',!r.text&&r.cursor===(corner==='nw'||corner==='se'?'nwse-resize':'nesw-resize'),r);
 await page.mouse.move(r.x,r.y);await page.mouse.down();await page.mouse.move(r.x+(corner.includes('w')?25:-25),r.y+(corner.includes('n')?25:-25));await page.mouse.up();
 await page.waitForFunction(old=>{const b=document.querySelector('.floating-twin').getBoundingClientRect();return Math.abs(b.width-old.width)>15&&Math.abs(b.height-old.height)>15},before);
 const after=await box();assert(corner+' resizes both axes',Math.abs(after.width-before.width)>15&&Math.abs(after.height-before.height)>15,{before,after});
 assert(corner+' opposite corner stays',Math.abs((corner.includes('w')?after.right-before.right:after.left-before.left))<1&&Math.abs((corner.includes('n')?after.bottom-before.bottom:after.top-before.top))<1);
}
const saved=await box();await page.reload();await page.click('.twin-entry');await page.waitForFunction(saved=>{const b=document.querySelector('.floating-twin')?.getBoundingClientRect();return b&&Math.abs(b.width-saved.width)<1&&Math.abs(b.height-saved.height)<1},saved);b=await box();assert('refresh restores dimensions',Math.abs(b.width-saved.width)<1&&Math.abs(b.height-saved.height)<1,{saved,b});
await page.screenshot({path:out+'/verified.png'});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.waitForFunction(()=>{const b=document.querySelector('.floating-twin').getBoundingClientRect();return b.right<=innerWidth&&b.bottom<=innerHeight});
b=await box();assert('mobile stays in viewport',b.left>=0&&b.right<=390&&b.top>=56&&b.bottom<=844,b);
await page.screenshot({path:out+'/mobile.png'});
await page.cdp('Emulation.clearDeviceMetricsOverride');
await fs.writeFile(out+'/e2e.json',JSON.stringify(checks,null,2));console.log(checks);
