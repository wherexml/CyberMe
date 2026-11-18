// Build/start scripts/chat-top-fade-fixture.mjs, then ego-browser nodejs < this file.
// Pre-implementation failures: output/chat-top-fade-20261105/FAILURE-CASES.md.
const task=await taskSpace('CyberMe 顶部消息渐隐'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/chat-top-fade-20261105';
await fs.mkdir(out,{recursive:true});const checks=[],measurements=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
try{
 await page.goto('http://127.0.0.1:46776');await page.waitForSelector('.cm-chat-scroll [data-mid]');
 for(const theme of ['quiet','night'])for(const width of [1400,800]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:false});
  await page.evaluate(theme=>{const k='cyberme-v6-ui';localStorage.setItem(k,JSON.stringify({...JSON.parse(localStorage.getItem(k)||'{}'),theme,panel:true,panelRatio:.4,tab:'today'}))},theme);
  await page.reload();await page.waitForSelector('.cm-chat-scroll [data-mid]');
  await page.waitForFunction(()=>{const e=document.querySelector('.cm-chat-scroll');return e.scrollTop>0});
  await page.evaluate(()=>{const e=document.querySelector('.cm-chat-scroll');e.dispatchEvent(new Event('wheel',{bubbles:true}));e.scrollTop=0});await settle();
  const top=await page.evaluate(()=>{const e=document.querySelector('.cm-chat-scroll'),r=e.getBoundingClientRect(),m=e.querySelector('[data-mid]').getBoundingClientRect();return {gap:m.top-r.top,mask:getComputedStyle(e).maskImage,overflow:e.scrollWidth-e.clientWidth,headerMask:getComputedStyle(e.previousElementSibling).maskImage,composerMask:getComputedStyle(document.querySelector('textarea')).maskImage}});
  check(theme+width+' first message fully visible',top.gap>=96);check(theme+width+' gradient scoped without horizontal overflow',top.mask.includes('96px')&&top.overflow<=1&&top.headerMask==='none'&&top.composerMask==='none');
  await page.evaluate(()=>document.querySelector('.cm-chat-scroll').scrollTop=220);await settle();
  measurements.push({theme,width,...top,viewport:await page.evaluate(()=>{const r=document.querySelector('.cm-chat-scroll').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})});
  await page.screenshot({path:out+'/'+theme+'-'+width+'.png'});
  await page.evaluate(()=>{const e=document.querySelector('.cm-chat-scroll');e.scrollTop=e.scrollHeight});await settle();
  check(theme+width+' last message fully visible',await page.evaluate(()=>{const e=document.querySelector('.cm-chat-scroll'),r=e.getBoundingClientRect(),m=e.querySelector('[data-mid="fade-message-5"]').getBoundingClientRect();return m.bottom<=r.bottom&&m.top>=r.top+96}));
 }
 await page.cdp('Emulation.clearDeviceMetricsOverride');
 await page.evaluate(()=>document.querySelector('.cm-chat-scroll').scrollTop=220);await settle();
 const pos=await page.evaluate(()=>{const e=document.querySelector('.cm-chat-scroll'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+20,top:e.scrollTop}});
 await page.mouse.move(pos.x,pos.y);await page.mouse.wheel(0,160,{label:'检查顶部区域滚动'});
 await page.waitForFunction(t=>document.querySelector('.cm-chat-scroll').scrollTop>t,pos.top);check('real wheel works through fade',true);
 await page.evaluate(()=>document.querySelector('[data-mid="fade-message-4"] button').scrollIntoView({block:'center'}));
 await page.hover('[data-mid="fade-message-4"] > div');
 await page.click('[data-mid="fade-message-4"] button[aria-label="Quote reply"]');
 await page.waitForSelector('button[aria-label="Remove quote"]');check('quote remains interactive',true);
 await page.fill('textarea','公开未发送草稿');check('composer remains editable',await page.evaluate(()=>document.querySelector('textarea').value==='公开未发送草稿'));
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Built V6, isolated synthetic HTTP, Chromium only; installed app not updated',checks,measurements},null,2));
 console.log({pass:true,checks:checks.length,out});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,measurements,error:String(e)},null,2));throw e}
await page.cdp('Emulation.clearDeviceMetricsOverride');await task.finish({keep:[]});
