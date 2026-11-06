// Failure cases T1, T2, F4, V1, V2, V3: docs/public/attention-delivery.md. Source preview on synthetic data; not installed-app evidence.
// Fixture: node --import tsx scripts/attention-browser-fixture.mjs
// Run: ATTENTION_E2E_ARTIFACTS=<absolute path> ego-browser nodejs < scripts/attention-browser-e2e.mjs
const task=await taskSpace('CyberMe 注意力投递验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),out='/tmp/cyberme-attention-browser';
await fs.mkdir(out,{recursive:true});
const checks=[],check=(name,pass,evidence)=>{checks.push({name,pass:!!pass,...(evidence===undefined?{}:{evidence})});if(!pass)throw new Error(name+' '+JSON.stringify(evidence??null))};
const openSub=label=>page.click(`css=button:text-is("${label}")`);
try{
 await page.goto('http://127.0.0.1:46851');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='决策'));
 await openSub('决策');
 for(const width of [800,1400]){
  await page.cdp("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});
  await page.evaluate(()=>new Promise(resolve=>{let prev="",n=0;const tick=()=>{const r=document.querySelector("[data-mid]")?.getBoundingClientRect();const v=JSON.stringify(r);n=v===prev?n+1:0;prev=v;if(n>8)resolve();else requestAnimationFrame(tick)};tick()}));
  const m=await page.evaluate(()=>{const rows=[...document.querySelectorAll('[data-mid]')],times=rows.filter(r=>r.querySelector('[data-msg-time]')).length,dividers=[...document.querySelectorAll('[data-day-divider]')],first=dividers[0],next=first?.nextElementSibling,prevEl=dividers[1]?.previousElementSibling,meta=document.querySelector('[data-mid] [data-msg-time]'),bubble=meta?.previousElementSibling;const box=x=>x?.getBoundingClientRect();return {rows:rows.length,times,dividers:dividers.length,below:first&&next?box(next).top+6-box(first).bottom:null,above:dividers[1]&&prevEl?box(dividers[1]).top+6-box(prevEl).bottom:null,metaGap:meta&&bubble?box(meta).top-box(bubble).bottom:null,overflow:document.documentElement.scrollWidth>innerWidth}});
  check(`T1 every row has a time at ${width}`,m.rows>0&&m.times===m.rows,m);
  check(`T1 dividers only at a change of day at ${width}`,m.dividers>=1&&m.dividers<=3,m);
  check(`T2 spacing at ${width}`,m.metaGap!==null&&Math.abs(m.metaGap-4)<=1&&m.below!==null&&Math.abs(m.below-12)<=2,m);
  check(`T2 no overflow at ${width}`,!m.overflow,m);
  await page.screenshot({path:`${out}/chat-${width}.png`});
 }
 const body=await page.evaluate(()=>document.body.innerText);
 check('V3 listed strings renamed',!/待决定|稍后决定|暂无待决定|今天的决定|几次决定/.test(body)&&body.includes('决策'));
 check('urgent shows real actions under the message',await page.evaluate(()=>!!document.querySelector('[data-message-actions] [data-action="snooze"]')));
 check('digest is one bounded message',await page.evaluate(()=>document.querySelectorAll('[data-digest]').length===1));
 check('V1 sender table reads senderName',await page.evaluate(()=>{const c=document.querySelector('[data-item="urgent"]');return !!c&&c.innerText.includes('甲')&&c.innerText.includes('乙')}));
 check('time strip drawn from real message times',await page.evaluate(()=>!!document.querySelector('[data-item="urgent"] [data-time-strip]')));
 check('V2 one data point draws nothing',await page.evaluate(()=>{const c=document.querySelector('[data-item="single"]');return !!c&&!c.querySelector('[data-time-strip]')}));
 await page.screenshot({path:out+'/decisions.png'});
 await openSub('灵感');await page.waitForFunction(()=>!!document.querySelector('[data-idea="idea-old"]'));
 const when=await page.evaluate(()=>document.querySelector('[data-idea="idea-old"] [data-idea-when]').textContent);
 check('F4 card shows the old source time as well as the update',when.includes('来源')&&when.includes('更新'),when);
 check('F3 passed deadline makes no claim',await page.evaluate(()=>document.querySelector('[data-idea="idea-old"] [data-idea-deadline]').textContent==='已过期，结果未知'));
 check('inspirations hold no unresolved requests',await page.evaluate(()=>!document.querySelector('[data-item]')));
 await page.click('css=[data-idea="idea-old"] [data-action="dismiss"]');await page.waitForFunction(()=>!document.querySelector('[data-idea="idea-old"]'));
 check('ignore leaves no stub, with one undo notice',await page.evaluate(()=>document.querySelectorAll('[data-dismiss-ack]').length===1));
 await page.click('css=[data-dismiss-ack] button');await page.waitForFunction(()=>!!document.querySelector('[data-idea="idea-old"]'));
 await page.screenshot({path:out+'/inspirations.png'});
 await page.click('css=[data-idea="idea-old"] [data-idea-title]');await page.waitForFunction(()=>!!document.querySelector('[data-before-after]'));
 check('detail shows only grounded facts',await page.evaluate(()=>!!document.querySelector('[data-verified]')&&!!document.querySelector('[data-linked-task]')&&document.querySelector('[data-verified]').textContent.includes('来源未变化')));
 await page.screenshot({path:out+'/idea-detail.png'});await page.click('css=[aria-label="Back"]');
 await openSub('决策');await page.click('css=[data-item="urgent"] [data-dec-title]');await page.waitForFunction(()=>!!document.querySelector('[data-thread-timeline]'));
 check('thread timeline comes from exact dated messages',await page.evaluate(()=>{const t=document.querySelector('[data-thread-timeline]').innerText;return t.includes('请求')&&t.includes('后续')}));await page.click('css=[aria-label="Back"]');
 await page.click('css=[data-item="single"] [data-dec-title]');await page.waitForFunction(()=>!!document.querySelector('[data-delivery-strategy]'));check('V2 one message draws no timeline',await page.evaluate(()=>!document.querySelector('[data-thread-timeline]')));await page.click('css=[aria-label="Back"]');
 // An old local flag stays reversible and local: the record is untouched until the user decides.
 await page.evaluate(()=>{const key='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(key)||'{}');ui.gal={...ui.gal,'idea-old':true};localStorage.setItem(key,JSON.stringify(ui))});await page.reload();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='灵感'));await openSub('灵感');await page.waitForFunction(()=>!!document.querySelector('[data-handled="idea"]'));
 check('local flag hides the card without changing the record',await page.evaluate(async()=>!document.querySelector('[data-idea="idea-old"]')&&(await (await fetch('/api/ideas/idea-old')).json()).status==='new'));
 await page.click('css=[data-handled="idea"] button:text-is("已处理")');await page.click('css=[data-handled="idea"] button:text-is("恢复")');await page.waitForFunction(()=>!!document.querySelector('[data-idea="idea-old"]'));
 check('restoring clears only the local flag',await page.evaluate(async()=>(await (await fetch('/api/ideas/idea-old')).json()).status==='new'));
}finally{await fs.writeFile(out+'/browser.json',JSON.stringify({scope:'source preview, synthetic data',checks},null,2));console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length}))}
