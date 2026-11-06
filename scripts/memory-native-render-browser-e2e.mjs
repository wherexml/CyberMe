// Against exact installed assets copied to .local/memory-native-render-web by the native baseline gate.
// Isolated fixture: node --import tsx scripts/memory-native-render-fixture.mjs
const task=await taskSpace('CyberMe 原生绘制回归'),page=task.page('p1'),fs=await import('node:fs/promises');
const out=process.cwd()+'/output/memory-native-render-20261106',checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const home=async()=>{await page.click('.mem-breadcrumb');await page.waitForSelector('.mem-overview')};
try{
 await page.goto('http://127.0.0.1:46886');await page.waitForSelector('textarea');if(!await page.evaluate(()=>!!document.querySelector('[data-memory-page]')))await page.click('text="记忆"');await page.waitForSelector('.mem-overview');
 await page.click('[data-memory-folder="section:1"]');await page.waitForSelector('.cm-row');
 const paused=await page.evaluate(()=>{const p=document.querySelector('[data-memory-page]'),a=document.getAnimations().filter(a=>p.contains(a.effect?.target));for(const x of a){x.pause();x.currentTime=0}return a.map(x=>({name:x.animationName,opacity:getComputedStyle(x.effect.target).opacity}))});
 check('installed memory cards stay visible at suspended first frame',paused.length>=2&&paused.every(a=>Number(a.opacity)===1),paused);
 await page.screenshot({path:out+'/paused-memory-card.png'});
 await page.click('[data-memory-page] .cm-row');await page.waitForSelector('.mem-editor-input');
 const baseline=await page.evaluate(async()=>await(await fetch('/api/settings/documents/memory')).json());
 const long='## 工作\n- '+ '公开长文绘制验证，保存原文并确保底部操作始终可见。'.repeat(90);
 await page.fill('.mem-editor-input',long);
 for(const [width,height] of [[1000,700],[1400,1000]]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await page.waitForFunction(()=>{const e=document.querySelector('.mem-editor'),s=e.closest('.cm-scroll');return e.getBoundingClientRect().bottom<=s.getBoundingClientRect().bottom});
  const layout=await page.evaluate(()=>{const e=document.querySelector('.mem-editor'),t=e.querySelector('textarea'),s=e.closest('.cm-scroll'),b=e.querySelector('button');return {height:t.clientHeight,scrollable:t.scrollHeight>t.clientHeight,visible:getComputedStyle(e).opacity==='1',buttonVisible:b.getBoundingClientRect().bottom<=s.getBoundingClientRect().bottom}});
  check('installed editor fits '+width+'x'+height,layout.height>300&&layout.scrollable&&layout.visible&&layout.buttonVisible,layout);await page.screenshot({path:out+'/editor-'+width+'.png'});
 }
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('.mem-editor-input'));
 check('long text persists through real versioned HTTP',await page.evaluate(async text=>(await(await fetch('/api/settings/documents/memory')).json()).content.includes(text),long));
 await home();
 await page.click('[data-memory-folder="soul"]');await page.waitForSelector('.cm-row');
 const soul=await page.evaluate(()=>{const p=document.querySelector('[data-memory-page]'),a=document.getAnimations().filter(a=>p.contains(a.effect?.target));for(const x of a){x.pause();x.currentTime=0}return a.map(x=>getComputedStyle(x.effect.target).opacity)});
 check('Agent card also readable with paused animations',soul.length>0&&soul.every(x=>Number(x)===1));await home();
 for(const theme of ['quiet','night']){
  await page.evaluate(theme=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,theme,tab:'memory'}))},theme);await page.reload();await page.waitForSelector('.mem-overview');
  await page.click('[data-memory-folder="section:1"]');await page.click('.cm-row');await page.waitForSelector('.mem-editor-input');
  check('editor restores saved long content in '+theme,await page.evaluate(text=>document.querySelector('.mem-editor-input').value.includes(text),long));
  await page.screenshot({path:out+'/editor-'+theme+'.png'});await page.click('[data-memory-page] button:text-is("完成")');await home();
 }
 await page.evaluate(async content=>{await fetch('/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({document:content})})},baseline.content);
 console.log({passed:checks.length});
}finally{await fs.writeFile(out+'/browser-checks.json',JSON.stringify({scope:'exact installed assets, synthetic real HTTP',checks},null,2));}
