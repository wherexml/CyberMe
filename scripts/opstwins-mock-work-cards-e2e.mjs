// Browser E2E for the public local-only scenario; restores only its own demo session.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-work-cards-20261023/run-'+Date.now();
await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'CyberMe Mock work cards E2E'),p=task.page('p1'),results=[];
const key='opstwins-product-mock-v1',demoId='demo-work-cards';let backup,others;
const check=(name,ok)=>{results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name)};
const state=()=>p.evaluate(()=>window.OpsTwinsMock.getState());
const demo=async()=>(await state()).sessions.find(s=>s.id===demoId);
const click=action=>p.click(`button[data-action="${action}"]`);
async function network(){check('演示没有调用模型或执行 API',await p.evaluate(()=>!performance.getEntriesByType('resource').some(x=>x.name.includes('/api/'))))}
try{
 await p.goto('http://127.0.0.1:46400/?demo=work-cards#chat');await p.waitForSelector('.work-choices');
 backup=await demo();others=JSON.stringify((await state()).sessions.filter(s=>s.id!==demoId));
 check('新增独立示例且三项可选',await p.evaluate(()=>document.querySelectorAll('.work-choice-pick:not(:disabled)').length===3));
 const initial=await demo(),taskMsg=initial.messages.find(m=>m.workTask),panelMsg=initial.messages.find(m=>m.workPanel);
 await click('work-task:'+taskMsg.id);check('任务详情可打开',await p.evaluate(()=>document.querySelector('.modal').textContent.includes('核对评审范围')));await p.keyboard.press('Escape');
 await click('work-file:'+taskMsg.id);check('成果可打开全文',await p.evaluate(()=>document.querySelector('.modal').textContent.includes('部署检查结果仍待核实')));await p.keyboard.press('Escape');
 const downloading=p.waitForEvent('download',{timeout:10000});await click('work-download:'+taskMsg.id);const download=await downloading;await download.saveAs(out+'/评审准备.md');check('下载与已保存正文一致',await fs.readFile(out+'/评审准备.md','utf8')===taskMsg.workTask.artifact.body);
 await p.click('[aria-label="查看来源：先对齐两版差异"]');check('来源精确打开讨论记录',await p.evaluate(()=>document.querySelector('.modal').textContent.includes('产品讨论记录')));await p.keyboard.press('Escape');
 await p.focus(`[data-action="work-choose:${panelMsg.id}:1:core"]`);await p.keyboard.press('Enter');
 check('键盘选择启动一个任务',(await demo()).messages.filter(m=>m.workTask?.status==='running').length===1);
 await p.fill('[name=message]','先对齐差异，不要继续整理旧方案');await p.press('[name=message]','Enter');
 let d=await demo();const stopped=d.messages.find(m=>m.workTask?.status==='stopped');check('新消息直接停止旧回复并立即产生新选项',!!stopped&&!d.workActive&&d.messages.at(-1).workPanel&&!d.draft);
 await p.waitForFunction(()=>document.querySelectorAll('.work-choice-pick:not(:disabled)').length===3);
 await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,2700)));
 d=await demo();check('迟到计时结果没有复活旧任务',d.messages.find(m=>m.id===stopped.id).workTask.status==='stopped'&&!d.messages.find(m=>m.id===stopped.id).workTask.artifact);
 check('旧选项已禁用且无排队入口',await p.evaluate(()=>[...document.querySelectorAll('.work-choices')][0].querySelectorAll('button.work-choice-pick:disabled').length===3&&!document.querySelector('.chat-main').textContent.includes('排队')));
 const fresh=d.messages.at(-1);await click(`work-choose:${fresh.id}:${fresh.workPanel.version}:compare`);
 await click('nav:ideas');await p.waitForFunction(()=>window.OpsTwinsMock.getState().sessions.find(s=>s.id==='demo-work-cards').messages.at(-1).workTask?.status==='done');
 check('后台完成不切走当前页',(await p.evaluate(()=>window.OpsTwinsMock.getScreen()))==='ideas');await click('nav:chat');
 d=await demo();check('任务完成并有持久成果',d.messages.at(-1).workTask.status==='done'&&!!d.messages.at(-1).workTask.artifact);
 await network();await p.reload();await p.waitForSelector('.work-card');check('刷新恢复同一成果',(await demo()).messages.at(-1).workTask.artifact.id===d.messages.at(-1).workTask.artifact.id);
 await click('work-resume:'+stopped.id);await p.reload();await p.waitForSelector('.work-card');check('运行中刷新保留停止状态不自动重放',!(await demo()).workActive&&(await demo()).messages.at(-1).workTask.status==='stopped');
 await p.fill('[name=message]','保存失败时保留的公开草稿');
 await p.evaluate(()=>{window.__workOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='opstwins-product-mock-v1')throw Error('public fixture disk full');return window.__workOriginalSet.call(this,k,v)}});
 const count=(await demo()).messages.length;await p.press('[name=message]','Enter');check('保存失败保稿且不添加消息',(await demo()).draft==='保存失败时保留的公开草稿'&&(await demo()).messages.length===count);
 await p.evaluate(()=>{Storage.prototype.setItem=window.__workOriginalSet;delete window.__workOriginalSet});await p.press('[name=message]','Enter');check('恢复保存后正常提交',(await demo()).messages.length===count+2);
 check('原有会话完全保留',JSON.stringify((await state()).sessions.filter(s=>s.id!==demoId))===others);await network();
 await fs.writeFile(out+'/final.ax.txt',await p.snapshot());
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({error:String(e),results},null,2));throw e}
finally{
 if(backup){await p.evaluate(({key,backup})=>{if(window.__workOriginalSet){Storage.prototype.setItem=window.__workOriginalSet;delete window.__workOriginalSet}const saved=JSON.parse(localStorage.getItem(key));saved.data.sessions=saved.data.sessions.map(s=>s.id===backup.id?backup:s);localStorage.setItem(key,JSON.stringify(saved))},{key,backup});await p.reload()}
 const hashes={};for(const file of ['work-cards.js','work-cards.css','pages.js','app.js'])hashes[file]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+file)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({spaceId:task.spaceId,scope:'local Mock only; no live Jev/model/executor',results,hashes},null,2));console.log({out,results});
}
