// ego-browser nodejs < scripts/mygo-settings-browser-e2e.mjs
// Public workspace only. Binding/model response fixtures test UI semantics, not upstream authorization/inference.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/mygo-1007/settings-'+Date.now();await fs.mkdir(out,{recursive:true});
const p=(await taskSpace(1)).page('p1'),cases=[];function check(name,pass,detail){cases.push({name,status:pass?'PASS':'FAIL',detail});if(!pass)throw Error(name)}
try{
await p.goto('http://127.0.0.1:46300/desktop.html');await p.waitForFunction(()=>window.OpsTwinsDesktop?.loadChat&&!document.querySelector('#desktop-boot'));
await p.evaluate(()=>document.documentElement.classList.add('desktop-native'));
await p.click('button[aria-label="设置"]');await p.click('[data-setting="general"]');
check('removed-general-controls',await p.evaluate(()=>!['正文大小','减少动态效果'].some(s=>document.querySelector('#settings-content').textContent.includes(s))));
await p.click('[data-setting="connections"]');await p.waitForFunction(()=>document.querySelector('[data-provider="wechat"]'));
await p.evaluate(()=>document.querySelector('[data-provider="wechat"] .settings-provider-name').scrollIntoView({block:'center'}));await p.click('[data-provider="wechat"] .settings-provider-name');await p.waitForFunction(()=>document.querySelector('.desktop-island h1')?.textContent==='个人微信');
check('whole-card-opens-detail',true);
await p.evaluate(()=>window.dispatchEvent(new Event('desktop-owner-hidden')));check('hidden-preserves-settings-shell',await p.evaluate(()=>!!document.querySelector('#settings-content .desktop-island')));
await p.evaluate(()=>window.dispatchEvent(new Event('desktop-owner-visible')));await p.waitForFunction(()=>document.querySelector('.desktop-island h1')?.textContent==='个人微信');check('hidden-visible-restores-same-detail',true);
await p.click('[data-setting="general"]');await p.click('[data-setting="connections"]');await p.waitForFunction(()=>document.querySelector('.desktop-island h1')?.textContent==='个人微信');check('section-return-not-blank',true);
await p.click('.settings-back-link');await p.waitForFunction(()=>document.querySelector('.settings-segment'));
await p.click('.settings-segment button:last-child');
check('skill-local-read-only',await p.evaluate(()=>{const form=document.querySelector('.settings-custom-form');return form.querySelector('select').disabled&&form.querySelector('select').value==='none'&&!document.querySelector('.settings-custom-card input[type=password]')&&document.querySelectorAll('.settings-custom-permissions input').length===1&&document.querySelectorAll('.settings-segment [aria-pressed=true]').length===1}));
check('segment-only-selected-raised',await p.evaluate(()=>[...document.querySelectorAll('.settings-segment button[aria-pressed=false]')].every(b=>getComputedStyle(b).boxShadow==='none')));
await p.screenshot({path:out+'/connections.png'});
await p.click('[data-setting="identity"]');await p.waitForFunction(()=>document.querySelector('.desktop-identity'));
await p.click('.desktop-identity .settings-document:nth-of-type(2) .settings-document-header button:last-child');
await p.fill('[aria-label="记忆内容"]','# OPSADV-QA Markdown '+Date.now()+'\n\n## 阅读效果\n\n- **加粗条目**\n- 第二项\n\nEND-MARKDOWN-FULL');await p.click('.desktop-identity .settings-card-actions button:first-child');await p.waitForFunction(()=>!document.querySelector('[aria-label="记忆内容"]'));
const selector=await p.evaluate(()=>{const list=[...document.querySelectorAll('.memory-document')];return '.memory-document:nth-of-type('+(list.findIndex(e=>e.textContent.includes('OPSADV-QA Markdown'))+1)+') summary'});
await p.evaluate(()=>[...document.querySelectorAll('.memory-document summary')].find(e=>e.textContent.includes('OPSADV-QA Markdown')).click());await p.waitForFunction(()=>[...document.querySelectorAll('.memory-document .settings-markdown')].some(e=>e.textContent.includes('END-MARKDOWN-FULL')));
check('memory-full-safe-markdown',await p.evaluate(()=>{const e=[...document.querySelectorAll('.memory-document')].find(e=>e.textContent.includes('OPSADV-QA Markdown'));return !!e.querySelector('h1')&&!!e.querySelector('h2')&&!!e.querySelector('ul strong')&&e.textContent.includes('END-MARKDOWN-FULL')}));await p.screenshot({path:out+'/memory.png'});
await p.click('[data-setting="models"]');await p.waitForFunction(()=>document.querySelector('#model'));
check('single-model-test-action',await p.evaluate(()=>document.querySelectorAll('.model-test-controls button').length===1&&!/回查原测试|准备新的测试|回查 \/ 原请求重试/.test(document.querySelector('#settings-content').textContent)));
await p.click('.provider-row:first-of-type');await p.waitForFunction(()=>document.querySelector('.provider-editor'));
await p.evaluate(()=>document.querySelector('#settings-content').scrollTop=200);
const bounds=await p.evaluate(()=>{const r=document.querySelector('.settings-back-link').getBoundingClientRect(),c=document.querySelector('#settings-content').getBoundingClientRect();return {top:r.top,content:c.top,bottom:r.bottom,contentBottom:c.bottom,scroll:document.querySelector('#settings-content').scrollTop}});check('sticky-return-visible',bounds.top>=bounds.content-1&&bounds.bottom<bounds.contentBottom,bounds);await p.screenshot({path:out+'/provider-sticky.png'});
await p.click('[data-setting="channels"]');await p.waitForFunction(()=>document.querySelector('.feishu-binding-card'));
await p.evaluate(()=>{const base=window.fetch;window.__bindingPosts=0;window.fetch=async(url,opts)=>{if(String(url).endsWith('/api/feishu/binding')){if(opts?.method==='POST')window.__bindingPosts++;return new Response(JSON.stringify({status:'bound'}),{headers:{'Content-Type':'application/json'}})}return base(url,opts)}});
await p.click('.feishu-binding-card .settings-card-head strong');await p.waitForFunction(()=>document.querySelector('.feishu-binding-dialog')?.open);await p.waitForFunction(()=>document.querySelector('.feishu-binding-dialog [role=status]')?.textContent.includes('Bot 已绑定'));
check('bound-card-open-without-reauthorize',await p.evaluate(()=>window.__bindingPosts===0));await p.click('.feishu-binding-dialog .settings-modal-close');await p.waitForFunction(()=>!document.querySelector('.feishu-binding-dialog').open);
await p.evaluate(()=>document.querySelector('#settings-window').focus());check('no-container-focus-outline',await p.evaluate(()=>getComputedStyle(document.querySelector('#settings-window')).outlineStyle==='none'));await p.screenshot({path:out+'/channels-closed.png'});
await p.click('[data-setting="general"]');await p.click('input[aria-label="English"]');await p.waitForFunction(()=>document.documentElement.lang==='en');check('removed-controls-in-english',await p.evaluate(()=>!['Text size','Body size','Reduce motion'].some(s=>document.querySelector('#settings-content').textContent.includes(s))));await p.click('input[aria-label="简体中文"]');
}catch(e){cases.push({name:'execution',status:'FAIL',error:e.message});await p.screenshot({path:out+'/failure.png'})}finally{await fs.writeFile(out+'/result.json',JSON.stringify({scope:'public workspace; binding response is explicit UI fixture',cases},null,2));console.log(JSON.stringify({out,cases}))}
