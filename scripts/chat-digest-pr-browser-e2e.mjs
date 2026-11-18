// node scripts/ego-locked.mjs nodejs < scripts/chat-digest-pr-browser-e2e.mjs
const task=await taskSpace('CyberMe 主对话摘要与 PR 验收 20261109'),page=task.page('p1');
console.log({spaceId:task.spaceId});
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/chat-digest-pr-20261109';
const url='http://127.0.0.1:46828/cyberme.html',checks=[],shots=[];
const check=(name,ok)=>{checks.push({name,pass:!!ok});if(!ok)throw Error(name)};
const call=async (path,post=false)=>JSON.parse((await page.fetch('/__fixture/'+path,post?{method:'POST'}:undefined)).body);
const screenshot=async name=>{const path=out+'/'+name+'.png';await page.screenshot({path});shots.push(path)};
const order=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-chat-scroll [data-mid]')].map(el=>el.querySelector('[data-digest]')?'digest':el.textContent.includes('历史 PR 查询')?'legacy':el.textContent.includes('浏览器验收')?'user':el.textContent.includes('改动包含 status.ts')?'answer':'other'));
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:940,deviceScaleFactor:1,mobile:false});
 await page.goto(url);await page.waitForSelector('[data-digest]');
 const legacy=await call('legacy');
 await page.evaluate(r=>{const state=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...state,requests:[r],conversationId:'main',panel:false}))},legacy);
 await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('模型回复超时。请先核对原操作结果。'));
 check('legacy partial shows timeout instead of claiming manual stop',await page.evaluate(()=>{const x=document.querySelector('[data-mid="old-partial-message"]').nextElementSibling;return x.textContent.includes('部分完成')&&!x.querySelector('button')&&!x.textContent.includes('停止前')}));
 const baseline=await call('evidence');
 await page.fill('textarea','查看 public/fixture PR7 浏览器验收');await page.press('textarea','Enter');
 await page.waitForFunction(async()=>{const r=await fetch('/__fixture/evidence');return (await r.json()).waiting});
 const due=await call('due',true);
 check('due digest stays queued while the answer is in flight',due.waiting&&due.digests===1&&due.held===1&&JSON.stringify(await order())===JSON.stringify(['digest','legacy','user']));
 await screenshot('during-reply');
 await call('release',true);
 await page.waitForFunction(()=>document.body.innerText.includes('改动包含 status.ts'));
 check('settled digest publishes only once', (await call('sync',true)).digests===2&&(await call('sync',true)).digests===2);
 await page.waitForFunction(()=>document.querySelectorAll('[data-digest]').length===2,undefined,{timeout:20000});
 check('late digest sits at source time before the new question and answer',JSON.stringify(await order())===JSON.stringify(['digest','digest','legacy','user','answer']));
 await page.evaluate(()=>{const x=document.querySelector('.cm-chat-scroll');x.scrollTop=x.scrollHeight});
 await screenshot('chat-digest-and-pr');
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-digest]').length===2);
 check('reload preserves timeline, never replays partial request',JSON.stringify(await order())===JSON.stringify(['digest','digest','legacy','user','answer'])&&(await call('evidence')).posts===baseline.posts+1);
 await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...state,conversationId:'side'}))});
 await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('修正公开示例'));
 check('primary digests and legacy recovery do not leak into a side conversation',await page.evaluate(()=>!document.querySelector('[data-digest]')&&!document.body.innerText.includes('历史 PR 查询')));
 await fs.writeFile(out+'/browser.json',JSON.stringify({url,checks,shots},null,2));
 console.log({url,checks:checks.length,shots});await task.finish({keep:[]});
}catch(e){
 await fs.writeFile(out+'/browser.json',JSON.stringify({url,checks,shots,error:e.message},null,2));
 throw e;
}
