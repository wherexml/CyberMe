// Run with ego-browser nodejs. Uses only public authored fixtures, restores exact namespace.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-detailed-chat-20261017/'+Date.now();
await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins detailed conversation demo'),page=task.page('p1');
const key='opstwins-product-mock-v1',results=[];let original,backedUp=false,generation=0;
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
const click=action=>page.click(`button[data-action="${action}"]`);
const state=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
const clean=()=>page.evaluate(()=>!document.querySelector('.attention-result,.inbox-automation')&&[...document.querySelector('.reading').children].every(x=>x.matches('.message')));
async function shot(name){await page.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await page.snapshot());}
async function seed(mode='new'){
 await page.evaluate(async({key,mode})=>{
  const {initial}=await import('./data.js'),{legacyDemo}=await import('./demo-conversations.js');
  const s=structuredClone(initial);
  if(mode.startsWith('legacy')){
   s.sessions[0].messages=[s.sessions[0].messages[0],{role:'assistant',text:legacyDemo.main}];
   s.sessions[0].draft='公开未发送主稿';
   s.sessions[1].messages=[{role:'assistant',text:legacyDemo.review}];s.sessions[2].messages=[];
   if(mode==='legacy-with-followups')s.sessions[0].messages.push({role:'user',text:'公开人工历史：请保留'},{role:'assistant',text:'公开自定义回答：保持原样'});
   if(mode==='legacy-generic')s.sessions[0].messages.push({role:'user',text:'把风险展开'},{role:'assistant',text:legacyDemo.reply});
  }
  if(mode==='custom'){s.sessions[0].messages=[{role:'user',text:'我的公开自定义问题'},{role:'assistant',text:'我的公开自定义答案'}];s.sessions[0].draft='我的公开草稿'}
  localStorage.setItem(key,JSON.stringify({version:1,data:s}));
 },{key,mode});
 await page.goto('http://127.0.0.1:46400/?v=9&fixture='+Date.now()+'-'+(++generation)+'#chat');await page.waitForSelector('[name=message]');
}
try{
 await page.goto('http://127.0.0.1:46400/?v=9#chat');await page.waitForSelector('[name=message]');
 original=await page.evaluate(key=>localStorage.getItem(key),key);backedUp=true;
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1010,height:961,deviceScaleFactor:1,mobile:false});
 await seed();let s=await state();const baseline=JSON.stringify({inbox:s.inbox,tasks:s.tasks,connections:s.connections});
 check('三组对话均有完整多轮正文',s.sessions[0].messages.length===6&&s.sessions[1].messages.length===4&&s.sessions[2].messages.length===4&&s.sessions.every(x=>x.messages.filter(m=>m.role==='assistant').every(m=>m.text.length>350)));
 check('主会话具体事实/判断/待核实都有正文',s.sessions[0].messages[1].text.includes('10:24')&&s.sessions[0].messages[1].text.includes('09:48')&&s.sessions[0].messages[1].text.includes('没有明确的开始时间')&&s.sessions[0].messages[1].text.includes('结果尚未确认'));
 check('详细内容仍只采用普通消息',await clean());await shot('main-head');
 const scrollRect=await page.evaluate(()=>{const r=document.querySelector('.timeline').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/3}});
 await page.mouse.move(scrollRect.x,scrollRect.y,{label:'read long conversation'});
 for(let i=0;i<3;i++){
  const position=await page.evaluate(()=>{const t=document.querySelector('.timeline');return {top:t.scrollTop,end:t.scrollHeight-t.clientHeight}});
  if(position.top>=position.end-3)break;
  await page.mouse.wheel(0,1500,{label:'scroll conversation down'});
  await page.waitForFunction(before=>document.querySelector('.timeline').scrollTop>before,position.top);
 }
 await page.waitForFunction(()=>{const t=document.querySelector('.timeline');return t.scrollTop+t.clientHeight>=t.scrollHeight-3});
 check('长回复尾部实际可见且输入框保留',await page.evaluate(()=>{const t=document.querySelector('.timeline').getBoundingClientRect(),p=document.querySelector('.reading>.message:last-child .message-text>p:last-of-type').getBoundingClientRect(),c=document.querySelector('[name=message]').getBoundingClientRect();return p.bottom<=t.bottom+1&&p.top>=t.top&&c.height>0&&c.bottom<=innerHeight}));await shot('main-tail');
 await page.fill('[name=message]','把风险和失败恢复说详细一点');await page.press('[name=message]','Enter');
 s=await state();check('真实输入获得具体场景跟进',s.sessions[0].messages.length===8&&s.sessions[0].messages.at(-1).text.includes('事项切换后的回包')&&s.sessions[0].messages.at(-1).text.includes('重新生成不能覆盖后来输入')&&!s.sessions[0].messages.at(-1).text.includes('已收到这段内容'));await shot('risk-followup');
 await page.reload();await page.waitForSelector('[name=message]');check('新增对话刷新恢复且预置轮次不重复',(await state()).sessions[0].messages.length===8);
 await page.fill('[name=message]','把下一步行动列清楚');await page.press('[name=message]','Enter');
 check('不同问题获得不同详细正文',(await state()).sessions[0].messages.at(-1).text.includes('现在确认')&&(await state()).sessions[0].messages.at(-1).text.includes('现有任务里'));
 await page.fill('[name=message]','发送给林可');await page.press('[name=message]','Enter');
 s=await state();check('回复内容完整且不伪造外发',s.sessions[0].messages.at(-1).text.includes('给林可')&&s.sessions[0].messages.at(-1).text.includes('没有发送')&&JSON.stringify({inbox:s.inbox,tasks:s.tasks,connections:s.connections})===baseline);
 await page.fill('[name=message]','公开主会话独立草稿');await click('sidebar');await click('session:review');
 check('评审侧会话含议程与完整检查步骤',await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===4&&document.querySelector('.reading').textContent.includes('正常和未确认要分开看')));
 await page.fill('[name=message]','公开评审草稿');await shot('review');await click('session:research');
 check('工作流侧会话不再空白',await page.evaluate(()=>document.querySelectorAll('.reading>.message').length===4&&document.querySelector('.reading').textContent.includes('由谁确认')&&document.querySelector('.reading').textContent.includes('对外执行前再确认')));await shot('workflow');
 await click('session:main');check('补内容不改变会话独立草稿',await page.evaluate(()=>document.querySelector('[name=message]').value==='公开主会话独立草稿'));await click('session:review');check('评审草稿独立保留',await page.evaluate(()=>document.querySelector('[name=message]').value==='公开评审草稿'));
 await seed('legacy');s=await state();check('旧默认内容无需清空即可更新',s.sessions[0].messages.length===6&&s.sessions[1].messages.length===4&&s.sessions[2].messages.length===4&&s.sessions[0].draft==='公开未发送主稿');
 await seed('legacy-with-followups');s=await state();check('已有人工历史只扩写旧答案不插入假用户轮次',s.sessions[0].messages.length===4&&s.sessions[0].messages[1].text.includes('10:24')&&s.sessions[0].messages[2].text==='公开人工历史：请保留'&&s.sessions[0].messages[3].text==='公开自定义回答：保持原样');
 await seed('legacy-generic');s=await state();check('精确旧占位回答可更新为详细跟进',s.sessions[0].messages.length===4&&s.sessions[0].messages[3].text.includes('事项切换后的回包'));
 await seed('custom');s=await state();check('人工自定义正文与草稿不覆盖',s.sessions[0].messages.length===2&&s.sessions[0].messages[1].text==='我的公开自定义答案'&&s.sessions[0].draft==='我的公开草稿');
 await seed();await click('scenario:error');const count=(await state()).sessions[0].messages.length;await page.fill('[name=message]','公开失败场景问题');await page.press('[name=message]','Enter');
 check('失败场景不补造成功回答',(await state()).sessions[0].messages.length===count&&(await state()).sessions[0].draft==='公开失败场景问题'&&await page.evaluate(()=>!!document.querySelector('.recovery')));
 const hashes={};for(const name of ['demo-conversations.js','data.js','app.js','pages.js'])hashes[name]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+name)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({scope:'public authored local demo; no real AI or transport',spaceId:task.spaceId,results,hashes},null,2));console.log({passed:results.length,out,spaceId:task.spaceId});
}catch(error){await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(error)},null,2));await shot('failure');throw error}
finally{
 if(backedUp){await page.evaluate(({key,original})=>original===null?localStorage.removeItem(key):localStorage.setItem(key,original),{key,original});await page.goto('http://127.0.0.1:46400/?v=9&restored='+Date.now()+'#chat');await page.waitForSelector('[name=message]');const after=await page.evaluate(key=>localStorage.getItem(key),key);await fs.writeFile(out+'/restoration.json',JSON.stringify({exactMatch:original===after},null,2));if(original!==after)throw Error('Mock namespace restore mismatch');await shot('final-chat')}
}
