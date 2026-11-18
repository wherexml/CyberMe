// Browser journey for the sent-message skill capsule against scripts/skill-message-fixture.mjs (production V6 +
// server HTTP, synthetic data; default http://127.0.0.1:47551) with built assets in .local/skill-message-web.
// Run with: ego-browser nodejs < scripts/skill-message-browser-e2e.mjs
//
// TaskSpace: the coordinator creates ONE space and writes the absolute JSON input file
// /Users/steve/Projects/cyberme/output/skill-message-capsule-20261113/browser-input.json (or the literal global
// SKILL_MESSAGE_INPUT holding another absolute path) with {"spaceId":<number>,"url":"http://127.0.0.1:47551/cyberme.html","output":"<abs dir>"}.
// This script never creates, binds another or finishes a space. Evidence is saved before a failure is thrown.
const fs=await import('node:fs/promises');
const DEFAULT_OUT='/Users/steve/Projects/cyberme/output/skill-message-capsule-20261113';
const inputPath=globalThis.SKILL_MESSAGE_INPUT||DEFAULT_OUT+'/browser-input.json';
const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
if(!Number.isInteger(input.spaceId))throw Error('browser-input.json needs a numeric spaceId');
const given=new URL(input.url||'http://127.0.0.1:47551/cyberme.html'),url=given.pathname.endsWith('.html')?given.href:given.origin+'/cyberme.html';
const task=await taskSpace(input.spaceId),page=task.page('p1');
const out=(input.output||DEFAULT_OUT)+'/browser-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(out,{recursive:true});
const T=20000,checks=[],shots=[],ta='textarea';
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(!pass&&detail!==undefined?{detail}:{})});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)throw Error(name)};
const until=(fn,arg,timeout=T)=>page.waitForFunction(fn,arg,{timeout});
const settled=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,30)))));
const sleep=ms=>page.evaluate(ms=>new Promise(r=>setTimeout(r,ms)),ms);
const fx=async(path,body)=>JSON.parse((await page.fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const state=()=>fx('/fixture/state');
const shot=async name=>{const path=out+'/'+name+'.png';await page.screenshot({path});shots.push({path,url:await page.evaluate(()=>location.href)})};
const caret=async n=>{await page.evaluate(n=>{const t=document.querySelector('textarea');t.focus();const p=n>0?n-1:1;t.setSelectionRange(p,p)},n);await page.press(ta,n>0?'ArrowRight':'ArrowLeft');await settled()};
const type=async text=>{await page.fill(ta,text);await settled();await caret(text.length)};
const rows=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-skill-row .cm-skill-name')].map(e=>e.textContent));
const token=()=>page.evaluate(()=>document.querySelector('.cm-skill-token-name')?.textContent||null);
const choose=async(query,name)=>{await type(query);await until(()=>document.querySelectorAll('.cm-skill-row').length>0);const i=(await rows()).indexOf(name);if(i<0)throw Error('row missing '+name);await page.click(`xpath=(//div[contains(@class,"cm-skill-row")])[${i+1}]`,{timeout:T});await until(n=>document.querySelector('.cm-skill-token-name')?.textContent===n,name)};
const flushReload=async patch=>{await page.evaluate(()=>window.dispatchEvent(new Event('cyberme-before-update')));await settled();await page.evaluate(p=>{const v=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...v,...p}))},patch);await page.reload();await page.waitForSelector(ta,{timeout:T});await settled()};
// Projection of one bubble: capsule names, the text that follows the capsule, the quote block, raw innerText.
const bubble=id=>page.evaluate(id=>{const b=document.querySelector(`[data-mid="${id}"]`);if(!b)return null;const caps=[...b.querySelectorAll('.cm-sent-skill')];const cap=caps[0];
 const after=cap?[...cap.parentElement.childNodes].filter(n=>n!==cap).map(n=>n.textContent).join(''):null;
 return {caps:caps.map(c=>c.querySelector('.cm-sent-skill-name')?.textContent),after,text:b.innerText,hasQuote:!!b.querySelector('.ph-quotes'),quote:b.querySelector('.ph-quotes')?.nextElementSibling?.textContent||null}},id);
const result={url,inputPath,spaceId:input.spaceId,checks,shots,boundary:'Real browser + built production V6 + production server HTTP on isolated synthetic data and a controlled provider. Not installed-app or native WebKit validation.'};
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await page.goto(url);await page.waitForSelector(ta,{timeout:T});
 await page.evaluate(()=>localStorage.removeItem('cyberme-v6-ui'));await page.reload();await page.waitForSelector(ta,{timeout:T});
 await until(()=>!!document.querySelector('[data-mid="fp-url"]'));await sleep(2000);
 const s0=await state();
 check('rendering history makes no POST, skill read or model call',s0.posts.length===0&&s0.skillReads===0&&s0.modelCalls===0,{posts:s0.posts.length,skillReads:s0.skillReads,modelCalls:s0.modelCalls});

 // ---- persisted history projection ----
 let b=await bubble('hist-skill');
 check('historical canonical message shows one capsule then the task',JSON.stringify(b.caps)==='["sub2api"]'&&b.after==='SKILL_MSG_HISTORY_TASK 历史任务'&&!b.text.includes('/skill:'),b);
 b=await bubble('hist-multi');
 check('multiline task kept and trailing quote shown as quote',b.caps[0]==='sub2api'&&b.after==='第一行\n第二行'&&b.hasQuote&&b.quote==='引用第一行\n引用第二行',b);
 b=await bubble('hist-only');check('skill-only message stays visible as a capsule',b.caps[0]==='demo-manual'&&b.after==='',b);
 b=await bubble('hist-only-quote');check('skill-only with quote keeps the quote, no blank text',b.caps[0]==='demo-manual'&&b.after===''&&b.quote==='只有引用',b);
 b=await bubble('hist-legacy-quote');check('legacy quote-first message unchanged',!b.caps.length&&b.hasQuote&&b.text.includes('旧版正文 LEGACY_QUOTE_MARKER'),b);
 const st=await state();
 for(const id of ['fp-alias','fp-space','fp-quote','fp-code','fp-mid','fp-path','fp-colon','fp-long','fp-url']){
  b=await bubble(id);const marker=st.history[id].split(' ').at(-1).replace(/\n.*/s,'');
  check('false positive stays plain text: '+id,b&&!b.caps.length&&b.text.includes(marker),b);
 }
 check('read-only capsule: span, no button, no tabindex, no title',await page.evaluate(()=>[...document.querySelectorAll('.cm-sent-skill')].every(c=>c.tagName==='SPAN'&&!c.querySelector('button')&&!c.hasAttribute('tabindex')&&!c.hasAttribute('title')&&!c.closest('button,a'))));
 const loc=await page.evaluate(()=>location.href);await page.click('[data-mid="hist-skill"] .cm-sent-skill',{timeout:T});await sleep(800);
 check('clicking a capsule does nothing',(await state()).posts.length===0&&await page.evaluate(l=>location.href===l&&!document.activeElement?.classList.contains('cm-sent-skill'),loc));
 check('composer token selectors are not matched by history',await page.evaluate(()=>!document.querySelector('.cm-skill-token')));
 await shot('01-history');
 await page.reload();await page.waitForSelector(ta,{timeout:T});await until(()=>!!document.querySelector('[data-mid="hist-skill"] .cm-sent-skill'));await sleep(1500);
 const s1=await state();check('reload re-projects without POST, skill read, model call or data rewrite',s1.posts.length===0&&s1.skillReads===0&&s1.modelCalls===0&&s1.storedUnchanged,s1);

 // ---- direct send through the composer: pending and persisted share the projection ----
 // Scope the quote control to this exact row and wait until hover has made it actionable before clicking it.
 const quoteBtn='[data-mid="hist-skill-reply"] button[aria-label="Quote reply"]';
 await page.evaluate(()=>document.querySelector('[data-mid="hist-skill-reply"]').scrollIntoView({block:'center'}));
 await page.hover('[data-mid="hist-skill-reply"]');
 await until(sel=>{const b=document.querySelector(sel);if(!b)return false;const cs=getComputedStyle(b),r=b.getBoundingClientRect();return cs.opacity==='1'&&cs.pointerEvents!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0},quoteBtn);
 await page.click(quoteBtn,{timeout:T});await until(()=>!!document.querySelector('button[aria-label="Remove quote"]'));
 await choose('/sub2api','sub2api');await page.keyboard.insertText('SKILL_MSG_SEND 你好');await page.press(ta,'Shift+Enter');await page.keyboard.insertText('第二行');await settled();
 await fx('/fixture/chat-hold',{ms:3000});const n0=(await state()).posts.length;await page.press(ta,'Enter');
 await until(async n=>(await(await fetch('/fixture/state')).json()).posts.length>n,n0);
 const sent=(await state()).posts.at(-1);
 check('POST carries the exact raw serialized bytes',sent.message==='/skill:sub2api SKILL_MSG_SEND 你好\n第二行\n\n> 合成回复 hist-skill'&&JSON.parse(sent.raw).message===sent.message,sent.message);
 await until(()=>[...document.querySelectorAll('[data-mid]')].some(e=>e.innerText.includes('SKILL_MSG_SEND')));
 const pend=await page.evaluate(()=>{const e=[...document.querySelectorAll('[data-mid]')].find(e=>e.innerText.includes('SKILL_MSG_SEND'));return e?.getAttribute('data-mid')});
 b=await bubble(pend);check('pending record shows the capsule, task and quote',b.caps[0]==='sub2api'&&b.after==='SKILL_MSG_SEND 你好\n第二行'&&b.quote==='合成回复 hist-skill'&&!b.text.includes('/skill:'),b);
 await shot('02-pending');
 await fx('/fixture/chat-hold',{ms:0});
 await until(()=>document.querySelector('.cm-chat-scroll').innerText.split('SKILL_MSG_REPLY').length>1,undefined,40000);await sleep(1500);
 const count=await page.evaluate(()=>[...document.querySelectorAll('[data-mid]')].filter(e=>e.innerText.includes('SKILL_MSG_SEND')&&e.querySelector('.cm-sent-skill')).length);
 check('persisted message shows exactly one projected bubble (no duplicate token)',count===1,count);
 const persisted=await page.evaluate(()=>[...document.querySelectorAll('[data-mid]')].find(e=>e.innerText.includes('SKILL_MSG_SEND'))?.querySelectorAll('.cm-sent-skill').length);
 check('one capsule in the persisted bubble',persisted===1,persisted);
 check('exactly one POST for the send',(await state()).posts.length===n0+1);

 // ---- skill-only send ----
 await choose('/demo-manual','demo-manual');const n1=(await state()).posts.length;await page.press(ta,'Enter');
 await until(async n=>(await(await fetch('/fixture/state')).json()).posts.length>n,n1);
 check('skill-only POST bytes are exactly the command',(await state()).posts.at(-1).message==='/skill:demo-manual');
 await until(()=>[...document.querySelectorAll('[data-mid] .cm-sent-skill-name')].filter(e=>e.textContent==='demo-manual').length>=3);
 check('skill-only sent message stays visible',true);await shot('03-skill-only');

 // ---- composer unchanged ----
 await choose('/sub2api','sub2api');
 check('composer token still the single .cm-skill-token',await page.evaluate(()=>document.querySelectorAll('.cm-skill-token').length===1)&&await token()==='sub2api');
 await page.click('button[aria-label="移除技能 sub2api"]',{timeout:T});await until(()=>!document.querySelector('.cm-skill-token'));
 check('composer remove still works',!await token());await type('');

 // ---- narrow and dark containment ----
 const contained=()=>page.evaluate(()=>{const c=document.querySelector('[data-mid="hist-long"] .cm-sent-skill');const bub=c.closest('[data-mid]').querySelector('div > div');const r=c.getBoundingClientRect(),p=c.parentElement.parentElement.getBoundingClientRect();return r.right<=p.right+1&&r.width<=p.width+1&&document.documentElement.scrollWidth<=innerWidth});
 await page.evaluate(()=>document.querySelector('[data-mid="hist-long"]').scrollIntoView({block:'center'}));check('long capsule contained (wide)',await contained());await shot('04-long');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:2,mobile:false});await settled();
 await page.evaluate(()=>document.querySelector('[data-mid="hist-long"]').scrollIntoView({block:'center'}));check('long capsule contained (narrow)',await contained());await shot('05-narrow');
 await flushReload({theme:'night'});await until(()=>!!document.querySelector('[data-mid="hist-long"] .cm-sent-skill'));
 await page.evaluate(()=>document.querySelector('[data-mid="hist-multi"]').scrollIntoView({block:'center'}));check('long capsule contained (narrow dark)',await contained());await shot('06-dark-narrow');
 await flushReload({theme:'quiet'});
 const end=await state();
 check('no render-induced POST or replay after all reloads',end.posts.length===n1+1&&end.storedUnchanged,{posts:end.posts.length,expected:n1+1,storedUnchanged:end.storedUnchanged});
 result.pass=true;
}catch(e){result.pass=false;result.error=String(e?.message||e)}
finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:checks.length,out}))}
if(!result.pass)throw Error('skill message browser journey failed: '+result.error);
