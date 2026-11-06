// Synthetic HTTP fixture: scripts/memory-library-fixture.mjs. Failure inventory: docs/public/memory-library.md.
const task=await taskSpace('CyberMe 记忆分类与编辑改进'),page=task.page('p1');console.log({spaceId:task.spaceId});
const fs=await import('node:fs/promises'),base='http://127.0.0.1:46870',out=process.cwd()+'/output/memory-refinement-20261106';await fs.mkdir(out,{recursive:true});const checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const control=async v=>{const r=await fetch(base+'/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});if(!r.ok)throw Error('control')};
const doc=async()=>await(await fetch(base+'/api/settings/documents/memory')).json();
const home=async()=>{await page.click('.mem-breadcrumb');await page.waitForSelector('.mem-overview')};
try{
 const original='使用中文沟通。\n\nAITV 主项目：/Users/public/Projects/demo；保留主仓与归档区别。\n\n我的设备是 MacBook。\n\n'+ '公开长笔记保留原文。'.repeat(300);
 await control({document:original,language:'zh-CN'});await page.goto(base);await page.waitForSelector('.mem-overview');
 check('ten topic folders plus people and automatic',await page.evaluate(()=>document.querySelectorAll('.mem-folder-grid .mem-folder').length===12));
 check('overview has no repeated notes or Agent link',await page.evaluate(()=>!document.querySelector('.mem-overview').textContent.includes('AITV')&&!document.querySelector('.mem-overview').textContent.includes('使用中文沟通')));
 await page.click('.mem-overview .mem-link');await page.waitForSelector('[data-memory-view="category:identity"]');check('profile opens identity category instead of SOUL',await page.evaluate(()=>!document.querySelector('[data-memory-view="soul"]')));await home();
 await page.click('[data-memory-folder="category:work"]');await page.waitForSelector('.mem-category-note');check('unheaded notes indexed by topic',await page.evaluate(()=>document.querySelector('.mem-category-note').textContent.includes('AITV')));await home();
 await page.click('[data-memory-folder="category:preference"]');check('language preference indexed independently',await page.evaluate(()=>document.querySelector('.mem-category-note').textContent.includes('使用中文沟通')));await home();
 check('browsing leaves original document byte-for-byte intact',(await doc()).content===original);
 await page.click('[data-memory-folder="category:learning"]');await page.click('.mem-category-detail .mem-settings-entry');await page.waitForSelector('.mem-editor-input');
 await page.fill('.mem-editor-input','## 学习与知识\n- 我长期阅读产品设计书籍。');await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('.mem-editor-input'));
 check('empty category creates real Markdown without replacing old notes',(await doc()).content.startsWith(original)&&(await doc()).content.includes('## 学习与知识\n- 我长期阅读产品设计书籍。'));await home();
 await page.click('[data-memory-folder="category:learning"]');check('saved category shows real content',await page.evaluate(()=>document.querySelector('.mem-category-note').textContent.includes('产品设计书籍')));await home();
 for(const theme of ['quiet','night']){
  await page.evaluate(theme=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,theme,tab:'memory'}))},theme);await page.reload();await page.waitForSelector('.mem-overview');
  await page.waitForFunction(()=>[...document.querySelectorAll('.mem-generated-artwork')].every(e=>e.complete&&e.naturalWidth>0));check(theme+' generated icons load',await page.evaluate(()=>document.querySelectorAll('.mem-generated-artwork').length===2));
  await page.screenshot({path:out+'/categories-'+theme+'.png'});
  await page.click('[data-memory-folder="section:-1"]');await page.click('[data-memory-page] .cm-row');await page.waitForSelector('.mem-editor-input');
  for(const [width,height] of [[1000,700],[1400,1000]]){
   await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await page.waitForFunction(()=>{const e=document.querySelector('.mem-editor'),s=e.closest('.cm-scroll');return e.getBoundingClientRect().bottom<=s.getBoundingClientRect().bottom});
   const geometry=await page.evaluate(()=>{const e=document.querySelector('.mem-editor'),t=e.querySelector('textarea'),s=e.closest('.cm-scroll'),buttons=[...e.querySelectorAll('button')],b=buttons.at(-1).getBoundingClientRect();return {height:t.clientHeight,internalScroll:t.scrollHeight>t.clientHeight,doneVisible:b.bottom<=s.getBoundingClientRect().bottom,overflow:e.scrollWidth>e.clientWidth+1}});
   check(theme+' '+width+' tall scrollable editor with visible Done',geometry.height>=300&&geometry.internalScroll&&geometry.doneVisible&&!geometry.overflow,geometry);
   await page.screenshot({path:out+'/editor-'+theme+'-'+width+'.png'});
  }
  await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('.mem-editor-input'));await home();
 }
 check('long original survives editing and resizing',(await doc()).content.startsWith(original));
 await control({language:'en'});await page.reload();await page.waitForFunction(()=>document.querySelector('[data-memory-folder="category:learning"]')?.textContent.includes('Learning'));check('English categories work',await page.evaluate(()=>document.querySelector('[data-memory-folder="category:device"]').textContent.includes('Devices')));
 console.log({passed:checks.length});
}finally{await fs.writeFile(out+'/refinement-checks.json',JSON.stringify({checks},null,2));}
