// Replay: ego-browser nodejs < scripts/model-settings-browser-e2e.mjs
// Resume the goal's existing TaskSpace. Do not run concurrently with another p1 operator.
const task=await taskSpace(66),page=task.page('p1');
const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/model-settings-20261002';
await fs.mkdir(out,{recursive:true});
const checks=[];
const check=(name,ok,detail)=>{checks.push({name,status:ok?'PASS':'FAIL',detail});if(!ok)throw new Error(name);};
await page.goto('http://127.0.0.1:46100/settings/models');
await page.waitForSelector('#model-preset-deep');
const original=await page.evaluate(()=>({provider:document.querySelector('#model-provider-deep').value,model:document.querySelector('#model-preset-deep').value}));
const alternate=original.model==='claude-haiku-4-5-20251001'?'claude-opus-5-5':'claude-haiku-4-5-20251001';
let offline=false;
try {
  await page.selectOption('#model-preset-deep',alternate);
  await page.reload();await page.waitForSelector('#model-preset-deep');
  check('Unsaved choice survives reload',await page.evaluate(value=>document.querySelector('#model-preset-deep').value===value&&/尚未保存|Unsaved changes/.test(document.body.innerText),alternate));
  await page.cdp('Network.enable');
  await page.cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});offline=true;
  await page.click('button[type=submit]');await page.waitForSelector('[role=alert]');
  check('Offline save retains selection and shows error',await page.evaluate(value=>document.querySelector('#model-preset-deep').value===value&&!!document.querySelector('[role=alert]'),alternate));
  await page.screenshot({path:out+'/offline.png'});
  await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});offline=false;
  await page.click('button[type=submit]');await page.waitForFunction(()=>/模型配置已保存|Model configuration saved/.test(document.body.innerText));
  await page.reload();await page.waitForSelector('#model-preset-deep');
  check('Retry saves and persists across reload',await page.evaluate(value=>document.querySelector('#model-preset-deep').value===value&&document.querySelector('button[type=submit]').disabled,alternate));
  await page.selectOption('#model-preset-deep','custom');
  await page.fill('#model-id-deep','qa-invalid model');
  await page.click('button[type=submit]');await page.waitForSelector('[role=alert]');
  check('Invalid custom model rejected without losing input',await page.evaluate(()=>document.querySelector('#model-id-deep').value==='qa-invalid model'));
  await page.click('.settings-model-footer button[type=button]');await page.waitForFunction(()=>!document.querySelector('#model-id-deep'));
  check('Cancel reloads persisted model',await page.evaluate(value=>document.querySelector('#model-preset-deep').value===value,alternate));
  await page.selectOption('#model-preset-deep',original.model);
  await page.focus('button[type=submit]');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>/模型配置已保存|Model configuration saved/.test(document.body.innerText));
  check('Keyboard save restores original selection',await page.evaluate(value=>document.querySelector('#model-preset-deep').value===value,original.model));
  await page.screenshot({path:out+'/desktop-final.png'});
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await page.waitForFunction(()=>innerWidth===390);
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('.settings-model-card select')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}));
  check('390px layout without page overflow; 44px controls',geometry.scroll<=geometry.width&&geometry.fields.every(x=>x.height>=44),geometry);
  await page.screenshot({path:out+'/mobile.png'});
  await fs.writeFile(out+'/mobile.txt',await page.snapshot({scope:'full_page'}));
} finally {
  if(offline)await page.cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await fs.writeFile(out+'/browser.json',JSON.stringify({at:new Date().toISOString(),checks,original},null,2));
}
console.log(JSON.stringify({checks:checks.length,status:'PASS',artifact:out+'/browser.json'}));
