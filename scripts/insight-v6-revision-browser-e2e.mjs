// Run after node scripts/build-insight-mock-revision.mjs, with both preview services running.
// ego-browser nodejs < scripts/insight-v6-revision-browser-e2e.mjs
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/CyberMe',out=root+'/output/insight-v6-revision-20261111/'+Date.now();await fs.mkdir(out,{recursive:true});
const t=await taskSpace(9),p=t.page('p1'),checks=[];
const revision='http://127.0.0.1:46781/insights-current.html',catalog='http://127.0.0.1:46400/#overview';
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail?{detail}:{})});if(!pass)throw Error(name)};
const shot=name=>p.screenshot({path:out+'/'+name+'.png'});
const menu=async()=>{await p.click('[data-mock-insight-menu]');await p.waitForSelector('[role="menu"]')};
const history=async()=>{await menu();await p.click('[data-mock-open-history]');await p.waitForSelector('[data-mock-history]')};
const metrics=()=>{
 const title=[...document.querySelectorAll('div')].find(n=>n.textContent==='三位续约联系人都没回音，谁来跟进？');
 const card=title.parentElement.parentElement.parentElement,cs=getComputedStyle(card),ts=getComputedStyle(title),win=document.querySelector('[data-screen-label="CyberMe window"]'),wr=win.getBoundingClientRect();
 const ta=document.querySelector('textarea'),tr=ta.getBoundingClientRect();
 return {title:{font:ts.fontSize,weight:ts.fontWeight,line:ts.lineHeight},card:{radius:cs.borderRadius,width:Math.round(card.getBoundingClientRect().width)},window:{width:Math.round(wr.width),height:Math.round(wr.height)},composer:{width:Math.round(tr.width),font:getComputedStyle(ta).fontSize},mascot:Math.round(document.querySelector('[aria-label="CyberMe"]').getBoundingClientRect().width)};
};
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await p.goto('http://127.0.0.1:46781/v6-baseline-20261111.html');await p.waitForSelector('[aria-label="CyberMe"]');
 await p.click('text="中文"');await p.waitForFunction(()=>document.body.innerText.includes('三位续约联系人都没回音'));
 const baseline=await p.evaluate(metrics);await shot('01-v6-baseline');
 await p.goto(revision);await p.waitForSelector('[data-mock-insight-menu]');
 const candidate=await p.evaluate(metrics);
 check('baseline V6 window, card, type, mascot and composer dimensions retained',JSON.stringify(baseline)===JSON.stringify(candidate),{baseline,candidate});
 check('one insight feed retains original rich cards and charts',await p.evaluate(()=>document.querySelectorAll('[data-mock-decision]').length===2&&document.querySelectorAll('[data-mock-idea]').length>=6&&document.querySelector('[data-mock-panel-scroll]').innerText.includes('Dana Whitfield')&&!document.querySelector('[data-mock-panel-scroll]').innerText.includes('为什么选这个')));
 check('no old footer or secondary category switch',await p.evaluate(()=>{const el=document.querySelector('[data-mock-panel-scroll]');return !/再找找|已处理/.test(el.innerText)&&![...el.querySelectorAll('button')].some(b=>['决定','灵感'].includes(b.innerText.trim()))}));
 await shot('02-current');
 await menu();check('menu contains exactly two actions',await p.evaluate(()=>document.querySelectorAll('[role="menuitem"]').length===2));await shot('03-menu');
 await p.keyboard.press('Escape');check('Escape closes menu and restores opener focus',await p.evaluate(()=>!document.querySelector('[role="menu"]')&&document.activeElement.hasAttribute('data-mock-insight-menu')));
 await menu();await p.click('textarea');check('outside click closes menu',await p.evaluate(()=>!document.querySelector('[role="menu"]')));
 await p.fill('textarea','保留我的补充。');const taskCount=await p.evaluate(()=>window.__cm.get().tasks.length);
 await history();
 check('history separates ignored and snoozed facts without completion labels',await p.evaluate(()=>{const n=document.querySelector('[data-mock-history]');return n.innerText.includes('已忽略')&&n.innerText.includes('明天 09:00')&&!n.innerText.includes('已完成')&&n.querySelectorAll('[data-mock-history-row]').length===2}));
 check('history navigation keeps unsent draft',await p.evaluate(()=>document.querySelector('textarea').value==='保留我的补充。'));
 await shot('04-history');
 await p.click('[data-mock-restore="decision:d2"]');
 check('restore only removes its exact history row',await p.evaluate(()=>!document.querySelector('[data-mock-history-row="decision:d2"]')&&!!document.querySelector('[data-mock-history-row="idea:g3"]')));
 await p.click('[data-mock-restore="idea:g3"]');
 check('last restored item leaves a readable empty history and stable focus',await p.evaluate(()=>document.querySelector('[data-mock-history]').innerText.includes('暂无忽略或推迟')&&document.activeElement.hasAttribute('data-mock-history')));
 await p.click('[aria-label="Back"]');
 check('restored cards return to original feed without creating tasks',await p.evaluate(expected=>!!document.querySelector('[data-mock-decision="decision:d2"]')&&!!document.querySelector('[data-mock-idea="idea:g3"]')&&window.__cm.get().tasks.length===expected,taskCount));
 await p.click('[data-mock-snooze="decision:d3"]');
 await history();check('snooze uses same history and keeps a time',await p.evaluate(()=>document.querySelector('[data-mock-history-row="decision:d3"]').innerText.includes('明天 09:00')));
 await p.click('[data-mock-restore="decision:d3"]');await p.click('[aria-label="Back"]');
 await p.click('[data-mock-ignore="idea:g1"]');
 await history();check('ignore enters same history with accurate status',await p.evaluate(()=>document.querySelector('[data-mock-history-row="idea:g1"]').innerText.includes('已忽略')));
 await p.click('[aria-label="Back"]');
 await p.click('[data-mock-discuss="decision:d3"]');
 await p.waitForFunction(()=>document.querySelector('textarea').value.includes('三位续约联系人'));
 check('original card discussion and quote still prepare a draft',await p.evaluate(()=>document.querySelector('textarea').value.includes('三位续约联系人')&&window.__cm.get().tasks.length===2));
 await p.click('text="演示刷新失败"');await p.waitForSelector('[data-mock-retry]');
 check('failed refresh preserves current cards',await p.evaluate(()=>document.querySelectorAll('[data-mock-decision]').length===3&&document.querySelectorAll('[data-mock-idea]').length>=6));await shot('05-failure');
 await p.click('[data-mock-retry]');await menu();
 check('refresh is disabled while running',await p.evaluate(()=>document.querySelector('[data-mock-refresh]').disabled));
 await p.keyboard.press('Escape');await p.waitForFunction(()=>document.querySelector('[data-mock-panel-scroll]').innerText.includes('暂无新洞察'));
 check('retry completes without duplicating data',await p.evaluate(()=>document.querySelectorAll('[data-mock-decision]').length===3&&window.__cm.get().tasks.length===2));
 await p.click('text="重置"');await menu();await p.click('[data-mock-refresh]');await p.click('text="重置"');
 check('reset clears in-flight lookup and its late result',await p.evaluate(()=>!window.__cm.get().mockSearching&&!window.__cm.get().mockResult));
 await p.click('text="任务"');check('other tabs keep original content and no insight menu',await p.evaluate(()=>!document.querySelector('[data-mock-insight-menu]')&&document.body.innerText.includes('将路线图导出到 Notion')));
 await p.click('text="记忆"');check('memory remains reachable',await p.evaluate(()=>document.body.innerText.includes('关于我')));
 await p.click('text="洞察"');await p.click('text="空状态"');
 check('empty state retains action menu and empty history',await p.evaluate(()=>!!document.querySelector('[data-mock-insight-menu]')&&document.querySelector('[data-mock-panel-scroll]').innerText.includes('暂无洞察')));
 await history();check('empty history remains navigable',await p.evaluate(()=>document.querySelector('[data-mock-history]').innerText.includes('暂无忽略或推迟')));
 await p.click('[aria-label="Back"]');await p.click('text="有内容"');
 await p.click('text="C 夜"');await menu();await shot('06-night-menu');
 for(const width of [1000,780]){
  await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false});
  await p.waitForFunction(w=>innerWidth===w&&window.__cm.get().vw===w,width);
  check('menu and full window stay within viewport at '+width,await p.evaluate(()=>{const r=document.querySelector('[role="menu"]').getBoundingClientRect(),w=document.querySelector('[data-screen-label="CyberMe window"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&w.left>=0&&w.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth}));await shot('07-narrow-'+width);
 }
 await p.keyboard.press('Escape');await p.click('text="A 静（推荐）"');
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await p.goto(catalog);await p.waitForSelector('[data-current-proposal]');
 check('overview defaults to current V6 instead of classic grid',await p.evaluate(()=>!!document.querySelector('[data-current-proposal]')&&!document.querySelector('.screen-grid')&&!document.body.innerText.includes('独立拼装稿')));await shot('08-overview');
 await p.click('.catalog-bar a[href="#overview-legacy"]');await p.waitForSelector('.screen-grid');
 check('old overview is explicitly archived with rejected proposal',await p.evaluate(()=>document.body.innerText.includes('旧版工作区')&&document.body.innerText.includes('已弃用')));await shot('09-legacy');
 await p.goto('http://127.0.0.1:46400/#chat');await p.waitForSelector('.chat-layout');
 check('old deep links survive with an old-version label',await p.evaluate(()=>document.querySelector('.studio-brand').innerText.includes('旧版工作区')));
 await p.goto(catalog);await p.click('[data-current-proposal]');await p.waitForSelector('[data-mock-insight-menu]');
 check('catalog opens current revision directly',await p.url()===revision);
 check('revision does not call business APIs',await p.evaluate(()=>!performance.getEntriesByType('resource').some(r=>r.name.includes('/api/'))));
 await shot('10-final');await fs.writeFile(out+'/final-ax.txt',await p.snapshot());
 const files=['mock/opstwins/catalog.js','mock/opstwins/catalog.css','mock/opstwins/app.js','mock/opstwins/v6-revision/logic.js','scripts/build-insight-mock-revision.mjs','.local/design-preview/v6-baseline-20261111.html','.local/design-preview/v6.1-concept.html','.local/design-preview/insights-current.html'];
 const hashes={};for(const file of files)hashes[file]=crypto.createHash('sha256').update(await fs.readFile(root+'/'+file)).digest('hex');await fs.writeFile(out+'/sha256.json',JSON.stringify(hashes,null,2));
}catch(e){checks.push({name:'browser interaction completed',pass:false,error:String(e)});throw e}finally{await fs.writeFile(out+'/result.json',JSON.stringify({url:revision,catalog,out,checks,scope:'Existing V6 static prototype and synthetic interactions only. No real model, business API, installed app or product-code acceptance.'},null,2));console.log(JSON.stringify({out,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks},null,2))}
// The caller inspects artifacts before finish({keep:['p1']}).
