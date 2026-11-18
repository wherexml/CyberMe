// Footer revision of the V6 Mock: 刷新洞察 · 忽略与推迟 at the end of the feed, inline history below it.
// Run after node scripts/build-insight-mock-revision.mjs, with both preview services running.
// ego-browser nodejs < scripts/insight-footer-mock-browser-e2e.mjs
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/CyberMe',out=root+'/output/insight-footer-mock-20261111/'+Date.now();await fs.mkdir(out,{recursive:true});
const t=await taskSpace(9),p=t.page('p1'),checks=[];
const revision='http://127.0.0.1:46781/insights-current.html?v=20261111-footer',common='http://127.0.0.1:46781/v6.1-concept.html?original-v6&v=20261111-footer',catalog='http://127.0.0.1:46400/#overview';
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail?{detail}:{})});if(!pass)throw Error(name)};
// Native physical clicks with a longer auto-scroll budget for distant feed targets; no force or DOM fallback.
const click=sel=>p.click(sel,{timeout:15000});
const shot=name=>p.screenshot({path:out+'/'+name+'.png'});
const until=(...args)=>p.waitForFunction(...args);
const ev=(...args)=>p.evaluate(...args),sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Simulation controls live in the preview bar outside the product window.
const sim=(group,opt)=>ev(([g,o])=>{const span=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()===g&&s.nextElementSibling&&[...s.nextElementSibling.querySelectorAll('button')].some(b=>b.textContent.trim()===o));[...span.nextElementSibling.querySelectorAll('button')].find(b=>b.textContent.trim()===o).click()},[group,opt]);
const footerTop=()=>ev(()=>document.querySelector('[data-mock-footer]').getBoundingClientRect().top);
// Footer position in content coordinates plus the panel's post-layout scroll limits.
const anchor=()=>ev(()=>{const sc=document.querySelector('[data-mock-panel-scroll]'),pt=sc.getBoundingClientRect().top,top=document.querySelector('[data-mock-footer]').getBoundingClientRect().top;return {top,panelTop:pt,scroll:sc.scrollTop,max:sc.scrollHeight-sc.clientHeight,offset:top-pt+sc.scrollTop}});
const toView=()=>ev(()=>document.querySelector('[data-mock-footer]').scrollIntoView({block:'center'}));
const openList=async()=>{await toView();if(!await ev(()=>!!document.querySelector('[data-mock-history]'))){await click('[data-mock-history-toggle]');await p.waitForSelector('[data-mock-history]')}};
const rowKeys=()=>ev(()=>[...document.querySelectorAll('[data-mock-history-row]')].map(r=>r.getAttribute('data-mock-history-row')));
const rowText=key=>ev(k=>document.querySelector(`[data-mock-history-row="${k}"]`)?.innerText||'',key);
const inFeed=key=>ev(k=>!!document.querySelector(`[data-mock-decision="${k}"],[data-mock-idea="${k}"]`),key);
const feedKeys=()=>ev(()=>[...document.querySelectorAll('[data-mock-decision],[data-mock-idea]')].map(n=>n.getAttribute('data-mock-decision')||n.getAttribute('data-mock-idea')).sort().join(','));
const composer=()=>ev(()=>({draft:document.querySelector('textarea').value,quote:!!document.querySelector('[aria-label="Remove quote"]')}));
const tasks=()=>ev(()=>window.__cm.get().tasks.length);
const metrics=()=>{
 const title=[...document.querySelectorAll('div')].find(n=>n.textContent==='三位续约联系人都没回音，谁来跟进？');
 const card=title.parentElement.parentElement.parentElement,cs=getComputedStyle(card),ts=getComputedStyle(title),wr=document.querySelector('[data-screen-label="CyberMe window"]').getBoundingClientRect();
 const ta=document.querySelector('textarea'),tr=ta.getBoundingClientRect();
 return {title:{font:ts.fontSize,weight:ts.fontWeight,line:ts.lineHeight},card:{radius:cs.borderRadius,width:Math.round(card.getBoundingClientRect().width)},window:{width:Math.round(wr.width),height:Math.round(wr.height)},composer:{width:Math.round(tr.width),font:getComputedStyle(ta).fontSize},mascot:Math.round(document.querySelector('[aria-label="CyberMe"]').getBoundingClientRect().width)};
};
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await p.goto('http://127.0.0.1:46781/v6-baseline-20261111.html');await p.waitForSelector('[aria-label="CyberMe"]');
 await click('text="中文"');await until(()=>document.body.innerText.includes('三位续约联系人都没回音'));
 const baseline=await ev(metrics);
 await p.goto(revision);await p.reload();await p.waitForSelector('[data-mock-footer]');
 check('V6 window, card, type, mascot and composer dimensions match the frozen baseline',JSON.stringify(baseline)===JSON.stringify(await ev(metrics)),{baseline});
 // Layout
 check('single quiet footer row with two entries, no header menu or old labels',await ev(()=>{const f=document.querySelectorAll('[data-mock-footer]'),el=f[0],scroll=document.querySelector('[data-mock-panel-scroll]');const txt=el.innerText.replace(/\s+/g,'');
  return f.length===1&&txt==='刷新洞察·忽略与推迟'&&!/\d/.test(txt)&&!document.querySelector('[data-mock-insight-menu],[role="menu"],[data-mock-menu-host]')&&!/再找找|已处理|洞察操作/.test(scroll.innerText)&&document.querySelector('[data-mock-history-toggle]').getAttribute('aria-expanded')==='false'}));
 check('footer sits after the last feed card and is centred',await ev(()=>{const f=document.querySelector('[data-mock-footer]').getBoundingClientRect(),cards=[...document.querySelectorAll('[data-mock-decision],[data-mock-idea]')],last=Math.max(...cards.map(c=>c.getBoundingClientRect().bottom));
  const row=document.querySelector('[data-mock-refresh]').parentElement.getBoundingClientRect(),s=document.querySelector('[data-mock-panel-scroll]').getBoundingClientRect();return f.top>=last&&Math.abs((row.left+row.right)/2-(s.left+s.right)/2)<=4}));
 check('expired snooze is back in the feed; active hidden records are not',await inFeed('idea:g4')&&!(await inFeed('decision:d2'))&&!(await inFeed('idea:g6'))&&!(await inFeed('idea:g3'))&&!(await inFeed('idea:g5')));
 await click('[data-mock-discuss="decision:d3"]');await until(()=>document.querySelector('textarea').value.includes('三位续约联系人'));
 const draft=await composer(),taskCount=await tasks();
 await toView();await shot('01-footer');
 // Inline mixed history
 const panelBefore=await ev(()=>document.querySelector('[data-mock-panel-scroll]').scrollTop),chatBefore=await ev(()=>document.querySelector('.cm-chat-fade').scrollTop);
 await click('[data-mock-history-toggle]');await p.waitForSelector('[data-mock-history]');
 const reveal=await ev(()=>{const sc=document.querySelector('[data-mock-panel-scroll]'),s=sc.getBoundingClientRect(),r=document.querySelector('[data-mock-history-row]').getBoundingClientRect();return {scrollTop:sc.scrollTop,rowTop:r.top,rowBottom:r.bottom,panelTop:s.top,panelBottom:s.bottom}});
 const moved=reveal.scrollTop-panelBefore,needed=Math.max(0,reveal.rowBottom+moved-reveal.panelBottom);
 check('history expands inline and reveals the first complete row',reveal.rowTop>=reveal.panelTop&&reveal.rowBottom<=reveal.panelBottom&&await ev(()=>{const f=document.querySelector('[data-mock-footer]');return f.contains(document.querySelector('[data-mock-history]'))&&document.querySelector('[data-mock-history-toggle]').getAttribute('aria-expanded')==='true'&&document.querySelectorAll('[data-mock-decision]').length>0}),reveal);
 check('reveal uses only the minimum right-panel scroll; chat does not move',moved>=0&&moved<=needed+12&&await ev(()=>document.querySelector('.cm-chat-fade').scrollTop)===chatBefore,{moved,needed});
 check('rows ordered snoozed by stored until, then ignored, then local-only',JSON.stringify(await rowKeys())===JSON.stringify(['decision:d2','idea:g6','idea:g3','idea:g5']),{keys:await rowKeys()});
 check('rows show stored times and distinct states, never completion or a fixed tomorrow',(await rowText('decision:d2')).includes('推迟到 11月12日 09:00')&&(await rowText('idea:g6')).includes('推迟到 11月14日 08:30')&&(await rowText('idea:g3')).includes('已忽略')&&(await rowText('idea:g5')).includes('仅本机隐藏')
  &&await ev(()=>{const h=document.querySelector('[data-mock-history]');const st=[...h.querySelectorAll('[data-mock-row-status]')];return st.length===4&&st.every(n=>!/完成|已处理|明天/.test(n.innerText))&&!!h.querySelector('[data-mock-ignore-local="idea:g5"]')&&h.querySelectorAll('[data-mock-ignore-local]').length===1}));
 check('opening history keeps draft and reference',JSON.stringify(await composer())===JSON.stringify(draft));
 await shot('02-history-open');
 // Per-row failure, conflict and busy isolation
 await sim('恢复','失败');await click('[data-mock-restore="idea:g3"]');
 check('restoring row is busy alone; other rows stay usable',await ev(()=>{const r=document.querySelector('[data-mock-history-row="idea:g3"]');return r.getAttribute('aria-busy')==='true'&&r.querySelector('[data-mock-restore]').disabled&&r.innerText.includes('恢复中')&&!document.querySelector('[data-mock-restore="decision:d2"]').disabled&&!document.querySelector('[data-mock-refresh]').disabled}));
 await until(()=>document.querySelector('[data-mock-history-row="idea:g3"] [data-mock-row-note]')?.innerText.includes('未能恢复'));
 check('failed restore keeps its row and the card stays hidden',!!(await rowKeys()).includes('idea:g3')&&!(await inFeed('idea:g3')));
 await sim('恢复','冲突');await click('[data-mock-restore="decision:d2"]');
 await until(()=>document.querySelector('[data-mock-history-row="decision:d2"] [data-mock-row-note]')?.innerText.includes('已有更新，未恢复'));
 check('conflict keeps the row with its own message; other errors untouched',(await rowText('idea:g3')).includes('未能恢复')&&!(await inFeed('decision:d2')));
 await sim('恢复','失败');await click('[data-mock-ignore-local="idea:g5"]');
 await until(()=>document.querySelector('[data-mock-history-row="idea:g5"] [data-mock-row-note]')?.innerText.includes('未能忽略'));
 check('failed ignore leaves a local-only row local',await ev(()=>document.querySelector('[data-mock-history-row="idea:g5"]').getAttribute('data-state')==='local'));
 await shot('03-row-errors');
 // Successful concurrent restores, double click, viewport anchor
 await sim('恢复','成功');const before=await anchor();
 await ev(()=>{const b=document.querySelector('[data-mock-restore="idea:g6"]');b.click();b.click();document.querySelector('[data-mock-restore="idea:g3"]').click()});
 check('two different rows restore concurrently',await ev(()=>['idea:g6','idea:g3'].every(k=>document.querySelector(`[data-mock-history-row="${k}"]`).getAttribute('aria-busy')==='true')));
 await until(()=>!document.querySelector('[data-mock-history-row="idea:g6"]')&&!document.querySelector('[data-mock-history-row="idea:g3"]'));
 check('restored cards return once, without creating work',await inFeed('idea:g6')&&await inFeed('idea:g3')&&await ev(()=>document.querySelectorAll('[data-mock-idea="idea:g6"]').length===1)&&await tasks()===taskCount);
 const after=await anchor(),target=before.scroll+(after.offset-before.offset),attainable=Math.min(Math.max(target,0),after.max),expected=after.panelTop+after.offset-attainable;
 // Keep the footer where it was; when the shortened list makes that scroll unreachable, the nearest attainable position is the clamped one.
 check('viewport keeps the footer anchor, or its nearest attainable position at the scroll limit',Math.abs(after.top-expected)<=2&&Math.abs(after.scroll-attainable)<=2,{before,after,target,attainable,expected});
 await click('[data-mock-restore="idea:g5"]');
 await until(()=>!document.querySelector('[data-mock-history-row="idea:g5"]'));
 check('local-only restore is immediate and local; list stays open with focus on its toggle',await inFeed('idea:g5')&&await ev(()=>!!document.querySelector('[data-mock-history]')&&document.activeElement.hasAttribute('data-mock-history-toggle')));
 await click('[data-mock-restore="decision:d2"]');await until(()=>!document.querySelector('[data-mock-history-row="decision:d2"]'));
 check('last restore collapses the list, hides its entry and focuses refresh',await ev(()=>!document.querySelector('[data-mock-history]')&&!document.querySelector('[data-mock-history-toggle]')&&document.activeElement.hasAttribute('data-mock-refresh'))&&await inFeed('decision:d2'));
 check('draft and reference survive restores',JSON.stringify(await composer())===JSON.stringify(draft));
 await shot('04-all-restored');
 // New snooze / ignore from cards
 await click('[data-mock-snooze="decision:d3"]');await click('[data-mock-ignore="idea:g1"]');await openList();
 check('card snooze and ignore enter the same list with stored time and state',JSON.stringify(await rowKeys())===JSON.stringify(['decision:d3','idea:g1'])&&(await rowText('decision:d3')).includes('推迟到 11月12日 09:00')&&(await rowText('idea:g1')).includes('已忽略'));
 // Refresh states
 const ids=await feedKeys();
 await sim('刷新','无变化');await click('[data-mock-refresh]');
 check('refresh runs once with inline busy state',await ev(()=>{const b=document.querySelector('[data-mock-refresh]');b.click();return b.disabled&&b.innerText.includes('查找中')&&document.querySelector('[data-mock-status]').innerText.includes('查找中')}));
 await until(()=>document.querySelector('[data-mock-status]')?.innerText.includes('暂无新洞察'));
 check('no-change refresh reports inline without altering cards',await feedKeys()===ids);
 await sim('刷新','有更新');await click('[data-mock-refresh]');await until(()=>document.querySelector('[data-mock-status]')?.innerText.includes('洞察已更新'));
 check('updated refresh marks an existing record, not a new id',await feedKeys()===ids&&await ev(()=>[...document.querySelectorAll('[data-mock-idea]')].some(n=>n.innerText.includes('刚刚更新'))));
 await sim('刷新','失败');await click('[data-mock-refresh]');await p.waitForSelector('[data-mock-retry]');
 check('failed refresh keeps cards and offers retry inline',await feedKeys()===ids&&await ev(()=>document.querySelector('[data-mock-status]').innerText.includes('查找未完成')));
 await shot('05-refresh-failed');
 await sim('刷新','无变化');await click('[data-mock-retry]');await until(()=>document.querySelector('[data-mock-status]')?.innerText.includes('暂无新洞察'));
 check('retry completes with the current scenario',!(await ev(()=>!!document.querySelector('[data-mock-retry]'))));
 // Tab and URL continuity
 const url=await p.url();await click('text="任务"');
 check('other tabs show no footer',await ev(()=>!document.querySelector('[data-mock-footer]')&&document.body.innerText.includes('将路线图导出到 Notion')));
 await click('text="洞察"');await p.waitForSelector('[data-mock-footer]');
 check('returning to Insights keeps URL, list rows and draft',await p.url()===url&&JSON.stringify(await rowKeys())===JSON.stringify(['decision:d3','idea:g1'])&&JSON.stringify(await composer())===JSON.stringify(draft));
 // Reset and stale completions
 await sim('刷新','有更新');await click('[data-mock-refresh]');await click('text="重置"');
 await sleep(2000);
 check('reset discards an in-flight refresh',await ev(()=>!document.querySelector('[data-mock-status]')&&![...document.querySelectorAll('[data-mock-idea]')].some(n=>n.innerText.includes('刚刚更新'))&&!window.__cm.get().mockSearching));
 await openList();await click('[data-mock-restore="decision:d2"]');await click('text="重置"');
 await sleep(1600);
 await openList();
 check('reset discards an in-flight restore; seed rows are intact',JSON.stringify(await rowKeys())===JSON.stringify(['decision:d2','idea:g6','idea:g3','idea:g5'])&&await ev(()=>!document.querySelector('[data-mock-row-note]')));
 await sim('恢复','成功');await click('[data-mock-ignore-local="idea:g5"]');
 await until(()=>document.querySelector('[data-mock-history-row="idea:g5"]')?.getAttribute('data-state')==='ignored');
 check('local Ignore converts the mark to an ignored row and keeps the card hidden',(await rowText('idea:g5')).includes('已忽略')&&!(await inFeed('idea:g5'))&&await ev(()=>!document.querySelector('[data-mock-ignore-local]')));
 // Empty state
 await click('text="空状态"');await p.waitForSelector('[data-mock-footer]');
 check('empty state keeps refresh and hides the empty history entry',await ev(()=>!document.querySelector('[data-mock-history-toggle]')&&!!document.querySelector('[data-mock-refresh]')&&document.querySelector('[data-mock-panel-scroll]').innerText.includes('暂无洞察')));
 await click('text="有内容"');await p.waitForSelector('[data-mock-history-toggle]');
 // English
 await click('text="English"');await openList();
 check('English footer and states',await ev(()=>document.querySelector('[data-mock-footer]').innerText.includes('Refresh insights')&&document.querySelector('[data-mock-history-toggle]').innerText.trim()==='Ignored & snoozed')&&(await rowText('decision:d2')).includes('Snoozed until Nov 12, 09:00')&&(await rowText('idea:g5')).includes('Hidden on this device only'));
 await shot('06-english');await click('text="中文"');
 // Dark and narrow
 await click('text="C 夜"');await openList();
 // Keep the real 250ms theme transition; capture only after the window background settles.
 await until(()=>getComputedStyle(document.querySelector('[data-screen-label="CyberMe window"]')).backgroundColor==='rgb(17, 17, 19)');
 const night=await ev(()=>{const lum=c=>{const [r,g,b]=c.match(/\d+(\.\d+)?/g).map(Number);return (0.2126*r+0.7152*g+0.0722*b)/255};
  const title=document.querySelector('[data-mock-history-row] span'),status=document.querySelector('[data-mock-row-status]');
  return {window:getComputedStyle(document.querySelector('[data-screen-label="CyberMe window"]')).backgroundColor,title:lum(getComputedStyle(title).color),status:lum(getComputedStyle(status).color)}});
 check('night theme settled with readable history text',night.window==='rgb(17, 17, 19)'&&night.title>=0.7&&night.status>=0.35,night);
 await shot('07-night');
 for(const width of [1000,780]){
  await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});
  await until(w=>innerWidth===w&&window.__cm.get().vw===w,width);await toView();
  check('footer stays one row and list fits at '+width,await ev(()=>{const a=document.querySelector('[data-mock-refresh]').getBoundingClientRect(),b=document.querySelector('[data-mock-history-toggle]').getBoundingClientRect(),w=document.querySelector('[data-screen-label="CyberMe window"]').getBoundingClientRect();
   return Math.abs(a.top-b.top)<=1&&[...document.querySelectorAll('[data-mock-history-row]')].every(r=>{const x=r.getBoundingClientRect();return x.left>=w.left-1&&x.right<=w.right+1})&&document.documentElement.scrollWidth<=innerWidth}));
  await shot('08-narrow-'+width);
 }
 await click('text="A 静（推荐）"');
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 check('no business API requests',await ev(()=>!performance.getEntriesByType('resource').some(r=>r.name.includes('/api/'))));
 // Both current-preview URLs and catalog
 await p.goto(common);await p.waitForSelector('[data-mock-footer]');
 check('common entry renders the same footer',await ev(()=>document.querySelector('[data-mock-footer]').innerText.replace(/\s+/g,'')==='刷新洞察·忽略与推迟'));
 await p.goto(catalog);await p.waitForSelector('[data-current-proposal]');
 check('catalog points both current links at the footer revision',await ev(()=>document.querySelector('[data-current-proposal]').href.includes('insights-current.html?v=20261111-footer')&&document.querySelector('[data-v6-current]').href.includes('v=20261111-footer')&&document.querySelector('[data-current-proposal]').innerText.includes('末尾')));
 await shot('09-catalog');
 await p.goto(revision);await p.waitForSelector('[data-mock-footer]');await fs.writeFile(out+'/final-ax.txt',await p.snapshot());
 const files=['mock/opstwins/catalog.js','mock/opstwins/v6-revision/logic.js','scripts/build-insight-mock-revision.mjs','.local/design-preview/v6-baseline-20261111.html','.local/design-preview/v6.1-concept.html','.local/design-preview/insights-current.html'];
 const hashes={};for(const file of files)hashes[file]=crypto.createHash('sha256').update(await fs.readFile(root+'/'+file)).digest('hex');await fs.writeFile(out+'/sha256.json',JSON.stringify(hashes,null,2));
 check('frozen baseline unchanged; both current previews identical',hashes['.local/design-preview/v6-baseline-20261111.html']==='5277901d4f80f425c41494c44192dc347f8c69e77aa8c17de52a223cbb7727ee'&&hashes['.local/design-preview/v6.1-concept.html']===hashes['.local/design-preview/insights-current.html']);
}catch(e){checks.push({name:'browser interaction completed',pass:false,error:String(e)});throw e}finally{await fs.writeFile(out+'/result.json',JSON.stringify({url:revision,common,catalog,out,checks,scope:'Existing V6 static prototype footer with synthetic records and simulated outcomes only. No real model, business API, installed app or product-code acceptance.'},null,2));console.log(JSON.stringify({out,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks},null,2))}
// The caller inspects artifacts before finish({keep:['p1']}).
