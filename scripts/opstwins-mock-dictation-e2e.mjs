// Historical pre-removal dictation coverage. Current removal acceptance: opstwins-mock-remove-voice-e2e.mjs.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-dictation-fix-20261017/'+Date.now();await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins dictation settings'),p=task.page('p1'),key='opstwins-product-mock-v1',results=[];let original,backed=false,restored=false;
const click=a=>p.click(`[data-action="${a}"]`),state=()=>p.evaluate(()=>window.OpsTwinsMock.getState());
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
async function language(value){await p.click('button[aria-label="识别语言"]');await p.click(`#vm-select-menu [data-vm-option="${['自动识别','中文','English'].indexOf(value)}"]`)}
async function shot(name){await p.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await p.snapshot())}
async function go(){await p.goto('http://127.0.0.1:46400/?v=dictation-final-'+Date.now()+'#settings/dictation');await p.waitForSelector('form[data-kind=dictation]')}
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1239,height:961,deviceScaleFactor:1,mobile:false});await go();original=await p.evaluate(k=>localStorage.getItem(k),key);backed=true;
 const base=(await state()).dictation,alternate=base.language==='中文'?'English':'中文';
 check('去掉解释卡片与无实际权限行',await p.evaluate(()=>{const e=document.querySelector('.settings-content');return !e.querySelector('small,.dictation-preview')&&!/保存到 Mock|关闭时先|访问权限|界面预览|不使用麦克风/.test(e.textContent)}));
 check('初始不显示保存操作',await p.evaluate(()=>document.querySelector('#settings-form .form-actions').hidden));await shot('01-clean');
 await language(alternate);await p.click('[name=autoSend]');check('修改后才显示唯一保存区',await p.evaluate(()=>document.querySelectorAll('#settings-form .form-actions').length===1&&!document.querySelector('#settings-form .form-actions').hidden));
 check('修改尚未覆盖已存偏好',JSON.stringify((await state()).dictation)===JSON.stringify(base));
 await click('cancel-setting');check('取消恢复语言与开关',await p.evaluate(base=>document.querySelector('[name=language]').value===base.language&&document.querySelector('[name=autoSend]').checked===base.autoSend,base));
 await language(alternate);await p.click('[name=autoSend]');await p.click('#settings-form .primary');await p.reload();await p.waitForSelector('[aria-label="识别语言"].vm-select');
 check('保存后刷新恢复精确偏好',(await state()).dictation.language===alternate&&(await state()).dictation.autoSend===!base.autoSend);
 check('保存成功收起操作栏',await p.evaluate(()=>document.querySelector('#settings-form .form-actions').hidden));
 await language(base.language);await click('scenario:error');await p.click('#settings-form .primary');check('受控失败保稿不覆盖基线',await p.evaluate(v=>document.querySelector('[name=language]').value===v&&document.querySelector('.form-feedback').textContent.includes('保留'),base.language)&&(await state()).dictation.language===alternate);await shot('02-failure');
 await click('scenario:normal');await p.evaluate(k=>{window.__dictationSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===k)throw new DOMException('public local persistence failure','QuotaExceededError');return window.__dictationSetItem.call(this,key,value)}},key);
 await p.click('#settings-form .primary');check('真实本地存储失败回滚基线且保稿',(await state()).dictation.language===alternate&&await p.evaluate(v=>document.querySelector('[name=language]').value===v&&document.querySelector('.form-feedback').textContent==='保存失败，请重试',base.language));
 await p.evaluate(()=>{Storage.prototype.setItem=window.__dictationSetItem;delete window.__dictationSetItem});await p.click('#settings-form .primary');check('原稿明确重试成功',(await state()).dictation.language===base.language);
 await language(alternate);await click('setting:general');await click('setting:dictation');check('切页保留未保存偏好',await p.evaluate(v=>document.querySelector('[name=language]').value===v&&!document.querySelector('#settings-form .form-actions').hidden,alternate));await click('cancel-setting');
 const draft=(await state()).sessions.find(x=>x.id==='main').draft;await click('dictation-demo');check('预览入口真实进入可取消录音界面',await p.evaluate(()=>!!document.querySelector('[data-action="voice-cancel"]')&&!document.querySelector('.settings-window')));await click('voice-cancel');check('取消预览保留聊天草稿',(await state()).sessions.find(x=>x.id==='main').draft===draft);
 await click('setting:general');await click('setting:dictation');await click('tweaks');await click('theme:dark');await click('close');check('深色控件布局不溢出',await p.evaluate(()=>{const e=document.querySelector('.settings-content');return document.documentElement.dataset.theme==='dark'&&e.scrollWidth<=e.clientWidth}));await shot('03-dark');
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:850,deviceScaleFactor:1,mobile:false});check('缩放下操作入口仍在窗口内',await p.evaluate(()=>{const w=document.querySelector('.settings-window').getBoundingClientRect(),b=document.querySelector('[data-action="dictation-demo"]').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&b.left>=w.left&&b.right<=w.right&&b.bottom<=w.bottom}));await shot('04-scaled');
}catch(e){results.push({name:'browser operation',status:'FAIL',error:String(e)});await shot('failure');throw e}
finally{
 await p.evaluate(()=>{if(window.__dictationSetItem){Storage.prototype.setItem=window.__dictationSetItem;delete window.__dictationSetItem}});
 if(backed){await p.goto('http://127.0.0.1:46400/assets/opstwins.svg');await p.evaluate(({key,value})=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value),{key,value:original});await go();restored=await p.evaluate(k=>localStorage.getItem(k),key)===original;check('原始存储逐字恢复',restored)}
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1239,height:961,deviceScaleFactor:1,mobile:false});await shot('final');
 const hashes={};for(const f of ['settings.js','app.js','settings-refinement.css'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+f)).digest('hex');await fs.writeFile(out+'/result.json',JSON.stringify({spaceId:task.spaceId,results,restored,hashes,scope:'local mock only; no hardware or model request'},null,2));console.log({spaceId:task.spaceId,out,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length});
}
