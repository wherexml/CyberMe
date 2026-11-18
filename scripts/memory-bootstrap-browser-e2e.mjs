// Start: node --import tsx scripts/memory-bootstrap-http-e2e.mjs --serve.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/memory-library-web
// Run: ego-browser nodejs < scripts/memory-bootstrap-browser-e2e.mjs
const task=await taskSpace('CyberMe 自动记忆修复 20261108'),p=task.page('p1'),fs=await import('node:fs/promises'),out='/Users/steve/Projects/cyberme/output/memory-bootstrap-20261108',url='http://127.0.0.1:46910';
const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
await p.goto(url);await p.waitForSelector('textarea');console.log(await p.snapshot());
if(!await p.evaluate(()=>!!document.querySelector('.mem-overview')))await p.click('loc=role:button[name="记忆"]');
await p.waitForSelector('.mem-overview');await p.waitForFunction(()=>document.querySelector('[data-memory-page]').dataset.memoryRefreshing==='false');
check('bottom source and Agent entries removed',await p.evaluate(()=>!document.querySelector('.mem-source-list')&&!document.querySelector('[data-memory-folder="soul"]')&&!document.querySelector('[data-memory-folder^="section:"]')));
check('automatic facts project into category previews',await p.evaluate(()=>document.querySelector('[data-memory-folder="category:interest"]').textContent.includes('摄影')&&document.querySelector('[data-memory-folder="category:device"]').textContent.includes('Mac mini')));
await p.screenshot({path:out+'/01-home.png'});
await p.click('[data-memory-folder="category:work"]');await p.waitForSelector('.mem-category-note');
check('manual document remains accessible',await p.evaluate(()=>document.querySelector('.mem-category-note').textContent.includes('手写资料需要保留')));
await p.click('.mem-category-note');await p.waitForSelector('[data-memory-view="section:0"]');check('original note opens intact',await p.evaluate(()=>document.querySelector('[data-memory-page]').textContent.includes('不归类的公开笔记')));
await p.click('.mem-breadcrumb');await p.click('[data-memory-folder="automatic"]');await p.waitForSelector('[data-memory-view="automatic"]');
check('initialized exact facts visible',await p.evaluate(()=>document.querySelector('[data-memory-page]').textContent.includes('我长期喜欢摄影。')&&document.querySelector('[data-memory-page]').textContent.includes('回复请简洁直接。')));
await p.screenshot({path:out+'/02-learned.png'});
await fetch(url+'/__memory/fail');await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForSelector('[data-memory-job="failure"]');check('failure and explicit retry are visible',true);await p.screenshot({path:out+'/03-failure.png'});
console.log(await p.snapshot());
await p.click('[data-memory-job="failure"] button');await p.waitForSelector('[data-memory-job="failure"]',{state:'hidden',timeout:20000});
check('retry pending state visible',await p.evaluate(()=>!!document.querySelector('[data-memory-processing]')));
await p.screenshot({path:out+'/04-processing.png'});
await p.reload();await p.waitForSelector('textarea');await p.click('loc=role:button[name="记忆"]');await p.waitForSelector('.mem-overview');await p.click('[data-memory-folder="automatic"]');await p.waitForSelector('[data-memory-view="automatic"]');
await p.waitForSelector('[data-memory-job="failure"]');check('failure remains recoverable after refresh',await p.evaluate(()=>!!document.querySelector('[data-memory-job="failure"]')));
await fs.writeFile(out+'/browser.json',JSON.stringify({status:'PASS',url,spaceId:task.spaceId,synthetic:true,checks},null,2));console.log(JSON.stringify({status:'PASS',checks,url}));
// The parent completes the one shared TaskSpace after installed-app evidence.
