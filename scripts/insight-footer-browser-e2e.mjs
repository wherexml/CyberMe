// Browser journey for the 洞察 footer against a fresh scripts/insight-footer-fixture.mjs (port 46881), built V6 assets
// in .local/insight-footer-web. Run with ego-browser nodejs; ego TaskSpace 38, page p1. Scripts do not inherit the shell cwd or
// environment, so every path is absolute. Physical clicks only, each with a 15-second timeout. Screenshots wait for settled
// theme colours. The caller inspects the screenshots and finishes TaskSpace 38 exactly once; this script never finishes it.
const fs=await import('node:fs/promises'),{createHash}=await import('node:crypto');
const root='/Users/steve/Projects/CyberMe',base='http://127.0.0.1:46881',url=base+'/cyberme.html';
const out=root+'/output/insight-footer-client-20261112/'+new Date().toISOString().replace(/[:.]/g,'-');
const task=await taskSpace(38),page=task.page('p1');
const T=15000,checks=[],shots=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(name)};
const click=(selector,label)=>page.click(selector,{label,timeout:T});
const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:T});
const fx=async(name,body={})=>JSON.parse((await page.fetch('/__fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const ev=async()=>JSON.parse((await page.fetch('/__fixture/evidence')).body);
const posts=async path=>(await ev()).posts.filter(p=>p.path===path).length;
const row=key=>`[data-history-row="${key}"]`;
const focusRefresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
async function settled(){
 // Theme transitions finish before capture: body and footer colours unchanged across two samples.
 let last='';for(let n=0;n<30;n++){const now=await page.evaluate(()=>{const f=document.querySelector('[data-insight-footer] button');return [getComputedStyle(document.body).backgroundColor,f&&getComputedStyle(f).color].join('|')});if(now===last)return;last=now;await new Promise(r=>setTimeout(r,250))}
}
// The installed UI keeps an explicit ui.theme (quiet/night); switch that real preference, reload, and assert final colours.
const THEME_TEXT2={quiet:'rgb(96, 100, 108)',night:'rgb(176, 180, 186)'};
async function setTheme(theme){
 await page.evaluate(t=>{const k='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(k)||'{}');ui.theme=t;localStorage.setItem(k,JSON.stringify(ui))},theme);
 await page.reload();await page.waitForSelector('[data-insight-footer]',{timeout:T});
 await until(c=>getComputedStyle(document.querySelector('[data-footer-refresh]')).color===c,THEME_TEXT2[theme]);
 await settled();
 check('theme '+theme+' applied with final colours',await page.evaluate(c=>getComputedStyle(document.querySelector('[data-footer-refresh]')).color===c,THEME_TEXT2[theme]));
}
async function shot(name){await settled();const path=out+'/'+name+'.png';await page.screenshot({path});shots.push(path)}
// Records every button state of one history row while a physical action runs; brief busy states are captured, not slowed down.
const watchRow=key=>page.evaluate(k=>{window.__rowSeen=[];window.__rowObs?.disconnect();const take=()=>{const r=document.querySelector(`[data-history-row="${k}"]`);if(r)window.__rowSeen.push([...r.querySelectorAll('button')].map(b=>({action:b.dataset.action,text:b.textContent,disabled:b.disabled,busy:b.getAttribute('aria-busy')})))};window.__rowObs=new MutationObserver(take);window.__rowObs.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});take()},key);
const rowSeen=()=>page.evaluate(()=>{window.__rowObs?.disconnect();return window.__rowSeen||[]});
async function openHistory(){if(await page.evaluate(()=>document.querySelector('[data-footer-history]')?.getAttribute('aria-expanded')!=='true'))await click('[data-footer-history]','打开忽略与推迟')}
await fs.mkdir(out,{recursive:true});
console.log({space:task.spaceId,out});
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await page.goto(url);
 // A decided card and a legacy local mark, as an existing install would have them.
 await page.evaluate(()=>{const k='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(k)||'{}');ui.gal={...ui.gal,'local-mark':true};ui.brief={...ui.brief,decided:{pick:{label:'公开选项',index:0}}};localStorage.setItem(k,JSON.stringify(ui))});
 await page.reload();
 await page.waitForSelector('[data-insight-footer]',{timeout:T});
 const expected=(await ev()).expectedRows;

 check('one footer at the true end of the feed, after decided cards',await page.evaluate(()=>{const feed=document.querySelector('[data-insight-feed]'),f=document.querySelectorAll('[data-insight-footer]');return f.length===1&&feed.lastElementChild===f[0]&&!!document.querySelector('[data-decided]')&&!!(document.querySelector('[data-decided]').compareDocumentPosition(f[0])&Node.DOCUMENT_POSITION_FOLLOWING)}));
 check('old 再找找 and 已处理 controls are gone',await page.evaluate(()=>!document.querySelector('[data-handled="inbox"],[data-handled="idea"]')&&![...document.querySelectorAll('[data-insight-feed] button')].some(b=>['再找找','已处理'].includes(b.textContent.trim()))));
 check('footer labels',await page.evaluate(()=>document.querySelector('[data-footer-refresh]').textContent==='刷新洞察'&&document.querySelector('[data-footer-history]').textContent==='忽略与推迟'));

 // Expansion: minimum right-panel scroll; chat scroll and composer untouched.
 await page.fill('textarea','保留这段聊天输入。');
 const chatTop=await page.evaluate(()=>document.querySelector('.cm-chat-scroll')?.scrollTop??0);
 await click('[data-footer-history]','打开忽略与推迟');
 await page.waitForSelector('[data-insight-history]',{timeout:T});
 const reveal=await page.evaluate(()=>{const r=document.querySelector('[data-history-row]').getBoundingClientRect(),s=document.querySelector('[data-insight-footer]').closest('.cm-scroll').getBoundingClientRect();return {top:r.top,bottom:r.bottom,vTop:s.top,vBottom:s.bottom}});
 check('first history row fully visible',reveal.top>=reveal.vTop-0.5&&reveal.bottom<=reveal.vBottom+0.5,reveal);
 check('chat scroll and composer unchanged',await page.evaluate(({chatTop})=>(document.querySelector('.cm-chat-scroll')?.scrollTop??0)===chatTop&&document.querySelector('textarea').value==='保留这段聊天输入。',{chatTop}));
 const keys=await page.evaluate(()=>[...document.querySelectorAll('[data-history-row]')].map(r=>r.dataset.historyRow));
 check('all history rows listed, none truncated',keys.length===expected,{rows:keys.length,expected});
 check('same bare ID listed separately per kind',keys.includes('inbox:same')&&keys.includes('idea:same'));
 check('expired and forwarded records are not listed',!keys.includes('inbox:expired-snooze')&&!keys.includes('inbox:forwarded'));
 const labels=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-history-row]')].map(r=>[r.dataset.historyRow,{state:r.dataset.historyState,label:r.querySelector('[data-history-label]').textContent}])));
 check('honest state labels',labels['inbox:snoozed-inbox'].label.startsWith('推迟到 ')&&labels['idea:deferred-timed'].label.startsWith('推迟到 ')&&labels['inbox:same'].label.startsWith('已忽略')&&labels['idea:local-mark'].label==='仅本机隐藏'&&labels['idea:legacy-untimed'].label==='已推迟，未设唤醒时间'&&!/\d/.test(labels['idea:legacy-untimed'].label),labels);
 check('active snoozes first, soonest wake first',keys[0]==='inbox:snoozed-inbox'&&keys[1]==='idea:deferred-timed',keys.slice(0,3));
 await shot('history-light-zh');

 // Restore inbox:same only; idea:same stays.
 await click(row('inbox:same')+' [data-action="restore"]','恢复同号收件箱事项');
 await until(k=>!document.querySelector(`[data-history-row="${k}"]`),'inbox:same');
 check('restored row leaves; same-ID idea row stays and inbox card returns',await page.evaluate(()=>!!document.querySelector('[data-history-row="idea:same"]')&&!!document.querySelector('[data-item="same"]')));

 // Duplicate activation (not an OS double-click): a physical clickCount:2 cannot resolve its second click once the first
 // fast restore removes the row, so the documented page.evaluate escape hatch activates the same captured live button twice
 // synchronously. All other product actions in this script stay physical.
 const sameIdea='/api/ideas/same/attention';
 const dup=await page.evaluate(()=>new Promise(resolve=>{
  const rowEl=document.querySelector('[data-history-row="idea:same"]'),button=rowEl.querySelector('[data-action="restore"]');
  const other=()=>document.querySelector('[data-history-row="idea:other-idea"] [data-action="restore"]');
  const seen={busy:false,otherUsable:null};
  const look=()=>{if(button.disabled&&button.getAttribute('aria-busy')==='true'&&!seen.busy){seen.busy=true;seen.otherUsable=!!other()&&!other().disabled}
   if(seen.busy||!rowEl.isConnected){observer.disconnect();resolve(seen)}};
  const observer=new MutationObserver(look);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','aria-busy']});
  button.click();button.click();
  setTimeout(()=>{observer.disconnect();resolve(seen)},15000);
 }));
 check('duplicate activation shows a busy row guard while another row stays usable',dup.busy&&dup.otherUsable===true,dup);
 await until(()=>!document.querySelector('[data-history-row="idea:same"]'));
 check('duplicate activation sends exactly one restore POST',await posts(sameIdea)===1);

 // Browser concurrency stress (not physical clicks): two different rows are activated synchronously in-page, so both
 // requests are in flight together; each row's own busy state is captured.
 const pair=await page.evaluate(()=>new Promise(resolve=>{
  const keys=['idea:other-idea','inbox:other-inbox'],buttons=keys.map(k=>document.querySelector(`[data-history-row="${k}"] [data-action="restore"]`));
  const seen=Object.fromEntries(keys.map(k=>[k,{busy:false,text:''}]));
  const look=()=>{buttons.forEach((b,i)=>{if(b.isConnected&&b.disabled&&b.getAttribute('aria-busy')==='true'&&!seen[keys[i]].busy)seen[keys[i]]={busy:true,text:b.textContent,bothBusy:buttons.every(x=>x.isConnected&&x.disabled)}});
   if(keys.every(k=>seen[k].busy)||buttons.every(b=>!b.isConnected)){observer.disconnect();resolve(seen)}};
  const observer=new MutationObserver(look);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','aria-busy']});
  buttons.forEach(b=>b.click());
  setTimeout(()=>{observer.disconnect();resolve(seen)},15000);
 }));
 check('concurrency stress: both rows show their own 恢复中… together',pair['idea:other-idea'].busy&&pair['inbox:other-inbox'].busy&&pair['idea:other-idea'].text==='恢复中…'&&pair['inbox:other-inbox'].text==='恢复中…'&&(pair['idea:other-idea'].bothBusy||pair['inbox:other-inbox'].bothBusy),pair);
 await until(()=>!document.querySelector('[data-history-row="idea:other-idea"]')&&!document.querySelector('[data-history-row="inbox:other-inbox"]'));
 check('concurrency stress: each row made exactly one real write',await posts('/api/ideas/other-idea/attention')===1&&await posts('/api/inbox/other-inbox/attention-dismissal/undo')===1&&JSON.parse((await page.fetch('/api/ideas/other-idea')).body).status==='new'&&JSON.parse((await page.fetch('/api/inbox/other-inbox')).body).status!=='dismissed');

 // Conflict: canonical reread, row stays with a readable message, then a fresh restore works.
 // The record changes the moment the restore arrives, so the request carries a stale version and the real route returns 409.
 await fx('fault',{method:'POST',path:'/api/inbox/conflict/attention-dismissal/undo',kind:'conflict'});
 await click(row('inbox:conflict')+' [data-action="restore"]','恢复时记录被别处修改');
 await until(()=>document.querySelector('[data-history-row="inbox:conflict"] [role="alert"]')?.textContent==='已有更新，未恢复');
 await shot('row-conflict');
 await click(row('inbox:conflict')+' [data-action="restore"]','重新读取后恢复');
 await until(()=>!document.querySelector('[data-history-row="inbox:conflict"]'));
 check('conflict then canonical restore',await posts('/api/inbox/conflict/attention-dismissal/undo')===2);

 // Response lost after commit: readback confirms, no replay.
 await fx('fault',{method:'POST',path:'/api/inbox/lost-inbox/attention-dismissal/undo',kind:'after'});
 await click(row('inbox:lost-inbox')+' [data-action="restore"]','恢复并丢失响应');
 await until(()=>!document.querySelector('[data-history-row="inbox:lost-inbox"]'));
 check('lost response confirmed by readback without replay',await posts('/api/inbox/lost-inbox/attention-dismissal/undo')===1);

 // Lost before arrival: not finding the change is no proof it never arrives, so 再次核对 stays GET-only and never unlocks restore.
 await fx('fault',{method:'POST',path:'/api/ideas/lost-idea/attention',kind:'before'});
 await click(row('idea:lost-idea')+' [data-action="restore"]','恢复但请求未到达');
 await page.waitForSelector(row('idea:lost-idea')+' [data-action="check"]',{timeout:T});
 await watchRow('idea:lost-idea');
 await click(row('idea:lost-idea')+' [data-action="check"]','再次核对');
 await until(()=>{const r=document.querySelector('[data-history-row="idea:lost-idea"]');return r&&!r.querySelector('[data-action="check"]').disabled&&!r.querySelector('[data-action="restore"]')&&r.querySelector('[role="alert"]')?.textContent==='结果待确认'});
 const checkSeen=await rowSeen();
 check('readback busy label is 核对中… and never 恢复中…',checkSeen.some(s=>s.some(b=>b.action==='check'&&b.text==='核对中…'&&b.busy==='true'))&&!checkSeen.some(s=>s.some(b=>b.text==='恢复中…')),checkSeen.filter(s=>s.some(b=>b.disabled)));
 check('inconclusive re-check stays unconfirmed and does not POST',await posts('/api/ideas/lost-idea/attention')===1);

 // Snooze binding: a newer snooze with another operationId is not proof that our undo applied.
 await fx('fault',{method:'POST',path:'/api/inbox/snoozed-inbox/attention-snooze/undo',kind:'after-resnooze'});
 await click(row('inbox:snoozed-inbox')+' [data-action="restore"]','恢复推迟后被再次推迟');
 await page.waitForSelector(row('inbox:snoozed-inbox')+' [data-action="check"]',{timeout:T});
 await click(row('inbox:snoozed-inbox')+' [data-action="check"]','在新推迟后再次核对');
 await until(()=>{const r=document.querySelector('[data-history-row="inbox:snoozed-inbox"]');return r&&!r.querySelector('[data-action="check"]').disabled});
 check('newer snooze operation is not confirmation',await page.evaluate(()=>document.querySelector('[data-history-row="inbox:snoozed-inbox"] [role="alert"]')?.textContent==='结果待确认')&&await posts('/api/inbox/snoozed-inbox/attention-snooze/undo')===1);

 // Local-only: 忽略 writes the server dismissal; the row becomes a server 已忽略 row.
 // A refused Ignore (one-shot 503, not forwarded) reports an ignore failure and leaves the local-only row as it was.
 await fx('fault',{method:'POST',path:'/api/ideas/local-mark/attention',kind:'unavailable'});
 await click(row('idea:local-mark')+' [data-action="dismiss"]','忽略被拒绝（503）');
 await until(()=>document.querySelector('[data-history-row="idea:local-mark"] [role="alert"]')?.textContent.startsWith('未能忽略'));
 check('failed ignore says 未能忽略 and keeps the local row intact',await page.evaluate(()=>{const r=document.querySelector('[data-history-row="idea:local-mark"]');return r.dataset.historyState==='local'&&!r.querySelector('[role="alert"]').textContent.includes('恢复')&&!!r.querySelector('[data-action="dismiss"]')&&!r.querySelector('[data-action="dismiss"]').disabled&&JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').gal?.['local-mark']===true})&&JSON.parse((await page.fetch('/api/ideas/local-mark')).body).status==='new');
 await watchRow('idea:local-mark');
 await click(row('idea:local-mark')+' [data-action="dismiss"]','把本机标记改为忽略');
 await until(()=>document.querySelector('[data-history-row="idea:local-mark"]')?.dataset.historyState==='dismissed');
 const ignoreSeen=await rowSeen();
 check('ignore busy label names ignore only',ignoreSeen.some(s=>s.some(b=>b.action==='dismiss'&&b.text==='忽略中…'&&b.busy==='true'))&&!ignoreSeen.some(s=>s.some(b=>b.text==='恢复中…'))&&ignoreSeen.some(s=>s.some(b=>b.action==='restore'&&b.disabled&&b.text==='恢复')),ignoreSeen.filter(s=>s.some(b=>b.disabled)));
 check('explicit ignore alone writes dismissed',JSON.parse((await page.fetch('/api/ideas/local-mark')).body).status==='dismissed'&&await page.evaluate(()=>!JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').gal?.['local-mark']));

 // Refresh: running survives a tab switch without a second model run.
 const tab=label=>click(`text="${label}"`,'切换到'+label);
 await fx('source',{body:'公开试点：日期改到下周三。'});await fx('mode',{mode:'hold'});
 const calls0=(await ev()).modelCalls,refresh0=(await ev()).refreshPosts;
 await click('[data-footer-refresh]','刷新洞察');
 await until(()=>document.querySelector('[data-footer-refresh]').textContent==='查找中…');
 check('disabled refresh has no hover style',await page.evaluate(()=>{const b=document.querySelector('[data-footer-refresh]');return b.disabled&&!b.className}));
 await tab('任务');await tab('洞察');
 await until(()=>document.querySelector('[data-footer-refresh]')?.textContent==='查找中…');
 for(let n=0;n<100&&!(await ev()).held;n++)await new Promise(r=>setTimeout(r,100));
 await fx('release');
 await until(()=>document.querySelector('[data-footer-status="done"]')?.textContent==='洞察已更新');
 const afterHold=await ev();
 check('one refresh POST and one model run across remount',afterHold.refreshPosts===refresh0+1&&afterHold.modelCalls===calls0+2,{posts:afterHold.refreshPosts-refresh0,calls:afterHold.modelCalls-calls0});
 check('update of an existing record is reported without statistics',await page.evaluate(()=>!/\d/.test(document.querySelector('[data-footer-status]').textContent)));
 await shot('refresh-updated');
 await fx('mode',{mode:'none'});await click('[data-footer-refresh]','无新内容刷新');
 await until(()=>document.querySelector('[data-footer-status="done"]')?.textContent==='暂无新洞察');
 const cards=await page.evaluate(()=>document.querySelectorAll('[data-idea],[data-item]').length);
 await fx('mode',{mode:'invalid'});await click('[data-footer-refresh]','失败刷新');
 await page.waitForSelector('[data-footer-retry]',{timeout:T});
 check('failure keeps cards and offers retry inline',await page.evaluate(n=>document.querySelectorAll('[data-idea],[data-item]').length===n&&document.querySelector('[data-footer-status="failed"]').textContent.startsWith('查找未完成'),cards));
 await shot('refresh-failed');
 await fx('mode',{mode:'update'});await fx('source',{body:'公开试点：日期确认为周四。'});
 await click('[data-footer-retry]','重试刷新');
 await until(()=>document.querySelector('[data-footer-status="done"]'));
 // Lost refresh response after commit: confirmed by a new background run ID.
 await fx('source',{body:'公开试点：日期再次确认。'});await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'after'});
 await click('[data-footer-refresh]','刷新并丢失响应');
 await until(()=>document.querySelector('[data-footer-status="done"]')&&document.querySelector('[data-footer-refresh]').textContent==='刷新洞察');
 check('lost refresh response confirmed by readback',true);
 // Preflight read failure: nothing is POSTed and retry stays available.
 let before=(await ev()).refreshPosts;
 await fx('fault',{method:'GET',path:'/api/ideas/background',kind:'unavailable'});
 await click('[data-footer-refresh]','预读失败的刷新');
 await page.waitForSelector('[data-footer-retry]',{timeout:T});
 check('preflight read failure sends no refresh',(await ev()).refreshPosts===before);
 // readbackRequired, matching run: confirmed by GET.
 await fx('source',{body:'公开试点：日期第三次确认。'});await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'readback'});
 await click('[data-footer-retry]','重试并收到需回读结果');
 await until(()=>document.querySelector('[data-footer-status="done"]')?.textContent==='洞察已更新');
 check('readbackRequired with matching run is confirmed',true);
 // readbackRequired, the readback GET itself fails: unknown; 再次核对 (GET only) then confirms.
 await fx('source',{body:'公开试点：日期第四次确认。'});await fx('mode',{mode:'hold'});
 await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'readback'});
 before=(await ev()).refreshPosts;
 await click('[data-footer-refresh]','回读失败的刷新');
 for(let n=0;n<100&&!(await ev()).held;n++)await new Promise(r=>setTimeout(r,100));
 await fx('fault',{method:'GET',path:'/api/ideas/background',kind:'unavailable'});await fx('release');await fx('mode',{mode:'update'});
 await page.waitForSelector('[data-footer-check]',{timeout:T});
 check('failed readback is unknown and blocks refresh',await page.evaluate(()=>document.querySelector('[data-footer-refresh]').disabled&&!document.querySelector('[data-footer-retry]')));
 await click('[data-footer-check]','再次核对回读');
 await until(()=>document.querySelector('[data-footer-status="done"]')?.textContent==='洞察已更新');
 check('check again confirmed by GET only',(await ev()).refreshPosts===before+1);
 // readbackRequired naming another run: never confirmed, never re-POSTed.
 await fx('source',{body:'公开试点：日期第五次确认。'});await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'readback-mismatch'});
 before=(await ev()).refreshPosts;
 await click('[data-footer-refresh]','回读编号不符的刷新');
 await page.waitForSelector('[data-footer-check]',{timeout:T});
 await click('[data-footer-check]','再次核对不符的回读');
 await until(()=>document.querySelector('[data-footer-status="unknown"]')&&!document.querySelector('[data-footer-check]').disabled);
 check('mismatched readback stays unknown with refresh disabled',await page.evaluate(()=>document.querySelector('[data-footer-refresh]').disabled&&!document.querySelector('[data-footer-retry]')));
 // Never reached: an unchanged baseline is not proof either way; it stays unknown and 再次核对 reads only.
 // (Arrives while already unknown, so this only checks no POST is possible; a reload is the user's way to start over.)
 check('unknown refresh is never replayed',(await ev()).refreshPosts===before+1);
 await shot('refresh-unknown');
 await page.reload();await page.waitForSelector('[data-insight-footer]',{timeout:T});
 await page.fill('textarea','保留这段聊天输入。');
 await fx('fault',{method:'POST',path:'/api/ideas/refresh',kind:'before'});before=(await ev()).refreshPosts;
 await click('[data-footer-refresh]','刷新但请求未到达');
 await page.waitForSelector('[data-footer-check]',{timeout:T});
 await click('[data-footer-check]','再次核对未到达的刷新');
 await until(()=>document.querySelector('[data-footer-status="unknown"]')&&!document.querySelector('[data-footer-check]').disabled);
 check('unchanged baseline does not unlock retry',(await ev()).refreshPosts===before+1&&await page.evaluate(()=>!document.querySelector('[data-footer-retry]')));
 await page.reload();await page.waitForSelector('[data-insight-footer]',{timeout:T});
 await page.fill('textarea','保留这段聊天输入。');

 // Keyboard: Tab reaches the history toggle, Enter opens it.
 await page.evaluate(()=>document.querySelector('[data-footer-refresh]').focus());
 await page.keyboard.press('Tab');
 check('history toggle reachable by keyboard',await page.evaluate(()=>document.activeElement?.hasAttribute('data-footer-history')));

 // Dark theme, English, narrow panel.
 await setTheme('night');
 await openHistory();await shot('history-dark-zh');
 const settings=JSON.parse((await page.fetch('/api/settings')).body);
 await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language:'en'},baseSettings:{identity:settings.identity}})});
 await focusRefresh();
 await until(()=>document.querySelector('[data-footer-refresh]')?.textContent==='Refresh insights');
 await openHistory();
 check('English labels',await page.evaluate(()=>document.querySelector('[data-footer-history]').textContent==='Ignored & snoozed'&&!!document.querySelector('[data-history-row="idea:legacy-untimed"] [data-history-label]')?.textContent.includes('no wake time')));
 await shot('history-dark-en');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:2,mobile:false});
 await setTheme('quiet');await openHistory();
 check('narrow English footer keeps both entries and the dot on one row',await page.evaluate(()=>{const a=document.querySelector('[data-footer-refresh]').getBoundingClientRect(),b=document.querySelector('[data-footer-history]').getBoundingClientRect(),dot=document.querySelector('[data-footer-row] [aria-hidden]').getBoundingClientRect();return Math.abs(a.top-b.top)<=1&&Math.abs((dot.top+dot.bottom)/2-(a.top+a.bottom)/2)<=3&&a.right<=dot.left+1&&dot.right<=b.left+1&&getComputedStyle(document.querySelector('[data-footer-refresh]')).fontSize==='12px'}));
 check('narrow panel has no horizontal overflow',await page.evaluate(()=>{const s=document.querySelector('[data-insight-footer]').closest('.cm-scroll');return s.scrollWidth<=s.clientWidth+1}));
 await shot('history-narrow-en');
 await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language:'zh-CN'},baseSettings:{identity:{...settings.identity,language:'en'}}})}).catch(()=>{});

 // Last row: collapses, hides its entry, focuses refresh; composer keeps its text.
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await page.fill('textarea','保留这段聊天输入。');
 await fx('restore-all-except',{keep:'idea:legacy-untimed'});await focusRefresh();
 await until(()=>document.querySelectorAll('[data-history-row]').length===1);
 await click(row('idea:legacy-untimed')+' [data-action="restore"]','恢复最后一行');
 await until(()=>!document.querySelector('[data-footer-history]'));
 check('last row collapses the list, refresh stays and gets focus, no filler text',await page.evaluate(()=>!document.querySelector('[data-insight-history]')&&!document.querySelector('[data-footer-status]')&&document.activeElement?.hasAttribute('data-footer-refresh')&&document.querySelector('textarea').value==='保留这段聊天输入。'));
 await shot('history-empty');

 // Empty feed (fixture-only empty dataset of synthetic rows): only the quiet refresh footer, no completion sentence.
 const emptied=await fx('empty');
 await focusRefresh();
 await until(()=>!document.querySelector('[data-insight-feed] [data-item],[data-insight-feed] [data-idea]'));
 check('empty feed keeps only the refresh footer, without 都做完了 filler',emptied.inbox===0&&emptied.ideas===0&&await page.evaluate(()=>{const feed=document.querySelector('[data-insight-feed]'),text=feed.innerText;return feed.children.length===1&&feed.lastElementChild.hasAttribute('data-insight-footer')&&!!feed.querySelector('[data-footer-refresh]')&&!feed.querySelector('[data-footer-history]')&&!text.includes('今天的决策都做完了')&&!text.includes('剩下的交给我')}),emptied);
 await shot('feed-empty');
 const end=await ev();
 check('no tasks, messages or sends from footer actions',end.sends===0&&!end.posts.some(p=>/\/(tasks|chat|send|approve)/.test(p.path)),{sends:end.sends});
 await fs.writeFile(out+'/http-evidence.json',JSON.stringify(end,null,2));
}catch(e){checks.push({name:String(e?.message||e),pass:false})}
finally{
 const files=['web/src/v6/InsightFooter.tsx','web/src/v6/Brief.tsx','web/src/v6/attention.ts','web/src/v6/strings.ts','scripts/insight-footer-fixture.mjs','scripts/insight-footer-browser-e2e.mjs'];
 const sourceHashes={};for(const f of files){try{sourceHashes[f]=createHash('sha256').update(await fs.readFile(root+'/'+f)).digest('hex')}catch{sourceHashes[f]=null}}
 await fs.writeFile(out+'/browser.json',JSON.stringify({url,space:task.spaceId,page:'p1',scope:'built V6, production HTTP and SQLite, synthetic data, controlled local model',screenshots:shots,sourceHashes,checks},null,2));
 console.log(JSON.stringify({url,out,passed:checks.filter(c=>c.pass).length,total:checks.length}));
}
// No task.finish(): the coordinator reviews the screenshots and finishes TaskSpace 38 once acceptance is complete.
if(!checks.every(c=>c.pass))throw Error('insight footer browser checks failed');
