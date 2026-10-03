/* Failure cases established before implementation. Run ego-browser nodejs < this file.
   No private text, transport capability or reply bodies in artifacts. */
const fs=await import('node:fs/promises'),path=await import('node:path'),crypto=await import('node:crypto');
const base='/Users/steve/Projects/opstwin-advance',out=path.join(base,'output/idea-judgment-review');await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPS_UI_SPACE??'OpsTwins idea and judgment refinement'),page=task.page('p1'),checks=[];console.log({spaceId:task.spaceId});
const entry='file://'+base+'/docs/design/macos-ui-study.html';let saved;
const files=['docs/design/macos-ui-study.html','docs/design/macos-ui-study.js','docs/design/macos-workspace-refinement.css','docs/design/macos-message-time.js','docs/design/macos-design-chat.js','scripts/macos-study-chat-bridge.mjs','server/src/chat-status.ts'];
const initialHashes={};for(const f of files)initialHashes[f]=crypto.createHash('sha256').update(await fs.readFile(path.join(base,f))).digest('hex');
function check(name,pass,metrics={}){checks.push({name,status:pass?'PASS':'FAIL',...metrics});console.log({check:name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)}
const view=async(w,h)=>page.cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
try{
 await page.goto(entry);await page.cdp('Page.bringToFront');await view(1272,961);
 saved=await page.evaluate(()=>({prefs:localStorage.getItem('opstwins-ui-study-prefs'),state:localStorage.getItem('opstwins-ui-study-state-v2'),chat:localStorage.getItem('opstwins-design-chat-v1')}));
 await page.click('[data-page="ideas"]');await page.mouse.move(80,40,{label:'移开卡片指针'});
 check('discuss hidden at rest',await page.evaluate(()=>getComputedStyle(document.querySelector('.idea-discuss')).opacity==='0'));
 await page.hover('.idea-card >> nth=0');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.idea-discuss')).opacity==='1',undefined,{timeout:3000});
 check('hover reveals leading chat icon',await page.evaluate(()=>{const b=document.querySelector('.idea-discuss');return getComputedStyle(b).opacity==='1'&&b.firstElementChild?.tagName.toLowerCase()==='svg'&&b.firstElementChild.querySelector('use')?.getAttribute('href')==='#chat'}));
 await page.mouse.move(80,40,{label:'移开指针'});await page.evaluate(()=>document.querySelector('.idea-discuss').focus());await page.waitForFunction(()=>getComputedStyle(document.querySelector('.idea-discuss')).opacity==='1',undefined,{timeout:3000});
 check('keyboard focus reveals action',await page.evaluate(()=>getComputedStyle(document.querySelector('.idea-discuss')).opacity==='1'));
 // Inject a synthetic task through the normal idea renderer. Actual HTTP + configured model below.
 await page.evaluate(()=>{const d=window.OPSTWINS_DESIGN_DATA;d.ideas.unshift({id:'ui-e2e-idea',title:'验收：只回复 UI-E2E-OK',description:'这是合成 UI 验收。不要读取业务资料、调用工具、创建任务或外发，只回复 UI-E2E-OK。',status:'new',category:'productivity',steps:['保留此步骤用于验证上下文']});document.querySelector('#input').value='未发送草稿';document.querySelector('#input').dispatchEvent(new Event('input',{bubbles:true}))});
 await page.click('#ideas-categories button >> nth=0');await page.hover('.idea-card >> nth=0');await page.click('.idea-discuss >> nth=0');
 check('idea opens Chat and preserves unsent draft',await page.evaluate(()=>document.querySelector('#view-chat').classList.contains('active')&&document.querySelector('#input').value==='未发送草稿'&&document.querySelector('[data-chat-request]')));
 await page.waitForFunction(()=>document.querySelector('[data-chat-request]')?.dataset.status==='succeeded',undefined,{timeout:160000});
 check('real Agent result appears',await page.evaluate(()=>{const r=document.querySelector('[data-chat-request]');return r.dataset.status==='succeeded'&&r.querySelector('.chat-agent-result')?.textContent.includes('UI-E2E-OK')&&r.querySelector('.chat-task-context')?.textContent.includes('保留此步骤')}));
 const real=await page.evaluate(()=>{const r=window.OpsTwinsDesignChat.entries().find(x=>x.message.includes('UI-E2E-OK'));return {id:r.requestId,status:r.status,runId:r.result?.run?.id,model:r.result?.run?.model}});
 check('real run has persisted identifiers',real.status==='succeeded'&&!!real.runId,{runId:real.runId,model:real.model});
 await page.reload();await page.waitForFunction(()=>document.querySelector('[data-chat-request]')?.dataset.status==='succeeded',undefined,{timeout:15000});
 check('refresh restores result and draft',await page.evaluate(()=>!!document.querySelector('.chat-agent-result')&&document.querySelector('#input').value==='未发送草稿'));
 // Simulate a newly refreshed private snapshot containing the same completed run.
 check('refreshed source snapshot does not duplicate result',await page.evaluate(()=>{const r=window.OpsTwinsDesignChat.entries().find(x=>x.message.includes('UI-E2E-OK'));window.OPSTWINS_DESIGN_DATA.messages.push(r.result.userMessage,r.result.assistantMessage);window.renderChat();return document.querySelectorAll('[data-message-id="'+r.result.assistantMessage.id+'"]').length===1&&!document.querySelector('[data-chat-request="'+r.requestId+'"]')&&!!document.querySelector('[data-message-id="'+r.result.userMessage.id+'"] details')}));
 // Repeated clicks use one pending request; this response is an explicit UI fixture.
 await page.evaluate(()=>{window.__realFetch=window.fetch;window.__postCount=0;window.fetch=async(url,init)=>{if(String(url).includes(':46114/')&&init?.method==='POST'){window.__postCount++;return new Promise(resolve=>{window.__resolveFixture=()=>resolve(new Response(JSON.stringify({conversationId:window.OPSTWINS_DESIGN_DATA.primaryConversationId,assistantMessage:{content:'Synthetic duplicate click result'},run:{id:'fixture'}}),{status:200,headers:{'Content-Type':'application/json'}}))})}return window.__realFetch(url,init)}});
 await page.click('[data-page="ideas"]');await page.hover('.sample-idea >> nth=1');await page.click('.sample-idea .idea-discuss >> nth=1');
 await page.click('[data-page="ideas"]');await page.hover('.sample-idea >> nth=1');await page.click('.sample-idea .idea-discuss >> nth=1');
 check('double click creates only one POST',await page.evaluate(()=>window.__postCount===1));
 await page.evaluate(()=>{window.__resolveFixture();window.fetch=window.__realFetch;delete window.__realFetch});
 await page.waitForFunction(()=>!!document.querySelector('[data-status="succeeded"] .chat-agent-result'),undefined,{timeout:5000});
 await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='opstwins-design-chat-v1')throw Error('synthetic storage failure');return window.__originalSetItem.call(this,k,v)};window.__entriesBefore=window.OpsTwinsDesignChat.entries().length});
 await page.click('[data-page="ideas"]');await page.hover('.sample-idea >> nth=2');await page.click('.sample-idea .idea-discuss >> nth=2');
 check('storage failure prevents submission',await page.evaluate(()=>window.OpsTwinsDesignChat.entries().length===window.__entriesBefore));
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem});
 // UI fixtures: do not issue another model request. All responses below are explicitly synthetic.
 await page.evaluate(()=>{window.__realFetch=window.fetch;window.__fixtureCalls=0;window.fetch=async(url,init)=>{if(String(url).includes(':46114/')){window.__fixtureCalls++;return new Response(JSON.stringify({error:'bridge_unavailable'}),{status:502,headers:{'Content-Type':'application/json'}})}return window.__realFetch(url,init)}});
 await page.click('[data-page="ideas"]');await page.hover('.sample-idea >> nth=0');await page.click('.sample-idea .idea-discuss >> nth=0');
 await page.waitForFunction(()=>!!document.querySelector('[data-chat-request][data-status="unknown"]'),undefined,{timeout:12000});
 check('transport failure offers status recovery',await page.evaluate(()=>!!document.querySelector('[data-chat-request][data-status="unknown"] .chat-recover')));
 await page.evaluate(()=>{window.fetch=async(url,init)=>String(url).includes(':46114/')?new Response(JSON.stringify({status:'partial',requestId:'fixture',conversationId:'fixture',runId:'fixture',completedWrites:[{name:'create_task'}]}),{status:200,headers:{'Content-Type':'application/json'}}):window.__realFetch(url,init)});
 await page.click('[data-status="unknown"] .chat-recover');
 await page.waitForFunction(()=>!!document.querySelector('[data-status="partial"]'),undefined,{timeout:5000});
 check('partial run blocks retry',await page.evaluate(()=>!document.querySelector('[data-status="partial"] .chat-retry')));
 await page.evaluate(()=>{window.fetch=window.__realFetch;delete window.__realFetch});
 await page.click('[data-page="inbox"]');
 // Synthetic records prevent source text or auto reply generation entering captures.
 await page.evaluate(()=>{const d=window.OPSTWINS_DESIGN_DATA,now=new Date(),at=day=>new Date(now.getFullYear(),now.getMonth(),day,10,8).toISOString();d.inbox=[{id:'jev-fixture',sender:'合成验收',channel:'Internal',body:'合成资料',draft:'已存在的合成草稿',attention:true,status:'pending',messages:[{text:'合成资料',sentAt:at(now.getDate()),type:'text'}],triage:{status:'succeeded',method:'model',needsReply:.45,needsOwner:.52,needsDeepThink:.38}}];document.querySelector('[data-filter="all"]').click()});
 if(!await page.evaluate(()=>document.querySelector('.inbox-layout').classList.contains('show-detail')))await page.click('#inbox-items .inbox-item');
 check('three visual probabilities and no evidence button',await page.evaluate(()=>{const m=[...document.querySelectorAll('.judgment [role="meter"]')];return m.length===3&&m.map(x=>Number(x.getAttribute('aria-valuenow'))).join(',')==='45,52,38'&&!document.querySelector('#toggle-evidence')}));
 await page.evaluate(()=>{const t=window.OPSTWINS_DESIGN_DATA.inbox[0].triage;t.method='rule';t.needsReply=false;t.needsOwner=true;t.needsDeepThink=undefined;document.querySelector('[data-filter="all"]').click()});
 check('rules never invent model percentages',await page.evaluate(()=>![...document.querySelectorAll('.judgment [role="meter"]')].length&&[...document.querySelectorAll('.judgment-meter')].every(x=>x.title.includes('规则判定'))));
 for(const status of ['failed','pending']){await page.evaluate(s=>{window.OPSTWINS_DESIGN_DATA.inbox[0].triage.status=s;document.querySelector('[data-filter="all"]').click()},status);check('no probability for '+status,await page.evaluate(()=>!document.querySelector('.judgment [role="meter"]')))}
 for(const value of [null,-.1,1.1,"NaN","Infinity"]){await page.evaluate(v=>{const t=window.OPSTWINS_DESIGN_DATA.inbox[0].triage;t.status='succeeded';t.method='model';t.needsReply=v==='NaN'?NaN:v==='Infinity'?Infinity:v;document.querySelector('[data-filter="all"]').click()},value);check('invalid probability has no fill '+String(value),await page.evaluate(()=>!document.querySelector('#meter-reply[role="meter"]')&&document.querySelector('#meter-reply').title.includes('没有已保存概率')))}
 const dates=[['2026-10-03T10:08:00','2026-10-03T12:00:00','10:08'],['2026-10-02T10:08:00','2026-10-03T12:00:00','昨天 10:08'],['2026-09-30T10:08:00','2026-10-03T12:00:00','星期三'],['2026-09-27T10:08:00','2026-10-03T12:00:00','09/27'],['2026-10-04T10:08:00','2026-10-05T12:00:00','昨天 10:08'],['2025-12-31T10:08:00','2026-01-01T12:00:00','昨天 10:08'],['2025-12-30T10:08:00','2026-01-02T12:00:00','星期二'],['2025-01-01T10:08:00','2026-10-03T12:00:00','01/01'],['bad','2026-10-03T12:00:00','']];
 for(const [at,now,expected]of dates)check('compact time '+at+' at '+now,await page.evaluate(([a,n,e])=>window.OpsTwinsMessageTime.listLabel(a,n)===e,[at,now,expected]));
 check('epoch seconds and milliseconds agree',await page.evaluate(()=>{const t=new Date().setHours(10,8,0,0);return window.OpsTwinsMessageTime.listLabel(t)===window.OpsTwinsMessageTime.listLabel(t/1000)}));
 check('list uses compact timestamp dataset',await page.evaluate(()=>!!document.querySelector('.inbox-item time[data-list-time]')));
 await page.evaluate(()=>{const t=window.OPSTWINS_DESIGN_DATA.inbox[0].triage;t.needsReply=.45;t.needsOwner=.52;t.needsDeepThink=.38;document.querySelector('[data-filter="all"]').click()});
 for(const [w,h]of [[1272,961],[900,700],[390,844],[760,450]]){await view(w,h);check('judgment fits '+w+'x'+h,await page.evaluate(()=>{const c=document.querySelector('.jev-card'),r=c.getBoundingClientRect();return c.scrollWidth<=c.clientWidth+1&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth+1&&[...c.querySelectorAll('[role="meter"]')].every(m=>{const b=m.getBoundingClientRect(),f=m.firstElementChild.getBoundingClientRect();return b.width>80&&b.height===6&&Math.abs(f.width/b.width*100-Number(m.getAttribute('aria-valuenow')))<1})}));}
 await view(1272,961);await page.cdp('Page.bringToFront');const clip=await page.evaluate(()=>{const r=document.querySelector('.jev-card').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}});await page.screenshot({path:path.join(out,'judgment-synthetic.png'),clip});
 await page.evaluate(()=>{document.body.classList.add('dark')});await page.screenshot({path:path.join(out,'judgment-dark-synthetic.png'),clip});
}catch(error){checks.push({name:'E2E stopped',status:'FAIL',error:error.message})}
finally{
 await page.evaluate(()=>{if(window.__realFetch)window.fetch=window.__realFetch;if(window.__originalSetItem)Storage.prototype.setItem=window.__originalSetItem}).catch(()=>{});
 if(saved)await page.evaluate(s=>{for(const [k,v]of [['opstwins-ui-study-prefs',s.prefs],['opstwins-ui-study-state-v2',s.state],['opstwins-design-chat-v1',s.chat]]){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}},saved);
 await page.cdp('Emulation.clearDeviceMetricsOverride');await page.reload();
}
const hashes={};for(const f of files)hashes[f]=crypto.createHash('sha256').update(await fs.readFile(path.join(base,f))).digest('hex');
checks.push({name:'source stable during acceptance',status:JSON.stringify(initialHashes)===JSON.stringify(hashes)?'PASS':'FAIL'});
await fs.writeFile(path.join(out,'result.json'),JSON.stringify({capturedAt:new Date().toISOString(),spaceId:task.spaceId,checks,hashes,scope:'real configured Agent synthetic task; tool effects separately audited; explicitly synthetic failure cases; native NOT_RUN'},null,2));console.log({artifact:path.join(out,'result.json'),passed:checks.filter(x=>x.status==='PASS').length,failed:checks.filter(x=>x.status==='FAIL').length});
if(checks.some(x=>x.status==='FAIL'))throw Error('E2E failed');
