// Replay: ego-browser nodejs < scripts/chat-preview-e2e.mjs (TaskSpace 45 must remain active).
const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/chat-preview-20261002';
const t=await taskSpace(45),p=t.page('p1');
const checks=[];function assert(ok,name,detail){checks.push({name,status:ok?'PASS':'FAIL',detail});if(!ok)throw new Error(name)}
try{
 await p.goto('http://127.0.0.1:46100/chat');
 await p.waitForSelector('.twin-entry');await p.evaluate(()=>localStorage.setItem('opsadv-twin-size',JSON.stringify({width:420,height:825})));await p.reload();
 await p.click('.twin-entry');
 const before=await p.evaluate(()=>document.querySelector('.floating-twin').getBoundingClientRect().toJSON());
 assert(before.x===16&&before.bottom>before.top,'Float anchored left',before);
 const handle=await p.evaluate(()=>document.querySelector('.twin-resize').getBoundingClientRect().toJSON());
 await p.mouse.move(handle.x+14,handle.y+14);await p.mouse.down();await p.mouse.move(handle.x+114,handle.y+114);await p.mouse.up();await p.waitForFunction(w=>document.querySelector('.floating-twin').getBoundingClientRect().width>w,before.width);
 const resized=await p.evaluate(()=>({box:document.querySelector('.floating-twin').getBoundingClientRect().toJSON(),saved:JSON.parse(localStorage.getItem('opsadv-twin-size'))}));
 assert(resized.box.width>before.width&&resized.box.height<before.height,'Pointer resize changes both dimensions',resized);
 await p.click('[aria-label="Close twin window"]');await p.reload();await p.click('.twin-entry');
 const restored=await p.evaluate(()=>document.querySelector('.floating-twin').getBoundingClientRect().toJSON());assert(Math.abs(restored.width-resized.box.width)<1&&Math.abs(restored.height-resized.box.height)<1,'Size survives refresh',restored);
 await p.screenshot({path:out+'/float-resized.png'});
 const link='.floating-twin a.copy[href="/files/artifact-a7403a61-ac3c-4d40-8e0d-796c9ac25cb2"]';await p.click(link);await p.waitForSelector('.preview-content .markdown');
 assert(await p.evaluate(()=>document.querySelector('.preview-content').textContent.includes('Acceptance marker')),'Float file preview uses actual content');
 await p.reload();await p.waitForSelector('.preview-content .markdown');assert(true,'Preview survives refresh');
 await p.click('[aria-label="Close file preview"]');await p.click('a.about-file[href="/files/artifact-79e787a0-221a-475e-9af1-1a885d53d75b"]');await p.waitForSelector('.preview-content iframe');await p.screenshot({path:out+'/pdf-preview.png'});assert(true,'PDF viewer displayed');await p.click('[aria-label="Close file preview"]');
 const response=await p.fetch('/api/bootstrap');const boot=JSON.parse(response.body);for(const mime of ['wordprocessingml','spreadsheetml','image/']){const a=boot.artifacts.find(a=>a.mime.includes(mime));if(!a){checks.push({name:mime,status:'NOT_RUN',detail:'No existing artifact'});continue}const r=await p.fetch('/api/artifacts/'+a.id+'/preview');assert(r.ok,'HTTP preview '+mime,{id:a.id,status:r.status});}
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await p.reload();await p.click('.mobile-bar [aria-label="Ask your twin"]');const mobile=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,box:document.querySelector('.floating-twin').getBoundingClientRect().toJSON()}));assert(mobile.scroll<=mobile.width&&mobile.box.right<=mobile.width,'Mobile viewport bounds',mobile);await p.screenshot({path:out+'/mobile-float.png'});await p.click('.floating-twin a.copy[href="/files/artifact-a7403a61-ac3c-4d40-8e0d-796c9ac25cb2"]');await p.waitForSelector('.preview-content .markdown');await p.screenshot({path:out+'/mobile-preview.png'});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile preview no overflow');await p.click('[aria-label="Close file preview"]');await p.cdp('Emulation.clearDeviceMetricsOverride');
}finally{await fs.writeFile(out+'/e2e.json',JSON.stringify(checks,null,2));console.log(checks)}
