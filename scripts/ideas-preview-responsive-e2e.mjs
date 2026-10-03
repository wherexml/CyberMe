// Replay: ego-browser nodejs < scripts/ideas-preview-responsive-e2e.mjs
// Read-only UI journey: does not execute/resume automations or modify records.
const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/responsive-preview-20261002';
await fs.mkdir(out,{recursive:true});
const task=await taskSpace('OpsTwin preview responsive regression'),page=task.page('p1');
const checks=[];
function assert(ok,name,detail){checks.push({name,status:ok?'PASS':'FAIL',detail});if(!ok)throw new Error(name)}
function geometry(){
 const box=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
 const card=document.querySelector('.op-idea-card');
 const row=document.querySelector('.op-result-row');
 return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,content:box('.app-content'),grid:box('.op-idea-grid'),columns:getComputedStyle(document.querySelector('.op-idea-grid')).gridTemplateColumns,card:box('.op-idea-card'),preview:box('.file-preview'),title:box('.op-result-row>span'),buttons:Array.from(row?.querySelectorAll('button')||[]).map(e=>e.getBoundingClientRect().toJSON()),cardScroll:card?.scrollWidth,cardClient:card?.clientWidth,previewScroll:document.querySelector('.preview-content')?.scrollWidth,previewClient:document.querySelector('.preview-content')?.clientWidth};
}
try{
 await page.goto('http://127.0.0.1:46100/ideas');await page.waitForSelector('.op-idea-card');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await page.click('.op-filters button:nth-child(2)');
 const fileLink='.op-idea-result a:not([download])';
 assert(await page.evaluate(()=>!!document.querySelector('.op-idea-result a:not([download])')),'Persisted automation has a real file');
 await page.click(fileLink);await page.waitForSelector('.preview-content .markdown');
 const filename=await page.evaluate(()=>document.querySelector('.file-preview header strong').textContent);
 for(const width of [1920,1675,1440,1280,1101,1100,1024,900,760,720,390]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=720});
  const g=await page.evaluate(geometry);
  assert(g.scrollWidth<=width,`${width}: page has no horizontal overflow`,g);
  assert(g.card.width>=Math.min(300,g.grid.width)-1,`${width}: readable card width`,{card:g.card.width,grid:g.grid.width,columns:g.columns});
  assert(g.title.width>=g.card.width-54,`${width}: result title gets full row`,{title:g.title,card:g.card});
  assert(g.buttons.every(b=>b.top>=g.title.bottom-1),`${width}: actions below result title`,g.buttons);
  assert(g.cardScroll<=g.cardClient+1&&g.previewScroll<=g.previewClient+1,`${width}: card and preview content fit`,g);
  assert(g.preview.right<=width+1,`${width}: preview fits viewport`,g.preview);
  if(width>1100)assert(g.content.right<=g.preview.left+1,`${width}: desktop panes do not overlap`,g);
  else assert(Math.abs(g.content.width-(width<=720?width:width-200))<1,`${width}: overlay preserves workspace width`,g);
  if([1675,1440,1101,1024,390].includes(width))await page.screenshot({path:out+`/after-${width}.png`});
 }
 await page.reload();await page.waitForSelector('.preview-content .markdown');
 assert(await page.evaluate(()=>document.querySelector('.file-preview header strong').textContent)===filename,'Preview survives refresh');
 await page.click('.file-preview header button');await page.waitForFunction(()=>!document.querySelector('.file-preview'));
 assert(await page.evaluate(()=>!document.body.classList.contains('file-preview-open')),'Close restores workspace');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await page.click('.op-filters button:nth-child(2)');await page.click(fileLink);await page.waitForSelector('.preview-content .markdown');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.file-preview'));
 assert(await page.evaluate(()=>document.activeElement?.matches('.op-idea-result a:not([download])')),'Escape closes preview and restores file link focus');
 await page.click('.op-filters button:first-child');
 const closed=await page.evaluate(()=>({columns:getComputedStyle(document.querySelector('.op-idea-grid')).gridTemplateColumns,cards:Array.from(document.querySelectorAll('.op-idea-card')).map(c=>c.getBoundingClientRect().width)}));
 assert(closed.cards.every(w=>w>=300),'Closed preview multi-card grid remains readable',closed);
 await page.screenshot({path:out+'/closed-1440.png'});
 await fs.writeFile(out+'/e2e.json',JSON.stringify({status:'PASS',taskSpaceId:task.spaceId,checks},null,2));
 await task.finish({keep:[]});console.log({status:'PASS',checks:checks.length,out});
}catch(error){await fs.writeFile(out+'/e2e.json',JSON.stringify({status:'FAIL',taskSpaceId:task.spaceId,error:String(error),checks},null,2));throw error}
