// Build/start scripts/chat-width-fixture.mjs, then: ego-browser nodejs < scripts/chat-width-browser-e2e.mjs
// Failure cases: output/chat-width-20261105/FAILURE-CASES.md (recorded before implementation).
const task=await taskSpace('CyberMe 对话宽度验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/chat-width-20261105';
await fs.mkdir(out,{recursive:true});const checks=[],measurements=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{
 await page.goto('http://127.0.0.1:46778');await page.waitForSelector('[data-mid="long"]');
 for(const [width,ratio,theme] of [[1600,.4,'quiet'],[1000,.4,'quiet'],[800,2/3,'quiet'],[1400,.4,'night'],[1400,.4,'paper']]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await page.evaluate(p=>{const k='cyberme-v6-ui';localStorage.setItem(k,JSON.stringify({...JSON.parse(localStorage.getItem(k)||'{}'),...p}))},{panel:true,panelRatio:ratio,theme});
  await page.reload();await page.waitForSelector('[data-mid="long"]');
  await page.waitForFunction(()=>document.querySelector('.cm-scroll:has(> .cm-chat-column)').scrollTop>0);
  await page.evaluate(()=>{const s=document.querySelector('.cm-scroll:has(> .cm-chat-column)');s.dispatchEvent(new Event('wheel',{bubbles:true}));s.scrollTop=0});
  const m=await page.evaluate(()=>{
   const rect=s=>document.querySelector(s).getBoundingClientRect();const scroll=document.querySelector('.cm-scroll:has(> .cm-chat-column)'),col=rect('.cm-scroll:has(> .cm-chat-column) .cm-chat-column'),c=rect('.cm-composer-column'),b=rect('[data-mid="long"] [data-ai-text]'),md=rect('[data-mid="long"] .cm-md'),p=rect('[data-mid="long"] p'),short=rect('[data-mid="short"] [data-ai-text]'),q=rect('[data-mid="long"] button');
   return {left:scroll.getBoundingClientRect().width,column:col.width,composer:c.width,alignment:col.x-c.x,bubble:b.width,short:short.width,paddingLeft:md.x-b.x,paddingRight:b.right-md.right,paragraph:p.width,markdown:md.width,overflow:scroll.scrollWidth-scroll.clientWidth,quoteGap:q.x-b.right,quoteRight:q.right,leftRight:scroll.getBoundingClientRect().right,wrap:getComputedStyle(document.querySelector('[data-mid="long"] p')).textWrap};
  });measurements.push({width,ratio,theme,...m});
  check(theme+width+' aligned 80% columns',Math.abs(m.column/m.left-.8)<.001&&Math.abs(m.composer/m.left-.8)<.001&&Math.abs(m.alignment)<1);
  check(theme+width+' full text width and equal padding',Math.abs(m.paddingLeft-14)<1&&Math.abs(m.paddingRight-14)<1&&Math.abs(m.paragraph-m.markdown)<1&&m.wrap==='wrap');
  check(theme+width+' no clipping and quote gutter',m.overflow<1&&m.quoteGap>=5&&m.quoteRight<=m.leftRight&&m.short<m.bubble);
  await page.screenshot({path:out+'/'+theme+'-'+width+'.png'});
 }
 await page.click('button[aria-label="Hide panel"]');
 await page.waitForFunction(()=>{const s=document.querySelector('.cm-scroll:has(> .cm-chat-column)'),f=document.querySelector('[data-screen-label="CyberMe window"]');return Math.abs(s.clientWidth-f.clientWidth)<1});
 check('hidden panel keeps 80% width',await page.evaluate(()=>Math.abs(document.querySelector('.cm-composer-column').getBoundingClientRect().width/document.querySelector('.cm-scroll:has(> .cm-chat-column)').getBoundingClientRect().width-.8)<.001));
 await page.click('button[aria-label="Show panel"]');await page.waitForSelector('[role="separator"]');
 await page.press('[role="separator"]','ArrowLeft');
 await page.waitForFunction(()=>Math.abs(document.querySelector('.cm-composer-column').getBoundingClientRect().width/document.querySelector('.cm-scroll:has(> .cm-chat-column)').getBoundingClientRect().width-.8)<.001);
 check('resized panel keeps 80% width',true);
 await page.hover('[data-mid="short"]');await page.click('[data-mid="short"] button[aria-label="Quote reply"]');await page.waitForSelector('button[aria-label="Remove quote"]');
 await page.fill('textarea','公开未发送草稿');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').drafts?.primary?.text==='公开未发送草稿');
 await page.reload();await page.waitForSelector('button[aria-label="Remove quote"]');
 check('quote and unsent draft survive refresh',await page.evaluate(()=>document.querySelector('textarea').value==='公开未发送草稿'));
 check('Markdown and manual breaks preserved',await page.evaluate(()=>{const f=document.querySelector('[data-mid="format"] .cm-md');return !f.querySelector('p').querySelector('br')&&f.querySelectorAll('br').length===1&&f.querySelector('pre').textContent.includes('first line\nsecond line')&&f.querySelector('table')&&document.querySelector('[data-mid="long"] ol').children.length===2&&document.querySelector('[data-mid="user"] span').textContent.includes('\n')}));
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Built V6 with isolated synthetic HTTP in Chromium; installed app not updated',checks,measurements},null,2));console.log({pass:true,checks:checks.length,out});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,measurements,error:String(e)},null,2));throw e}
await page.cdp('Emulation.clearDeviceMetricsOverride');await task.finish({keep:[]});
