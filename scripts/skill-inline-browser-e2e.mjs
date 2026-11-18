// Browser journey for inline (whitespace-bounded) slash tokens in the V6 composer skill picker, against the same
// synthetic fixture as scripts/skill-composer-browser-e2e.mjs (scripts/skill-composer-fixture.mjs: production server
// app, synthetic skills/provider/data; default http://127.0.0.1:47531) and built V6 assets in .local/skill-composer-web.
// Run with: ego-browser nodejs < scripts/skill-inline-browser-e2e.mjs
//
// Input: the literal global SKILL_INLINE_INPUT must hold an ABSOLUTE path to a JSON file
// {"spaceId":<number>,"url":"http://127.0.0.1:47531...","output":"<abs dir>"}. This script resumes exactly that one
// TaskSpace, never binds or finishes another, and leaves finishing to the coordinator after visual review. Scripts do
// not inherit cwd or environment: every path is absolute. Only synthetic skills (notes-tidy, zz-tail, demo-manual)
// are chosen; the single send injects the fixture's SYNTH_BODY marker and runs no real business skill.
const fs=await import('node:fs/promises');
const inputPath=globalThis.SKILL_INLINE_INPUT;
if(typeof inputPath!=='string'||!inputPath.startsWith('/'))throw Error('set globalThis.SKILL_INLINE_INPUT to an absolute JSON path');
const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
if(!Number.isInteger(input.spaceId))throw Error('input JSON needs a numeric spaceId');
if(typeof input.output!=='string'||!input.output.startsWith('/'))throw Error('input JSON needs an absolute output directory');
const given=new URL(input.url||'http://127.0.0.1:47531/cyberme.html'),url=given.pathname.endsWith('.html')?given.href:given.origin+'/cyberme.html';
const task=await taskSpace(input.spaceId),page=task.page('p1');
const out=input.output+'/inline-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(out,{recursive:true});
const T=15000,checks=[],shots=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(!pass&&detail!==undefined?{detail}:{})});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)throw Error(name)};
const until=(fn,arg,timeout=T)=>page.waitForFunction(fn,arg,{timeout});
const fx=async(path,body)=>JSON.parse((await page.fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const state=()=>fx('/fixture/state');
const settled=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,30)))));
const sleep=ms=>page.evaluate(ms=>new Promise(r=>setTimeout(r,ms)),ms);
const shot=async name=>{const path=out+'/'+name+'.png';await page.screenshot({path});shots.push({path,url:await page.evaluate(()=>location.href)})};
const ta='textarea';
const value=()=>page.evaluate(()=>document.querySelector('textarea').value);
const sel=()=>page.evaluate(()=>{const t=document.querySelector('textarea');return [t.selectionStart,t.selectionEnd]});
const menuOpen=()=>page.evaluate(()=>!!document.querySelector('.cm-skill-menu'));
const rows=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-skill-row .cm-skill-name')].map(e=>e.textContent));
const token=()=>page.evaluate(()=>document.querySelector('.cm-skill-token-name')?.textContent||null);
const tokens=()=>page.evaluate(()=>document.querySelectorAll('.cm-skill-token').length);
// Places the caret one step away, then reaches n with a real arrow key so React observes the selection change.
const caret=async n=>{await page.evaluate(n=>{const t=document.querySelector('textarea');t.focus();const p=n>0?n-1:1;t.setSelectionRange(p,p)},n);await page.press(ta,n>0?'ArrowRight':'ArrowLeft');await settled()};
// fill() then an explicit caret; `at` defaults to the end. Offsets are UTF-16 indexes (all text here is BMP).
const type=async(text,at)=>{await page.fill(ta,text);await settled();await caret(at===undefined?text.length:at)};
const key=async opts=>{const prevented=await page.evaluate(o=>{const e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...o});document.querySelector('textarea').dispatchEvent(e);return e.defaultPrevented},opts);await settled();return prevented};
const composition=t=>page.evaluate(t=>document.querySelector('textarea').dispatchEvent(new CompositionEvent(t,{bubbles:true,data:'中'})),t);
const waitMenuRows=()=>until(()=>document.querySelectorAll('.cm-skill-row').length>0);
const ui=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}'));
const setUI=async patch=>{await page.evaluate(()=>window.dispatchEvent(new Event('cyberme-before-update')));await settled();await page.evaluate(p=>{const v=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...v,...p}))},patch);await page.reload();await page.waitForSelector(ta,{timeout:T});await settled()};
const removeToken=async()=>{const n=await token();if(n){await page.click(`button[aria-label="移除技能 ${n}"]`,{timeout:T});await until(()=>!document.querySelector('.cm-skill-token'))}};
const clickRow=async name=>{const i=(await rows()).indexOf(name);if(i<0)throw Error('row missing '+name);await page.click(`xpath=(//div[contains(@class,"cm-skill-row")])[${i+1}]`,{timeout:T});await until(n=>document.querySelector('.cm-skill-token-name')?.textContent===n,name);await settled()};
const noPostSince=async n=>(await state()).posts.length===n;
const result={url,inputPath,spaceId:input.spaceId,checks,shots,boundary:'Real browser + built production V6 + production server HTTP (GET /api/skills, POST /api/chat) with isolated synthetic skills, data and controlled SSE provider. Synthetic keyboard/composition events, not OS IME. Not installed-app or native WebKit validation.'};
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await page.goto(url);await page.waitForSelector(ta,{timeout:T});
 await page.evaluate(()=>localStorage.removeItem('cyberme-v6-ui'));await setUI({theme:'quiet',conversationId:null,cfg:{enterSend:true,progress:true}});
 await fx('/fixture/skills',{delayMs:0,fail:0});await fx('/fixture/chat-hold',{ms:0});
 const names=(await fx('/api/skills')).items.map(s=>s.name);
 for(const n of ['notes-tidy','zz-tail'])if(!names.includes(n))throw Error('synthetic fixture skill missing: '+n);
 const s0=await state();

 // ---- positives: start of draft and after whitespace anywhere ----
 await type('你好 /');await waitMenuRows();check('"你好 /" opens the full list',(await rows()).length===names.filter(n=>/^[A-Za-z0-9][\w.-]{0,79}$/.test(n)).length);await shot('01-after-cjk-space');
 await type('你好 /notes');await waitMenuRows();check('"你好 /notes" ranks the name first',(await rows())[0]==='notes-tidy');
 await type('/skill:notes');await waitMenuRows();check('"/skill:notes" at start opens',(await rows())[0]==='notes-tidy');
 await type('你好 /skill:notes');await waitMenuRows();check('"你好 /skill:notes" opens',(await rows())[0]==='notes-tidy');
 await type('第一行\n/notes');await waitMenuRows();check('token at the start of a later line opens',(await rows())[0]==='notes-tidy');
 await type('a\t/zz');await waitMenuRows();check('token after a tab opens',(await rows())[0]==='zz-tail');
 await type('你好　/zz');await waitMenuRows();check('token after an ideographic space opens',(await rows())[0]==='zz-tail');
 await type('  /zz');await waitMenuRows();check('token after leading spaces opens',(await rows())[0]==='zz-tail');

 // ---- negatives stay inert ----
 const neg=[['你好/sub'],['你好/'],['see https://example.invalid/notes'],['open /Users/x/notes'],['a/b /c/d'],['你好 //notes'],['x /a:b'],['x /skill:a:b'],['x /"notes"'],
  ['你好 \\/notes'],['> 你好 /notes'],['  > /notes'],['说 `x /notes'],['说 `x /notes` 了',8],['说 ``a ` /notes x`` 了',12],['说 ``a` ` /notes x``',12],['说 ``a`` ``b /notes'],
  ['```\n/notes'],['```\nx\n/notes'],['~~~\n你好 /notes'],['```js /notes'],['````\n```\n/notes'],['~~~\n```\n/notes'],['```\n```js\n/notes'],['  ```\n\t/notes']];
 for(const [raw,at] of neg){await type(raw,at);check('no menu for '+JSON.stringify(raw)+(at!==undefined?' @'+at:''),!await menuOpen())}
 await type('```\nx\n```\n你好 /notes');await waitMenuRows();check('token after a closed fence opens',(await rows())[0]==='notes-tidy');
 await type('说 `x` /notes');await waitMenuRows();check('token after closed inline code opens',(await rows())[0]==='notes-tidy');
 await type('说 ``a ` b`` /notes');await waitMenuRows();check('token after a closed double-backtick span opens',(await rows())[0]==='notes-tidy');
 await type('````\n```\n````\n/notes');await waitMenuRows();check('fence closed only by a run at least as long, then opens',(await rows())[0]==='notes-tidy');
 await type('~~~\nx\n~~~~\n你好 /notes');await waitMenuRows();check('tilde fence closed by a longer tilde run, then opens',(await rows())[0]==='notes-tidy');
 await type('``` /notes` x\n/notes');await waitMenuRows();check('backtick line with a backtick info string is not a fence',(await rows())[0]==='notes-tidy');
 for(const raw of ['    /notes','\t/notes','第一行\n\t/notes','  \t /notes']){await type(raw);await waitMenuRows();check('indentation alone does not suppress '+JSON.stringify(raw),(await rows())[0]==='notes-tidy')}
 await type('你好 /notes');await page.press(ta,'Shift+ArrowLeft');await page.press(ta,'Shift+ArrowLeft');await settled();
 check('selection is really non-collapsed',JSON.stringify(await sel())==='[7,9]',await sel());
 check('a non-collapsed selection inside the token keeps the picker closed',!await menuOpen());
 check('Tab with a selection is not taken by the picker',!await key({key:'Tab'})&&!await token()&&await value()==='你好 /notes');
 await type('你好 /notes',3);check('caret before the slash stays closed',!await menuOpen());
 await type('你好 /notes 世界');check('caret in the following word stays closed',!await menuOpen());
 await type('ordinary 你好 text');check('ordinary typing unaffected',!await menuOpen()&&await value()==='ordinary 你好 text');

 // ---- caret in the middle of a mid-draft token: only that token is removed, caret at its start ----
 await type('你好 /notes 世界',6);await waitMenuRows();check('caret inside a middle token opens',(await rows())[0]==='notes-tidy');await shot('02-caret-middle');
 check('Enter chooses without sending',await key({key:'Enter'})&&await token()==='notes-tidy'&&await noPostSince(s0.posts.length));
 check('prefix and suffix bytes kept exactly',await value()==='你好  世界',await value());
 check('caret restored at the token start',JSON.stringify(await sel())==='[3,3]',await sel());
 check('selected skill closes the picker for other tokens',!await menuOpen());await shot('03-chosen-middle');
 await key({key:'Backspace'});check('Backspace away from index 0 keeps the capsule',await token()==='notes-tidy');
 await page.press(ta,'Backspace');await settled();check('Backspace at a non-zero caret edits text only',await token()==='notes-tidy'&&await value()==='你好 世界',await value());
 await removeToken();

 // ---- newline-bounded token chosen by pointer ----
 await type('第一行\n/notes 尾巴',8);await waitMenuRows();await clickRow('notes-tidy');
 check('click keeps the newline prefix and suffix',await value()==='第一行\n 尾巴',await value());
 check('click restores the caret at the token start',JSON.stringify(await sel())==='[4,4]',await sel());
 await removeToken();

 // ---- non-BMP prefix/suffix: UTF-16 offsets (😀 and 🎉 are surrogate pairs, 2 code units each) ----
 const emo='😀你好 /notes 🎉尾';check('emoji draft offsets are UTF-16',emo.indexOf('/')===5&&emo.length===15);
 await type(emo,8);await waitMenuRows();check('caret after an emoji prefix opens the token',(await rows())[0]==='notes-tidy');
 await key({key:'Enter'});
 check('emoji prefix and suffix bytes kept exactly',await token()==='notes-tidy'&&await value()==='😀你好  🎉尾',await value());
 check('caret restored at the token start after the emoji (UTF-16 5)',JSON.stringify(await sel())==='[5,5]',await sel());
 check('no surrogate was split',await page.evaluate(()=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(document.querySelector('textarea').value)));
 await removeToken();
 await type('🎉/notes');check('emoji glued to the slash stays inert',!await menuOpen());

 // ---- multiple tokens: the active one only; Escape is per token ----
 const multi='/zz 中间 /notes 末尾';
 await type(multi,2);await waitMenuRows();check('first token searches its own query',(await rows())[0]==='zz-tail');
 await caret(12);await waitMenuRows();check('second token searches its own query',(await rows())[0]==='notes-tidy');
 check('Escape dismisses the second token',await key({key:'Escape'})&&!await menuOpen());
 await caret(10);check('caret moves inside the dismissed token keep it closed',!await menuOpen());
 await caret(2);await waitMenuRows();check('another token still opens after Escape',(await rows())[0]==='zz-tail');
 await caret(12);check('returning to the dismissed token keeps it closed',!await menuOpen());
 await page.keyboard.insertText('-');await settled();check('editing the dismissed token reopens',await menuOpen()&&await value()==='/zz 中间 /note-s 末尾',await value());
 await type(multi,12);await waitMenuRows();await key({key:'Tab'});
 check('Tab removes only the second token',await token()==='notes-tidy'&&await value()==='/zz 中间  末尾'&&await tokens()===1,await value());
 check('caret at the removed token start',JSON.stringify(await sel())==='[7,7]',await sel());
 await caret(2);check('raw first token stays text while a skill is selected',!await menuOpen()&&await tokens()===1);
 await removeToken();

 // ---- keyboard / IME semantics for inline tokens ----
 await type('你好 /notes');await waitMenuRows();
 await composition('compositionstart');check('composition Enter does not choose',!await key({key:'Enter',isComposing:true})&&!await token());
 await composition('compositionend');check('WebKit 229 Enter does not choose',!await key({key:'Enter',keyCode:229})&&!await token());
 check('repeat Enter does not choose',await key({key:'Enter',repeat:true})&&!await token());
 for(const m of ['ctrlKey','metaKey','altKey'])check('modified Tab ('+m+') keeps native behavior',!await key({key:'Tab',[m]:true})&&!await token());
 await key({key:'ArrowDown'});await key({key:'ArrowUp'});check('arrows keep the inline list',await menuOpen());
 await page.press(ta,'Shift+Enter');await settled();check('Shift+Enter inserts a newline, not a choice',!await token()&&await value()==='你好 /notes\n'&&await noPostSince(s0.posts.length));

 // ---- persistence: reload and conversation switch keep the inline result ----
 await type('前缀 /notes 后缀',5);await waitMenuRows();await key({key:'Enter'});await sleep(600);
 await page.reload();await page.waitForSelector(ta,{timeout:T});await settled();
 check('reload restores capsule and exact text',await token()==='notes-tidy'&&await value()==='前缀  后缀',await value());
 await setUI({conversationId:'side'});check('side conversation has its own empty draft',!await token()&&await value()==='');
 await setUI({conversationId:null});check('primary draft restored after switch',await token()==='notes-tidy'&&await value()==='前缀  后缀');
 const d=(await ui()).drafts.primary;check('saved draft holds the skill and exact text',d?.skill?.name==='notes-tidy'&&d?.text==='前缀  后缀',d);

 // ---- serialized real HTTP send (synthetic skill only) ----
 const before=(await state()).posts.length;await page.press(ta,'Enter');
 await until(n=>fetch('/fixture/state').then(r=>r.json()).then(s=>s.posts.length>n),before,40000);
 await until(()=>document.querySelector('.cm-chat-scroll')?.innerText.includes('INVOKED:SYNTH_BODY_notes-tidy'),undefined,40000);await sleep(600);
 const st=await state(),sent=st.posts.slice(before);
 check('exactly one request',sent.length===1,sent.length);
 check('canonical leading /skill:name then the remaining text',sent[0].message==='/skill:notes-tidy 前缀  后缀',sent[0].message);
 check('normal chat path',sent[0].mode==='chat');
 check('server parser injected exactly the synthetic skill',st.seen.at(-1).invoked.join()==='SYNTH_BODY_notes-tidy');
 check('sent capsule shown in the bubble',await page.evaluate(()=>[...document.querySelectorAll('[data-sent-skill]')].some(e=>e.getAttribute('data-sent-skill')==='notes-tidy')));
 check('accepted send clears text and capsule',!await token()&&await value()==='');await shot('04-sent');
 const end=await state();check('no OS command, task or external send intent',end.commandOperations===0&&end.sendIntents===0&&end.tasks===s0.tasks);
 result.pass=true;
}catch(e){result.pass=false;result.error=String(e?.message||e)}
finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:checks.length,out}))}
if(!result.pass)throw Error('skill inline browser journey failed: '+result.error);
