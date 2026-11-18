// Browser check for the processing-deadline copy and one-time GET refresh of cached partial requests, against a
// running scripts/chat-progress-budget-fixture.mjs (start it with PROGRESS_API_PORT=47565 PROGRESS_MODEL_PORT=47566; default http://127.0.0.1:47565) with built V6 assets in
// .local/chat-progress-budget-web. Run with: ego-browser nodejs < scripts/chat-progress-budget-browser-e2e.mjs
//
// TaskSpace: the coordinator creates ONE new space and writes the absolute JSON input file
// /Users/steve/Projects/cyberme/output/chat-phase-watchdog-20261113/browser-input.json (or the literal global
// PROGRESS_BROWSER_INPUT holding another absolute path) with {"spaceId":<number>,"url":"http://127.0.0.1:47565/cyberme.html","output":"<abs dir>"}.
// This script never creates, binds another or finishes a space. Evidence is saved before a failure is thrown.
const fs=await import('node:fs/promises');
const DEFAULT_OUT='/Users/steve/Projects/cyberme/output/chat-phase-watchdog-20261113';
const inputPath=globalThis.PROGRESS_BROWSER_INPUT||DEFAULT_OUT+'/browser-input.json';
const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
if(!Number.isInteger(input.spaceId))throw Error('browser-input.json needs a numeric spaceId');
const given=new URL(input.url||'http://127.0.0.1:47565/cyberme.html'),url=given.pathname.endsWith('.html')?given.href:given.origin+'/cyberme.html';
const task=await taskSpace(input.spaceId),page=task.page('p1');
const out=(input.output||DEFAULT_OUT)+'/browser-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(out,{recursive:true});
const T=20000,checks=[],shots=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(!pass&&detail!==undefined?{detail}:{})});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)throw Error(name)};
const until=(fn,arg,timeout=T)=>page.waitForFunction(fn,arg,{timeout});
const settled=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,30)))));
const http=async(method,path,body)=>{const r=await page.fetch(path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=JSON.parse(r.body)}catch{data=r.body}return {status:r.status,data}};
const state=async()=>(await http('GET','/fixture/state')).data;
const shot=async name=>{const path=out+'/'+name+'.png';await page.screenshot({path});shots.push({path,url:await page.evaluate(()=>location.href)})};
const flushThen=async fn=>{await page.evaluate(()=>window.dispatchEvent(new Event('cyberme-before-update')));await settled();await page.evaluate(fn);await page.reload();await page.waitForSelector('textarea',{timeout:T});await settled()};
const result={url,inputPath,spaceId:input.spaceId,checks,shots,boundary:'Real browser + built production V6 + production server HTTP on isolated synthetic data with a controlled provider. Not installed-app or native WebKit validation.'};
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await page.goto(url);await page.waitForSelector('textarea',{timeout:T});
 // A legacy synchronous request whose single answer timer fired after completed tool work (the historical shape).
 const id='brw'+Date.now().toString(36),rid='cyberme-'+crypto.randomUUID();
 const message='/skill:progress-demo 请实际在公开隔离目录运行合成步骤脚本并回读标记 #loop:'+id;
 const legacy=await http('POST','/api/chat',{conversationId:'primary',message,mode:'chat',requestId:rid});
 check('legacy synchronous timeout after writes keeps the protective 409',legacy.status===409&&JSON.stringify(legacy.data).includes('partial_run_requires_review'),legacy.status);
 let server;for(let i=0;i<100;i++){server=(await http('GET','/api/chat/requests/'+rid)).data;if(!['queued','running','prepared'].includes(server.status))break;await page.evaluate(()=>new Promise(r=>setTimeout(r,200)))}
 check('server reports partial with processing_deadline',server.status==='partial'&&server.failureCode==='processing_deadline',server);
 // Cached client receipt from before this change: partial + model_timeout.
 await flushThen(new Function(`const v=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');v.conversationId=null;v.requests=[...(v.requests||[]).filter(r=>r.requestId!==${JSON.stringify(rid)}),{requestId:${JSON.stringify(rid)},conversationId:'primary',message:${JSON.stringify(message)},contextIds:[],attachmentIds:[],status:'partial',failureCode:'model_timeout',runId:${JSON.stringify(server.runId||'')},createdAt:new Date().toISOString()}];localStorage.setItem('cyberme-v6-ui',JSON.stringify(v))`));
 const posts0=(await state()).chatPosts;
 await until(()=>document.querySelector('.cm-chat-scroll')?.innerText.includes('处理超时，本轮已停止。'));
 const text=await page.evaluate(()=>document.querySelector('.cm-chat-scroll').innerText);
 check('cached model_timeout refreshed to the processing copy',!text.includes('模型回复超时')&&text.includes('处理超时，本轮已停止。'));
 check('existing partial review sentence kept',text.includes('请先核对原操作结果。'));
 check('client receipt updated by GET only',await page.evaluate(id=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).requests.find(r=>r.requestId===id)?.failureCode==='processing_deadline',rid));
 await shot('01-processing-deadline-zh');
 await page.evaluate(()=>new Promise(r=>setTimeout(r,3000)));
 check('no resend: zero POST /api/chat during refresh',(await state()).chatPosts===posts0,{before:posts0,after:(await state()).chatPosts});
 check('no extra banner or view-receipt control',await page.evaluate(()=>![...document.querySelectorAll('button')].some(b=>/查看回执|View receipt/.test(b.textContent||''))));
 // English copy through the isolated fixture settings, then restore.
 const en=await http('PATCH','/api/settings',{identity:{language:'en'}});check('isolated settings switched to English',en.status<400,en.status);
 await page.reload();await page.waitForSelector('textarea',{timeout:T});
 await until(()=>document.querySelector('.cm-chat-scroll')?.innerText.includes('Processing timed out; this turn stopped.'));
 check('English copy is compact and keeps the review sentence',await page.evaluate(()=>{const t=document.querySelector('.cm-chat-scroll').innerText;return t.includes('Processing timed out; this turn stopped.')&&t.includes('Review the original actions before trying again.')&&!t.includes('The model timed out.')}));
 await shot('02-processing-deadline-en');
 check('still no resend after language switch',(await state()).chatPosts===posts0);
 const zh=await http('PATCH','/api/settings',{identity:{language:'zh-CN'}});check('isolated settings restored to zh-CN',zh.status<400,zh.status);
 result.pass=true;
}catch(e){result.pass=false;result.error=String(e?.message||e)}
finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:checks.length,out}))}
if(!result.pass)throw Error('chat progress budget browser journey failed: '+result.error);
