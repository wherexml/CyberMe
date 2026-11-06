// Run fixture/build per panel-ratio-fixture.mjs, then: ego-browser nodejs < scripts/panel-ratio-browser-e2e.mjs
// Failure cases are recorded before implementation in output/panel-ratio-20261105/FAILURE-CASES.md.
const task=await taskSpace('CyberMe 分栏比例验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/panel-ratio-20261105';
await fs.mkdir(out,{recursive:true});const checks=[],measurements=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const viewport=async width=>{await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:false});await page.waitForFunction(w=>innerWidth===w,width)};
const read=()=>page.evaluate(()=>{const f=document.querySelector('[data-screen-label="CyberMe window"]'),s=document.querySelector('[role="separator"]'),p=s.nextElementSibling,c=s.previousElementSibling;return {frame:f.getBoundingClientRect().width,panel:p.getBoundingClientRect().width,chat:c.getBoundingClientRect().width,now:+s.getAttribute('aria-valuenow'),min:+s.getAttribute('aria-valuemin'),max:+s.getAttribute('aria-valuemax'),state:JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}')}});
async function sample(label,ratio){await page.waitForFunction(r=>{const s=document.querySelector('[role="separator"]');if(!s)return false;return Math.abs(s.nextElementSibling.getBoundingClientRect().width/document.querySelector('[data-screen-label="CyberMe window"]').getBoundingClientRect().width-r)<0.001},ratio);const m=await read();measurements.push({label,...m});check(label,Math.abs(m.panel/m.frame-ratio)<0.001&&Math.abs(m.chat+m.panel-m.frame)<1&&Math.abs(m.now-m.panel)<1);return m}
async function seed(patch){await page.evaluate(p=>{const k='cyberme-v6-ui';localStorage.setItem(k,JSON.stringify({...JSON.parse(localStorage.getItem(k)||'{}'),...p}))},patch);await page.reload();await page.waitForSelector('[role="separator"]')}
try{
 await page.goto('http://127.0.0.1:46774');await page.waitForSelector('[role="separator"]');
 await seed({panelW:null,panelRatio:null,panel:true});
 for(const w of [1600,1200,1000,800]){await viewport(w);await sample('default 40% at '+w,0.4)}
 await viewport(1408);await sample('preview frame capped at 1360',0.4);
 const drag=await page.evaluate(()=>{const f=document.querySelector('[data-screen-label="CyberMe window"]').getBoundingClientRect(),s=document.querySelector('[role="separator"]').getBoundingClientRect();return {x:s.x+s.width/2,y:s.y+s.height/2,to:f.right-f.width/2}});
 await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.to,drag.y);await page.mouse.up();
 await sample('pointer sets 50%',0.5);
 for(const w of [1000,800,1600]){await viewport(w);await sample('dragged 50% at '+w,0.5)}
 await viewport(1000);await page.reload();await sample('reload keeps 50%',0.5);
 await page.screenshot({path:out+'/narrow-50.png'});
 await page.click('button[aria-label="Hide panel"]');await page.waitForSelector('button[aria-label="Show panel"]');await viewport(1200);await page.click('button[aria-label="Show panel"]');await sample('hide resize reopen',0.5);
 await page.press('[role="separator"]','End');await sample('keyboard maximum',2/3);await viewport(900);await sample('maximum scales down',2/3);
 await page.press('[role="separator"]','Home');let m=await sample('keyboard minimum',1/3);check('ARIA bounds match fractions',Math.abs(m.min/m.frame-1/3)<0.001&&Math.abs(m.max/m.frame-2/3)<0.001);
 await page.press('[role="separator"]','ArrowLeft');await sample('keyboard grows 16px',1/3+16/m.frame);await page.press('[role="separator"]','ArrowRight');await sample('keyboard shrinks 16px',1/3);
 await page.dblclick('[role="separator"]');await sample('double click resets 40%',0.4);
 await viewport(1408);await seed({panelRatio:null,panelW:680,drafts:{primary:{text:'公开未发送草稿',quote:null,refs:[]}}});m=await sample('legacy pixel migration',0.5);check('migration clears legacy width and keeps draft',m.state.panelW===null&&m.state.panelRatio===0.5&&m.state.drafts.primary.text==='公开未发送草稿');
 await viewport(1000);await page.reload();await sample('legacy migrated ratio survives smaller reload',0.5);
 for(const value of ['broken',null]){await seed({panelRatio:value,panelW:null});await sample('invalid or absent ratio '+value,0.4)}
 await seed({panelRatio:-1,panelW:null});await sample('negative clamped',1/3);await seed({panelRatio:999,panelW:null});await sample('oversized clamped',2/3);
 await page.dblclick('[role="separator"]');await viewport(1000);await sample('final narrow default',0.4);await page.screenshot({path:out+'/narrow-default.png'});
 await viewport(1600);await sample('final wide default',0.4);await page.screenshot({path:out+'/wide-default.png'});
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Built production UI in Chromium; isolated synthetic HTTP, no installed-app verification',checks,measurements},null,2));
 console.log({pass:true,checks:checks.length,out});console.log(await page.snapshot());
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,measurements,error:String(e)},null,2));throw e}
await page.cdp('Emulation.clearDeviceMetricsOverride');await task.finish({keep:[]});
