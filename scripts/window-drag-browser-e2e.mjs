// Run with ego-browser nodejs. Uses production MyGO JS bridge with recorded native messages.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/window-drag-20261107';
await fs.mkdir(out,{recursive:true});const t=await taskSpace('CyberMe 跨屏拖动验收'),p=t.page('p1'),checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const messages=()=>p.evaluate(()=>window.dragEvidence.filter(m=>m.t==='drag'||m.t==='dblclick'||m.m?.startsWith('WindowChrome.')||m.m==='mygo:window.ToggleMaximize'));
const reset=()=>p.evaluate(()=>{window.dragEvidence=[]});
try{
 await p.goto('http://127.0.0.1:46828/cyberme.html');await p.waitForSelector('textarea');
 check('one native chrome registration',await p.evaluate(()=>document.querySelectorAll('style[data-window-chrome]').length===1));
 const regions=await p.evaluate(()=>[...document.querySelectorAll('[data-drag-region]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x+110,y:r.y+10}}));
 for(const [i,r] of regions.entries()){
  await reset();await p.mouse.move(r.x,r.y);await p.mouse.down();await p.mouse.move(r.x+160,r.y+65);await p.mouse.up();const m=await messages();check('header '+i+' starts exactly one native drag',m.length===1&&m[0].t==='drag',m);
 }
 await reset();await p.mouse.click(regions[0].x,regions[0].y,{clickCount:2});const dbl=await messages();check('double-click has one native zoom and no extra JS toggle',dbl.filter(m=>m.t==='dblclick').length===1&&!dbl.some(m=>m.m),dbl);
 await reset();await p.click('button[aria-label="CyberMe"]');check('avatar button does not drag',!(await messages()).length);console.log(await p.snapshot());
 // Close the avatar popover with the same button, then exercise page remount and nested icons.
 await p.click('button[aria-label="CyberMe"]');await p.click('text="设置"');
 check('settings navigation works without dragging',await p.evaluate(()=>document.body.innerText.includes('通用'))&&!(await messages()).length);
 check('registration remains singular after React effect refresh',await p.evaluate(()=>document.querySelectorAll('style[data-window-chrome]').length===1));
 check('all nested header controls excluded',await p.evaluate(()=>[...document.querySelectorAll('[data-drag-region] button,[data-drag-region] button *')].every(e=>getComputedStyle(e).getPropertyValue('--app-region').trim()==='no-drag')));
 await reset();await p.fill('textarea','拖动后保留的公开草稿');check('composer input works without dragging',!(await messages()).length);
 const split=await p.evaluate(()=>{const r=document.querySelector('[role="separator"]').getBoundingClientRect();return {x:r.x+r.width/2,y:200,width:document.querySelector('[data-drag-region]').getBoundingClientRect().width}});
 await p.mouse.move(split.x,split.y);await p.mouse.down();await p.mouse.move(split.x-80,split.y);await p.mouse.up();
 const after=await p.evaluate(()=>document.querySelector('[data-drag-region]').getBoundingClientRect().width);
 check('panel splitter resizes without native drag',Math.abs(after-split.width)>50&&!(await messages()).length,{before:split.width,after});
 await reset();await p.mouse.move(110,10);await p.mouse.down();await p.mouse.move(400,60);await p.mouse.up();await p.mouse.move(500,120);
 check('release has no late coordinate writes',await p.evaluate(()=>!window.dragEvidence.some(m=>m.m?.startsWith('WindowChrome.'))));
 check('drag preserves composer draft',await p.evaluate(()=>document.querySelector('textarea').value==='拖动后保留的公开草稿'));
 await p.screenshot({path:out+'/browser.png'});
 await p.reload();await p.waitForSelector('textarea');check('reload retains native drag registration',await p.evaluate(()=>document.querySelectorAll('style[data-window-chrome]').length===1));
}finally{await fs.writeFile(out+'/browser.json',JSON.stringify({url:await p.url(),scope:'Production UI/API/MyGO bridge, synthetic data, native message sink only; not AppKit or physical display acceptance',checks},null,2));console.log(JSON.stringify({checks,out}));}
