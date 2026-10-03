/** Run via ego-browser nodejs, importing run(page, outputDirectory). Uses current TaskSpace. */
export async function run(page,out){
 const fs=await import('node:fs/promises');await fs.mkdir(out,{recursive:true});const checks=[];const check=(name,ok)=>{checks.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw new Error(name);};
 await page.goto('http://127.0.0.1:46100/settings/connections/feishu-local');await page.waitForSelector('.feishu-sync-settings');
 await page.click('loc=css:.feishu-sync-settings > summary');const initial=await page.evaluate(()=>document.querySelector('select[aria-label="聊天同步频率"]').value);
 const next=initial==='15'?'30':'15';
 try{
  await page.selectOption('loc=css:select[aria-label="聊天同步频率"]',next);await page.click('loc=role:button[name="保存同步设置"]');await page.waitForFunction(()=>document.querySelector('.feishu-sync').innerText.includes('同步设置已保存'));
  await page.reload();await page.waitForSelector('.feishu-sync-settings');await page.click('loc=css:.feishu-sync-settings > summary');check('Frequency persists after reload',await page.evaluate(value=>document.querySelector('select[aria-label="聊天同步频率"]').value===value,next));check('Next scheduled run is displayed',await page.evaluate(()=>!document.querySelector('.feishu-sync-next').innerText.split('\n')[0].includes('未安排')));
 }finally{await page.selectOption('loc=css:select[aria-label="聊天同步频率"]',initial);await page.click('loc=role:button[name="保存同步设置"]');await page.waitForFunction(()=>document.querySelector('.feishu-sync').innerText.includes('同步设置已保存'));}
 await page.click('loc=css:.feishu-sync-settings > summary');
 await page.selectOption('loc=css:select[aria-label="同步范围"]','mail');await page.click('loc=role:button[name="立即同步"]');await page.waitForFunction(()=>document.querySelector('.feishu-sync').innerText.includes('同步已开始'));await page.waitForFunction(()=>document.querySelector('.feishu-sync-run:first-child .feishu-sync-status')?.textContent==='成功', undefined, {timeout:60000});
 await page.waitForFunction(()=>document.querySelector('.feishu-sync [role="status"]')?.textContent.includes('同步已结束：成功'));check('Completed sync replaces the started banner',await page.evaluate(()=>!document.querySelector('.feishu-sync [role="status"]').textContent.includes('同步已开始')));
 check('Browser starts real mail sync and displays success',await page.evaluate(()=>document.querySelector('.feishu-sync-run:first-child').innerText.includes('邮箱')));
 await page.click('loc=css:.feishu-sync-run:first-child > summary');check('Expanded history shows time, size and count',await page.evaluate(()=>{const s=document.querySelector('.feishu-sync-run:first-child').innerText;return s.includes('读取量')&&s.includes('同步后总大小')&&s.includes('结束时间');}));
 await page.screenshot({path:out+'/desktop.png'});
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});check('Mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/mobile.png'});await page.cdp('Emulation.clearDeviceMetricsOverride');
 await page.reload();await page.waitForSelector('.feishu-sync-run');check('History survives page refresh',await page.evaluate(()=>document.querySelectorAll('.feishu-sync-run').length>0));
 await fs.writeFile(out+'/browser-checks.json',JSON.stringify({status:'PASS',checks,externalWrites:false,settingsRestored:true},null,2));console.log(checks);
}
