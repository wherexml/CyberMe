// Read-only error/retry, media and refresh checks; restores browser networking in finally.
const task=await taskSpace(71),page=task.page('p1');const fs=await import('node:fs/promises');const out='/Users/steve/Projects/opstwin-advance/output/message-presentation-20261003';
async function wait(fn){for(let i=0;i<80;i++){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Visible condition timed out');}
const id='chat-oc_5f5f6e2e61676c3ba36ad01afd79739b',url='http://127.0.0.1:46100/inbox?item='+id;
try {
 await page.cdp('Network.enable');await page.cdp('Network.setBlockedURLs',{urls:['*/api/sources/chats/*/messages*']});
 await page.goto(url);await wait(()=>!!document.querySelector('.op-source-thread [role="alert"]'));
 const failed=await page.evaluate(()=>({fallback:document.querySelectorAll('.op-source-bubble').length,error:document.querySelector('.op-source-thread [role="alert"]')?.textContent.includes('读取失败')}));
 await page.screenshot({path:out+'/read-failure.png'});
 await page.cdp('Network.setBlockedURLs',{urls:[]});
 await page.click('.op-source-thread [role="alert"] button');await wait(()=>!document.querySelector('.op-source-thread [role="alert"]')&&document.querySelectorAll('.op-source-message').length>12);
 const retry=await page.evaluate(()=>({messages:document.querySelectorAll('.op-source-message').length,noError:!document.querySelector('.op-source-thread [role="alert"]')}));
 await page.goto(url);await wait(()=>!!document.querySelector('.op-source-message'));
 const refresh=await page.evaluate(()=>({selected:location.search.includes('chat-oc_5f5f6e2e61676c3ba36ad01afd79739b'),bubbles:document.querySelectorAll('.op-source-message').length}));
 await page.goto('http://127.0.0.1:46100/inbox?item=chat-oc_b5dafc824935dd29d3cbfd839a9e812e');
 await wait(()=>!!document.querySelector('.op-message-attachment img'));
 await page.evaluate(()=>{document.querySelector('.op-source-thread').scrollTop=0;});
 await wait(()=>[...document.querySelectorAll('.op-message-attachment img')].some(i=>i.complete&&i.naturalWidth>0));
 const media=await page.evaluate(()=>({images:[...document.querySelectorAll('.op-message-attachment img')].filter(i=>i.complete&&i.naturalWidth>0).length,overflow:document.documentElement.scrollWidth>innerWidth}));
 await page.screenshot({path:out+'/media.png'});
 await fs.writeFile(out+'/recovery-e2e.json',JSON.stringify({failed,retry,refresh,media},null,2));console.log({failed,retry,refresh,media});
 if(!failed.error||!failed.fallback||!retry.noError||!refresh.selected||!media.images||media.overflow)throw new Error('Recovery failed');
}finally{await page.cdp('Network.setBlockedURLs',{urls:[]});}
