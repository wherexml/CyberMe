// Browser journey for reliable typed Insight actions against a fresh scripts/insight-recovery-actions-fixture.mjs (port 46913)
// and built V6 assets in .local/insight-action-recovery-web. Run with ego-browser nodejs.
// TaskSpace: the coordinator injects the literal global INSIGHT_ACTION_RECOVERY_TASK and finishes it once after visual review.
// Scripts do not inherit cwd or environment: every path is absolute. Physical clicks only (15-second timeout); the single
// in-page activation is labelled. Screenshots scroll the affected card into view first.
const fs=await import('node:fs/promises'),{createHash}=await import('node:crypto');
const task=globalThis.INSIGHT_ACTION_RECOVERY_TASK;if(!task)throw Error('INSIGHT_ACTION_RECOVERY_TASK was not injected');
const page=task.page('p1');
const root='/Users/steve/Projects/CyberMe',base='http://127.0.0.1:46913',url=base+'/cyberme.html';
const out=root+'/output/insight-action-recovery-20261112/'+new Date().toISOString().replace(/[:.]/g,'-');
const T=15000,LONG=40000,checks=[],shots=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(name)};
const click=(selector,label)=>page.click(selector,{label,timeout:T});
const until=(fn,arg,timeout=T)=>page.waitForFunction(fn,arg,{timeout});
const fx=async(name,body={})=>JSON.parse((await page.fetch('/__fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const ev=async()=>JSON.parse((await page.fetch('/__fixture/evidence')).body);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const focusRefresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const opt=(id,type='draft_reply')=>`[data-item="${id}"] [data-action="${type}"]`;
const chip=(type='draft_reply')=>`[data-message-actions] [data-action="${type}"]`;
// Success icon: the existing ph-check icon element inside the option.
const hasCheck=sel=>page.evaluate(sel=>!!document.querySelector(sel)?.querySelector('.ph-check'),sel);
const btn=sel=>page.evaluate(sel=>{const b=document.querySelector(sel);if(!b)return null;const card=b.closest('[data-item]')||b.closest('[data-message-actions]');const f=card?.querySelector('[data-action-feedback]');return {text:b.textContent.trim(),phase:b.dataset.phase||'',disabled:b.disabled,waiting:b.dataset.waiting||'',feedback:f?.textContent||'',feedbackPhase:f?.dataset.actionFeedback||''}},sel);
const labelIs=(sel,text,timeout=LONG)=>until(({sel,text})=>document.querySelector(sel)?.textContent.trim()===text,{sel,text},timeout);
const phaseIs=(sel,phase,timeout=LONG)=>until(({sel,phase})=>document.querySelector(sel)?.dataset.phase===phase,{sel,phase},timeout);
const posts=async id=>(await ev()).actionPosts.filter(p=>p.entityId===id);
const calls=async id=>(await ev()).modelCalls[id]||0;
const COMPOSER='保留这段聊天输入。';
async function settled(){let last='';for(let n=0;n<30;n++){const now=await page.evaluate(()=>[getComputedStyle(document.body).backgroundColor,getComputedStyle(document.querySelector('[data-footer-refresh]')||document.body).color].join('|'));if(now===last)return;last=now;await sleep(250)}}
async function shot(name,id){if(id)await page.evaluate(id=>document.querySelector(`[data-item="${id}"]`)?.scrollIntoView({block:'center'}),id);await settled();const path=out+'/'+name+'.png';await page.screenshot({path});shots.push(path)}
async function load(){await page.goto(url);await page.waitForSelector(opt('dup'),{timeout:T})}
await fs.mkdir(out,{recursive:true});
console.log({out});
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 // page.fetch needs the fixture origin before any relative request.
 await page.goto(base+'/__fixture/evidence');
 // Reruns reuse the same TaskSpace and origin: start from clean synthetic UI storage for this exact origin only
 // (no cookies, caches, profiles or other origins are touched).
 const cleaned=await page.evaluate(expected=>{if(location.origin!==expected)return {origin:location.origin,ok:false};for(const k of ['cyberme-v6-ui','cyberme-v6-ui-unsynced'])localStorage.removeItem(k);return {origin:location.origin,ok:localStorage.getItem('cyberme-v6-ui')===null&&localStorage.getItem('cyberme-v6-ui-unsynced')===null}},base);
 check('clean synthetic UI storage on the fixture origin before the first load',cleaned.ok&&cleaned.origin===base,cleaned);
 await load();
 await page.fill('textarea',COMPOSER);

 // Cross-entry: the card and the derived message share one operation.
 await fx('model-hold',{id:'dup',hold:true});
 await page.waitForSelector(chip(),{timeout:T});
 await click(opt('dup'),'卡片起草');
 await labelIs(opt('dup'),'正在起草…');
 let c=await btn(chip());
 check('derived message shows the same running operation and is locked',c.phase==='pending'&&c.disabled&&c.text==='处理中…',c);
 // Labelled in-page activation of the locked chip (a disabled control cannot take a physical click).
 await page.evaluate(sel=>document.querySelector(sel).click(),chip());
 await click('text="任务"','切换到任务');await click('text="洞察"','回到洞察');
 await labelIs(opt('dup'),'正在起草…');
 check('tab remount keeps the running state',true);
 await fx('model-hold',{id:'dup',hold:false});
 await labelIs(opt('dup'),'查看草稿');await labelIs(chip(),'查看草稿');
 check('one POST and one model run across card and message',(await posts('dup')).length===1&&await calls('dup')===1);

 // Lost POST after commit, held then failed GETs, full reload: never a second POST.
 await fx('op-read',{mode:'hold'});await fx('fault',{entityId:'lost',kind:'after'});
 await click(opt('lost'),'起草并丢失响应');
 for(let n=0;n<40&&!(await ev()).heldReads;n++)await sleep(250);
 check('readback is held after the lost POST',(await ev()).heldReads>=1);
 await shot('lost-held','lost');
 await page.reload();await page.waitForSelector(opt('lost'),{timeout:T});
 await phaseIs(opt('lost'),'unknown');
 check('reload restores the unconfirmed operation',(await btn(opt('lost'))).feedback.startsWith('结果未确认'));
 await fx('op-read',{mode:'fail'});await fx('op-read-release',{outcome:'fail'});
 await until(sel=>{const b=document.querySelector(sel);return b&&!b.disabled&&b.textContent.trim()==='再次核对'},opt('lost'));
 await click(opt('lost'),'再次核对（读取失败）');await sleep(1500);
 check('failed readback stays unconfirmed and never re-posts',(await btn(opt('lost'))).phase==='unknown'&&(await posts('lost')).length===1);
 await fx('op-read',{mode:'normal'});await focusRefresh();
 await labelIs(opt('lost'),'查看草稿');
 check('successful readback settles the original operation once',(await posts('lost')).length===1&&await calls('lost')===1);
 await page.fill('textarea',COMPOSER);

 // Local save failure: zero POST; explicit retry of the same operation after storage recovers.
 await page.evaluate(()=>{const k='cyberme-v6-ui',orig=Storage.prototype.setItem;window.__restoreSetItem=()=>{Storage.prototype.setItem=orig};Storage.prototype.setItem=function(key,value){if(key===k)throw new Error('fixture_storage_full');return orig.call(this,key,value)}});
 await click(opt('save'),'保存失败时起草');
 await labelIs(opt('save'),'重试',T);
 c=await btn(opt('save'));
 check('save failure posts nothing and says so',c.phase==='not_saved'&&c.feedback==='未保存，未提交。'&&(await posts('save')).length===0,c);
 await shot('save-failed','save');
 await page.evaluate(()=>window.__restoreSetItem());
 await click(opt('save'),'存储恢复后重试');
 await labelIs(opt('save'),'查看草稿');
 check('explicit retry posts once',(await posts('save')).length===1&&await calls('save')===1);

 // POST never arrives: GET 404, explicit same-ID retry, delayed original becomes a replay.
 await fx('fault',{entityId:'late',kind:'delay'});
 await click(opt('late'),'起草但请求延迟');
 await phaseIs(opt('late'),'missing');
 check('404 offers an explicit retry, nothing automatic',(await btn(opt('late'))).text==='重试'&&(await posts('late')).length===1);
 await click(opt('late'),'明确重试同一操作');
 await labelIs(opt('late'),'查看草稿');
 const replay=await fx('release-delayed');
 const lp=await posts('late');
 check('retry reused the same ID and immutable payload; delayed original replayed; one model run',lp.length===2&&lp[0].operationId===lp[1].operationId&&lp[0].requestRevision===lp[1].requestRevision&&replay[0]?.body?.replayed===true&&await calls('late')===1,{lp,replay});

 // Stale binding: a real 409 shown as such; no model run.
 await fx('fault',{entityId:'stale',kind:'stale'});
 await click(opt('stale'),'起草时请求已变化');
 await until(sel=>document.querySelector(sel)?.closest('[data-item]')?.querySelector('[data-action-feedback]')?.textContent==='事项已变化，请查看最新内容。',opt('stale'),LONG);
 check('stale binding refusal is visible and runs no model',await calls('stale')===0);

 // Ambiguous 503 after commit: settled by GET.
 await fx('fault',{entityId:'ambiguous',kind:'ambiguous'});
 await click(opt('ambiguous'),'起草后收到 503');
 await labelIs(opt('ambiguous'),'查看草稿');
 check('ambiguous 5xx settles by readback without a second POST',(await posts('ambiguous')).length===1&&await calls('ambiguous')===1);

 // Server unknown with exact positive evidence settles; without it, stays unconfirmed.
 await fx('fault',{entityId:'proof',kind:'unknown'});
 await click(opt('proof'),'起草后服务端中断（有证据）');
 await labelIs(opt('proof'),'查看草稿');
 check('positive draft evidence settles an interrupted operation',(await posts('proof')).length===1);
 await fx('fault',{entityId:'absent',kind:'unknown'});
 await click(opt('absent','create_task'),'转任务后服务端中断（无证据）');
 await phaseIs(opt('absent','create_task'),'unknown');
 await until(sel=>!document.querySelector(sel).disabled,opt('absent','create_task'));
 await click(opt('absent','create_task'),'再次核对无证据的操作');await sleep(1500);
 c=await btn(opt('absent','create_task'));
 check('without exact proof it stays unconfirmed, never View task, never re-posted',c.phase==='unknown'&&c.text==='再次核对'&&!c.text.startsWith('查看任务')&&(await posts('absent')).length===1,c);
 await shot('absent-unknown','absent');

 // Known task view, then a new request on the same record.
 await click(opt('task','create_task'),'转成任务');
 await until(sel=>document.querySelector(sel)?.textContent.trim().startsWith('查看任务 · '),opt('task','create_task'),LONG);
 c=await btn(opt('task','create_task'));
 check('exact receipt shows View task with the task’s own status, not completion',c.text.startsWith('查看任务 · ')&&!c.text.includes('已完成'),c);
 await shot('task-view','task');
 await fx('new-request',{id:'task'});await focusRefresh();
 await until(sel=>{const t=document.querySelector(sel)?.textContent.trim()||'';return !!t&&!t.startsWith('查看任务')},opt('task','create_task'),LONG);
 check('an older request’s task does not mark the new request',!(await btn(opt('task','create_task'))).text.startsWith('查看任务'));

 // Detail labels.
 // Saved/old draft and candidate are both shown when both exist.
 await click('[data-item="label-both"] [data-dec-title]','打开同时有旧草稿和候选草稿的详情');
 await page.waitForSelector('[data-draft-section="candidate"]',{timeout:T});
 check('detail shows both the old draft and the candidate',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-draft-label]')].map(x=>x.textContent.trim())))===JSON.stringify(['旧草稿','候选草稿']));
 await shot('detail-both-drafts');
 await click('[aria-label="Back"]','返回洞察');await page.waitForSelector(opt('dup'),{timeout:T});
 for(const [id,label] of [['label-old','旧草稿'],['label-candidate','候选草稿'],['label-current','回复草稿']]){
  await click(`[data-item="${id}"] [data-dec-title]`,'打开详情 '+id);
  await page.waitForSelector('[data-draft-label]',{timeout:T});
  check('detail label for '+id,await page.evaluate(()=>document.querySelector('[data-draft-label]').textContent.trim())===label);
  if(id==='label-old')await shot('detail-old-draft');
  await click('[aria-label="Back"]','返回洞察');await page.waitForSelector(opt('dup'),{timeout:T});
 }

 // Cooling preserved.
 c=await btn(opt('cool'));
 check('cooling wait unchanged',c.waiting==='cooling'&&c.disabled&&c.text==='等待消息稳定',c);

 // Response held after the server completed: the bounded POST times out and the same ID is read back.
 await fx('fault',{entityId:'held',kind:'hold-response'});
 await click(opt('held'),'起草但响应被挂起');
 await labelIs(opt('held'),'查看草稿',70000);
 check('held response after completion settles by readback: one POST, one model run',(await posts('held')).length===1&&await calls('held')===1);

 // Polling exhaustion is FAULT-INJECTED READBACK, not a live model running past the production 90 s model timeout:
 // one real controlled draft completes, its POST response is lost, and the gate reports 'running' for GETs of that exact
 // operation (the stored op is untouched) until released. The held-response case above proves the real 30 s POST timeout.
 await fx('mask-running',{entityId:'slow',on:true});await fx('fault',{entityId:'slow',kind:'after'});
 await click(opt('slow'),'起草（响应丢失，回读被注入为运行中）');
 await until(sel=>{const b=document.querySelector(sel);return b&&b.dataset.phase==='unknown'&&!b.disabled&&b.textContent.trim()==='再次核对'},opt('slow'),90000);
 const slowOp=(await posts('slow'))[0]?.operationId;
 check('bounded polling of an injected running readback becomes a GET-only check, not a stuck busy state',(await posts('slow')).length===1&&!!slowOp&&(await ev()).ops.find(o=>o.id===slowOp)?.status==='succeeded');
 // The real draft already exists canonically, yet the receipt is unconfirmed: no completed check icon.
 check('unconfirmed action shows no success icon even with a current canonical draft',!(await hasCheck(opt('slow')))&&(await btn(opt('slow'))).text==='再次核对');
 await shot('slow-check-again','slow');
 await page.reload();await page.waitForSelector(opt('slow'),{timeout:T});
 await until(sel=>['pending','unknown'].includes(document.querySelector(sel)?.dataset.phase||''),opt('slow'));
 check('pending or unconfirmed after reload shows no success icon',!(await hasCheck(opt('slow'))));
 check('reload keeps the same operation ID',await page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').actions?.['inbox:slow:draft_reply']?.operationId)===slowOp);
 await fx('mask-running',{entityId:'slow',on:false});
 await until(sel=>{const b=document.querySelector(sel);return b?.textContent.trim()==='查看草稿'||(b?.dataset.phase==='unknown'&&!b.disabled)},opt('slow'),LONG);
 if((await btn(opt('slow'))).phase==='unknown')await click(opt('slow'),'再次核对（读取真实记录）');
 await labelIs(opt('slow'),'查看草稿');
 check('settled View draft keeps its success icon',await hasCheck(opt('slow')));
 check('released readback reads the real succeeded record: one POST, one model run',(await posts('slow')).length===1&&await calls('slow')===1&&(await ev()).maskRunning.length===0);
 await page.fill('textarea',COMPOSER);

 // A 404 retry whose local save fails keeps the uncertainty (it may already have run) and posts nothing.
 await fx('fault',{entityId:'late2',kind:'delay'});
 await click(opt('late2'),'起草但请求延迟（二）');
 await phaseIs(opt('late2'),'missing');
 await page.evaluate(()=>{const k='cyberme-v6-ui',orig=Storage.prototype.setItem;window.__restoreSetItem=()=>{Storage.prototype.setItem=orig};Storage.prototype.setItem=function(key,value){if(key===k)throw new Error('fixture_storage_full');return orig.call(this,key,value)}});
 await click(opt('late2'),'保存失败时重试');await sleep(1500);
 c=await btn(opt('late2'));
 check('retry action shows no success icon',!(await hasCheck(opt('late2'))));
 check('save failure on a retry keeps “not confirmed”, never “not submitted”, zero POST',c.phase==='missing'&&c.text==='重试'&&c.feedback.startsWith('结果未确认')&&(await posts('late2')).length===1,c);
 await page.evaluate(()=>window.__restoreSetItem());
 await click(opt('late2'),'存储恢复后重试');
 await labelIs(opt('late2'),'查看草稿');
 await fx('release-delayed');
 const l2=await posts('late2');
 check('same ID retried once after the save recovered; one model run',l2.length===2&&l2[0].operationId===l2[1].operationId&&await calls('late2')===1);

 // Discussion on a derived informational idea is read-only: composer only.
 const pre=await ev();
 // Test-only marker: the discussion chip of the one derived message whose displayed content is exactly 公开观察提醒
 // (idea-info), not those of 公开观察提醒 idea-ack / idea-late. The click itself stays physical.
 const marked=await page.evaluate(()=>{
  const chips=[...document.querySelectorAll('[data-message-actions] [data-action="discuss"]')].filter(b=>{
   let n=b.closest('[data-message-actions]').parentElement;
   for(let i=0;i<8&&n;i++,n=n.parentElement){const t=n.textContent;if(t.includes('公开观察提醒'))return !/公开观察提醒 idea-/.test(t)&&[...n.querySelectorAll('*')].some(x=>x.childElementCount===0&&x.textContent.trim()==='公开观察提醒')}
   return false});
  if(chips.length===1)chips[0].setAttribute('data-test-chip','idea-info-discuss');return chips.length});
 check('exactly one discussion chip belongs to the 公开观察提醒 message',marked===1,{marked});
 await click('[data-test-chip="idea-info-discuss"]','展开聊聊（只读，idea-info）');
 await until(()=>document.querySelector('textarea')?.value.includes('帮我分析判断'));
 const postDiscuss=await ev();
 check('discussion prepares the composer with zero attention POST, model, task or send',postDiscuss.actionPosts.length===pre.actionPosts.length&&JSON.stringify(postDiscuss.modelCalls)===JSON.stringify(pre.modelCalls)&&postDiscuss.tasks.length===pre.tasks.length&&postDiscuss.sends===0);
 await page.fill('textarea',COMPOSER);

 // A pending shared draft takes precedence over opening a new Proposal in the detail.
 await fx('model-hold',{id:'detail-pending',hold:true});
 await click(opt('detail-pending'),'起草（模型挂起）');
 await labelIs(opt('detail-pending'),'正在起草…');
 await click('[data-item="detail-pending"] [data-dec-title]','打开进行中的详情');
 await page.waitForSelector('[data-detail-draft]',{timeout:T});
 check('detail shows the shared pending draft action, not a new Proposal',await page.evaluate(()=>{const b=document.querySelector('[data-detail-draft]');return b.dataset.phase==='pending'&&b.disabled&&b.textContent.trim()==='正在起草…'&&![...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='起草回复'&&!x.hasAttribute('data-detail-draft'))}));
 await shot('detail-pending');
 await fx('model-hold',{id:'detail-pending',hold:false});
 await click('[aria-label="Back"]','返回洞察');await labelIs(opt('detail-pending'),'查看草稿');
 check('detail-pending made one POST',(await posts('detail-pending')).length===1);

 // No recommendation pill on unresolved, retry, check or view-result options.
 check('recommendation pill only on plain actions',await page.evaluate(()=>[...document.querySelectorAll('[data-item] [data-action]')].filter(b=>['unknown','missing','not_saved','pending'].includes(b.dataset.phase||'')||/^(查看任务|查看草稿|再次核对|重试)/.test(b.textContent.trim())).every(b=>!b.textContent.includes('推荐'))));

 // Typed dismiss acknowledgements are bounded by the server undo window from the operation's start.
 // Test-only marker on the chip of one derived message (located by its own text), so the click itself stays physical.
 const markChip=(id,type)=>page.evaluate(({id,type})=>{const own='公开观察提醒 '+id;
  const m=[...document.querySelectorAll('[data-message-actions]')].find(x=>{let n=x.parentElement;for(let i=0;i<8&&n;i++,n=n.parentElement)if(n.textContent.includes(own))return !/公开观察提醒 idea-(ack|late)/.test(n.textContent.replace(own,''));return false});
  const b=m?.querySelector(`[data-action="${type}"]`);if(b)b.setAttribute('data-test-chip',id+'-'+type);return !!b},{id,type});
 check('idea-ack chip located',await markChip('idea-ack','dismiss'));
 await click('[data-test-chip="idea-ack-dismiss"]','忽略灵感（即时成功）');
 await page.waitForSelector('[data-dismiss-ack]',{timeout:T});
 check('a prompt typed dismiss offers Undo',true);
 await until(()=>!document.querySelector('[data-dismiss-ack]'),undefined,20000);
 check('idea-late chip located',await markChip('idea-late','dismiss'));
 const lateBefore=await ev();
 await fx('op-read',{mode:'hold'});await fx('fault',{entityId:'idea-late',kind:'after'});
 const lateClickAt=Date.now();
 await click('[data-test-chip="idea-late-dismiss"]','忽略灵感（结果迟到）');
 // The server has dismissed the idea; a canonical refresh closes it. Its unresolved dismiss must keep a GET-only check entry.
 await focusRefresh();
 await until(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').actions?.['idea:idea-late:dismiss']?.phase==='unknown',undefined,LONG);
 await until(id=>{const own='公开观察提醒 '+id;return [...document.querySelectorAll('[data-message-actions]')].some(x=>{let n=x.parentElement;for(let i=0;i<8&&n;i++,n=n.parentElement)if(n.textContent.includes(own))return !!x.querySelector('[data-action="dismiss"][data-phase="unknown"]');return false})},'idea-late',LONG);
 check('closed idea keeps only its unconfirmed dismiss entry, no fresh actions',await page.evaluate(()=>{const own='公开观察提醒 idea-late';const row=[...document.querySelectorAll('[data-message-actions]')].find(x=>{let n=x.parentElement;for(let i=0;i<8&&n;i++,n=n.parentElement)if(n.textContent.includes(own))return !/公开观察提醒 idea-(ack|info)/.test(n.textContent.replace(own,''))&&!!x.querySelector('[data-action="dismiss"]');return false});return !!row&&[...row.querySelectorAll('[data-action]')].map(b=>b.dataset.action).join()==='dismiss'&&row.querySelector('[data-action="dismiss"]').textContent.trim()==='再次核对'}));
 // Release only after the 20-second server undo window from the operation's start has passed.
 await sleep(Math.max(0,22000-(Date.now()-lateClickAt)));
 await fx('op-read',{mode:'normal'});await fx('op-read-release',{outcome:'ok'});
 check('idea-late check chip located',await markChip('idea-late','dismiss'));
 await until(()=>!document.querySelector('[data-test-chip="idea-late-dismiss"]')?.disabled);
 await click('[data-test-chip="idea-late-dismiss"]','再次核对迟到的忽略');
 await until(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').actions?.['idea:idea-late:dismiss']?.phase==='succeeded',undefined,LONG);
 await sleep(500);
 const lateAfter=await ev();
 check('late dismiss: one POST, unchanged model/task/external counts, and the entry is gone once settled',(await posts('idea-late')).length===1&&JSON.stringify(lateAfter.modelCalls)===JSON.stringify(lateBefore.modelCalls)&&lateAfter.tasks.length===lateBefore.tasks.length&&lateAfter.externalAttempts===lateBefore.externalAttempts&&lateAfter.sends===0&&!(await page.evaluate(()=>!!document.querySelector('[data-test-chip="idea-late-dismiss"]'))));
 check('a late success past the undo window offers no Undo',!(await page.evaluate(()=>!!document.querySelector('[data-dismiss-ack]'))));

 const e=await ev();
 check('no send or external call; model runs only from explicit actions; composer intact',e.sends===0&&e.externalAttempts===0&&Object.entries(e.modelCalls).every(([k,n])=>['dup','lost','save','late','ambiguous','proof','held','slow','late2','detail-pending'].includes(k)&&n===1)&&await page.evaluate(t=>document.querySelector('textarea').value===t,COMPOSER),e.modelCalls);

 // Dark, English, narrow: the unresolved card stays readable.
 await page.evaluate(()=>{const k='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(k)||'{}');ui.theme='night';localStorage.setItem(k,JSON.stringify(ui))});
 const settings=JSON.parse((await page.fetch('/api/settings')).body);
 await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language:'en'},baseSettings:{identity:settings.identity}})});
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:2,mobile:false});
 await load();
 await until(sel=>document.querySelector(sel)?.textContent.trim()==='Check again',opt('absent','create_task'),LONG);
 await until(()=>getComputedStyle(document.querySelector('[data-footer-refresh]')).color==='rgb(176, 180, 186)');
 c=await btn(opt('absent','create_task'));
 check('English dark narrow unconfirmed action',c.feedback.startsWith('Result not confirmed')&&await page.evaluate(()=>{const s=document.querySelector('[data-item="absent"]').closest('.cm-scroll');return s.scrollWidth<=s.clientWidth+1}),c);
 await shot('absent-dark-en-narrow','absent');
 await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language:'zh-CN'},baseSettings:{identity:{...settings.identity,language:'en'}}})}).catch(()=>{});
 // Final isolated segment: capacity. 100 valid unresolved receipts older than 7 days (synthetic entities that no card renders,
 // so nothing reads them back) survive reload exactly; a plain new action is refused locally; composer and drafts untouched.
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await load();await page.fill('textarea',COMPOSER);await sleep(1200);
 const preSeed=await page.evaluate(()=>localStorage.getItem('cyberme-v6-ui'));
 const preDrafts=JSON.stringify(JSON.parse(preSeed||'{}').drafts||{});
 const seeded=await page.evaluate(()=>{
  const k='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(k)||'{}'),old=new Date(Date.now()-8*864e5).toISOString(),until=new Date(Date.now()+864e5).toISOString(),synth={};
  for(let i=0;i<100;i++){const id='cap-'+String(i).padStart(3,'0');synth['inbox:'+id+':snooze']={operationId:'cap-op-'+id,type:'snooze',binding:{entityKind:'inbox',entityId:id,requestMessageId:id+'-m',requestRevision:'rev-'+id},extra:{until},at:old,phase:'unknown'}}
  ui.actions={...(ui.actions||{}),...synth};localStorage.setItem(k,JSON.stringify(ui));return synth});
 await load();
 const identity=r=>JSON.stringify({operationId:r?.operationId,binding:r?.binding,extra:r?.extra,phase:r?.phase,at:r?.at});
 const kept=await page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').actions||{});
 check('100 unresolved receipts older than 7 days survive reload unchanged',Object.keys(seeded).length===100&&Object.entries(seeded).every(([k,r])=>identity(kept[k])===identity(r)));
 const before=await ev();
 await click(opt('dup','create_task'),'容量已满时转成任务');
 await until(sel=>/^(待核对的操作过多，请先核对已有结果。|Too many unconfirmed actions\. Check them first\.)$/.test(document.querySelector(sel)?.closest('[data-item]')?.querySelector('[role="alert"]')?.textContent||''),opt('dup','create_task')); // a local capacity refusal has no receipt phase, hence no data-action-feedback value
 await sleep(1000);
 const afterCap=await ev(),still=await page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}'));
 check('capacity refusal: zero POST, model, task or send',afterCap.actionPosts.length===before.actionPosts.length&&JSON.stringify(afterCap.modelCalls)===JSON.stringify(before.modelCalls)&&afterCap.tasks.length===before.tasks.length&&afterCap.sends===0);
 check('refusal keeps every receipt, the composer text and the unrelated drafts',Object.entries(seeded).every(([k,r])=>identity(still.actions?.[k])===identity(r))&&!still.actions?.['inbox:dup:create_task']&&await page.evaluate(t=>document.querySelector('textarea').value===t,COMPOSER)&&JSON.stringify(still.drafts||{})===preDrafts);
 await shot('capacity-refused','dup');
 await page.evaluate(v=>{if(v===null)localStorage.removeItem('cyberme-v6-ui');else localStorage.setItem('cyberme-v6-ui',v)},preSeed);
 await load();
 check('pre-seed synthetic UI state restored',!Object.keys(await page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').actions||{})).some(k=>k.startsWith('inbox:cap-')));
 await fs.writeFile(out+'/http-evidence.json',JSON.stringify(await ev(),null,2));
}catch(err){checks.push({name:String(err?.message||err),pass:false})}
finally{
 // Restore any injected read mode.
 await fx('mask-running',{entityId:'slow',on:false}).catch(()=>{});await fx('op-read',{mode:'normal'}).catch(()=>{});await fx('op-read-release',{outcome:'fail'}).catch(()=>{});
 const files=['web/src/v6/store.ts','web/src/v6/attention.ts','web/src/v6/attention-action-state.ts','web/src/v6/Brief.tsx','web/src/v6/MessageActions.tsx','scripts/insight-recovery-actions-fixture.mjs','scripts/insight-recovery-actions-browser-e2e.mjs'];
 const sourceHashes={};for(const f of files){try{sourceHashes[f]=createHash('sha256').update(await fs.readFile(root+'/'+f)).digest('hex')}catch{sourceHashes[f]=null}}
 await fs.writeFile(out+'/browser.json',JSON.stringify({url,page:'p1',scope:'built V6, production HTTP and SQLite, synthetic Feishu records, controlled local model',screenshots:shots,sourceHashes,checks},null,2));
 console.log(JSON.stringify({url,out,passed:checks.filter(c=>c.pass).length,total:checks.length}));
}
// No task.finish(): the coordinator reviews the screenshots and finishes the injected TaskSpace once.
if(!checks.every(c=>c.pass))throw Error('insight action recovery browser checks failed');
