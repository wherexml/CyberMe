// Prerequisite: ATTENTION_ASSETS=.local/chat-time-center-web node --import tsx scripts/attention-browser-fixture.mjs
// Run: ego-browser nodejs < scripts/chat-time-center-browser-e2e.mjs
// Failure cases recorded before implementation in output/chat-time-center-20261106/FAILURE-CASES.md.
const task=await taskSpace('CyberMe 消息时间居中验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/chat-time-center-20261106';
const checks=[],measurements=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{
 await page.goto('http://127.0.0.1:46851');await page.waitForSelector('[data-mid="same-1"]');
 for(const [width,theme] of [[1400,'quiet'],[800,'quiet'],[800,'night'],[1400,'night']]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await page.evaluate(theme=>{const k='cyberme-v6-ui';localStorage.setItem(k,JSON.stringify({...JSON.parse(localStorage.getItem(k)||'{}'),theme}))},theme);
  await page.reload();await page.waitForSelector('[data-mid="same-1"]');
  const m=await page.evaluate(()=>{const col=document.querySelector('.cm-scroll > .cm-chat-column'),c=col.getBoundingClientRect();return {columnWidth:c.width,dividers:document.querySelectorAll('[data-day-divider]').length,rows:[...col.querySelectorAll('[data-mid]')].map(r=>{const t=r.querySelector('[data-msg-time]'),b=t?.nextElementSibling,a=t?.getBoundingClientRect(),d=b?.getBoundingClientRect();return {id:r.dataset.mid,text:t?.textContent,first:t===r.firstElementChild,centerError:a?Math.abs(a.x+a.width/2-c.x-c.width/2):999,gap:a&&d?d.top-a.bottom:null,align:t&&getComputedStyle(t).textAlign,overflow:t?t.scrollWidth-t.clientWidth:999}})}});
  measurements.push({width,theme,...m});
  check(`${width} ${theme} all timestamps centered above messages`,m.rows.length>=3&&m.rows.every(r=>r.first&&r.centerError<1&&r.align==='center'&&Math.abs(r.gap-12)<1));
  check(`${width} ${theme} no duplicated divider or overflow`,m.dividers===0&&m.rows.every(r=>r.overflow<1));
  check(`${width} ${theme} same minute retains each time`,m.rows.find(r=>r.id==='same-1').text===m.rows.find(r=>r.id==='same-2').text);
  check(`${width} ${theme} source and delivery retained`,m.rows.some(r=>r.text.includes('来源')&&r.text.includes('推送')));
  await page.evaluate(()=>{const s=document.querySelector('.cm-scroll:has(> .cm-chat-column)');s.dispatchEvent(new Event('wheel',{bubbles:true}));s.scrollTop=0});
  await page.screenshot({path:out+`/browser-${theme}-${width}.png`});
 }
 await page.hover('[data-mid="same-2"]');await page.click('[data-mid="same-2"] button[aria-label="Quote reply"]');await page.waitForSelector('button[aria-label="Remove quote"]');
 await page.fill('textarea','公开未发送草稿');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').drafts?.main?.text==='公开未发送草稿');await page.reload();await page.waitForSelector('button[aria-label="Remove quote"]');
 check('quote and draft preserved',await page.evaluate(()=>document.querySelector('textarea').value==='公开未发送草稿'));
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Synthetic HTTP fixture in Chromium',checks,measurements},null,2));
 console.log({passed:checks.length});
 await page.cdp('Emulation.clearDeviceMetricsOverride');await task.finish({keep:[]});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,measurements,error:String(e)},null,2));throw e}
