// Run after scripts/chat-time-groups-fixture.mjs: ego-browser nodejs < scripts/chat-time-groups-browser-e2e.mjs
// Failure cases recorded before implementation: output/chat-time-groups-20261106/FAILURE-CASES.md.
const task=await taskSpace('CyberMe 连续对话时间分组验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/chat-time-groups-20261106';
const checks=[],measurements=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{
 await page.goto('http://127.0.0.1:46787');await page.waitForSelector('[data-mid="reply"]');
 const expected=await page.evaluate(async()=>await(await fetch('/fixture/expected')).json());
 for(const [width,theme] of [[1400,'quiet'],[800,'quiet'],[800,'night'],[1400,'night']]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await page.evaluate(theme=>{const k='cyberme-v6-ui';localStorage.setItem(k,JSON.stringify({...JSON.parse(localStorage.getItem(k)||'{}'),theme}))},theme);await page.reload();await page.waitForSelector('[data-mid="reply"]');
  const m=await page.evaluate(()=>{const col=document.querySelector('.cm-scroll > .cm-chat-column'),c=col.getBoundingClientRect();return {ids:[...col.querySelectorAll('[data-msg-time]')].map(t=>t.closest('[data-mid]')?.dataset.mid),times:[...col.querySelectorAll('[data-msg-time]')].map(t=>{const r=t.getBoundingClientRect();return {text:t.textContent,center:Math.abs(r.x+r.width/2-c.x-c.width/2),overflow:t.scrollWidth-t.clientWidth}}),source:document.querySelector('[data-mid="source"] [data-source-time]')?.textContent,sourceSeparator:!!document.querySelector('[data-mid="source"] [data-msg-time]')}});
  measurements.push({width,theme,...m});
  check(`${theme} ${width}: exact separators, including 14:59/15:00 and midnight`,JSON.stringify(m.ids)===JSON.stringify(expected.separators));
  check(`${theme} ${width}: centered without overflow`,m.times.every(t=>t.center<1&&t.overflow<1));
  check(`${theme} ${width}: yesterday and today labels`,m.times[0].text.startsWith('昨天 ')&&m.times[1].text==='00:01');
  check(`${theme} ${width}: source metadata does not create group`,m.source?.startsWith('来源 ')&&!m.sourceSeparator);
  await page.evaluate(()=>{const s=document.querySelector('.cm-scroll:has(> .cm-chat-column)');s.dispatchEvent(new Event('wheel',{bubbles:true}));s.scrollTop=document.querySelector('[data-mid="user"]').offsetTop-120});
  await page.screenshot({path:out+`/browser-${theme}-${width}.png`});
 }
 await page.evaluate(()=>{const s=document.querySelector('.cm-scroll:has(> .cm-chat-column)');s.dispatchEvent(new Event('wheel',{bubbles:true}));s.scrollTop=0;s.dispatchEvent(new Event('scroll'))});await page.waitForSelector('[data-mid="older"]');
 check('pagination merges adjacent boundary without duplicate',await page.evaluate(ids=>JSON.stringify([...document.querySelectorAll('[data-msg-time]')].map(t=>t.closest('[data-mid]')?.dataset.mid))===JSON.stringify(ids),expected.afterPaging));
 await page.hover('[data-mid="reply"]');await page.click('[data-mid="reply"] button[aria-label="Quote reply"]');await page.waitForSelector('button[aria-label="Remove quote"]');await page.fill('textarea','公开未发送草稿');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').drafts?.primary?.text==='公开未发送草稿');await page.reload();await page.waitForSelector('button[aria-label="Remove quote"]');
 check('quote and draft preserved',await page.evaluate(()=>document.querySelector('textarea').value==='公开未发送草稿'));
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Actual V6 UI with isolated synthetic HTTP responses',checks,measurements},null,2));console.log({passed:checks.length});
 await page.cdp('Emulation.clearDeviceMetricsOverride');await task.finish({keep:[]});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,measurements,error:String(e)},null,2));throw e}
