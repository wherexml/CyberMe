// Failure cases: docs/public/intent-handling.md. Public synthetic data only, isolated port 46840.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/intent-handling-web
// Fixture: node --import tsx scripts/intent-handling-http-e2e.mjs --serve
// Run: ego-browser nodejs < scripts/intent-handling-browser-e2e.mjs (artifact path below is absolute; shell env is not inherited)
// The TaskSpace stays open on purpose so its screenshots can be inspected; the coordinator finishes it.
const task=await taskSpace('CyberMe 意图处理验收'),page=task.page('p1');
console.log('TaskSpace',task.spaceId);
const fs=await import('node:fs/promises'),out=process.env.INTENT_E2E_ARTIFACTS||process.cwd()+'/output/intent-handling';
await fs.mkdir(out,{recursive:true});
const base='http://127.0.0.1:46840',checks=[];
const check=(name,pass,evidence)=>{checks.push({name,pass:!!pass,...(evidence===undefined?{}:{evidence})});if(!pass)throw new Error(name+' '+JSON.stringify(evidence??null))};
const capture=async name=>{await page.waitForFunction(()=>document.getAnimations().every(a=>!Number.isFinite(a.effect?.getComputedTiming().endTime)||a.playState==='finished'||a.playState==='idle'));await page.screenshot({path:out+'/'+name+'.png'})};
const text=()=>page.evaluate(()=>document.body.innerText);
const row=id=>page.evaluate(async id=>(await fetch('/api/inbox/'+id,{cache:'no-store'})).json(),id);
const composer=()=>page.evaluate(()=>document.querySelector('textarea')?.value||'');
const openSub=label=>page.click(`css=button:text-is("${label}")`);
const inCard=(id,label)=>page.click(`css=[data-item="${id}"] button:text-is("${label}")`);
const ackUndo=()=>page.click('css=[data-dismiss-ack] button:text-is("撤销")');
const hasAck=title=>page.evaluate(title=>[...document.querySelectorAll('[data-dismiss-ack]')].some(x=>x.textContent.includes('已忽略：'+title)),title);
const ackCount=()=>page.evaluate(()=>document.querySelectorAll('[data-dismiss-ack]').length);
// Records every chat call the page makes, so "no chat call" is observed rather than assumed.
const watchChat=()=>page.evaluate(()=>{if(window.__chatCalls!==undefined)return;window.__chatCalls=0;const f=window.fetch;window.fetch=(u,o)=>{if(String(u).includes('/api/chat')&&(o?.method||'GET')==='POST')window.__chatCalls++;return f(u,o)}});
const openDetail=id=>page.click(`css=[data-item="${id}"] button:text-is("查看详情")`);
const noise=['联系人变更通知','限时优惠活动','普通闲聊','已解决的讨论','无时间通知','判断失败的普通消息'];
try{
 await page.goto(base);await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='决策'));await openSub('决策');await page.waitForFunction(()=>document.body.innerText.includes('简短请求'));
 await watchChat();
 const dec=await text();
 check('short direct request is a decision card',dec.includes('简短请求')&&dec.includes('能确认吗？'));
 for(const x of noise)check('decision list omits '+x,!dec.includes(x));
 check('decision options drop the chat-only handled command',!dec.includes('不需要回复，标记为已处理'));
 await capture('decisions');

 await openSub('决策');await page.waitForFunction(()=>document.body.innerText.includes('无时间的高风险请求'));
 const ins=await text();
 check('no generic source-changed status',!ins.includes('来源已变化'));
 check('no chat-stuffing re-check action',!ins.includes('重新核对来源'));
 for(const x of noise)check('inspirations omit '+x,!ins.includes(x));
 check('reason-specific time state',ins.includes('消息时间待核实'));
 check('sensitive item stays visible',ins.includes('判断失败的敏感事项'));
 check('manual draft stays visible',ins.includes('无需回复但有人工草稿'));
 check('send_unknown stays visible',ins.includes('发送结果未知')&&ins.includes('发送结果待核实'));
 check('evidence-backed question is shown',ins.includes('这份报表使用哪个季度的数据？'));
 check('no raw JSON dump',!ins.includes('"raw"'));
 check('no system count banner',!ins.includes('等待后台判断')&&!ins.includes('在完整收件箱中查看'));
 check('no dismissal feed for earlier dismissals',await ackCount()===0);
 check('stale inspiration is suppressed',!ins.includes('来源已忽略的灵感'));
 check('live inspiration is kept',ins.includes('来源仍有效的灵感'));
 check('send_unknown card offers no dismiss',await page.evaluate(()=>![...document.querySelectorAll('[data-item="send-unknown"] button')].some(b=>b.textContent==='忽略')));
 await capture('inspirations');

 // Direct dismissal: canonical, composer untouched, no chat call, one acknowledgement.
 const composerBefore=await composer();
 await inCard('time-risk','忽略');
 await page.waitForFunction(()=>document.querySelector('[data-dismiss-ack]')?.textContent.includes('无时间的高风险请求'));
 check('dismiss is canonical',(await row('time-risk')).status==='dismissed');
 check('dismiss did not fill the composer',await composer()===composerBefore);
 check('dismiss made no chat call',await page.evaluate(()=>window.__chatCalls)===0);
 check('undo acknowledgement stays within the scrolled viewport',await page.evaluate(()=>{const r=document.querySelector('[data-dismiss-ack]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}));
 await capture('dismissed');

 // A second dismissal replaces the first: never a queue, and the acknowledgement is not repeated per tab.
 await inCard('missing-state','忽略');
 await page.waitForFunction(()=>document.querySelector('[data-dismiss-ack]')?.textContent.includes('缺资料但没有明确问题'));
 check('only one acknowledgement exists',await ackCount()===1);
 check('the newer dismissal replaced the older acknowledgement',!(await hasAck('无时间的高风险请求')));
 await openSub('决策');check('still one acknowledgement on the other tab',await ackCount()===1);
 await openSub('灵感');

 // Idle expiry: nothing is touched while waiting.
 const started=Date.now();
 await page.waitForFunction(()=>!document.querySelector('[data-dismiss-ack]'),undefined,{timeout:20000});
 const elapsed=Date.now()-started;check('acknowledgement disappears while idle',elapsed>=8000&&elapsed<=17000,elapsed);
 check('expiry keeps the canonical dismissal',(await row('missing-state')).status==='dismissed');
 await openSub('决策');check('expired acknowledgement stays gone on the other tab',await ackCount()===0);

 // Refresh drops the acknowledgement and keeps the dismissal.
 await openSub('决策');await inCard('read-failed-open','忽略');
 await page.waitForFunction(()=>!!document.querySelector('[data-dismiss-ack]'));
 await page.reload();await page.waitForFunction(()=>document.body.innerText.length>50);await watchChat();
 await openSub('灵感');await page.waitForFunction(()=>document.body.innerText.includes('来源仍有效的灵感'));
 check('refresh has no acknowledgement',await ackCount()===0);
 check('refresh keeps the dismissal',(await row('read-failed-open')).status==='dismissed'&&!(await text()).includes('来源不可用但有未决请求'));

 // Classic reads the same record.
 const classic=await task.newPage();await classic.goto(base+'/desktop.html#inbox/read-failed-open');
 const classicRow=await classic.evaluate(async()=>(await fetch('/api/inbox/read-failed-open')).json());
 check('classic reads the same dismissal',classicRow.status==='dismissed'&&!!classicRow.attentionDismissal);

 // Version race: a newer write makes the on-screen undo stale.
 await inCard('manual-draft','忽略');
 await page.waitForFunction(()=>document.querySelector('[data-dismiss-ack]')?.textContent.includes('无需回复但有人工草稿'));
 const fresh=await row('manual-draft');
 await page.evaluate(async({updatedAt})=>{await fetch('/api/inbox/manual-draft',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:'竞争写入的人工草稿',editedByUser:true,baseUpdatedAt:updatedAt})})},{updatedAt:fresh.updatedAt});
 await ackUndo();
 await page.waitForFunction(()=>document.body.innerText.includes('已有更新，未撤销'));
 const raced=await row('manual-draft');check('stale undo keeps the dismissal and newer draft',raced.status==='dismissed'&&raced.draft==='竞争写入的人工草稿');

 // The failure refreshed the version, so the same acknowledgement can now undo, restoring only the status.
 await ackUndo();
 await page.waitForFunction(()=>!document.querySelector('[data-dismiss-ack]')&&!!document.querySelector('[data-item="manual-draft"]'));
 const undone=await row('manual-draft');check('undo restores status and keeps the newer draft',undone.status==='pending'&&undone.draft==='竞争写入的人工草稿'&&!undone.attentionDismissal);

 // Decision card dismissal, then a failure path with visible feedback.
 await openSub('决策');await page.waitForFunction(()=>!!document.querySelector('[data-item="short-request"]'));
 await page.evaluate(()=>{const f=window.fetch;window.__realFetch=f;window.fetch=(u,o)=>String(u).includes('short-request/attention-dismissal')?Promise.resolve(new Response(JSON.stringify({error:'network',message:'fixture failure'}),{status:500,headers:{'content-type':'application/json'}})):f(u,o)});
 await inCard('short-request','忽略');
 await page.waitForFunction(()=>document.body.innerText.includes('未能忽略'));
 check('failed dismissal keeps the matter pending',(await row('short-request')).status==='pending');
 await page.evaluate(()=>{window.fetch=window.__realFetch});
 await inCard('short-request','忽略');
 await page.waitForFunction(()=>document.querySelector('[data-dismiss-ack]')?.textContent.includes('简短请求'));
 check('decision card dismissal is canonical',(await row('short-request')).status==='dismissed');

 // Recheck reports what actually came back. A real 200/failed judgment is never called finished.
 await openSub('决策');await openDetail('failed-sensitive');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='重新判断'));
 check('detail has no chat-only watch action',!(await text()).includes('继续观察'));
 const composerRecheck=await composer();
 await page.evaluate(()=>fetch('/__fixture/model',{method:'POST',body:JSON.stringify({kind:'http',status:500})}));
 await page.click('css=button:text-is("重新判断")');
 await page.waitForFunction(()=>document.body.innerText.includes('暂时无法重新判断'));
 check('a 200/failed judgment shows failure, not completion',!(await text()).includes('重新判断完成'));
 check('recheck failure omits internal model errors',!(await text()).includes('Jev HTTP'));
 check('the record really failed',(await row('failed-sensitive')).triage?.status==='failed');
 await capture('recheck-failed');
 await page.evaluate(()=>fetch('/__fixture/model',{method:'POST',body:JSON.stringify({kind:'no_action'})}));
 await page.click('css=button:text-is("重新判断")');
 await page.waitForFunction(()=>document.body.innerText.includes('重新判断完成'));
 check('a succeeded judgment shows completion',(await row('failed-sensitive')).triage?.status==='succeeded');
 check('recheck does not fill the composer',await composer()===composerRecheck);
 check('recheck makes no chat call',await page.evaluate(()=>window.__chatCalls)===0);

 // A retry only queues a job.
 await page.goto(base);await page.waitForFunction(()=>document.body.innerText.length>50);
 await openSub('决策');await page.waitForFunction(()=>!!document.querySelector('[data-item="processing-queued"]'));
 await openDetail('processing-queued');
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='重新判断'));
 await page.click('css=button:text-is("重新判断")');
 await page.waitForFunction(()=>document.body.innerText.includes('已加入处理队列，尚未完成。'));
 check('a queued retry is not called finished',!(await text()).includes('重新判断完成'));
 await capture('recheck-queued');
 console.log(JSON.stringify({pass:true,checks:checks.length}));
}catch(e){console.error(String(e));process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{})}
await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'isolated browser + synthetic fixture; not the installed app',checks},null,2));
