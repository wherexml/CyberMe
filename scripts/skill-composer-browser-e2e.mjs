// Browser journey for the V6 composer skill picker against scripts/skill-composer-fixture.mjs
// (production server app, synthetic skills/provider/data; default http://127.0.0.1:47531) and built V6 assets in
// .local/skill-composer-web. Run with: ego-browser nodejs < scripts/skill-composer-browser-e2e.mjs
//
// TaskSpace binding: the coordinator writes the absolute JSON input file
// /Users/steve/Projects/cyberme/output/skill-composer-20261113/browser-input.json (or the literal global
// SKILL_COMPOSER_INPUT holding another absolute path) with keys {"spaceId":<number>,"url":"http://127.0.0.1:47531...","output":"<abs dir>"}.
// This script resumes exactly that one active space, never binds or finishes another, and leaves finishing to
// the coordinator after visual review. Scripts do not inherit cwd or environment: every path is absolute.
// Results and screenshots (with URL) go to the ignored output directory. Marker text only; no real sub2api.
const fs=await import('node:fs/promises');
const DEFAULT_OUT='/Users/steve/Projects/cyberme/output/skill-composer-20261113';
const inputPath=globalThis.SKILL_COMPOSER_INPUT||DEFAULT_OUT+'/browser-input.json';
const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
if(!Number.isInteger(input.spaceId))throw Error('browser-input.json needs a numeric spaceId');
const given=new URL(input.url||'http://127.0.0.1:47531/cyberme.html'),url=given.pathname.endsWith('.html')?given.href:given.origin+'/cyberme.html';
const OUT=input.output||DEFAULT_OUT;
const task=await taskSpace(input.spaceId),page=task.page('p1');
const out=OUT+'/browser-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(out,{recursive:true});
const T=15000,checks=[],shots=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(!pass&&detail!==undefined?{detail}:{})});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)throw Error(name)};
const until=(fn,arg,timeout=T)=>page.waitForFunction(fn,arg,{timeout});
const fx=async(path,body)=>JSON.parse((await page.fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const state=()=>fx('/fixture/state');
const settled=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,30)))));
const shot=async name=>{const path=out+'/'+name+'.png';await page.screenshot({path});shots.push({path,url:await page.evaluate(()=>location.href)})};
const ta='textarea';
const value=()=>page.evaluate(()=>document.querySelector('textarea').value);
const menuOpen=()=>page.evaluate(()=>!!document.querySelector('.cm-skill-menu'));
const rows=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-skill-row .cm-skill-name')].map(e=>e.textContent));
const token=()=>page.evaluate(()=>document.querySelector('.cm-skill-token-name')?.textContent||null);
// fill() may not emit a React change when the restored value is identical, so the caret is announced with a real key.
const type=async text=>{await page.fill(ta,text);await settled();await caret(text.length)};
// Places the caret one step away, then reaches n with a real arrow key so React observes the selection change.
const caret=async n=>{await page.evaluate(n=>{const t=document.querySelector('textarea');t.focus();const p=n>0?n-1:1;t.setSelectionRange(p,p)},n);await page.press(ta,n>0?'ArrowRight':'ArrowLeft');await settled()};
const key=async opts=>{const prevented=await page.evaluate(o=>{const e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...o});document.querySelector('textarea').dispatchEvent(e);return e.defaultPrevented},opts);await settled();return prevented};
const composition=t=>page.evaluate(t=>document.querySelector('textarea').dispatchEvent(new CompositionEvent(t,{bubbles:true,data:'中'})),t);
const waitMenuRows=()=>until(()=>document.querySelectorAll('.cm-skill-row').length>0);
const ui=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}'));
// Flush the app's debounced draft through its public hook first, so the reload's beforeunload flush cannot overwrite the patch.
const setUI=async patch=>{await page.evaluate(()=>window.dispatchEvent(new Event('cyberme-before-update')));await settled();await page.evaluate(p=>{const v=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...v,...p}))},patch);await page.reload();await page.waitForSelector(ta,{timeout:T});await settled()};
const choose=async(query,name)=>{await type(query);await waitMenuRows();const i=(await rows()).indexOf(name);if(i<0)throw Error('row missing '+name);await page.click(`xpath=(//div[contains(@class,"cm-skill-row")])[${i+1}]`,{timeout:T});await until(n=>document.querySelector('.cm-skill-token-name')?.textContent===n,name)};
const noPostSince=async n=>(await state()).posts.length===n;
const removeToken=async()=>{const n=await token();if(n){await page.click(`button[aria-label="移除技能 ${n}"]`,{timeout:T});await until(()=>!document.querySelector('.cm-skill-token'))}};
const sleep=ms=>page.evaluate(ms=>new Promise(r=>setTimeout(r,ms)),ms);
// Waits until the selected-skill verification GET has reached the fixture (it is then held by delayMs).
const readStarted=before=>until(async n=>(await(await fetch('/fixture/state')).json()).skillReads>n,before);
const postsAbove=n=>until(async n=>(await(await fetch('/fixture/state')).json()).posts.length>n,n,40000);
const toast=text=>until(t=>document.body.innerText.includes(t),text);
const toastGone=text=>until(t=>!document.body.innerText.includes(t),text,10000);
const quoteIntro=async()=>{await page.hover('[data-mid="composer-intro"]');await page.click('button[aria-label="Quote reply"]',{timeout:T});await until(()=>!!document.querySelector('button[aria-label="Remove quote"]'))};
const result={url,inputPath,spaceId:input.spaceId,checks,shots,boundary:'Real browser + built production V6 + production server HTTP (GET /api/skills, POST /api/chat) with isolated synthetic skills, data and controlled SSE provider. Synthetic keyboard/composition events, not OS IME. Not installed-app or native WebKit validation.'};
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
 await page.goto(url);await page.waitForSelector(ta,{timeout:T});
 await page.evaluate(()=>localStorage.removeItem('cyberme-v6-ui'));await setUI({theme:'quiet',conversationId:null,cfg:{enterSend:true,progress:true}});
 const catalog=await fx('/api/skills'),eligible=catalog.items.filter(s=>/^[A-Za-z0-9][\w.-]{0,79}$/.test(s.name));
 const s0=await state();

 // ---- search, ranking, tail, manual, empty ----
 await type('/sub');await waitMenuRows();
 const r1=await rows();check('slash opens list ranked exact/prefix before description',r1[0]==='sub2api'&&r1[1]==='sub2api-report'&&r1.indexOf('notes-tidy')>1,r1.slice(0,5));
 check('menu has no titles, counters or banners',await page.evaluate(()=>{const m=document.querySelector('.cm-skill-menu');return [...m.children].every(c=>c.classList.contains('cm-skill-list'))&&!/\d+\s*(skills|个)/.test(m.innerText.replace(/catalog-\d+/g,''))}));
 await shot('01-slash-sub');
 await type('/SUB2API');await waitMenuRows();check('case-insensitive exact match first',(await rows())[0]==='sub2api');
 await type('/skill:sub2');await waitMenuRows();check('/skill: prefix searches names',(await rows())[0]==='sub2api');
 await type('/');await waitMenuRows();const all=await rows();
 check('bare slash lists every eligible canonical name without a cap',all.length===eligible.length&&all.includes('zz-tail')&&all.includes('demo-manual'),{rows:all.length,eligible:eligible.length});
 check('non-invocable names are not offered',!all.some(n=>/\s/.test(n)));
 await page.evaluate(()=>{const l=document.querySelector('.cm-skill-list');l.scrollTop=l.scrollHeight});await settled();
 check('list scrolls to the tail',await page.evaluate(()=>{const l=document.querySelector('.cm-skill-list'),last=[...l.querySelectorAll('.cm-skill-row')].at(-1).getBoundingClientRect(),b=l.getBoundingClientRect();return last.bottom<=b.bottom+1&&l.scrollHeight>l.clientHeight}));await shot('02-tail-scrolled');
 await type('/遥测');await waitMenuRows();check('Chinese query reaches tail skill by description',JSON.stringify(await rows())==='["zz-tail"]',await rows());
 await type('/合成导出');await waitMenuRows();check('Chinese description match',(await rows())[0]==='demo-manual');
 await type('/不存在的中文词');await until(()=>document.querySelector('.cm-skill-menu')?.innerText.includes('没有匹配的技能'));check('Chinese no-match is honest',!await page.evaluate(()=>!!document.querySelector('.cm-skill-row')));
 await type('/zz');await waitMenuRows();check('tail skill found by name',(await rows())[0]==='zz-tail');
 await type('/demo-manual');await waitMenuRows();check('manual-only skill offered with manual label',(await rows())[0]==='demo-manual'&&await page.evaluate(()=>document.querySelector('.cm-skill-row .cm-skill-src')?.textContent==='手动'));
 await type('/sub2api');await waitMenuRows();check('source shown as concise label',await page.evaluate(()=>document.querySelector('.cm-skill-row .cm-skill-src')?.textContent==='已配置'));
 await type('/qqqqzzzz');await until(()=>document.querySelector('.cm-skill-menu')?.innerText.includes('没有匹配的技能'));check('empty result is honest',true);await shot('03-empty');

 // ---- raw text never triggers ----
 for(const raw of ['/Users/x/sub','see/sub','https://example.invalid/sub','> /sub','`/sub`','/sub/child','//sub','/a:b','/skill:a:b','/C:\\x','/"sub"','\\/sub']){await type(raw);check('no menu for '+JSON.stringify(raw),!await menuOpen())}
 // Tokens after whitespace now open too (inline coverage lives in scripts/skill-inline-browser-e2e.mjs).
 for(const raw of ['see /sub','  /sub','    /sub','\t/sub']){await type(raw);await waitMenuRows();check('menu for whitespace-bounded '+JSON.stringify(raw),await menuOpen())}
 await type('/sub2api task');check('completed raw command with caret after it stays text',!await menuOpen()&&await value()==='/sub2api task'&&!await token());
 await caret(2);check('caret inside initial token reopens',await menuOpen());
 await caret(10);check('caret in the task closes',!await menuOpen());

 // ---- keyboard: Escape, arrows, Enter/Tab, IME, Shift+Enter, repeat ----
 await type('/sub');await waitMenuRows();check('Escape dismisses',await key({key:'Escape'})&&!await menuOpen());
 await caret(2);await caret(4);check('caret/focus moves keep Escape dismissed',!await menuOpen());
 await page.keyboard.insertText('2');await settled();check('editing the token reopens after Escape',await menuOpen());
 await key({key:'Escape'});await page.press(ta,'Backspace');await settled();check('deleting back to an earlier dismissed token reopens',await value()==='/sub'&&await menuOpen());
 await type('/notes');await waitMenuRows();await key({key:'Escape'});await type('/sub');await waitMenuRows();check('typing another query after Escape reopens',await menuOpen());
 for(const m of ['ctrlKey','metaKey','altKey']){check('modified Tab ('+m+') keeps native behavior',!await key({key:'Tab',[m]:true})&&!await token())}
 await type('/sub');await waitMenuRows();
 await composition('compositionstart');check('composition Enter does not choose',!await key({key:'Enter',isComposing:true})&&!await token());
 await composition('compositionend');check('WebKit 229 Enter does not choose',!await key({key:'Enter',keyCode:229})&&!await token());
 check('repeat Enter does not choose',await key({key:'Enter',repeat:true})&&!await token());
 await key({key:'ArrowDown'});check('ArrowDown moves the active row',await page.evaluate(()=>document.querySelector('.cm-skill-row.is-active .cm-skill-name')?.textContent==='sub2api-report'));
 await key({key:'ArrowUp'});await key({key:'ArrowUp'});check('ArrowUp wraps',await page.evaluate(()=>document.querySelector('.cm-skill-row.is-active')===[...document.querySelectorAll('.cm-skill-row')].at(-1)));
 await key({key:'ArrowDown'});check('Enter chooses without sending',await key({key:'Enter'})&&await token()==='sub2api'&&await value()===''&&await noPostSince(s0.posts.length));
 check('choosing calls no model and no OS/task action',(await state()).modelCalls===s0.modelCalls&&(await state()).commandOperations===0&&(await state()).tasks===s0.tasks);
 await shot('04-token');
 await page.click('button[aria-label="移除技能 sub2api"]',{timeout:T});check('remove button clears token',!await token());
 await type('/sub do the task');await caret(4);await waitMenuRows();await key({key:'Tab'});
 check('Tab chooses and keeps the suffix exactly',await token()==='sub2api'&&await value()===' do the task');
 await caret(0);await key({key:'Backspace'});check('Backspace at start removes token, keeps task',!await token()&&await value()===' do the task');
 await type('/sub');await waitMenuRows();await page.press(ta,'Shift+Enter');await settled();
 check('Shift+Enter inserts newline, not a choice',!await token()&&(await value()).includes('\n')&&await noPostSince(s0.posts.length));
 await type('ordinary text with /slash later');check('ordinary typing unaffected',!await menuOpen()&&await value()==='ordinary text with /slash later');

 // ---- catalog loading / failure / retry ----
 await type('');await fx('/fixture/skills',{delayMs:1500});await type('/');
 await until(()=>document.querySelector('.cm-skill-menu')?.innerText.includes('正在载入技能')||document.querySelectorAll('.cm-skill-row').length>0);await shot('05-loading');
 await fx('/fixture/skills',{delayMs:0,fail:1});await type('');await type('/s');
 await until(()=>document.querySelector('.cm-skill-menu')?.innerText.includes('技能载入失败'));
 check('failure clears old rows and offers retry',await page.evaluate(()=>!document.querySelector('.cm-skill-row')&&!!document.querySelector('.cm-skill-retry')));await shot('06-error');
 await page.click('.cm-skill-retry',{timeout:T});await waitMenuRows();check('retry reloads the real catalog',(await rows()).includes('sub2api'));

 // ---- send serialization through production API, quote after command ----
 await type('');await quoteIntro();
 await choose('/sub2api','sub2api');await page.keyboard.insertText('SKILL_COMPOSER_TASK marker');await settled();
 // Duplicates are attempted while the selected-skill verification GET is held, i.e. before the local durable
 // receipt clears the composer (the Send button is still enabled then), so the submit guard is what is exercised.
 const before=(await state()).posts.length,readsBefore=(await state()).skillReads;await fx('/fixture/skills',{delayMs:2500});
 await page.press(ta,'Enter');await readStarted(readsBefore);
 await page.press(ta,'Enter');await key({key:'Enter'});await key({key:'Enter',repeat:true});await page.click('button[aria-label="Send"]',{timeout:T});
 await fx('/fixture/skills',{delayMs:0});
 await until(async n=>(await(await fetch('/fixture/state')).json()).posts.length>=n,before+1);
 await until(()=>document.querySelector('.cm-chat-scroll').innerText.includes('INVOKED:SYNTH_BODY_sub2api'),undefined,40000);
 const st=await state(),sent=st.posts.slice(before);
 check('repeat Enter/click produce exactly one request',sent.length===1,sent.length);
 check('message starts with /skill:name, task follows, quote last',sent[0].message==='/skill:sub2api SKILL_COMPOSER_TASK marker\n\n> 合成引用来源：SKILL_COMPOSER_QUOTE_SOURCE',sent[0].message);
 check('normal chat path, not work choice',sent[0].mode==='chat');
 check('server parser injected exactly the selected skill',st.seen.at(-1).invoked.join()==='SYNTH_BODY_sub2api');
 check('accepted send clears text, quote and token',!await token()&&await value()===''&&!await page.evaluate(()=>!!document.querySelector('button[aria-label="Remove quote"]')));
 check('no OS command, task or external send intent',st.commandOperations===0&&st.sendIntents===0);
 await shot('07-sent');

 // ---- draft persistence: reload and conversation switch ----
 await choose('/sub2api-r','sub2api-report');await page.keyboard.insertText('PRIMARY_DRAFT_MARKER');await settled();await page.evaluate(()=>new Promise(r=>setTimeout(r,600)));
 await page.reload();await page.waitForSelector(ta,{timeout:T});await settled();
 check('reload restores token and text',await token()==='sub2api-report'&&await value()==='PRIMARY_DRAFT_MARKER');
 await setUI({conversationId:'side'});check('side conversation has its own empty draft',!await token()&&await value()==='');
 await choose('/notes','notes-tidy');await page.keyboard.insertText('SIDE_DRAFT_MARKER');await settled();await page.evaluate(()=>new Promise(r=>setTimeout(r,600)));
 await page.click('button[title="回到主对话"]',{timeout:T});await settled();
 check('switch back restores primary token and text',await token()==='sub2api-report'&&await value()==='PRIMARY_DRAFT_MARKER');
 const saved=(await ui()).drafts;check('both drafts persisted with skill metadata',saved.primary?.skill?.name==='sub2api-report'&&saved.side?.skill?.name==='notes-tidy'&&saved.side?.text==='SIDE_DRAFT_MARKER');

 // ---- races before local acceptance: delay the selected-skill verification GET ----
 // startChat clears after the LOCAL durable receipt (before the POST answers), so pre-acceptance edits are made
 // while the verification read is held; input typed after the local receipt must stand alone.
 await setUI({conversationId:'side'});check('side draft restored',await token()==='notes-tidy'&&await value()==='SIDE_DRAFT_MARKER');
 // A restored textarea starts with the caret at 0; move it to the end so the later edit appends.
 await caret((await value()).length);
 let n=(await state()).posts.length,r=(await state()).skillReads;
 await fx('/fixture/skills',{delayMs:2500});await page.press(ta,'Enter');await readStarted(r);
 await page.keyboard.insertText(' NEWER_EDIT');await settled();await fx('/fixture/skills',{delayMs:0});await postsAbove(n);await sleep(800);
 check('pre-acceptance edit: request carries the snapshot',(await state()).posts.at(-1).message==='/skill:notes-tidy SIDE_DRAFT_MARKER');
 check('pre-acceptance edit kept with its skill',await value()==='SIDE_DRAFT_MARKER NEWER_EDIT'&&await token()==='notes-tidy');
 check('other owner draft untouched',(await ui()).drafts.primary?.text==='PRIMARY_DRAFT_MARKER'&&(await ui()).drafts.primary?.skill?.name==='sub2api-report');

 await type('SIDE_SWITCH_SEND');await sleep(600);n=(await state()).posts.length;r=(await state()).skillReads;
 await fx('/fixture/skills',{delayMs:2500});await page.press(ta,'Enter');await readStarted(r);
 await page.click('button[title="回到主对话"]',{timeout:T});await fx('/fixture/skills',{delayMs:0});await postsAbove(n);await sleep(800);
 const sw=(await state()).posts.at(-1);
 check('switch during verification still sends the side snapshot once',sw.message==='/skill:notes-tidy SIDE_SWITCH_SEND'&&sw.conversationId==='side'&&(await state()).posts.length===n+1);
 check('visible primary draft kept after switch',await token()==='sub2api-report'&&await value()==='PRIMARY_DRAFT_MARKER');
 check('sent side draft cleared only for its owner',(await ui()).drafts.side?.text===''&&!(await ui()).drafts.side?.skill);

 // A quote added while verification is pending must survive the old receipt (primary conversation).
 await removeToken();await choose('/sub2api','sub2api');await page.keyboard.insertText('QUOTE_RACE');await settled();
 n=(await state()).posts.length;r=(await state()).skillReads;
 await fx('/fixture/skills',{delayMs:2500});await page.press(ta,'Enter');await readStarted(r);await quoteIntro();
 await fx('/fixture/skills',{delayMs:0});await postsAbove(n);await sleep(800);
 check('quote race: request carries only the snapshot',(await state()).posts.at(-1).message==='/skill:sub2api QUOTE_RACE');
 check('quote race: newer quote, text and skill kept',await value()==='QUOTE_RACE'&&await token()==='sub2api'&&await page.evaluate(()=>!!document.querySelector('button[aria-label="Remove quote"]')));
 await sleep(600);check('quote race: saved owner draft keeps the quote',!!(await ui()).drafts.primary?.quote&&(await ui()).drafts.primary?.skill?.name==='sub2api');
 await page.click('button[aria-label="Remove quote"]',{timeout:T});

 // After the local receipt, new text stands alone.
 await type('RECEIPT_THEN_TYPE');n=(await state()).posts.length;await fx('/fixture/chat-hold',{ms:2500});await page.press(ta,'Enter');await postsAbove(n);
 await until(()=>document.querySelector('textarea').value==='');await page.keyboard.insertText('AFTER_RECEIPT');await settled();
 check('input after the local receipt does not inherit the sent skill',await value()==='AFTER_RECEIPT'&&!await token());
 await fx('/fixture/chat-hold',{ms:0});check('receipt send serialized its skill',(await state()).posts.at(-1).message==='/skill:sub2api RECEIPT_THEN_TYPE');

 // ---- unverifiable catalog, identity change and removal block send (deterministic order) ----
 await type('');await choose('/sub2api','sub2api');await page.keyboard.insertText('VERIFY_MARKER');await settled();
 n=(await state()).posts.length;await fx('/fixture/skills',{fail:1});await page.press(ta,'Enter');await toast('无法核对技能');
 check('unverifiable catalog blocks send and keeps input',await noPostSince(n)&&await token()==='sub2api'&&await value()==='VERIFY_MARKER');await shot('08-unverifiable');
 await toastGone('无法核对技能');
 await removeToken();await choose('/sub2api-r','sub2api-report');await page.keyboard.insertText('IDENTITY_MARKER');await settled();
 await fx('/fixture/move',{name:'sub2api-report'});await page.press(ta,'Enter');await toast('已不可用或已变更');
 check('identity change blocks send and keeps input',await noPostSince(n)&&await token()==='sub2api-report'&&await value()==='IDENTITY_MARKER');await shot('09-identity-changed');
 await toastGone('已不可用或已变更');
 await removeToken();await choose('/sub2api','sub2api');await page.keyboard.insertText('REMOVED_MARKER');await settled();
 await fx('/fixture/remove',{name:'sub2api'});await page.press(ta,'Enter');await toast('已不可用或已变更');
 check('removed skill blocks send, nothing else resolved',await noPostSince(n)&&await token()==='sub2api'&&await value()==='REMOVED_MARKER');

 // ---- long name, multiline, narrow and dark layouts ----
 await removeToken();
 const longName=(await fx('/api/skills')).items.find(s=>s.name.startsWith('long-')).name;
 await choose('/long-',longName);await page.keyboard.insertText('line one');await page.press(ta,'Shift+Enter');await page.keyboard.insertText('line two\nline three');await settled();
 const bounded=()=>page.evaluate(()=>{const t=document.querySelector('.cm-skill-token').getBoundingClientRect(),c=document.querySelector('.cm-composer-column').getBoundingClientRect(),a=document.querySelector('textarea').getBoundingClientRect();return t.right<=c.right&&t.width<=c.width*.5&&a.width>80&&document.documentElement.scrollWidth<=innerWidth});
 check('long token and multiline stay bounded',longName.length===80&&await bounded());await shot('10-long-multiline');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:2,mobile:false});await settled();
 check('narrow layout stays bounded',await bounded());await shot('11-narrow-token');
 await removeToken();await type('/sub');await waitMenuRows();
 check('narrow menu stays inside the column',await page.evaluate(()=>{const m=document.querySelector('.cm-skill-menu').getBoundingClientRect(),c=document.querySelector('.cm-composer-column').getBoundingClientRect();return m.left>=c.left-1&&m.right<=c.right+1&&m.top>=0}));await shot('12-narrow-menu');
 await setUI({theme:'night'});await removeToken();await type('/sub');await waitMenuRows();
 check('dark menu lists the remaining candidates',(await rows())[0]==='sub2api-report'&&!(await rows()).includes('sub2api'),await rows());await shot('13-dark-menu');
 await key({key:'Enter'});await page.keyboard.insertText('dark task');await settled();check('dark token renders exactly',await token()==='sub2api-report'&&await value()==='dark task');await shot('14-dark-token');
 await removeToken();await type('');await setUI({theme:'quiet'});

 // ---- English UI (isolated fixture settings only; restored afterwards) ----
 const setLanguage=async language=>{const r=await page.fetch('/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{language}})});if(r.status>=400)throw Error('settings PATCH failed '+r.status);await page.evaluate(()=>window.dispatchEvent(new Event('cyberme-before-update')));await settled();await page.reload();await page.waitForSelector(ta,{timeout:T});await settled()};
 await removeToken();await type('');const enPosts=(await state()).posts.length;await setLanguage('en');
 check('English UI active',await page.evaluate(()=>document.querySelector('textarea').placeholder==='Message CyberMe'));
 await type('/demo-manual');await waitMenuRows();
 check('English menu shows Manual label',(await rows())[0]==='demo-manual'&&await page.evaluate(()=>document.querySelector('.cm-skill-row .cm-skill-src')?.textContent==='Manual'));await shot('15-en-menu');
 await key({key:'Enter'});await page.keyboard.insertText('English draft marker');await settled();
 check('English token and remove label are exact',await token()==='demo-manual'&&await value()==='English draft marker'&&await page.evaluate(()=>!!document.querySelector('button[aria-label="Remove skill demo-manual"]')));
 check('English draft is not sent',await noPostSince(enPosts));await shot('16-en-token');
 await page.click('button[aria-label="Remove skill demo-manual"]',{timeout:T});await until(()=>!document.querySelector('.cm-skill-token'));await type('');await sleep(600);
 await setLanguage('zh-CN');check('Chinese UI restored with empty draft',await page.evaluate(()=>document.querySelector('textarea').placeholder==='和 CyberMe 聊天')&&!await token()&&await value()==='');
 const end=await state();check('journey created no OS command, task or external send intent',end.commandOperations===0&&end.sendIntents===0&&end.tasks===s0.tasks);
 result.pass=true;
}catch(e){result.pass=false;result.error=String(e?.message||e)}
finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:checks.length,out}))}
// The result is saved above; a failed journey must not end with a successful process status.
if(!result.pass)throw Error('skill composer browser journey failed: '+result.error);
