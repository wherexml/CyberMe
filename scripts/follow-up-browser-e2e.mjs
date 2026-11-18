// Browser E2E (built production UI) for continuous follow-up. Spec: docs/public/follow-up.md.
// Run after: node --import tsx scripts/follow-up-browser-fixture.mjs   (port 46934)
//   ego-browser nodejs < scripts/follow-up-browser-e2e.mjs
// Uses the coordinator-named existing task space/page (FOLLOW_UP_TASKSPACE / FOLLOW_UP_PAGE) and never finishes
// it: the coordinator owns its lifetime across regression flows. Records URL + screenshots under output/follow-up-browser-<stamp>/.
// Not a substitute for installed MyGO WebKit verification.
// The coordinator names an EXISTING task space and page; this script never creates or claims one.
const SPACE=process.env.FOLLOW_UP_TASKSPACE,PAGE=process.env.FOLLOW_UP_PAGE||'p1';
if(!SPACE)throw Error('Set FOLLOW_UP_TASKSPACE (and optionally FOLLOW_UP_PAGE) to an existing ego task space');
const task=await taskSpace(SPACE),page=task.page(PAGE);
const fs=await import('node:fs/promises'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=process.cwd()+'/output/follow-up-browser-'+stamp;
await fs.mkdir(out,{recursive:true});
const url='http://127.0.0.1:46934',DRAFT='我的草稿：先不要发',checks={},shots=[];
const shot=async name=>{const path=`${out}/${name}.png`;await page.screenshot({path});shots.push({name,path,url:await page.evaluate(()=>location.href)});};
const ok=(name,value)=>{checks[name]=!!value;console.log((value?'PASS ':'FAIL ')+name);};
const api=(path,init)=>page.evaluate(async([p,i])=>{const r=await fetch(p,i&&{...i,headers:{'content-type':'application/json'}});return {status:r.status,data:await r.json().catch(()=>({}))};},[path,init]);
const draftValue=()=>page.evaluate(()=>document.querySelector('#cyberme-v6 textarea')?.value);
const labels=()=>page.evaluate(()=>[...document.querySelectorAll('#cyberme-v6 [aria-label]')].map(e=>e.getAttribute('aria-label')));
let passed=false;
try{
 // Controlled existing state: the composer draft for the main conversation, as V6 persists it.
 await page.goto(url);
 await page.evaluate(d=>{const k='cyberme-v6-ui';let s={};try{s=JSON.parse(localStorage.getItem(k)||'{}')}catch{}s.drafts={...(s.drafts||{}),main:{text:d,quote:null,refs:[]}};s.conversationId='main';localStorage.setItem(k,JSON.stringify(s));},DRAFT);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#cyberme-v6')?.innerText.includes('Bob有新回复'));
 ok('reminder visible in the owning conversation',true);
 ok('existing draft restored into the composer',await draftValue()===DRAFT);
 const l=await labels();
 ok('exact accessible controls on the reminder',['确认完成','继续跟进','推迟到明早','取消跟进'].every(x=>l.includes(x)));
 ok('reminder quotes the actual reply without a duplicate status line',await page.evaluate(()=>{const t=document.querySelector('#cyberme-v6').innerText;return t.includes('同意，不过预算要再看')&&!t.includes('需要你判断，Bob');}));
 await shot('reminder');
 // Two matters: continuing Bob must not touch Dan, and must reach the real decide route.
 const danBefore=(await api('/api/tasks/fx-task-dan/follow-up')).data?.followUp;
 await page.click('css=#cyberme-v6 [aria-label="继续跟进"]');
 await page.waitForFunction(async()=>(await (await fetch('/api/tasks/fx-task-bob/follow-up')).json()).followUp?.state==='waiting');
 const bob=(await api('/api/tasks/fx-task-bob/follow-up')).data?.followUp,dan=(await api('/api/tasks/fx-task-dan/follow-up')).data?.followUp;
 ok('continue reached the decide route (Bob waiting, revision 3)',bob?.state==='waiting'&&bob?.revision===3);
 ok('other matter untouched',dan?.revision===danBefore?.revision&&dan?.state==='waiting');
 ok('draft preserved after the action and refresh',await draftValue()===DRAFT);
 await shot('after-continue');
 // Stale action: the old revision is rejected by the server and the old reminder no longer acts.
 const stale=await api('/api/tasks/fx-task-bob/follow-up/decide',{method:'POST',body:JSON.stringify({operationId:'browser-stale',revision:2,checkId:'chk-bob-1',decision:'confirm'})});
 ok('stale revision rejected 409',stale.status===409);
 ok('old reminder withdrawn or shown as outdated without controls',await page.evaluate(()=>{const t=document.querySelector('#cyberme-v6').innerText;return !t.includes('Bob有新回复')||(t.includes('此提醒已过期')&&!document.querySelector('#cyberme-v6 [aria-label="确认完成"]'));}));
 // Reload/reopen keeps state and draft; the task detail shows the matter concisely.
 await page.reload();await page.waitForFunction(()=>!!document.querySelector('#cyberme-v6 textarea'));
 ok('after reload the draft is still present',await draftValue()===DRAFT);
 await page.click('text="任务"');
 await page.click('text="跟进 Dan 会议材料"');
 await page.waitForFunction(()=>/跟进中，等待Dan/.test(document.querySelector('#cyberme-v6').innerText));
 ok('task detail shows the follow-up state line',await page.evaluate(()=>/跟进中，等待Dan/.test(document.querySelector('#cyberme-v6').innerText)));
 ok('follow-up detail has no generic complete action',await page.evaluate(()=>![...document.querySelectorAll('#cyberme-v6 button')].some(e=>/标记完成/.test(e.textContent||''))));
 await shot('task-detail');
 ok('no new navigation entry for follow-ups',await page.evaluate(()=>![...document.querySelectorAll('#cyberme-v6 nav a,#cyberme-v6 nav button,#cyberme-v6 [role=tab]')].some(e=>/跟进/.test(e.textContent||''))));
 passed=Object.values(checks).every(Boolean);
}finally{
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'built production UI, synthetic HTTP fixture 46934; NOT installed MyGO',url,checks,shots},null,2));
 console.log(checks);
 // The task space stays open on success and failure; the coordinator finishes it after its final browser round.
}
if(!passed)throw Error('Browser follow-up check failed');
