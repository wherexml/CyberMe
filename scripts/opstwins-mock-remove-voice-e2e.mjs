const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-remove-voice-20261017/'+Date.now();await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'移除原型语音输入'),p=task.page('p1'),key='opstwins-product-mock-v1',results=[];let original,backed=false;
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
const click=a=>p.click(`[data-action="${a}"]`);
async function go(route){await p.goto('http://127.0.0.1:46400/?v=voice-removed-'+Date.now()+'#'+route);await p.waitForSelector('#workspace')}
async function shot(name){await p.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await p.snapshot())}
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1239,height:961,deviceScaleFactor:1,mobile:false});await go('chat');original=await p.evaluate(k=>localStorage.getItem(k),key);backed=true;
 check('文字输入直接显示且无语音入口',await p.evaluate(()=>!!document.querySelector('[name=message]')&&!document.querySelector('[data-action=voice],[data-action=voice-cancel],[data-action=voice-stop],.wave,.recording')));
 check('保留添加资料和发送按钮',await p.evaluate(()=>document.querySelectorAll('.composer-entry button').length===2&&!!document.querySelector('[data-action=attachments]')&&!!document.querySelector('.send')));
 await p.fill('[name=message]','公开验收：移除语音输入后，文字草稿仍可编辑');await p.reload();await p.waitForSelector('[name=message]');check('刷新恢复文字草稿',await p.evaluate(()=>document.querySelector('[name=message]').value==='公开验收：移除语音输入后，文字草稿仍可编辑'));await shot('01-chat');
 await click('attachments');check('资料选择仍可打开',await p.evaluate(()=>document.querySelectorAll('[name=attachment]').length>0));await click('close');
 await click('scenario:unknown');await p.click('.send');check('发送仍走原状态门禁并保稿',await p.evaluate(()=>document.querySelector('#notice').textContent.includes('输入与引用已保留')&&document.querySelector('[name=message]').value.includes('公开验收')));await click('scenario:normal');
 await click('setting:general');check('设置导航与目录无听写',await p.evaluate(()=>!document.querySelector('[data-action="setting:dictation"]')&&!window.OpsTwinsMock.screens.includes('settings/dictation')));
 check('支持导航无重复',await p.evaluate(()=>document.querySelectorAll('.settings-nav [data-action="setting:help"]').length===1));await shot('02-settings');await p.keyboard.press('Escape');check('Escape正常返回文字输入',await p.evaluate(()=>!document.querySelector('.settings-window')&&document.querySelector('[name=message]').value.includes('公开验收')));
 await go('settings/dictation');check('旧听写深链安全返回通用设置',await p.evaluate(()=>window.OpsTwinsMock.getScreen()==='settings/general'&&location.hash==='#settings/general'));
 await click('tweaks');await click('theme:dark');await click('close');await click('close-settings');await shot('03-dark');
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:850,deviceScaleFactor:1,mobile:false});check('缩放文字输入与发送完整可见',await p.evaluate(()=>{const f=document.querySelector('#chat-form').getBoundingClientRect(),b=document.querySelector('.send').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&b.right<=f.right&&b.bottom<=f.bottom&&document.querySelector('[name=message]').getBoundingClientRect().width>100}));await shot('04-scaled');
}catch(e){results.push({name:'browser operation',status:'FAIL',error:String(e)});await shot('failure');throw e}
finally{
 if(backed){await p.goto('http://127.0.0.1:46400/assets/opstwins.svg');await p.evaluate(({key,value})=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value),{key,value:original});await go('chat');check('原始存储精确恢复',await p.evaluate(k=>localStorage.getItem(k),key)===original)}
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1239,height:961,deviceScaleFactor:1,mobile:false});await shot('final');const hashes={};for(const f of ['app.js','pages.js','settings.js','data.js','chat-quotes.js','styles.css','settings-refinement.css','chat-model.js'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+f)).digest('hex');await fs.writeFile(out+'/result.json',JSON.stringify({spaceId:task.spaceId,results,hashes,scope:'UI removal; no model POST or microphone use'},null,2));console.log({spaceId:task.spaceId,out,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length});
}
