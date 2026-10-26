// Run with ego-browser nodejs; one TaskSpace per run. Real product pages, simulated native bridge.
const fs=await import('node:fs/promises');const out='/Users/steve/Projects/opstwin-advance/.local/window-controls-20261023';
const task=await taskSpace('CyberMe window controls 20261023'),p=task.page('p1'),checks=[];
const check=(name,pass,evidence)=>{checks.push({name,pass,evidence});if(!pass)throw Error(name)};
const reset=()=>p.evaluate(()=>{window.__chromeFixture.calls=[];window.__chromeFixture.position={x:100,y:100}});
const point=selector=>p.evaluate(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}},selector);
async function drag(at){await p.mouse.move(at.x,at.y);await p.mouse.down();await p.mouse.move(at.x+45,at.y+25);await p.mouse.up()}
async function moved(name,at){await reset();await drag(at);await p.waitForFunction(()=>window.__chromeFixture.calls.some(c=>c.name==='WindowChrome.Move'));const pos=await p.evaluate(()=>window.__chromeFixture.position);check(name,pos.x===145&&pos.y===125,pos)}
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false});await p.goto('http://127.0.0.1:46780/desktop.html');await p.waitForFunction(()=>!!window.OpsTwinsWindowChrome);await p.evaluate(()=>document.documentElement.classList.add('desktop-native'));
 for(const [page,selector] of [['任务','#view-tasks .tasks>h2'],['灵感','#view-ideas .ideas-heading']]){
  await p.click(`loc=css:button[aria-label="${page}"]`);await moved(page+' heading drag',await point(selector));
  const at=await point(selector);await moved(page+' top padding drag',{x:at.x,y:18});
 }
 await reset();await p.click('loc=css:button[aria-label="设置"]');await p.waitForSelector('#settings-window[open]');
 check('navigation button never drags',await p.evaluate(()=>window.__chromeFixture.calls.length===0));
 const bar=await point('#settings-window .settings-titlebar');await moved('settings titlebar drag',bar);
 const right=await p.evaluate(()=>{const r=document.querySelector('#settings-window').getBoundingClientRect();return {x:r.right-50,y:r.top+18}});await moved('settings top right drag',right);
 await reset();await p.click('#close-settings');check('settings close still works',await p.evaluate(()=>!document.querySelector('#settings-window').open&&window.__chromeFixture.calls.length===0));
 await p.click('loc=css:button[aria-label="任务"]');await reset();await p.click('text="新建任务"');await p.waitForSelector('#detail-dialog[open]');
 check('task control never drags',await p.evaluate(()=>window.__chromeFixture.calls.length===0));
 check('front task dialog closes first',await p.evaluate(()=>window.OpsTwinsWindowChrome.closeFrontSurface()&&!document.querySelector('#detail-dialog').open));
 await p.click('loc=css:button[aria-label="设置"]');
 check('cancel guard respected',await p.evaluate(()=>{const d=document.querySelector('#settings-window');d.addEventListener('cancel',e=>e.preventDefault(),{once:true});return window.OpsTwinsWindowChrome.closeFrontSurface()&&d.open}));
 check('settings then native window close routing',await p.evaluate(()=>window.OpsTwinsWindowChrome.closeFrontSurface()&&!document.querySelector('#settings-window').open&&!window.OpsTwinsWindowChrome.closeFrontSurface()));
 await reset();const at=await point('#view-tasks .tasks>h2');await p.dblclick('#view-tasks .tasks>h2');check('double click maximize',await p.evaluate(()=>window.__chromeFixture.calls.some(c=>c.name==='maximize')));
 await reset();await p.evaluate(()=>{const original=window.mygo.call;window.__positionReturned=false;window.mygo.call=async(...args)=>{if(args[0]==='WindowChrome.Position')await new Promise(r=>window.__releasePosition=r);const value=await original(...args);if(args[0]==='WindowChrome.Position')window.__positionReturned=true;return value};window.__originalWindowCall=original});
 await drag(at);await p.evaluate(()=>window.__releasePosition());await p.waitForFunction(()=>window.__positionReturned);check('released pointer rejects delayed origin',await p.evaluate(()=>!window.__chromeFixture.calls.some(c=>c.name==='WindowChrome.Move')));
 await p.evaluate(()=>window.mygo.call=window.__originalWindowCall);
 for(const width of [640,1000]){await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});await moved('task drag at width '+width,await point('#view-tasks .tasks>h2'))}
}finally{await fs.writeFile(out+'/browser-results.json',JSON.stringify({at:new Date().toISOString(),simulatedNativeBridge:true,checks},null,2));console.log(JSON.stringify(checks));await p.cdp('Emulation.clearDeviceMetricsOverride')}
