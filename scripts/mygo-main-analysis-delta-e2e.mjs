const fs=await import('node:fs/promises');const t=await taskSpace(143),p=t.page('p1'),out='/Users/steve/Projects/opstwin-advance/output/mygo-main-analysis-20261018/final-browser-'+Date.now(),checks=[];await fs.mkdir(out,{recursive:true});
const check=(name,x)=>{checks.push({name,status:x?'PASS':'FAIL'});if(!x)throw Error(name)};
const api=async(method,path,body)=>{const r=await p.fetch(path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw Error('HTTP '+r.status);return JSON.parse(r.body)};
let original;
try{
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#desktop-boot')&&window.OpsTwinsDesktop?.v17,undefined,{timeout:30000});await p.click('button[aria-label="对话"]');
 original=await api('GET','/api/inbox/main-analysis-live');await p.fill('#input','最终输入保护 DELTA-8421');await p.evaluate(()=>window.__composerOwner=document.querySelector('#input'));
 await api('PATCH','/api/inbox/main-analysis-live',{draft:'DELTA-8421-current',editedByUser:true,baseUpdatedAt:original.updatedAt});await p.waitForFunction(()=>document.querySelector('#messages').textContent.includes('DELTA-8421-current'),undefined,{timeout:20000});
 check('实际更新保留同一个composer和输入',await p.evaluate(()=>document.querySelector('#input')===window.__composerOwner&&document.querySelector('#input').value==='最终输入保护 DELTA-8421'));
 check('重绘后每条来源只有一个入口',await p.evaluate(()=>[...document.querySelectorAll('#messages [data-message-id]')].every(a=>a.querySelectorAll('.inbox-chat-source').length<=1)));
 await p.click('button[aria-label="收件箱"]');await p.click('button[aria-label="对话"]');check('切页后入口仍不重复',await p.evaluate(()=>[...document.querySelectorAll('#messages [data-message-id]')].every(a=>a.querySelectorAll('.inbox-chat-source').length<=1)));
 check('主会话是服务端canonical ID',await p.evaluate(()=>window.OpsTwinsChatSessions.main()==='main-analysis-primary'));
 await p.click('button[aria-label="设置"]');await p.click('[data-setting="general"]');await p.click('[data-vm-select][aria-label="主题"]');await p.waitForSelector('#vm-select-menu');await p.keyboard.press('Escape');check('共享下拉Escape保留设置',await p.evaluate(()=>document.querySelector('#settings-window').open&&!document.querySelector('#vm-select-menu')));await p.click('#close-settings');
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:700,deviceScaleFactor:1,mobile:false});check('660宽度不溢出',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await fs.writeFile(out+'/narrow.ax.txt',await p.snapshot());await p.cdp('Emulation.clearDeviceMetricsOverride');
 await fs.writeFile(out+'/final.ax.txt',await p.snapshot());
}finally{if(original){const row=await api('GET','/api/inbox/main-analysis-live');await api('PATCH','/api/inbox/main-analysis-live',{draft:original.draft,editedByUser:original.editedByUser,baseUpdatedAt:row.updatedAt})}await fs.writeFile(out+'/result.json',JSON.stringify({checks,scope:'final assets, browser AX; native pixels separate'},null,2));console.log({out,checks})}
