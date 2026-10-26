// Run: ego-browser nodejs < scripts/opstwins-mock-workspace-quotes-e2e.mjs
// Public fixtures only. Exact prior localStorage namespace restored in finally.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-linked-workspace-20261017/'+Date.now();await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins workspace quotes E2E'),page=task.page('p1'),key='opstwins-product-mock-v1';
const results=[];let original,backedUp=false,tick=0;
function check(name,ok){results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name)}
const state=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
const click=action=>page.click(action==='close'?'.modal-heading button[data-action="close"]':`button[data-action="${action}"]`);
const go=async(route='chat')=>{await page.goto('http://127.0.0.1:46400/?v=10&e2e='+(++tick)+'-'+Date.now()+'#'+route);await page.waitForFunction(()=>!!window.OpsTwinsMock)};
async function shot(name){await page.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await page.snapshot())}
async function seed(mode='new'){
 await page.evaluate(async({key,mode})=>{const {initial}=await import('./data.js'),{legacyWorkspace}=await import('./workspace-legacy.js');const s=structuredClone(initial);
  if(mode==='legacy'||mode==='modified'){Object.assign(s,structuredClone(legacyWorkspace));delete s.demoWorkspaceVersion;if(mode==='modified'){s.inbox[0].draft='公开人工稿不能覆盖';s.inbox[0].draftRevision=2;s.ideas[0].body='公开修改后的建议';s.ideas[0].ignored=true;s.tasks[0].title='公开修改的标题';s.tasks[1].done=true;s.inbox=s.inbox.filter(x=>x.id!=='i4')}}
  if(mode==='deleted'){s.ideas=s.ideas.filter(x=>x.id!=='a4');s.tasks=s.tasks.filter(x=>!['t5','t6'].includes(x.id))}
  if(mode==='large'){s.sessions[0].messages=[{id:'long-public',role:'assistant',text:'公开长文'.repeat(1600)}]}
  localStorage.setItem(key,JSON.stringify({version:1,data:s}));
 },{key,mode});await go();
}
async function selectText(selector,start=0,end=12){
 const box=await page.evaluate(({selector,start,end})=>{const el=document.querySelector(selector);const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const node=walker.nextNode();const a=document.createRange(),b=document.createRange();a.setStart(node,start);a.setEnd(node,start+1);b.setStart(node,end-1);b.setEnd(node,end);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return {ax:x.left+.3,ay:x.top+x.height/2,bx:y.right-.3,by:y.top+y.height/2}}, {selector,start,end});
 await page.mouse.move(box.ax,box.ay,{label:'start exact text selection'});await page.mouse.down();await page.mouse.move(box.bx,box.by,{steps:20,label:'select source text'});await page.mouse.up();
 await page.waitForSelector('.selection-quote-toolbar');return page.evaluate(()=>getSelection().toString().trim());
}
try{
 await go();original=await page.evaluate(key=>localStorage.getItem(key),key);backedUp=true;
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1010,height:961,deviceScaleFactor:1,mobile:false});
 await seed();let s=await state();
 check('四项收件箱都有多轮具体消息',s.inbox.length===4&&s.inbox.every(x=>x.messages.length>=4&&x.analysis?.length>80));
 check('灵感有完整方案/执行步骤/精确来源',s.ideas.length===4&&s.ideas.every(x=>x.details?.length>230&&x.steps.length===3&&x.refs.length>=3));
 check('六项任务含目标交付物与检查项',s.tasks.length===6&&s.tasks.every(x=>x.note.length>60&&x.goal&&x.deliverable&&x.checklist.length>=3));
 check('未确认部署和初稿完成保持不同状态',s.inbox.find(x=>x.id==='i3').judgment===null&&s.inbox.find(x=>x.id==='i3').status==='unknown'&&s.tasks.find(x=>x.id==='t4').done&&!s.tasks.find(x=>x.id==='t5').done);
 check('所有演示关联均精确存在',await page.evaluate(async()=>{const {resolveWorkspaceSource}=await import('./workspace-demo.js'),s=window.OpsTwinsMock.getState();return [...s.inbox,...s.ideas,...s.tasks].every(row=>row.refs.every(r=>!!resolveWorkspaceSource(s,r.type,r.id)))}));
 await click('nav:inbox');await click('item:i1');await shot('inbox-complete');
 check('收件箱显示完整来源和关联链接',await page.evaluate(()=>document.querySelectorAll('.source-message-text').length===5&&document.querySelector('.workspace-links').textContent.includes('确认评审范围')));
 await click('analysis');check('分析跟随精确事项',await page.evaluate(()=>document.querySelector('.document-markdown').textContent.includes('范围')));await click('close');
 await click('filter:all');await click('item:i3');await click('analysis');check('部署分析没有借用范围占位',await page.evaluate(()=>document.querySelector('.document-markdown').textContent.includes('最后完成')&&!document.querySelector('.document-markdown').textContent.includes('对方提出了明确问题')));await click('close');
 await click('source:idea:a4');check('来源链接打开精确灵感方案',await page.evaluate(()=>document.querySelector('.modal h2').textContent.includes('部署检查')&&document.querySelector('.idea-document').textContent.includes('四种结果')));await shot('idea-plan');
 await click('source:task:t3');check('方案关联精确任务',await page.evaluate(()=>document.querySelector('[name=title]').value.includes('部署检查')&&document.querySelectorAll('[data-task-check]').length===4));
 await page.click('[data-task-check="run"]');await page.fill('[name=note]','公开未保存的任务草稿');await click('source:inbox:i3');await click('source:task:t3');
 check('跨来源回来保留未保存任务稿',await page.evaluate(()=>document.querySelector('[name=note]').value==='公开未保存的任务草稿'));await shot('task-detail');
 await go('tasks');await page.click('.task-title[data-action="task:t3"]');check('检查项跨刷新实际保存',await page.evaluate(()=>document.querySelector('[data-task-check="run"]').checked));await click('close');
 await click('nav:ideas');await click('discuss:a1');s=await state();check('深入聊聊创建完整专用会话',s.sessions.find(x=>x.id==='idea-a1').messages[0].text.includes(s.ideas[0].details)&&s.sessions.find(x=>x.id==='idea-a1').messages[0].text.includes(s.ideas[0].steps[2])&&s.sessions.find(x=>x.id==='main').messages.length===6);
 const n=s.sessions.length;await click('nav:ideas');await click('discuss:a1');check('再次深入聊聊复用原会话',(await state()).sessions.length===n);
 await click('session:main');await page.fill('[name=message]','这段怎么落到下一步？');
 await click('nav:inbox');await click('item:i1');await click('full-message');console.log(await page.snapshot());
 const selected=await selectText('.source-message-text');check('真实鼠标选区不是整项自动引用',selected.length>3&&selected.length<40);await shot('selection-toolbar');
 await page.click('.selection-quote-toolbar button');s=await state();let main=s.sessions.find(x=>x.id==='main');
 check('选文添加保留原文来源且不自动发送',main.draftQuotes.length===1&&main.draftQuotes[0].text===selected&&main.draftQuotes[0].sourceId==='i1'&&main.messages.length===6);
 check('已有问题与引用同时保留',await page.evaluate(()=>document.querySelector('[name=message]').value==='这段怎么落到下一步？'&&document.querySelectorAll('.composer-quote').length===1));await shot('quote-composer');
 await click('session:review');check('引用不会进入其他会话',await page.evaluate(()=>!document.querySelector('.composer-quote')));await page.fill('[name=message]','公开评审独立草稿');await click('session:main');
 await go();s=await state();check('引用与问题跨刷新恢复',s.sessions[0].draftQuotes[0].text===selected&&s.sessions[0].draft==='这段怎么落到下一步？');
 const qid=s.sessions[0].draftQuotes[0].id;await click('quote-preview:'+qid);check('引用预览可见完整选文',await page.evaluate(text=>document.querySelector('.document-markdown').textContent.includes(text),selected));await click('quote-origin:'+qid);check('查看来源回到精确收件箱',await page.evaluate(()=>document.querySelector('.inbox-item.selected').dataset.action==='item:i1'));
 await click('nav:chat');await page.press('[name=message]','Enter');s=await state();main=s.sessions[0];
 check('追问保存精确引用快照与正文',main.messages.length===8&&main.messages.at(-2).quotes[0].text===selected&&main.messages.at(-2).text==='这段怎么落到下一步？'&&main.draftQuotes.length===0);
 check('追问产生对应详细答复且不修改原事项',main.messages.at(-1).text.includes('范围边界')&&main.messages.at(-1).text.includes('回到引用来源')&&main.messages.at(-1).text.includes('没有自动改动')&&s.inbox[0].status==='pending'&&s.inbox[0].draft===s.inbox[0].generatedDraft);
 check('发送后仍为普通对话没有分析卡',await page.evaluate(()=>!document.querySelector('.attention-result,.inbox-automation')&&!!document.querySelector('.message-quotes blockquote')));await shot('quoted-followup');
 await go();check('已发送引用与答复跨刷新保留',(await state()).sessions[0].messages.at(-2).quotes[0].text===selected);
 // Whole-source keyboard alternative and max-four; documents provide real readable context.
 await click('attachments');await page.click('[name=attachment][value="3"]');await click('attach-selected');s=await state();check('资料选择实际附上部署核对单',s.sessions[0].draftQuotes[0].type==='document'&&s.sessions[0].draftQuotes[0].sourceId==='deploy-check');
 await page.fill('[name=message]','这里为什么不能直接重试？');await page.press('[name=message]','Enter');check('不同来源追问使用部署事实',(await state()).sessions[0].messages.at(-1).text.includes('等待超时只说明'));
 await click('nav:ideas');await click('idea:a2');await page.click('.modal [data-action^="quote-source:"]');check('灵感支持无选区添加',(await state()).sessions[0].draftQuotes[0].type==='idea');
 await click('nav:tasks');await page.click('.task-title[data-action="task:t1"]');await page.click('.modal [data-action^="quote-source:"]');
 await click('nav:inbox');await click('item:i2');await click('inbox-ideas');
 await click('attachments');await page.click('[name=attachment][value="0"]');await click('attach-selected');
 check('多种来源共同附加至当前对话',(await state()).sessions[0].draftQuotes.length===4);
 await click('nav:inbox');await click('filter:all');await click('item:i3');await click('inbox-ideas');check('第五段明确拒绝不覆盖四段',(await state()).sessions[0].draftQuotes.length===4&&await page.evaluate(()=>document.querySelector('#notice').textContent.includes('四段')));
 await click('nav:chat');await page.fill('[name=message]','公开保留的追问');s=await state();await click('quote-remove:'+s.sessions[0].draftQuotes[0].id);check('移除引用不清追问',(await state()).sessions[0].draftQuotes.length===3&&(await state()).sessions[0].draft==='公开保留的追问');
 await click('scenario:unknown');const before=(await state()).sessions[0].messages.length;await page.press('[name=message]','Enter');check('未确认状态保留引用与问题不伪造回答',(await state()).sessions[0].messages.length===before&&(await state()).sessions[0].draftQuotes.length===3&&(await state()).sessions[0].draft==='公开保留的追问');await click('scenario:normal');
 // Storage failures: preserve typed question + quote snapshot and roll back outgoing messages.
 await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='opstwins-product-mock-v1')throw new DOMException('public quota failure','QuotaExceededError');return window.__originalSetItem.call(this,k,v)}});
 await page.press('[name=message]','Enter');check('本地保存失败回滚发送并保留引用',(await state()).sessions[0].messages.length===before&&(await state()).sessions[0].draftQuotes.length===3&&await page.evaluate(()=>!!document.querySelector('.quote-save-error')));
 s=await state();await click('quote-remove:'+s.sessions[0].draftQuotes[0].id);check('移除保存失败恢复原引用',(await state()).sessions[0].draftQuotes.length===3);
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem});await click('quote-save');check('明确重试保存清错误且保稿',await page.evaluate(()=>!document.querySelector('.quote-save-error')&&document.querySelector('[name=message]').value==='公开保留的追问'));
 await seed('large');console.log(await page.snapshot());await page.click('.message-actions [data-action^="quote-source:"]');check('超长整段引用明确拒绝而非截断',!(await state()).sessions[0].draftQuotes?.length&&await page.evaluate(()=>document.querySelector('#notice').textContent.includes('6000')));
 await seed('legacy');s=await state();check('旧公开占位无需清空即可完整升级',s.inbox[0].messages.length===5&&s.ideas[0].details.length>230&&s.tasks.length===6&&s.tasks[3].done);
 await seed('modified');s=await state();check('保留人工稿/改写/完成/忽略状态和删除',s.inbox[0].draft==='公开人工稿不能覆盖'&&s.ideas[0].body==='公开修改后的建议'&&s.ideas[0].ignored&&s.tasks[0].title==='公开修改的标题'&&s.tasks[1].done&&!s.inbox.some(x=>x.id==='i4'));
 await seed('deleted');s=await state();check('已删除新演示项不在刷新时复活',!s.ideas.some(x=>x.id==='a4')&&!s.tasks.some(x=>['t5','t6'].includes(x.id)));
 const hashes={};for(const f of ['data.js','workspace-demo.js','workspace-legacy.js','chat-quotes.js','pages.js','app.js','workspace-quotes.css','index.html'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+f)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({spaceId:task.spaceId,scope:'public local authored demo; no AI/transport/native acceptance',results,hashes},null,2));console.log({passed:results.length,out,spaceId:task.spaceId});
}catch(error){await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(error)},null,2));await shot('failure');throw error}
finally{if(backedUp){await page.evaluate(({key,original})=>{if(window.__originalSetItem)Storage.prototype.setItem=window.__originalSetItem;original===null?localStorage.removeItem(key):localStorage.setItem(key,original)},{key,original});await go();const exact=await page.evaluate(key=>localStorage.getItem(key),key)===original;await fs.writeFile(out+'/restoration.json',JSON.stringify({exactMatch:exact}));if(!exact)throw Error('namespace restore mismatch')}}
