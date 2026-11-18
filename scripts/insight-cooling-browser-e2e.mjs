// Browser journey for the Insight draft cooling wait against a fresh scripts/insight-cooling-fixture.mjs (port 46905) and
// built V6 assets in .local/insight-cooling-web. Run with ego-browser nodejs.
// TaskSpace: the coordinator injects the literal global INSIGHT_COOLING_TASK (for example
//   globalThis.INSIGHT_COOLING_TASK=await taskSpace(<id>)) and finishes it once after visual review; this script never does.
// Scripts do not inherit cwd or environment: every path is absolute. Physical clicks only, 15-second timeout each.
const fs=await import('node:fs/promises'),{createHash}=await import('node:crypto');
const task=globalThis.INSIGHT_COOLING_TASK;if(!task)throw Error('INSIGHT_COOLING_TASK was not injected');
const page=task.page('p1');
const root='/Users/steve/Projects/CyberMe',base='http://127.0.0.1:46905',url=base+'/cyberme.html';
const out=root+'/output/insight-cooling-20261112/'+new Date().toISOString().replace(/[:.]/g,'-');
const T=15000,LONG=45000,checks=[],shots=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(name)};
const click=(selector,label)=>page.click(selector,{label,timeout:T});
const until=(fn,arg,timeout=T)=>page.waitForFunction(fn,arg,{timeout});
const fx=async(name,body={})=>JSON.parse((await page.fetch('/__fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const ev=async()=>JSON.parse((await page.fetch('/__fixture/evidence')).body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const focusRefresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const draftBtn=id=>`[data-item="${id}"] [data-action="draft_reply"]`;
const WAIT_ZH='等待消息稳定',WAIT_EN='Waiting for messages to settle';
const state=id=>page.evaluate(sel=>{const b=document.querySelector(sel),card=b?.closest('[data-item]');return b?{text:b.textContent.trim(),disabled:b.disabled,waiting:b.dataset.waiting||'',alert:card.querySelector('[role="alert"]')?.textContent||'',note:card.querySelector('[data-cooling-note]')?.textContent||''}:null},draftBtn(id));
const isWaiting=s=>!!s&&s.waiting==='cooling'&&s.disabled&&(s.text===WAIT_ZH||s.text===WAIT_EN);
const readyLabel=(sel,wait)=>until(({sel,wait})=>{const b=document.querySelector(sel);return b&&!b.disabled&&!b.dataset.waiting&&b.textContent.trim()!==wait},{sel,wait},LONG);
const posts=async id=>(await ev()).actionPosts.filter(p=>p.entityId===id).length;
const calls=async id=>(await ev()).modelCalls[id]||0;
const THEME_TEXT2={quiet:'rgb(96, 100, 108)',night:'rgb(176, 180, 186)'};
async function settled(){let last='';for(let n=0;n<30;n++){const now=await page.evaluate(()=>{const b=document.querySelector('[data-item] [data-action]');return [getComputedStyle(document.body).backgroundColor,b&&getComputedStyle(b).color].join('|')});if(now===last)return;last=now;await sleep(250)}}
async function shot(name){await settled();const path=out+'/'+name+'.png';await page.screenshot({path});shots.push(path)}
async function setTheme(theme){
 await page.evaluate(t=>{const k='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(k)||'{}');ui.theme=t;localStorage.setItem(k,JSON.stringify(ui))},theme);
 await page.reload();await page.waitForSelector(draftBtn('waiting'),{timeout:T});
 await until(c=>getComputedStyle(document.querySelector('[data-footer-refresh]')).color===c,THEME_TEXT2[theme]);
 await settled();
}
await fs.mkdir(out,{recursive:true});
console.log({out});
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 // page.fetch needs the fixture origin: leave the new-tab page on a plain fixture JSON URL (the app is not loaded yet).
 await page.goto(base+'/__fixture/evidence');
 for(const [id,seconds] of [['waiting',3600],['current-draft',3600],['soon',35],['race',-60],['replied',-60],['fail',-60],['extend',-60]])await fx('deadline',{id,seconds});
 // The reconciliation read for 'soon' will be held when its deadline passes.
 await fx('inbox-read',{id:'soon',mode:'hold'});
 await page.goto(url);
 await page.waitForSelector(draftBtn('waiting'),{timeout:T});
 await setTheme('quiet');
 await page.fill('textarea','保留这段聊天输入。');

 // Known waiting: only draft generation is locked, with a neutral label; no banner, countdown or red error.
 let s=await state('waiting');
 check('known cooling shows the neutral waiting label on the draft action',isWaiting(s)&&s.text===WAIT_ZH&&!s.alert,s);
 check('a stale draft does not look reviewable',s.text!=='查看草稿');
 check('other actions on the waiting card, other cards and the composer stay usable',await page.evaluate(()=>{const card=document.querySelector('[data-item="waiting"]');const others=[...card.querySelectorAll('[data-action="create_task"],[data-action="snooze"]')];return others.length>0&&others.every(b=>!b.disabled)&&!document.querySelector('[data-item="race"] [data-action="draft_reply"]').disabled&&!document.querySelector('textarea').disabled}));
 // Only the waiting action and its feedback are inspected; source timestamps elsewhere on the card are legitimate.
 check('no countdown or explanatory banner on the waiting action',await page.evaluate(sel=>{const b=document.querySelector(sel),card=b.closest('[data-item]');const feedback=[...card.querySelectorAll('[role="alert"],[role="status"],[data-cooling-note]')].map(x=>x.textContent).join(' ');return b.textContent.trim()==='等待消息稳定'&&!/\d/.test(b.textContent)&&!b.title&&!feedback.trim()},draftBtn('waiting')));
 s=await state('current-draft');
 check('a current saved draft stays viewable during cooling',s&&s.text==='查看草稿'&&!s.disabled&&!s.waiting,s);
 // The shared derived-message caller shows the same wait on its draft chip; its other chips stay usable.
 const chip='[data-message-actions] [data-action="draft_reply"]';
 await page.waitForSelector(chip,{timeout:T});
 check('derived message draft action waits neutrally; other message actions stay usable',await page.evaluate(sel=>{const b=document.querySelector(sel),row=b.closest('[data-message-actions]');return b.disabled&&b.dataset.waiting==='cooling'&&b.textContent.trim()==='等待消息稳定'&&!row.querySelector('[role="alert"]')&&[...row.querySelectorAll('[data-action="create_task"],[data-action="snooze"]')].every(x=>!x.disabled)},chip));
 await shot('known-waiting');

 // Race: the card looks ready, the source settles into a new window as the POST arrives.
 await fx('arm-race',{id:'race',seconds:25});
 await click(draftBtn('race'),'起草时来源刚更新');
 await until(sel=>document.querySelector(sel)?.dataset.waiting==='cooling',draftBtn('race'));
 s=await state('race');
 check('race refusal becomes the same neutral wait, not a red error',isWaiting(s)&&!s.alert,s);
 check('race made one request and no model call',await posts('race')===1&&await calls('race')===0);
 await shot('race-waiting');

 // Extension: a later deadline replaces the earlier one; the earlier timer cannot unlock the newer version.
 await fx('deadline',{id:'extend',seconds:8});await focusRefresh();
 await until(sel=>document.querySelector(sel)?.dataset.waiting==='cooling',draftBtn('extend'));
 await sleep(2000);await fx('deadline',{id:'extend',seconds:22});
 await sleep(8000); // the first deadline and its timer have passed
 check('earlier deadline passing does not unlock the extended version',isWaiting(await state('extend')),await state('extend'));
 await readyLabel(draftBtn('extend'),WAIT_ZH);
 check('extended wait ends without reload or tab switch, back to the normal action',!(await state('extend')).alert);
 await shot('ready-after-extension');

 // Remount during a wait keeps it.
 await click('text="任务"','切换到任务');await click('text="洞察"','回到洞察');
 await page.waitForSelector(draftBtn('waiting'),{timeout:T});
 check('tab remount keeps the waiting state and composer text',isWaiting(await state('waiting'))&&await page.evaluate(()=>document.querySelector('textarea').value==='保留这段聊天输入。'));

 // Expiry with a held, then failed, exact read: the draft never unlocks until a successful read of the current source.
 for(let n=0;n<90&&!(await ev()).heldReads.includes('soon');n++)await sleep(500);
 check('reconciliation read is held after the deadline',(await ev()).heldReads.includes('soon'));
 check('held read keeps the draft waiting; other actions on the card stay usable',isWaiting(await state('soon'))&&await page.evaluate(()=>[...document.querySelectorAll('[data-item="soon"] [data-action="create_task"],[data-item="soon"] [data-action="snooze"]')].every(b=>!b.disabled)));
 await shot('reconcile-held');
 await fx('inbox-read',{id:'soon',mode:'fail'});await fx('inbox-read-release',{id:'soon',outcome:'fail'});
 const readsAfterFail=(await ev()).reads.soon||0;
 await sleep(6000);await focusRefresh();await sleep(1000);
 check('failed reads keep waiting and are retried read-only',isWaiting(await state('soon'))&&((await ev()).reads.soon||0)>readsAfterFail&&!(await state('soon')).alert);
 await fx('inbox-read',{id:'soon',mode:'normal'});await focusRefresh();
 await readyLabel(draftBtn('soon'),WAIT_ZH);
 check('a later successful read unlocks, without claiming a draft',(await state('soon')).text!=='查看草稿'&&!(await state('soon')).alert);
 check('timers, focus, reads and rendering made no action or model call',await posts('soon')===0&&await posts('extend')===0&&await posts('waiting')===0&&await calls('soon')===0&&await calls('extend')===0&&await calls('waiting')===0);
 await shot('ready-after-expiry');

 // After the race deadline: exactly one explicit request drafts once.
 await readyLabel(draftBtn('race'),WAIT_ZH);
 await click(draftBtn('race'),'就绪后明确起草一次');
 await until(sel=>document.querySelector(sel)?.textContent.trim()==='查看草稿',draftBtn('race'),LONG);
 check('one explicit request after readiness, one model call',await posts('race')===2&&await calls('race')===1);

 // Honest failures stay failures.
 await click(draftBtn('replied'),'已回复来源起草');
 await until(sel=>!!document.querySelector(sel)?.closest('[data-item]').querySelector('[role="alert"]'),draftBtn('replied'));
 check('already-replied source keeps a red refusal, not a wait',!(await state('replied')).waiting);
 await click(draftBtn('fail'),'模型失败的起草');
 // Production replaces the decision with its execution-recovery card (草稿生成失败, 忽略, 查看详情); there is no draft button left.
 await until(()=>{const card=document.querySelector('[data-item="fail"]');return !!card&&!card.querySelector('[data-action="draft_reply"]')&&card.innerText.includes('草稿生成失败')},undefined,LONG);
 check('real model failure shows the generation-failure recovery card, not a cooling wait',await page.evaluate(()=>{const card=document.querySelector('[data-item="fail"]'),text=card.innerText,buttons=[...card.querySelectorAll('button')].map(b=>b.textContent.trim());return text.includes('草稿生成失败')&&buttons.includes('忽略')&&buttons.includes('查看详情')&&!card.querySelector('[data-waiting]')&&!text.includes('等待消息稳定')}));
 const e=await ev();
 check('no task, send or external call; composer text intact',e.tasks===0&&e.sends===0&&e.externalAttempts===0&&await page.evaluate(()=>document.querySelector('textarea').value==='保留这段聊天输入。'),{tasks:e.tasks,sends:e.sends});
 check('the stale draft was not overwritten during cooling',e.cards.waiting.draft==='公开旧草稿正文。'&&e.cards.waiting.draftStale===true);

 // Dark, English, narrow.
 await setTheme('night');
 const settings=JSON.parse((await page.fetch('/api/settings')).body);
 await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language:'en'},baseSettings:{identity:settings.identity}})});
 await focusRefresh();
 await until(({sel,w})=>document.querySelector(sel)?.textContent.trim()===w,{sel:draftBtn('waiting'),w:WAIT_EN});
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:2,mobile:false});
 await settled();
 check('English dark narrow waiting label',isWaiting(await state('waiting'))&&await page.evaluate(()=>getComputedStyle(document.querySelector('[data-footer-refresh]')).color==='rgb(176, 180, 186)'));
 await shot('waiting-dark-en-narrow');
 await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language:'zh-CN'},baseSettings:{identity:{...settings.identity,language:'en'}}})}).catch(()=>{});
 await fs.writeFile(out+'/http-evidence.json',JSON.stringify(await ev(),null,2));
}catch(err){checks.push({name:String(err?.message||err),pass:false})}
finally{
 const files=['web/src/v6/Brief.tsx','web/src/v6/attention.ts','web/src/v6/MessageActions.tsx','scripts/insight-cooling-fixture.mjs','scripts/insight-cooling-browser-e2e.mjs'];
 const sourceHashes={};for(const f of files){try{sourceHashes[f]=createHash('sha256').update(await fs.readFile(root+'/'+f)).digest('hex')}catch{sourceHashes[f]=null}}
 await fs.writeFile(out+'/browser.json',JSON.stringify({url,page:'p1',scope:'built V6, production HTTP and SQLite, synthetic Feishu records, controlled local model',screenshots:shots,sourceHashes,checks},null,2));
 console.log(JSON.stringify({url,out,passed:checks.filter(c=>c.pass).length,total:checks.length}));
}
// No task.finish(): the coordinator reviews the screenshots and finishes the injected TaskSpace once.
if(!checks.every(c=>c.pass))throw Error('insight cooling browser checks failed');
