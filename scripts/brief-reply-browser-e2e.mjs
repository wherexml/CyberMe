// Run after: node --import tsx scripts/brief-reply-http-e2e.mjs --serve
// ego-browser nodejs < scripts/brief-reply-browser-e2e.mjs
const task=await taskSpace('CyberMe 决定卡与起草修复'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/brief-reply-20261105';
await page.goto('http://127.0.0.1:46764');await page.waitForFunction(()=>document.body.innerText.includes('请核对公开材料中的两处日期。'));
const checks=await page.evaluate(()=>{const t=document.body.innerText;return {requestA:t.includes('请确认公开演示安排在周五还是周六？'),requestB:t.includes('请核对公开材料中的两处日期。'),noClassification:!t.includes('direct request'),noCriteria:!t.includes('worthwhile explicit'),noChatter:!t.includes('尾部闲聊不应取代请求'),noRecalled:!t.includes('不应显示的旧消息'),precedent:t.includes('已记录的历史参考')}});
console.log(await page.snapshot({scope:'full_page'}));
if(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}').brief?.['request-a']?.pick)){await page.click('css=button:text-is("撤销")');console.log(await page.snapshot({scope:'full_page'}));}
await page.click('css=button:has-text("起草回复，等我确认") >> nth=4');
await page.waitForFunction(()=>document.querySelector('textarea')?.value==='起草回复，等我确认');
await page.screenshot({path:out+'/decision.png'});
await page.click('button[aria-label="Send"]');
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).requests.some(r=>r.pick?.id==='request-a'&&r.status==='succeeded'));
checks.browserDraft=await page.evaluate(async()=>{const r=await fetch('/api/inbox/request-a');const item=await r.json();return item.draft==='我先核对演示安排，确认后回复'&&!item.approved&&item.status!=='sent'});
await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('草稿已保存，等你确认。'));
checks.persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).requests.some(r=>r.pick?.id==='request-a'&&r.status==='succeeded'));
// Public failures use the real read-only HTTP response and the ordinary persisted UI state.
await page.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));for(const code of ['model_runtime_missing','model_timeout']){const r=await (await fetch('/api/chat/requests/failure-'+code)).json();s.requests=s.requests.filter(x=>x.requestId!==r.requestId);s.requests.push({...r,message:'公开失败提示验收',contextIds:[],attachmentIds:[],createdAt:new Date().toISOString()});}localStorage.setItem('cyberme-v6-ui',JSON.stringify(s));});
await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('模型响应超时，请重试。'));
checks.safeErrors=await page.evaluate(()=>{const t=document.body.innerText;return t.includes('模型组件缺失，请更新应用后重试。')&&!t.includes('/private/example.mjs')});
await page.screenshot({path:out+'/failure.png'});
await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'built production UI; synthetic HTTP and controlled model',checks},null,2));
console.log(checks);if(Object.values(checks).some(x=>!x))throw Error('Browser check failed');
console.log(await page.snapshot());await task.finish({keep:[]});
