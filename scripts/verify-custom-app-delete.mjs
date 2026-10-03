// Run: ego-browser nodejs < scripts/verify-custom-app-delete.mjs
// Creates and deletes only this script's disposable custom app.
const task=await taskSpace('Custom app deletion');const page=task.page('p1');const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/custom-app-delete-20261003';const name='OPSADV-DELETE-QA-20261003';const checks=[];
function check(name,ok){checks.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);}
await page.goto('http://127.0.0.1:46100/settings/connections');await page.waitForSelector('.settings-custom-card');
let href=await page.evaluate(name=>[...document.querySelectorAll('.settings-custom-row')].find(r=>r.querySelector('.settings-custom-name')?.textContent===name)?.querySelector('a')?.getAttribute('href'),name);
if(!href){
 await page.click('loc=role:button[name="REST API"]');await page.fill('input[placeholder="例如 Zendesk"]',name);await page.fill('input[placeholder="https://"]','http://127.0.0.1:46110/api/health');await page.click('loc=role:button[name="检测并连接"]');await page.waitForFunction(name=>[...document.querySelectorAll('.settings-custom-name')].some(e=>e.textContent===name),name);
 href=await page.evaluate(name=>[...document.querySelectorAll('.settings-custom-row')].find(r=>r.querySelector('.settings-custom-name')?.textContent===name).querySelector('a').getAttribute('href'),name);
}
await page.click('a[href="'+href+'"]');await page.waitForSelector('loc=role:button[name="删除应用"]');
await page.click('loc=role:button[name="删除应用"]');await page.waitForSelector('[role="dialog"]');
check('Confirmation names the selected app',await page.evaluate(name=>document.querySelector('[role="dialog"]').textContent.includes(name),name));
await page.screenshot({path:out+'/confirmation.png'});
await page.click('loc=role:button[name="取消"]');check('Cancel preserves detail',await page.evaluate(()=>!document.querySelector('[role="dialog"]')&&!!document.querySelector('[data-page="customize-connection"]')));
await page.click('loc=role:button[name="删除应用"]');
await page.cdp('Network.enable');await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
try{await page.click('loc=role:button[name="确认删除"]');await page.waitForSelector('[role="dialog"] [role="alert"]');check('Network failure keeps confirmation for retry',true);}finally{await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0});}
await page.click('loc=role:button[name="确认删除"]');await page.waitForURL('http://127.0.0.1:46100/settings/connections');
check('Successful deletion removes row',await page.evaluate(name=>![...document.querySelectorAll('.settings-custom-name')].some(e=>e.textContent===name),name));
await page.goto('http://127.0.0.1:46100/settings/connections');await page.waitForSelector('.settings-custom-card');check('Refresh keeps it removed',await page.evaluate(name=>![...document.querySelectorAll('.settings-custom-name')].some(e=>e.textContent===name),name));
const response=await page.fetch('/api/connections/'+href.split('/').pop());check('Deleted record unavailable through API',response.status===404);
await page.goto('http://127.0.0.1:46100'+href);await page.waitForSelector('loc=role:link[name="返回连接列表"]');check('Old detail URL cannot recreate deleted app',await page.evaluate(()=>document.body.textContent.includes('应用已删除或不存在')&&!document.querySelector('main input')));
await page.screenshot({path:out+'/deleted-route.png'});await page.click('loc=role:link[name="返回连接列表"]');
await fs.writeFile(out+'/checks.json',JSON.stringify({checks},null,2));console.log(checks);
