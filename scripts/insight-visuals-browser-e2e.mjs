// Insight visuals + merged 洞察 feed. Source preview on synthetic data; not installed-app evidence.
// Fixture: node --import tsx scripts/insight-visuals-browser-fixture.mjs   (46933)
// Run:     ego-browser nodejs < scripts/insight-visuals-browser-e2e.mjs
const OUT=process.env.INSIGHT_VISUALS_EVIDENCE||process.cwd()+'/.local/insights-product-opus-20261106/evidence/browser';
const BASE='http://127.0.0.1:46933';
const fs=await import('node:fs/promises');await fs.mkdir(OUT,{recursive:true});
const task=await taskSpace(process.env.INSIGHT_VISUALS_TASK_SPACE?Number(process.env.INSIGHT_VISUALS_TASK_SPACE):'CyberMe 洞察视觉验收'),page=task.page('p1');
const checks=[];const check=(name,pass,evidence)=>{checks.push({name,pass:!!pass,...(evidence===undefined?{}:{evidence})});if(!pass)console.error('FAIL',name,JSON.stringify(evidence??null))};
const fx=(path,body)=>fetch(BASE+'/__fixture/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}).then(r=>r.json());
const size=(w,h=1000)=>page.cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
const card=id=>`[data-idea="${id}"]`;
try{
 await size(1400);
 await page.goto(BASE+'/');await page.waitForSelector('[data-insight-feed]',{timeout:20000});
 await page.waitForFunction(()=>document.querySelectorAll('[data-insight-visual]').length>=5,undefined,{timeout:20000});
 // U1 merged feed, no sub-tabs or topic filter wall
 const feed=await page.evaluate(()=>{const btn=[...document.querySelectorAll('button')].map(b=>b.textContent.trim());return {label:document.querySelector('[data-feed-label]')?.textContent,subTabs:btn.filter(t=>t==='决策'||t==='灵感').length,allFilter:btn.filter(t=>t==='全部').length,relations:[...document.querySelectorAll('[data-insight-visual]')].map(x=>x.dataset.insightVisual).sort(),decision:!!document.querySelector('[data-item="req-1"]'),plain:document.querySelector('[data-idea="idea-plain"] [data-idea-body]')?.dataset.ideaBody}});
 check('U1 one 洞察 feed: no 决策/灵感 sub-tabs, no topic filter wall',feed.label==='洞察'&&feed.subTabs===0&&feed.allFilter===0,feed);
 check('decision card keeps its place in the merged feed',feed.decision,feed);
 check('five generated relations render with generic components',JSON.stringify(feed.relations)===JSON.stringify(['annotated-document','before-after','comparison','dependencies','mapping']),feed.relations);
 check('V17 no evidence: saved text shown, no visual',feed.plain==='text');
 const originals=await page.evaluate(()=>[...document.querySelectorAll('[data-idea-title]')].map(e=>e.textContent));check('saved titles stay intact when model headers differ',originals.some(t=>t.startsWith('样例比较：'))&&originals.some(t=>t.startsWith('样例映射：')),originals);
 const clamp=await page.evaluate(()=>{const s=document.querySelector('[data-idea="idea-0"] [data-idea-body]');return{lines:getComputedStyle(s).webkitLineClamp,text:s.textContent}});
 await page.click(`${card('idea-0')} [data-idea-body]`,{label:'open full original from clamped summary'});await page.waitForSelector('button[aria-label="Back"]',{timeout:10000});
 const fullOriginal=await page.evaluate(()=>[...document.querySelectorAll('.cm-md')].some(e=>e.textContent.includes('值班人没有写明')));check('graph summary clamps to 3 lines and opens complete original',clamp.lines==='3'&&fullOriginal,clamp);
 await page.click('button[aria-label="Back"]',{label:'return to insights'});await page.waitForSelector(card('idea-0'),{timeout:10000});
 // V8 unknown cells never merged; datum semantics visible
 const sem=await page.evaluate(()=>{const cmp=document.querySelector('[data-insight-visual="comparison"]');return {same:cmp.querySelectorAll('.iv-same').length,unknown:cmp.querySelectorAll('[data-status="not-provided"]').length,missingSummary:cmp.querySelector('[data-missing]')?.textContent,claimTags:[...cmp.querySelectorAll('.iv-d-claim .iv-tag')].map(t=>t.textContent),qual:[...cmp.querySelectorAll('.iv-qual')].map(t=>t.textContent),ticks:[...document.querySelectorAll('td[data-state]')].map(t=>t.dataset.state+':'+t.textContent),proposals:document.querySelectorAll('[data-status="proposal"]').length}});
 check('V8 unknown-only row becomes named missing summary, never 相同',sem.same===0&&sem.unknown===0&&sem.missingSummary?.includes('值班人'),sem);
 check('claims and qualifiers render beside their values',sem.claimTags.includes('转述')&&sem.qual.includes('最晚'),sem);
 check('matrix ✓ only where evidence states it; unknown shows 未提供',sem.ticks.some(t=>t.startsWith('confirmed:✓'))&&sem.ticks.some(t=>t.startsWith('not-provided:')),sem.ticks);
 await page.screenshot({path:OUT+'/feed-1400.png',fullPage:true});
 // R2 async: pending -> ready without reload
 await page.evaluate(()=>{window.__noReload=1});
 const before=await page.evaluate(()=>document.querySelector('[data-idea="idea-5"] [data-idea-body]')?.dataset.ideaBody);
 await fx('generate',{ids:['idea-5'],hold:'样例等待'});
 for(let i=0;i<50&&!(await fx('state')).held;i++)await new Promise(r=>setTimeout(r,100));
 const mid=await page.evaluate(()=>document.querySelector('[data-idea="idea-5"] [data-idea-body]')?.dataset.ideaBody);
 await fx('release',{});
 await page.waitForFunction(()=>document.querySelector('[data-idea="idea-5"] [data-insight-visual]'),undefined,{timeout:40000});
 const noReload=await page.evaluate(()=>window.__noReload===1);
 check('R2 pending card shows saved text, then the visual appears without reload',before==='text'&&mid==='text'&&noReload,{before,mid,noReload});
 // R2 revoke while a GET is in flight: no old visual frame afterwards
 await fx('slow',{ms:3000});await fx('connection',{status:'disconnected'});
 const samples=[];const t0=Date.now();let gone=false;
 while(Date.now()-t0<25000){const n=await page.evaluate(()=>document.querySelectorAll('[data-insight-visual]').length);samples.push(n);if(n===0)gone=true;else if(gone){break}await new Promise(r=>setTimeout(r,150))}
 await new Promise(r=>setTimeout(r,3500));const after=await page.evaluate(()=>document.querySelectorAll('[data-insight-visual]').length);
 check('R2/V11 revoked source: visuals cleared and never flash back from the in-flight GET',gone&&after===0&&!samples.slice(samples.indexOf(0)).some(n=>n>0),{after,tail:samples.slice(-8)});
 await fx('slow',{ms:0});await fx('connection',{status:'connected'});
 await page.waitForFunction(()=>document.querySelectorAll('[data-insight-visual]').length>=6,undefined,{timeout:30000});
 check('restored connection: visuals return',true);
 // U3 narrow + themes, no horizontal overflow
 // V6 is a desktop split view; the panel ratio is clamped to 1/3–2/3, so the narrowest real panel is 1/3 of the window.
 for(const [w,theme,ratio] of [[800,'quiet',1/3],[1100,'night',1/3],[1400,'quiet',0.4]]){
  await size(w,900);await page.evaluate(([t,r])=>{const k='cyberme-v6-ui';const ui=JSON.parse(localStorage.getItem(k)||'{}');ui.theme=t;ui.panelRatio=r;ui.panelW=null;localStorage.setItem(k,JSON.stringify(ui))},[theme,ratio]);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-insight-visual]').length>=6,undefined,{timeout:20000});
  const o=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,boxes:[...document.querySelectorAll('.iv-root,.iv-root *')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='hidden'&&!['mark','sup','svg','path'].includes(e.tagName.toLowerCase())).map(e=>e.className&&String(e.className).split(' ')[0]).slice(0,8),deps:(()=>{const d=document.querySelector('.iv-deps');if(!d)return null;const r=d.getBoundingClientRect();return [...d.querySelectorAll('.iv-dep-node')].every(n=>{const x=n.getBoundingClientRect();return x.left>=r.left-1&&x.right<=r.right+1})})()}));
  o.panel=await page.evaluate(()=>Math.round(document.querySelector('[data-insight-feed]').getBoundingClientRect().width));
  check(`U3 no overflow at ${w}px window, panel ${o.panel}px (${theme})`,!o.page&&!o.boxes.length&&o.deps!==false,o);
  await page.screenshot({path:`${OUT}/feed-${w}-${theme}.png`,fullPage:true});
 }
 await size(1400);await page.evaluate(()=>{const k='cyberme-v6-ui';const ui=JSON.parse(localStorage.getItem(k)||'{}');ui.theme='quiet';ui.panelRatio=0.4;localStorage.setItem(k,JSON.stringify(ui))});await page.reload();
 await page.waitForSelector(card('idea-0'),{timeout:20000});
 // persistent ignore + undo + handled history for an insight
 await page.click(`${card('idea-plain')} [data-action="dismiss"]`,{label:'dismiss plain insight'});
 await page.waitForFunction(()=>!document.querySelector('[data-idea="idea-plain"]'),undefined,{timeout:15000});
 await page.waitForSelector('[data-dismiss-ack]',{timeout:10000});
 await page.reload();await page.waitForSelector(card('idea-0'),{timeout:20000});
 const persisted=await page.evaluate(()=>!document.querySelector('[data-idea="idea-plain"]'));
 await page.click('css=[data-handled="idea"] button',{label:'open handled list'});
 await page.click('text=没有证据的建议 >> nth=0').catch(()=>{});
 const handled=await page.evaluate(()=>[...document.querySelectorAll('[data-handled="idea"] span')].some(s=>s.textContent==='没有证据的建议'));
 await page.evaluate(()=>{const row=[...document.querySelectorAll('[data-handled="idea"] div')].find(d=>d.textContent.includes('没有证据的建议'));[...row.querySelectorAll('button')].find(b=>/恢复|Bring back/.test(b.textContent))?.click()});
 await page.waitForSelector(card('idea-plain'),{timeout:15000});
 check('ignore persists across reload, appears under 已处理, and can be restored',persisted&&handled,{persisted,handled});
 // The timed snooze survives reload and is explicitly reversible from handled history.
 await page.waitForFunction(()=>{const b=document.querySelector('[data-idea="idea-plain"] [data-action="snooze"]');return b&&!b.disabled},undefined,{timeout:10000});
 await page.evaluate(()=>document.querySelector('[data-idea="idea-plain"] [data-action="snooze"]').scrollIntoView({block:'center'}));
 await page.click(`${card('idea-plain')} [data-action="snooze"]`,{label:'snooze until tomorrow'});
 await page.waitForFunction(()=>!document.querySelector('[data-idea="idea-plain"]'),undefined,{timeout:15000});await page.reload();await page.waitForSelector(card('idea-0'),{timeout:20000});
 const snoozed=await page.evaluate(()=>!document.querySelector('[data-idea="idea-plain"]'));
 await page.click('css=[data-handled="idea"] button',{label:'open snoozed history'});
 await page.evaluate(()=>{const row=[...document.querySelectorAll('[data-handled="idea"] div')].find(d=>d.textContent.includes('没有证据的建议'));[...row.querySelectorAll('button')].find(b=>/恢复|Bring back/.test(b.textContent))?.click()});
 await page.waitForSelector(card('idea-plain'),{timeout:15000});check('tomorrow snooze persists across reload and restores from handled',snoozed);
 // U2 decided request: one compact line with status, undo and dismiss; no "why" survey
 await page.evaluate(()=>{const k='cyberme-v6-ui';const ui=JSON.parse(localStorage.getItem(k)||'{}');ui.brief={...(ui.brief||{}),'req-1':{pick:{index:0,label:'先回复确认'}}};localStorage.setItem(k,JSON.stringify(ui))});
 await page.reload();await page.waitForSelector('[data-decided-item]',{timeout:20000});
 const dec=await page.evaluate(()=>{const d=document.querySelector('[data-decided-item]');const feed=[...document.querySelector('[data-insight-feed]').children];return {text:d.textContent,survey:/为什么|最重要|最省事|风险最低/.test(document.body.textContent),last:feed.indexOf(document.querySelector('[data-decided]'))>feed.indexOf(document.querySelector('[data-idea="idea-0"]')),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent)}});
 check('U2 decided request is one compact line after active items, no survey, never shown as done',!dec.survey&&dec.last&&dec.buttons.includes('撤销')&&dec.buttons.includes('忽略')&&!/已完成/.test(dec.text),dec);
 await page.screenshot({path:OUT+'/decided.png',fullPage:true});
 await page.click('css=[data-decided-item] button:text-is("撤销")',{label:'undo decided pick'});
 await page.waitForFunction(()=>!document.querySelector('[data-decided-item]'),undefined,{timeout:10000});
 check('undo returns the request to the active list',await page.evaluate(()=>!!document.querySelector('[data-item="req-1"]')));
}catch(e){checks.push({name:'harness error',pass:false,evidence:String(e?.stack||e).slice(0,800)})}
const summary={at:new Date().toISOString(),kind:'synthetic browser (ego-browser Chromium, source preview build)',taskSpace:task.spaceId,passed:checks.filter(c=>c.pass).length,total:checks.length,checks};
await fs.writeFile(OUT+'/browser-e2e.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({passed:summary.passed,total:summary.total,failed:checks.filter(c=>!c.pass)},null,1));
