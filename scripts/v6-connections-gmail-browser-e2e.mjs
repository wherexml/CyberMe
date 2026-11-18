// Serve the isolated production UI per v6-connections-gmail-e2e.mjs --serve.
// Run: ego-browser nodejs < scripts/v6-connections-gmail-browser-e2e.mjs
const task=await taskSpace('CyberMe 应用连接验收');
const page=task.page('p1');
const fs=await import('node:fs/promises');
const output='/Users/steve/Projects/cyberme/output/connection-implementation-20261109';
const url='http://127.0.0.1:46850/cyberme.html';
const checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const current=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-row')].map(r=>r.innerText));
const status=()=>page.evaluate(async()=>await(await fetch('/api/connections/google/status')).json());
const open=async()=>{
 await page.goto(url);
 await page.waitForSelector('text="设置"');
 await page.click('text="设置"',{label:'Open CyberMe settings'});
 await page.click('text="应用连接"',{label:'Open app connections'});
};
const add=async()=>page.click('text="添加连接"',{label:'Open supported app catalog'});
const gmail=async()=>page.click('text="Gmail"',{label:'Open Gmail connection'});
try{
 await open();
 check('superseded Feishu row stays hidden',!(await current()).some(r=>r.includes('旧飞书')));
 await add();
 await page.waitForSelector('text="Gmail"');
 const catalog=(await current()).join('\n');
 check('only actionable apps listed; no fake Apple or GitHub tile',catalog.includes('Gmail')&&!/(Apple|GitHub|Notion|暂不支持)/.test(catalog));
 await page.screenshot({path:output+'/connections-catalog.png'});
 await gmail();
 await page.waitForFunction(()=>document.body.innerText.includes('待配置'));
 check('missing Google client does not masquerade as authorization',(await status()).configured===false);
 await page.screenshot({path:output+'/gmail-needs-setup.png'});
 const connected=await page.evaluate(async()=>await(await fetch('/__fixture/connect-gmail',{method:'POST'})).json());
 check('controlled OAuth callback reaches real production routes',connected.ok);
 await page.reload();
 if((await current()).some(r=>r.includes('应用连接')))await page.click('text="应用连接"',{label:'Reopen app connections'});
 if(!(await current()).some(r=>r.includes('Gmail')))await open();
 await page.waitForSelector('text="Gmail"');
 check('Gmail connection survives browser reload',(await status()).status==='connected');
 await gmail();
 await page.waitForSelector('[role=switch]');
 check('Gmail read authorization starts disabled',await page.evaluate(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false'));
 await page.click('[role=switch]',{label:'Allow Gmail reads in chat'});
 await page.waitForSelector('[role=switch][aria-checked=true]');
 check('Gmail grant updates through Settings',await page.evaluate(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='true'));
 await page.screenshot({path:output+'/gmail-connected.png'});
 await page.click('[role=switch]',{label:'Revoke Gmail read access'});
 await page.waitForSelector('[role=switch][aria-checked=false]');
 check('Gmail grant revokes through Settings',await page.evaluate(()=>document.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false'));
 await fs.writeFile(output+'/browser.json',JSON.stringify({url,checks,scope:'source preview with synthetic account; no installed WebKit'},null,2));
 console.log({url,checks:checks.length});
 await task.finish({keep:[]});
}catch(e){await fs.writeFile(output+'/browser-failure.json',JSON.stringify({url,checks,error:String(e)},null,2));throw e}
