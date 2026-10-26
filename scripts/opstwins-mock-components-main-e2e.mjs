const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-components-main-20261017/'+Date.now();
await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins components and main conversation');
const page=task.page('p1'),results=[];
const click=a=>page.click(`button[data-action="${a}"]`);
const state=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
async function choose(selector,value){const c=await page.evaluate(({selector,value})=>{const s=document.querySelector(selector);return {id:s.dataset.selectNative,index:[...s.options].findIndex(o=>o.value===value)}},{selector,value});await page.click(`[data-vm-id="${c.id}"]`);await page.click(`[data-vm-option="${c.index}"]`)}
async function reset(){await page.goto('http://127.0.0.1:46400/?v=4#settings/models');await click('tweaks');await click('reset-confirm');await click('confirm-go')}
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await reset();
 check('原生下拉统一为VMSelect',await page.evaluate(()=>document.querySelectorAll('select:not([hidden])').length===0&&document.querySelectorAll('.vm-select').length===3));
 const model=await page.evaluate(()=>document.querySelector('select[name=model]').dataset.selectNative);
 await page.click(`[data-vm-id="${model}"]`);await page.screenshot({path:out+'/model-menu.png'});
 check('下拉40px且菜单等宽',await page.evaluate(()=>{const b=document.querySelector('[aria-label="当前模型"].vm-select'),m=document.querySelector('#vm-select-menu');return b.offsetHeight===40&&Math.abs(b.getBoundingClientRect().width-m.getBoundingClientRect().width)<1}));
 await page.keyboard.press('Escape');check('Escape只关菜单并恢复焦点',await page.evaluate(()=>!document.querySelector('#vm-select-menu')&&document.activeElement.matches('.vm-select[aria-label="当前模型"]')&&!!document.querySelector('.settings-window')));
 await page.click(`[data-vm-id="${model}"]`);await page.keyboard.press('End');await page.keyboard.press('Enter');
 check('键盘选择显示保存',await page.evaluate(()=>document.querySelector('select[name=model]').value==='示例推理模型'&&!document.querySelector('form[data-kind=model] .form-actions').hidden));
 await page.click('#settings-form button.primary');await page.reload();await page.waitForSelector('.vm-select');check('FormData模型选择保存刷新',(await state()).model.model==='示例推理模型');
 await choose('#screen-picker','settings/general');await choose('select[name=theme]','dark');check('主题通过共享下拉立即生效',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'));await page.click('input[name=launch]');check('共享开关仍保存偏好',(await state()).prefs.launch);await page.screenshot({path:out+'/general-dark.png'});await choose('select[name=theme]','light');
 await choose('#screen-picker','settings/provider');await choose('select[name=protocol]','Anthropic Messages');await page.click('#settings-form button.primary');check('供应商表单保持协议值',(await state()).model.protocol==='Anthropic Messages');
 await choose('#screen-picker','settings/autonomy');await choose('select[name=reply]','read');await page.click('#settings-form button.primary');check('自主权限共享下拉保存',(await state()).autonomy.reply==='read');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:850,deviceScaleFactor:1,mobile:false});
 const reply=await page.evaluate(()=>document.querySelector('select[name=reply]').dataset.selectNative);await page.click(`[data-vm-id="${reply}"]`);await page.screenshot({path:out+'/scaled-menu.png'});
 check('缩放菜单在产品范围内',await page.evaluate(()=>{const m=document.querySelector('#vm-select-menu').getBoundingClientRect(),c=document.querySelector('.prototype-canvas').getBoundingClientRect();return m.left>=c.left&&m.right<=c.right+1&&m.bottom<=c.bottom+1}));await page.keyboard.press('Escape');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await reset();await choose('#screen-picker','chat');
 check('主会话只渲染对话消息',await page.evaluate(()=>!document.querySelector('.inbox-automation,.attention-result')&&[...document.querySelector('.reading').children].every(x=>x.matches('.message'))));
 await page.fill('[name=message]','主会话独立草稿');await page.reload();await page.waitForSelector('[name=message]');
 check('刷新保留聊天草稿且不插入卡片',await page.evaluate(()=>document.querySelector('[name=message]').value==='主会话独立草稿'&&!document.querySelector('.inbox-automation')));
 await click('sidebar');await click('session:review');check('侧会话没有收件箱卡片',await page.evaluate(()=>!document.querySelector('.inbox-automation,.attention-result')));await click('session:main');
 await click('nav:inbox');check('独立Inbox草稿入口保留',await page.evaluate(()=>!!document.querySelector('#reply-draft')&&!document.querySelector('[data-action^="attention-"]')));
 await page.fill('#reply-draft','公开独立收件箱草稿');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='已保存');await click('nav:chat');
 check('Inbox人工稿不投影成Chat卡片',await page.evaluate(()=>!document.querySelector('.attention-result,.attention-draft')));
 await page.fill('[name=message]','公开后续对话');await page.press('[name=message]','Enter');check('新对话仍是普通消息',await page.evaluate(()=>document.querySelector('.reading').lastElementChild.matches('.message.assistant')));
 await reset();await choose('#screen-picker','chat');await page.screenshot({path:out+'/final-main.png'});
 const hashes={};for(const f of ['app.js','pages.js','components/select.js','components/select.css','components/adapter.js','components/common.css'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+f)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({taskSpace:task.spaceId,results,hashes,scope:'public mock only'},null,2));console.log({passed:results.length,out});
}catch(error){await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(error)},null,2));await page.screenshot({path:out+'/failure.png'});throw error}
