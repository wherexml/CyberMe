// ego-browser nodejs: one TaskSpace, exact Mock namespace restored in finally.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-open-source-20261017/'+Date.now();
await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins Inbox Zero and remend integration');
const page=task.page(globalThis.OPSTWIN_MOCK_PAGE||'p1'),results=[];
const key='opstwins-product-mock-v1';
const check=(name,pass,detail)=>{results.push({name,status:pass?'PASS':'FAIL',detail});if(!pass)throw Error(name)};
const click=action=>page.click(`[data-action="${action}"]`);
const state=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
let original,hasOriginal=false,fixtureGeneration=0;
async function seed(options={},route='inbox'){
 await page.evaluate(async({key,options})=>{
  const {initial}=await import('./data.js');const s=structuredClone(initial);
  if(options.messages){s.sessions[0].messages=options.messages;s.inbox=[]}
  if(Object.hasOwn(options,'confidence'))s.inbox[0].draftConfidence=options.confidence;
  if(options.request)s.inbox[0].draftRequest=options.request;
  if(options.legacy){for(const field of ['draftConfidence','generatedDraft','previewDraft'])delete s.inbox[0][field]}
  if(options.customMissing){delete s.inbox[0].draftConfidence;s.inbox[0].messages=[['other','公开自定义来源，不是内置样例']]}
  localStorage.setItem(key,JSON.stringify({version:1,data:s}));
 },{key,options});
 await page.goto('http://127.0.0.1:46400/?v=7&fixture='+Date.now()+'-'+(++fixtureGeneration)+'#'+route);
 await page.waitForSelector(route==='chat'?'.bubble':'#reply-draft');
}
async function shot(name){await page.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await page.snapshot());}
try{
 await page.goto('http://127.0.0.1:46400/?v=7#inbox');await page.waitForSelector('#reply-draft');
 original=await page.evaluate(key=>localStorage.getItem(key),key);hasOriginal=true;
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await seed();
 check('输入框与判断条尺寸保留',await page.evaluate(()=>document.querySelector('.prototype-canvas').offsetWidth===1000&&document.querySelector('.judgment').offsetHeight===42));
 await click('regenerate');await page.waitForFunction(()=>window.OpsTwinsMock.getState().inbox[0].draftRequest?.status==='completed');
 check('STANDARD门槛使用上游函数并更新未编辑稿',(await state()).inbox[0].draft===(await state()).inbox[0].previewDraft&&(await state()).inbox[0].draftRequest.policy.minimumConfidence==='STANDARD');
 await page.reload();await page.waitForSelector('#reply-draft');check('生成稿刷新恢复',await page.evaluate(()=>document.querySelector('#reply-draft').value===window.OpsTwinsMock.getState().inbox[0].previewDraft));
 await seed({legacy:true});await click('regenerate');await page.waitForFunction(()=>window.OpsTwinsMock.getState().inbox[0].draftRequest?.status==='completed');
 check('旧版精确公开样例补元数据后可用',(await state()).inbox[0].draft===(await state()).inbox[0].previewDraft);
 await seed({customMissing:true});await click('regenerate');check('自定义来源缺失置信度不被样例迁移放行',(await state()).inbox[0].draftRequest?.status==='unknown');
 await seed();await page.fill('#reply-draft','公开人工稿A');await click('regenerate');await page.fill('#reply-draft','公开后输入B：必须保留');
 await click('item:i2');const second=(await state()).inbox[1].draft;
 await page.waitForFunction(()=>window.OpsTwinsMock.getState().inbox[0].draftRequest?.status==='completed');
 check('后台回包不覆盖另一事项',await page.evaluate(value=>document.querySelector('#reply-draft').value===value,second));
 check('后输入原稿保留且新稿为候选',(await state()).inbox[0].draft==='公开后输入B：必须保留'&&!!(await state()).inbox[0].draftCandidate);
 await click('item:i1');await shot('manual-candidate');
 await page.reload();await page.waitForSelector('[data-action=adopt-draft]');
 check('人工稿与候选分别刷新恢复',await page.evaluate(()=>document.querySelector('#reply-draft').value==='公开后输入B：必须保留'&&!!document.querySelector('.draft-candidate')));
 await click('dismiss-draft');check('关闭候选不改人工稿',(await state()).inbox[0].draft==='公开后输入B：必须保留'&&!(await state()).inbox[0].draftCandidate);
 await click('regenerate');await page.waitForSelector('[data-action=adopt-draft]');await click('adopt-draft');
 check('明确采用才替换人工稿',(await state()).inbox[0].draft===(await state()).inbox[0].previewDraft&&!(await state()).inbox[0].draftCandidate);
 await page.reload();await page.waitForSelector('#reply-draft');check('采用结果刷新恢复',await page.evaluate(()=>document.querySelector('#reply-draft').value===window.OpsTwinsMock.getState().inbox[0].previewDraft));
 for(const [label,confidence] of [['低','ALL_EMAILS'],['缺失',null],['无效','untrusted-value']]){
  await seed({confidence});const before=(await state()).inbox[0].draft;
  await click('regenerate');
  check(label+'置信度阻断且事项/人工稿保留',(await state()).inbox[0].draft===before&&(await state()).inbox[0].draftRequest.status==='unknown'&&await page.evaluate(()=>!!document.querySelector('[data-action="item:i1"]')&&!!document.querySelector('.draft-feedback-error')));
 }
 await shot('unknown-confidence');
 await seed({confidence:'HIGH_CONFIDENCE'});await click('regenerate');await page.waitForFunction(()=>window.OpsTwinsMock.getState().inbox[0].draftRequest?.status==='completed');
 check('HIGH_CONFIDENCE允许准备',(await state()).inbox[0].draftRequest.policy.confidence==='HIGH_CONFIDENCE');
 await seed();const before=(await state()).inbox[0].draft;
 await click('scenario:error');await click('regenerate');const failed=(await state()).inbox[0].draftRequest.id;
 check('失败不替换原稿',(await state()).inbox[0].draft===before&&(await state()).inbox[0].draftRequest.status==='failed');
 await click('scenario:normal');await click('regenerate');await page.waitForFunction(()=>window.OpsTwinsMock.getState().inbox[0].draftRequest?.status==='completed');
 check('明确失败重试沿原ID',(await state()).inbox[0].draftRequest.id===failed);
 await seed();await click('regenerate');await click('scenario:error');
 await page.waitForFunction(()=>window.OpsTwinsMock.getState().inbox[0].draftRequest?.status==='failed');
 check('生成中切失败场景也不覆盖原稿',(await state()).inbox[0].draft===before&&!(await state()).inbox[0].draftCandidate);
 await seed();await click('regenerate');await page.reload();await page.waitForSelector('#reply-draft');
 const unresolved=(await state()).inbox[0].draftRequest;
 check('刷新中断保留原ID且不自动重跑',unresolved.status==='unknown');await click('regenerate');
 check('未确认不换key重发',(await state()).inbox[0].draftRequest.id===unresolved.id&&(await state()).inbox[0].draftRequest.status==='unknown');
 await seed();await click('scenario:partial');await click('regenerate');check('partial保稿且禁止自动采用',(await state()).inbox[0].draftRequest.status==='partial'&&!(await state()).inbox[0].draftCandidate);
 await seed();
 await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='opstwins-product-mock-v1')throw new DOMException('Public failure injection','QuotaExceededError');return window.__originalSetItem.call(this,k,v)}});
 await click('regenerate');check('准备落盘失败不生成或替换',(await state()).inbox[0].draftRequest.status==='failed'&&!(await state()).inbox[0].draftCandidate&&(await state()).inbox[0].draft===before);
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem});
 const context=await page.evaluate(async()=>{
  const {prepareThreadContext}=await import('./vendor/inbox-zero.js');
  const input=Array.from({length:80},(_,i)=>['other','公开首标'+i+'-'.repeat(3000)+'尾标'+i]);const raw=JSON.stringify(input);const result=prepareThreadContext(input);
  return {same:raw===JSON.stringify(input),count:result.messages.length,omitted:result.omittedCount,first:result.messages[0].text,last:result.messages.at(-1).text,truncated:result.truncatedCount};
 });
 check('上游上下文预算有界并保留首条/最新尾标',context.same&&context.count===64&&context.omitted===16&&context.first.startsWith('公开首标0')&&context.last.endsWith('尾标79')&&context.truncated===64&&context.last.includes('[内容已截断]'));
 const incomplete='**公开流式强调';
 await seed({messages:[{role:'assistant',text:incomplete,streaming:true},{role:'user',text:incomplete}]},'chat');
 check('remend只修复流式assistant展示',await page.evaluate(()=>document.querySelector('.message.assistant strong')?.textContent==='公开流式强调'&&!document.querySelector('.message.user strong')));
 check('修复不改写持久原文',(await state()).sessions[0].messages[0].text===incomplete);await shot('streaming-emphasis');
 await seed({messages:[{role:'assistant',text:incomplete,streaming:false}]},'chat');
 check('已结束消息不补造闭合语法',await page.evaluate(()=>!document.querySelector('.bubble strong')&&document.querySelector('.bubble').textContent.includes('**公开流式强调')));
 const rich='```js\nconst value = 1;\n```\n\n|项目|状态|\n|---|---|\n|公开|通过|\n\n[安全链接](https://example.com)\n\n[危险链接](javascript:alert(1))\n\n<img src="https://example.com/tracker.png" onerror="window.__unsafe=1"><script>window.__unsafe=1</script>\n\n![外部图片](https://example.com/remote.png)';
 await seed({messages:[{role:'assistant',text:rich}]},'chat');
 check('代码块/表格/安全链接真实渲染',await page.evaluate(()=>!!document.querySelector('.bubble pre code')&&!!document.querySelector('.bubble table')&&document.querySelector('.bubble a[href="https://example.com"]').rel==='noopener noreferrer'));
 check('HTML/图片/危险协议未执行',await page.evaluate(()=>!window.__unsafe&&!document.querySelector('.bubble img,.bubble script,.bubble [onerror],.bubble a[href^="javascript:"]')&&!performance.getEntriesByType('resource').some(e=>e.name.includes('example.com'))));
 await shot('markdown-safe-rich');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:850,deviceScaleFactor:1,mobile:false});
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
 check('窄屏Markdown未撑破产品窗',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.bubble').scrollWidth<=document.querySelector('.bubble').clientWidth+1));await shot('markdown-scaled');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 // The application intentionally has connect-src 'none'; verify static HTTP from Node.
 const response=await fetch('http://127.0.0.1:46400/vendor/manifest.json');
 const manifests=await response.json();
 check('静态服务继续禁止浏览器外部连接',response.headers.get('content-security-policy')?.includes("connect-src 'self'"));
 check('本地bundle固定来源与版本',manifests.remendVersion==='1.4.0'&&manifests.upstream.files.some(x=>x.repository==='elie222/inbox-zero')&&!!manifests.files['inbox-zero-LICENSE.txt']);
 const hashes={};for(const file of ['app.js','pages.js','ui.js','markdown.js','inbox-drafts.js','inbox-automation.js','open-source.css','vendor/remend.js','vendor/inbox-zero.js','vendor/marked.js'])hashes[file]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+file)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({scope:'public local Mock; no real model/Gmail/sending',spaceId:task.spaceId,results,hashes,manifests},null,2));
 console.log(JSON.stringify({passed:results.length,failed:0,spaceId:task.spaceId,out}));
}catch(error){await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(error)},null,2));await shot('failure');throw error}
finally{
 await page.evaluate(()=>{if(window.__originalSetItem){Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem}});
 if(hasOriginal){
  await page.evaluate(({key,original})=>original===null?localStorage.removeItem(key):localStorage.setItem(key,original),{key,original});await page.goto('http://127.0.0.1:46400/?v=7&restored='+Date.now()+'#inbox');await page.waitForSelector('#reply-draft');
  const restored=await page.evaluate(key=>localStorage.getItem(key),key),hash=text=>crypto.createHash('sha256').update(text??'null').digest('hex');
  await fs.writeFile(out+'/restoration.json',JSON.stringify({exactMatch:original===restored,before:hash(original),after:hash(restored)},null,2));
  if(original!==restored)throw Error('Mock namespace restoration mismatch');
 }
}
