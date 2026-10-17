// Run with ego-browser nodejs; prepend globalThis.OPSTWIN_MOCK_SPACE=61 to resume this acceptance space.
// Omit the global override for a new acceptance goal. Does not touch production data.
const fs = await import('node:fs/promises');
const path = await import('node:path');
const crypto = await import('node:crypto');
const root = process.env.OPSTWIN_MOCK_ROOT || '/Users/steve/Projects/opstwin-advance';
const out = path.join(root, 'output/mock-product-20261017', String(Date.now()));
await fs.mkdir(out, {recursive:true});
const task = await taskSpace(globalThis.OPSTWIN_MOCK_SPACE ? Number(globalThis.OPSTWIN_MOCK_SPACE) : 'OpsTwins Mock E2E');
const page = task.page('p1');
const results=[];
const check=(name,pass,detail)=>{results.push({name,status:pass?'PASS':'FAIL',detail});if(!pass)throw Error(name)};
const read=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
const click=action=>page.click(`${['notes','export'].includes(action)?'.studio-bar ':''}[data-action="${action}"]`);
const shot=name=>page.screenshot({path:path.join(out,name+'.png')});
async function screen(id){const visible=await page.evaluate(()=>document.querySelector('#screen-picker').getBoundingClientRect().width>0);if(visible)await page.selectOption('#screen-picker',id);else await page.goto('http://127.0.0.1:46400/#'+id);await page.waitForFunction(id=>window.OpsTwinsMock?.getScreen()===id,id)}
async function persistProof(){
 const hashes={};
 for(const file of ['index.html','app.js','pages.js','settings.js','ui.js','data.js','styles.css','fidelity.css','assets/product-icons.js'])hashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'mock/opstwins',file))).digest('hex');
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({taskSpace:task.spaceId,page:'p1',url:'http://127.0.0.1:46400/',scope:'public local mock only',results,hashes},null,2));
}
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1680,height:969,deviceScaleFactor:1,mobile:false});
 await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__mockErrors=[];addEventListener('error',e=>window.__mockErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__mockErrors.push(String(e.reason)));`});
 await page.goto('http://127.0.0.1:46400/');
 await page.waitForSelector('.overview');
 console.log({taskSpace:task.spaceId,out});
 check('统一入口展示32个页面',await page.evaluate(()=>document.querySelectorAll('.screen-card').length===32));
 await shot('00-overview');
 await fs.writeFile(path.join(out,'overview.ax.txt'),await page.snapshot());
 await page.click('a[aria-label="进入对话"]');
 await click('tweaks');await click('reset-confirm');await click('confirm-go');
 check('正常预览为1000×700且不放大',await page.evaluate(()=>{const r=document.querySelector('.desktop-window').getBoundingClientRect();return r.width===1000&&r.height===700}));
 const ids=await page.evaluate(()=>window.OpsTwinsMock.screens);
 for(const [i,id] of ids.entries()){
  await screen(id);
  const snapshot=await page.snapshot();
  check('页面 '+id,snapshot.length>300&&await page.evaluate(()=>!!document.querySelector('#workspace')));
  await shot(String(i+1).padStart(2,'0')+'-'+id.replaceAll('/','-'));
  await fs.writeFile(path.join(out,id.replaceAll('/','-')+'.ax.txt'),snapshot);
 }
 await screen('settings/models');check('设置900×640与225侧栏和240控件',await page.evaluate(()=>{const w=document.querySelector('.settings-window'),n=document.querySelector('.settings-nav'),s=document.querySelector('select[name=model]');return w.offsetWidth===900&&w.offsetHeight===640&&n.offsetWidth===225&&s.offsetWidth===240}));check('模型无修改隐藏保存',await page.evaluate(()=>document.querySelector('form[data-kind=model] .form-actions').hidden));await page.selectOption('[name=model]','示例推理模型');check('修改显示保存',await page.evaluate(()=>!document.querySelector('form[data-kind=model] .form-actions').hidden));await click('cancel-setting');
 await screen('chat');await click('overview');check('统一返回导航',await page.evaluate(()=>!!document.querySelector('.overview')));await click('overview');
 // Distinct drafts, recording cancel, attachments, readable local reply.
 await screen('chat');
 const marker='公开E2E-'+Date.now();
 await page.fill('[name=message]',marker+'主会话');await click('sidebar');await click('session:review');await page.fill('[name=message]',marker+'侧会话');await click('session:main');
 check('会话草稿隔离',await page.evaluate(()=>document.querySelector('[name=message]').value.includes('主会话')));
 await click('voice');await shot('voice');await click('voice-cancel');
 check('听写取消保稿',await page.evaluate(()=>document.querySelector('[name=message]').value.includes('主会话')));
 await click('attachments');await page.click('[name=attachment][value="0"]');await click('attach-selected');await page.click('[aria-label="发送消息"]');
 check('消息在本地会话保存',(await read()).sessions.find(x=>x.id==='main').messages.some(x=>x.text===marker+'主会话'));
 await page.reload();await page.waitForSelector('[name=message]');check('刷新恢复消息',(await read()).sessions.find(x=>x.id==='main').messages.some(x=>x.text===marker+'主会话'));
 // Inbox autosave and explicit send preview.
 await screen('inbox');await page.fill('#reply-draft',marker+'草稿');await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='已保存到本地 Mock');await click('item:i2');await click('item:i1');
 check('Inbox按事项保存',await page.evaluate(()=>document.querySelector('#reply-draft').value.includes('公开E2E-')));
 await click('reply');await shot('send-preview');await click('confirm-go');
 check('发送只记本地预览',(await read()).log.some(x=>x.label==='预览发送回复'));
 // Task edit, failure keeps input, explicit retry and refresh.
 await screen('tasks');await click('new-task');await page.fill('[name=title]',marker+'任务');await page.fill('[name=note]','公开示例备注');await click('scenario:error');
 check('场景切换保留任务稿',await page.evaluate(()=>document.querySelector('[name=title]').value.startsWith('公开E2E-')));
 await page.click('#task-form button.primary');check('失败不创建任务',!(await read()).tasks.some(x=>x.title===marker+'任务')&&await page.evaluate(()=>document.querySelector('#task-form .form-feedback').textContent.includes('输入已保留')));await shot('task-failure');
 await click('scenario:normal');await page.click('#task-form button.primary');
 const taskRow=(await read()).tasks.find(x=>x.title===marker+'任务');check('明确保存任务',!!taskRow);await click('toggle-task:'+taskRow.id);await page.reload();await page.waitForSelector('.tasks-page');check('任务完成刷新保留',(await read()).tasks.find(x=>x.id===taskRow.id).done);
 // Documents and custom/provider forms.
 await screen('settings/soul');await click('doc-edit');await page.fill('[name=document]','# 公开E2E身份\n\n'+marker);await page.click('#document-form button.primary');await page.reload();await page.waitForSelector('.document-markdown');check('文档保存和Markdown阅读',await page.evaluate(()=>document.querySelector('.document-markdown h2')?.textContent==='公开E2E身份'));
 await screen('settings/provider');await page.fill('[name=provider]','公开供应商');await page.fill('[name=credential]','public-dummy-secret-not-a-key');await click('scenario:error');
 check('供应商失败保稿，凭据不恢复',await page.evaluate(()=>document.querySelector('[name=provider]').value==='公开供应商'&&document.querySelector('[name=credential]').value===''));
 await click('scenario:normal');await page.click('#settings-form button.primary');check('小数参数表单可保存',(await read()).model.provider==='公开供应商');
 check('凭据未存储',!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('public-dummy-secret-not-a-key'));
 await screen('settings/models');await click('model-test');await page.waitForFunction(()=>document.querySelector('#model-feedback').textContent.includes('成功'));check('模型测试明确标注预览',await page.evaluate(()=>document.querySelector('#model-feedback').textContent.includes('预览')));
 await screen('settings/custom');await page.fill('[name=name]','公开知识源');await page.fill('[name=address]','https://example.com/knowledge');await page.click('#settings-form button.primary');await page.reload();await page.waitForSelector('[name=name]');check('自定义连接保存恢复',(await read()).custom.name==='公开知识源');
 // Memory undo and idea-to-side-session.
 await screen('memory');const count=(await read()).automatic.length;await click('forget:m1');await click('undo-memory');check('记忆忘记可撤销',(await read()).automatic.length===count);
 await screen('ideas');await click('discuss:a1');check('灵感进入独立侧会话',(await read()).sessions.some(x=>x.id==='idea-a1'));
 await screen('search');await page.fill('#global-query','确认本周评审');await page.press('#global-query','Enter');check('搜索打开精确Inbox',await page.evaluate(()=>document.querySelector('.person-heading h2')?.textContent==='林可'));
 for(const value of ['empty','loading','error','unknown','partial']){await screen('chat');await click('scenario:'+value);await shot('state-'+value);check('状态 '+value,await page.evaluate(v=>document.querySelector(`[data-action="scenario:${v}"]`).classList.contains('active'),value));}
 await click('scenario:normal');await screen('settings/help');await click('open:activity');check('帮助操作记录入口',await page.evaluate(()=>document.querySelector('h1')?.textContent==='操作记录'));
 await screen('chat');await click('notes');await page.fill('#page-note','公开迭代备注：保留当前输入框，调整间距');await page.reload();await page.waitForSelector('.studio-bar');await click('notes');check('页面备注刷新保留',await page.evaluate(()=>document.querySelector('#page-note').value.includes('调整间距')));await shot('notes');await click('notes');
 const downloadPromise=page.waitForEvent('download',{timeout:10000});await click('export');const download=await downloadPromise;await download.saveAs(path.join(out,'iteration-export.json'));const exported=JSON.parse(await fs.readFile(path.join(out,'iteration-export.json'),'utf8'));check('迭代包含备注',exported.data.notes.chat.includes('调整间距'));
 await click('tweaks');await click('theme:dark');await click('density:compact');await shot('dark-compact');check('外观与密度应用',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'&&document.body.dataset.density==='compact'));await click('theme:light');await click('density:standard');await click('close');
 for(const width of [900,660,390]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
  for(const id of ['chat','inbox','ideas','tasks','settings/models','settings/provider']){await screen(id);if(id==='inbox')await click('item:i2');await shot('width-'+width+'-'+id.replaceAll('/','-'));check(width+'保持桌面比例 '+id,await page.evaluate(()=>{const c=document.querySelector('.prototype-canvas'),r=c.getBoundingClientRect();return c.offsetWidth===1000&&c.offsetHeight===700&&Math.abs(r.width/r.height-10/7)<.001&&r.right<=innerWidth+1}));check(width+'无横向溢出 '+id,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 }
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1680,height:969,deviceScaleFactor:1,mobile:false});
 check('浏览器无脚本异常',await page.evaluate(()=>window.__mockErrors.length===0));
 // Reset only via this prototype's explicit UI. Retain public evidence first.
 await screen('chat');await click('tweaks');await click('reset-confirm');await click('confirm-go');await click('overview');await shot('final-overview');
 await persistProof();console.log({passed:results.length,failed:0,out});
}catch(error){results.push({name:'执行异常',status:'FAIL',detail:String(error)});await persistProof();await shot('failure').catch(()=>{});console.log({error:String(error),out});throw error}
