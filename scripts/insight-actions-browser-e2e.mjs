// ego-browser nodejs < /Users/steve/Projects/CyberMe/scripts/insight-actions-browser-e2e.mjs
// First run scripts/insight-actions-fixture.mjs. Synthetic data only.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/insight-actions-20261106';
await fs.mkdir(out,{recursive:true});
const t=await taskSpace('CyberMe 洞察双按钮验收'),p=t.page('p1'),checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
try{
 await p.goto('http://127.0.0.1:46871/cyberme.html');await p.waitForSelector('[data-idea="recommended"]');
 check('two left-aligned rounded buttons',await p.evaluate(()=>{const bar=document.querySelector('[data-idea="recommended"] [data-idea-actions]');return bar.querySelectorAll('button').length===2&&getComputedStyle(bar).justifyContent==='flex-start'&&[...bar.children].every(b=>getComputedStyle(b).borderRadius==='10px')}));
 check('no obsolete controls',await p.evaluate(()=>!document.querySelector('[data-delivery-strategy],[data-action="create_task"],[data-action="snooze"]')));
 check('legacy fallback available',await p.evaluate(()=>document.querySelector('[data-idea="legacy"] [data-action="recommend"]').textContent==='梳理下一步'));
 await p.fill('textarea','保留我的补充要求。');
 const before=JSON.parse((await p.fetch('/__fixture/evidence')).body);
 await p.click('[data-idea="recommended"] [data-action="recommend"]');
 await p.waitForFunction(()=>document.querySelector('textarea').value.includes('覆盖现有数据保留'));
 const prepared=await p.evaluate(()=>({text:document.querySelector('textarea').value,quote:document.body.innerText.includes('INSIGHT_END_9517')}));
 check('manual draft and full recommendation retained',prepared.text.startsWith('保留我的补充要求。')&&prepared.text.includes('先给我可审阅的方案。'));
 check('full insight quote retained beyond summary',prepared.quote);
 await p.click('[data-idea="recommended"] [data-action="recommend"]');
 await p.waitForFunction(()=>document.querySelector('textarea').value.includes('覆盖现有数据保留'));
 await p.click('[data-idea="recommended"] [data-action="ask-cyberme"]');
 await p.waitForFunction(()=>document.querySelector('textarea').value.includes('帮我分析判断与下一步'));
 check('switch action replaces automatic text only',await p.evaluate(()=>{const v=document.querySelector('textarea').value;return v.startsWith('保留我的补充要求。')&&!v.includes('覆盖现有数据保留')&&v.split('帮我分析判断与下一步').length===2}));
 const after=JSON.parse((await p.fetch('/__fixture/evidence')).body);
 check('clicks neither submit nor create tasks',after.requests.length===before.requests.length&&after.tasks===before.tasks&&after.messages===before.messages);
 await p.reload();await p.waitForSelector('textarea');
 check('refresh keeps draft quote and selection',await p.evaluate(()=>document.querySelector('textarea').value.includes('帮我分析判断与下一步')&&document.body.innerText.includes('INSIGHT_END_9517')));
 await p.screenshot({path:out+'/card-composer.png'});
 await p.click('[data-idea="recommended"] [data-idea-title]');
 await p.waitForSelector('[data-idea-actions] [data-action="recommend"]');
 check('detail uses same two actions without reminder setting',await p.evaluate(()=>document.querySelectorAll('[data-idea-actions] button').length===2&&!document.querySelector('[data-delivery-strategy]')));
 await p.click('[data-action="recommend"]');await p.waitForFunction(()=>document.querySelector('textarea').value.includes('覆盖现有数据保留'));
 await p.screenshot({path:out+'/detail-composer.png'});
 await p.click('button[aria-label="Send"]');
 await p.waitForFunction(()=>document.body.innerText.includes('公开受控验收响应'),undefined,{timeout:60000});
 const evidence=JSON.parse((await p.fetch('/__fixture/evidence')).body),req=evidence.requests.at(-1),model=JSON.stringify(evidence.calls.at(-1));
 check('normal chat receives selected idea and original source',req.contextIds.includes('recommended')&&req.contextIds.includes('source-checklist'));
 check('model receives full description, evidence, and source tail',model.includes('INSIGHT_END_9517')&&model.includes('SOURCE_END_6842')&&model.includes('保留现有数据，核对重启恢复。'));
 check('send does not use legacy task execution',evidence.tasks===before.tasks&&evidence.requests.length===before.requests.length+1);
 await p.click('[data-action="ask-cyberme"]');await p.waitForFunction(()=>document.querySelector('textarea').value.includes('帮我分析判断'));
 await p.click('button[aria-label="Remove quote"]');await p.click('button[aria-label="Send"]');
 await p.waitForFunction(async()=>{const e=await(await fetch('/__fixture/evidence')).json();return e.requests.length>=2&&e.requests.at(-1).contextIds.length===0});
 check('remove quote removes hidden selection',true);
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:800,height:850,deviceScaleFactor:1,mobile:false});
 check('narrow action row does not overflow',await p.evaluate(()=>{const bar=document.querySelector('[data-idea-actions]'),r=bar.getBoundingClientRect();return [...bar.children].every(b=>{const q=b.getBoundingClientRect();return q.left>=r.left-1&&q.right<=r.right+1})}));
 await p.screenshot({path:out+'/narrow.png'});
 await p.cdp('Emulation.clearDeviceMetricsOverride');
 await fs.writeFile(out+'/evidence.json',JSON.stringify({scope:'synthetic sources, production HTTP/SQLite/front-end, controlled model; not real-model quality or installed-app acceptance',request:req,modelReceivedFullContext:checks.find(c=>c.name.startsWith('model receives')).pass},null,2));
}finally{await fs.writeFile(out+'/browser.json',JSON.stringify({url:await p.url(),checks},null,2));console.log(JSON.stringify({checks,url:await p.url(),out}));}
