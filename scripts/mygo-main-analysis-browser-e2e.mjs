// Single goal TaskSpace143. Public QA states are explicitly distinguished from real upstreams.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const t=await taskSpace(143),p=t.page('p1'),root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mygo-main-analysis-20261018/browser-'+Date.now(),checks=[];
await fs.mkdir(out,{recursive:true});
const check=(name,value)=>{checks.push({name,status:value?'PASS':'FAIL'});if(!value)throw Error(name)};
async function api(method,path,body){const r=await p.fetch(path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=JSON.parse(r.body);if(!r.ok)throw Error(r.status+':'+path);return d}
const pilot=body=>api('POST','/api/pilot/main-analysis',body),state=async()=>{const d=await api('GET','/api/pilot/main-analysis');d.messages=d.messages.filter(m=>m.inboxAnalysis.itemId==='main-analysis-live');return d};
async function ready(){await p.waitForFunction(()=>!document.querySelector('#desktop-boot')&&!!window.OpsTwinsDesktop?.v17,undefined,{timeout:30000})}
async function shot(name){/* Browser screenshot transport timed out; preserve AX here and verify pixels in native App. */await fs.writeFile(out+'/'+name+'.ax.txt',await p.snapshot())}
async function waitText(text){await p.waitForFunction(text=>document.querySelector('[data-message-id="inbox-analysis-7a08d4ac7dd3765d55665ad5f52ff914"]')?.textContent.includes(text),text,{timeout:20000})}
try{
 await pilot({action:'recover'});await p.reload();await ready();const first=await state();if(first.item.triage?.status==='failed'){await waitText('分析失败');check('真实Jev402显示失败，不伪成功',true);await shot('real-jev-failed')}else check('续验同一真实草稿回执',first.item.draftPreparation?.status==='succeeded');
 await p.fill('#input','未发送草稿 INPUT-8421');
 await pilot({action:'qualified',running:true});await waitText('正在分析');await shot('controlled-analyzing');
 check('分析回包保留composer对象和值',await p.evaluate(()=>document.querySelector('#input').value==='未发送草稿 INPUT-8421'));
 await pilot({action:'qualified'});await pilot({action:'start'});
 await p.waitForFunction(async()=>{const d=await(await fetch('/api/pilot/main-analysis')).json();return !!d.item.draft||!!d.item.draftError},undefined,{timeout:150000});
 const completed=await state();await fs.writeFile(out+'/real-draft-receipt.json',JSON.stringify({triageSource:'public-controlled-fixture',preparation:completed.item.draftPreparation,requests:completed.draftRequests,draftRunId:completed.item.draftRunId,hasDraft:!!completed.item.draft,draftError:completed.item.draftError||null},null,2));
 check('真实配置模型生成草稿',!!completed.item.draft&&!completed.item.draftError&&completed.item.draftPreparation?.status==='succeeded');
 await waitText('待回复');check('主会话正文与canonical草稿一致',await p.evaluate(d=>document.querySelector('#messages').textContent.includes(d),completed.item.draft));check('一事项只有一条消息',completed.messages.length===1);await shot('ready');
 const sourceId=completed.messages[0].id,requestCount=completed.draftRequests.length;await p.reload();await ready();await waitText('待回复');check('刷新不重复请求或消息',(await state()).messages.length===1&&(await state()).draftRequests.length===requestCount);
 await p.click('[data-message-id="'+sourceId+'"] .inbox-chat-source a');await p.waitForSelector('#view-inbox.active');check('链接精确打开原事项',await p.evaluate(()=>document.querySelector('.inbox-item.selected')?.dataset.inboxId==='main-analysis-live'||document.querySelector('#draft').dataset.itemId==='main-analysis-live'));
 await p.fill('#draft','人工回复 EDITED-8421');await p.waitForFunction(async()=>{const x=await(await fetch('/api/inbox/main-analysis-live')).json();return x.draft==='人工回复 EDITED-8421'},undefined,{timeout:10000});
 await p.click('button[aria-label="对话"]');await waitText('人工回复 EDITED-8421');check('人工稿同步同一条主会话消息',(await state()).messages[0].id===sourceId);await shot('edited');
 await p.click('#session-toggle');await p.click('#session-new');await p.waitForFunction(()=>window.OpsTwinsChatSessions.selected()!=='main-analysis-primary');check('侧会话不出现全局汇总',await p.evaluate(()=>!document.querySelector('#messages .inbox-chat-source')));await p.click('#session-toggle');await p.click('.session-main .session-open');await waitText('人工回复 EDITED-8421');
 await pilot({action:'stop'});await pilot({action:'fault',kind:'unknown'});await waitText('上次生成未确认');await p.reload();await ready();await waitText('上次生成未确认');check('未知刷新不重跑',(await state()).draftRequests.length===requestCount);await shot('unknown');
 await pilot({action:'fault',kind:'source-change'});await waitText('来源已更新');check('来源更新不冒充旧草稿有效',await p.evaluate(()=>!document.querySelector('#messages').textContent.includes('人工回复 EDITED-8421')));await shot('source-changed');
 await pilot({action:'fault',kind:'deleted'});await waitText('来源暂不可用');check('删除后保留记录但撤下来源与草稿',await p.evaluate(()=>!document.querySelector('[data-message-id="inbox-analysis-7a08d4ac7dd3765d55665ad5f52ff914"] .inbox-chat-source')&&!document.querySelector('#messages').textContent.includes('EDITED-8421')));
 await p.click('button[aria-label="设置"]');await p.click('[data-setting="general"]');check('无可见原生select',await p.evaluate(()=>[...document.querySelectorAll('select')].every(x=>!x.getClientRects().length)));const b='[data-vm-select]';await p.click(b+' >> nth=0');await p.waitForSelector('#vm-select-menu');check('真实设置使用共享菜单',true);await p.keyboard.press('Escape');check('Escape保持设置打开',await p.evaluate(()=>document.querySelector('#settings-window').open));await shot('components');await p.click('#close-settings');
}catch(e){await fs.writeFile(out+'/error.txt',String(e));await shot('failure');throw e}
finally{await fs.writeFile(out+'/result.json',JSON.stringify({space:143,checks,source:'public QA; real LLM draft, real Jev failed402; controlled successful triage'},null,2));console.log({out,checks})}
