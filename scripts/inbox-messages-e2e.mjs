// Run: ego-browser nodejs < scripts/inbox-messages-e2e.mjs
const task = await taskSpace(71), page = task.page('p1');
await page.cdp('Emulation.clearDeviceMetricsOverride');
const fs = await import('node:fs/promises');
async function ready(selector){for(let i=0;i<60;i++){if(await page.evaluate(s=>!!document.querySelector(s),selector))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Timed out: '+selector);}
const out='/Users/steve/Projects/opstwin-advance/output/message-presentation-20261003';
await page.goto('http://127.0.0.1:46100/inbox');
console.log((await page.snapshot()).slice(-1200));
const state=await fetch('http://127.0.0.1:46110/api/bootstrap').then(r=>r.json());
const item=state.inbox.find(i=>i.sender==='郑方圆'&&i.id.startsWith('chat-'));
if(!item)throw new Error('Reference conversation missing');
await page.goto('http://127.0.0.1:46100/inbox?item='+encodeURIComponent(item.id));
await page.snapshot();
await ready('.op-source-message:nth-of-type(20)');
const checks=await page.evaluate(()=>({bubbles:document.querySelectorAll('.op-source-bubble').length,mine:document.querySelectorAll('.op-source-message.is-mine').length,avatars:[...document.querySelectorAll('.op-avatar img')].map(i=>({loaded:i.complete&&i.naturalWidth>0})),overflow:document.documentElement.scrollWidth>innerWidth}));
await page.screenshot({path:out+'/desktop.png'});
await page.click('text="查看完整消息"');
await page.snapshot();
await ready('[role="dialog"] .op-source-bubble');
const full=await page.evaluate(()=>({bubbles:document.querySelectorAll('[role="dialog"] .op-source-bubble').length,links:document.querySelectorAll('[role="dialog"] .op-source-bubble a').length,hasOlder:[...document.querySelectorAll('button')].some(b=>b.textContent==='加载更早消息'),recalled:document.querySelector('[role="dialog"]')?.textContent.includes('This message was recalled')}));
await page.screenshot({path:out+'/full.png'});
if(full.hasOlder){await page.click('text="加载更早消息"');await page.snapshot();}
const after=await page.evaluate(()=>({bubbles:document.querySelectorAll('[role="dialog"] .op-source-bubble').length,ids:[...document.querySelectorAll('[role="dialog"] [data-message-id]')].map(n=>n.getAttribute('data-message-id'))}));
await page.keyboard.press('Escape');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.goto('http://127.0.0.1:46100/inbox?item='+encodeURIComponent(item.id));await page.snapshot();
await ready('.op-source-message:nth-of-type(20)');
await page.click('text="查看完整消息"');await page.snapshot();
await ready('[role="dialog"] .op-source-bubble');
const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,dialog:!!document.querySelector('[role="dialog"]'),bubbles:document.querySelectorAll('[role="dialog"] .op-source-bubble').length}));
await page.screenshot({path:out+'/mobile.png'});
await page.keyboard.press('Escape');
await page.cdp('Emulation.clearDeviceMetricsOverride');
const result={itemId:item.id,checks,full,pagination:{before:full.bubbles,after:after.bubbles,unique:new Set(after.ids).size===after.ids.length},mobile};
await fs.writeFile(out+'/e2e.json',JSON.stringify(result,null,2));console.log(result);
if(!checks.bubbles||!checks.mine||checks.overflow||!full.links||full.recalled||mobile.overflow||!mobile.dialog||!mobile.bubbles||new Set(after.ids).size!==after.ids.length)throw new Error('Message presentation regression');
// Explicitly exercise a larger imported history, rather than assuming the sample has >80 messages.
const large = state.sources.chats.find(c=>c.messageCount>80 && state.inbox.some(i=>i.id==='chat-'+c.id));
if(!large)throw new Error('No paginated source available');
await page.goto('http://127.0.0.1:46100/inbox?item='+encodeURIComponent('chat-'+large.id));await page.snapshot();
await page.click('text="查看完整消息"');
for(let i=0;i<30;i++){if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='加载更早消息')))break;await new Promise(r=>setTimeout(r,150));}
const count=await page.evaluate(()=>document.querySelectorAll('[role="dialog"] [data-message-id]').length);
await page.click('text="加载更早消息"');
for(let i=0;i<30;i++){if(await page.evaluate(n=>document.querySelectorAll('[role="dialog"] [data-message-id]').length>n,count))break;await new Promise(r=>setTimeout(r,150));}
const paged=await page.evaluate(()=>({count:document.querySelectorAll('[role="dialog"] [data-message-id]').length,ids:[...document.querySelectorAll('[role="dialog"] [data-message-id]')].map(n=>n.getAttribute('data-message-id')),rawTime:[...document.querySelectorAll('[role="dialog"] time')].some(n=>/^\d{13}$/.test(n.textContent))}));
await page.screenshot({path:out+'/pagination.png'});
if(paged.count<=count||new Set(paged.ids).size!==paged.ids.length||paged.rawTime)throw new Error('Pagination/time regression');
await page.keyboard.press('Escape');
// Real read-only HTTP attachment retrieval, with no raw payloads or credentials in evidence.
const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync('/Users/steve/Projects/opstwin/server/data/dev.db',{readOnly:true});
const sample=db.prepare("SELECT id,chat_id,payload FROM feishu_messages WHERE payload LIKE '%local_attachments%' LIMIT 1").get();db.close();
const asset=JSON.parse(sample.payload).local_attachments[0];const response=await fetch('http://127.0.0.1:46110/api/source-message-assets/'+encodeURIComponent(sample.id)+'/'+encodeURIComponent(asset.file_key));
const assetCheck={status:response.status,mime:response.headers.get('content-type'),bytes:(await response.arrayBuffer()).byteLength};
if(assetCheck.status!==200||!assetCheck.bytes)throw new Error('Attachment unavailable');
const unauthorized=await fetch('http://127.0.0.1:46110/api/source-message-assets/'+encodeURIComponent(sample.id)+'/not-a-source-key');
if(unauthorized.status!==404)throw new Error('Unknown attachment not rejected');
await fs.writeFile(out+'/extended-e2e.json',JSON.stringify({pagination:{before:count,after:paged.count,unique:true,formattedTimes:!paged.rawTime},assetCheck,unknownAssetStatus:unauthorized.status},null,2));
console.log({pagination:[count,paged.count],assetCheck});
