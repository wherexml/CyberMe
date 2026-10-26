// Run: ego-browser nodejs < scripts/mygo-window-chrome-browser-e2e.mjs
// Public 46300 preview; native title-bar actions require the actual App.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/window-chrome-1007';
await fs.mkdir(out,{recursive:true});const p=(await taskSpace(2)).page('p1'),checks=[];
const check=(name,pass,evidence)=>{checks.push({name,pass,evidence});if(!pass)throw Error(name)};
async function ready(){await p.waitForFunction(()=>!!document.querySelector('.desktop-session-resize'));await p.evaluate(()=>document.documentElement.classList.add('desktop-native'))}
async function width(){return p.evaluate(()=>document.querySelector('#session-panel').getBoundingClientRect().width)}
async function open(){if(await p.evaluate(()=>document.querySelector('#session-panel').hidden))await p.click('loc=css:#session-toggle')}
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false});
 await p.goto('http://127.0.0.1:46300/desktop.html');await ready();await open();
 const start=await width(),draft=await p.evaluate(()=>document.querySelector('#input').value);
 const geometry=await p.evaluate(()=>{const h=document.querySelector('.desktop-session-resize'),r=h.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+150,cursor:getComputedStyle(h).cursor,rail:document.querySelector('.muse-rail').getBoundingClientRect().width,region:getComputedStyle(document.querySelector('.session-chat-header')).getPropertyValue('--app-region').trim()}});
 check('native spacing and drag region',geometry.rail===96&&geometry.region==='no-drag',geometry);
 check('resize cursor',geometry.cursor==='col-resize',geometry.cursor);
 await p.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.x,y:geometry.y});
 await p.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:geometry.x,y:geometry.y,button:'left',clickCount:1});
 await p.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.x+80,y:geometry.y,button:'left',buttons:1});
 await p.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:geometry.x+80,y:geometry.y,button:'left',clickCount:1});
 const resized=await width();check('pointer drag changes width',resized===Math.min(start+80,480),{start,resized});
 check('drag preserves draft',await p.evaluate(()=>document.querySelector('#input').value)===draft);
 await p.screenshot({path:out+'/browser-resized.png'});
 await p.goto('http://127.0.0.1:46300/desktop.html');await ready();await open();check('reload restores width',await width()===resized);
 for(const viewport of [760,640]){await p.cdp('Emulation.setDeviceMetricsOverride',{width:viewport,height:500,deviceScaleFactor:1,mobile:false});await p.waitForFunction(()=>document.querySelector('.chat-column').getBoundingClientRect().width>=320);const r=await p.evaluate(()=>({panel:document.querySelector('#session-panel').getBoundingClientRect().width,chat:document.querySelector('.chat-column').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth}));check('narrow '+viewport,r.chat>=320&&!r.overflow,r);await p.screenshot({path:out+'/browser-'+viewport+'.png'})}
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false});await p.waitForFunction(w=>document.querySelector('#session-panel').getBoundingClientRect().width===w,resized);check('wide window restores preferred width',await width()===resized);
}finally{await p.cdp('Emulation.clearDeviceMetricsOverride');await fs.writeFile(out+'/browser-results.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks))}
