// Build .local/chat-ime-web; run node --import tsx scripts/chat-ime-fixture.mjs.
// Run ego-browser nodejs < scripts/chat-ime-browser-e2e.mjs.
// Full product UI + isolated HTTP. Composition ordering is synthetic, not OS IME validation.
const task=await taskSpace('CyberMe 中文输入确认修复'),page=task.page('p1');
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/chat-ime-20261107';
await fs.mkdir(out,{recursive:true});
const checks=[],url='http://127.0.0.1:46816';
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const posts=async()=>await page.evaluate(async()=>await(await fetch('/fixture/attempts')).json());
const key=async(options)=>await page.evaluate(options=>{const e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',code:'Enter',...options});document.querySelector('textarea').dispatchEvent(e);return e.defaultPrevented},options);
const composition=async(type)=>await page.evaluate(type=>document.querySelector('textarea').dispatchEvent(new CompositionEvent(type,{bubbles:true,data:'中文'})),type);
const settled=async()=>await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const noSend=async(name,before,text)=>{await settled();check(name,(await posts()).length===before&&await page.evaluate(text=>document.querySelector('textarea').value===text,text));};
const send=async(name,action)=>{const before=(await posts()).length;await action();await page.waitForFunction(async n=>(await(await fetch('/fixture/attempts')).json()).length===n,before+1);await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('cyberme-v6-ui')).requests.some(r=>['running','prepared'].includes(r.status)));check(name,(await posts()).length===before+1);};
try{
 await page.goto(url);await page.waitForSelector('textarea');
 await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...v,cfg:{...v.cfg,enterSend:true}}))});
 await page.reload();await page.waitForSelector('textarea');
 await page.hover('[data-mid="ime-intro"]');await page.click('button[aria-label="Quote reply"]');await page.fill('textarea','中文确认后还要继续输入');
 const before=(await posts()).length,txt='中文确认后还要继续输入';
 check('native composition flag leaves confirmation untouched',!await key({isComposing:true}));await noSend('isComposing Enter preserves draft without POST',before,txt);
 await composition('compositionstart');
 check('composition lifecycle guards missing native flag',!await key({isComposing:false}));await noSend('composition lifecycle prevents POST',before,txt);
 await composition('compositionend');
 check('WebKit ending composition before Enter stays untouched',!await key({keyCode:229,isComposing:false}));await noSend('WebKit 229 preserves draft without POST',before,txt);
 check('held confirmation Enter prevents newline and repeat send',await key({repeat:true}));await noSend('repeated Enter does not send',before,txt);
 check('quote survives IME confirmation',await page.evaluate(()=>!!document.querySelector('button[aria-label="Remove quote"]')));
 await page.screenshot({path:out+'/confirmed-draft.png'});
 await send('separate Enter sends exactly once',()=>page.press('textarea','Enter'));
 check('sent Chinese body and quote are complete',(await posts()).at(-1).message.includes(txt)&&(await posts()).at(-1).message.includes('你好，有什么需要帮忙的？'));
 await page.fill('textarea','第一行');const n=(await posts()).length;await page.press('textarea','Shift+Enter');await page.keyboard.insertText('第二行');await noSend('Shift+Enter inserts newline without sending',n,'第一行\n第二行');
 await composition('compositionstart');await page.evaluate(()=>document.querySelector('textarea').blur());await page.focus('textarea');
 await send('blur clears stale composition state',()=>page.press('textarea','Enter'));
 await page.evaluate(()=>{const v=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...v,cfg:{...v.cfg,enterSend:false}}))});
 await page.reload();await page.waitForSelector('textarea');await page.fill('textarea','快捷键输入');
 const count=(await posts()).length;await page.press('textarea','Enter');await noSend('Enter-send disabled keeps Enter as newline',count,'快捷键输入\n');
 await composition('compositionstart');await key({metaKey:true});await key({ctrlKey:true});await noSend('composition blocks both modified send shortcuts',count,'快捷键输入\n');await composition('compositionend');await key({keyCode:229,metaKey:true});await noSend('WebKit confirmation also guards modified Enter',count,'快捷键输入\n');
 await send('Cmd+Enter sends after confirmation',()=>page.press('textarea','Meta+Enter'));
 await page.fill('textarea','Ctrl 快捷键');await send('Ctrl+Enter sends after confirmation',()=>page.press('textarea','Control+Enter'));
 await page.fill('textarea','中文确认后还可以继续编辑');await page.screenshot({path:out+'/final-composer.png'});
 console.log({checks:checks.length,pass:true,url,out});
}finally{await fs.writeFile(out+'/browser-result.json',JSON.stringify({url,scope:'Built V6 + isolated HTTP; synthetic composition sequences in Chromium, not native OS IME',checks},null,2))}
await task.finish({keep:[]});
