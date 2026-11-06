// Start the isolated service per connection-visibility-fixture.mjs, then:
// ego-browser nodejs < scripts/connection-visibility-browser-e2e.mjs
// Failure cases recorded before implementation: output/connection-visibility-20261105/FAILURE-CASES.md
const task=await taskSpace('CyberMe 旧连接隐藏验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const project=process.cwd(),out=project+'/output/connection-visibility-20261105';
await fs.mkdir(out,{recursive:true});
const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const rows=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-row')].map(x=>x.innerText));
const open=async url=>{await page.goto(url);await page.click('text="设置"');await page.click('text="应用连接"');await page.waitForSelector('text="添加连接"')};
try{
 await open('http://127.0.0.1:46776');
 let list=await rows();
 check('Only one Feishu row',list.filter(x=>x.includes('Feishu')).length===1);
 check('Replaced WeChat Claw hidden',!list.some(x=>x.includes('WeChat Claw')));
 check('Current Feishu and WeChat connected',list.some(x=>x.includes('Feishu')&&x.includes('已连接'))&&list.some(x=>x.includes('微信')&&x.includes('已连接')));
 check('Unreplaced disconnected same-provider record stays visible',list.some(x=>x.includes('另一飞书连接')&&x.includes('未连接')));
 check('Setup and error connections stay visible',list.some(x=>x.includes('Gmail')&&x.includes('需要处理'))&&list.some(x=>x.includes('错误连接')&&x.includes('公开错误状态')));
 await page.screenshot({path:out+'/connections.png'});
 await page.click('text="Feishu"');
 check('Current Feishu detail is reachable',await page.evaluate(()=>document.body.innerText.includes('立即同步')&&document.body.innerText.includes('已连接')));
 await page.reload();await page.click('text="应用连接"');
 check('Reload keeps same visible rows',JSON.stringify(list)===JSON.stringify(await rows()));
 const all=await page.evaluate(async()=>await(await fetch('/api/connections')).json());
 check('HTTP still retains both historical records',all.length===7&&all.find(x=>x.id==='old-feishu')?.supersededBy==='feishu-local'&&all.find(x=>x.id==='old-wechat')?.supersededBy==='wechat-sync-local');
 await open('http://127.0.0.1:46776/?case=all-replaced');
 check('All replaced renders existing empty state',await page.evaluate(()=>document.body.innerText.includes('尚未连接应用')&&!document.body.innerText.includes('WeChat Claw')&&!document.body.innerText.includes('Feishu')));
 await page.screenshot({path:out+'/empty.png'});
 const evidence=await page.evaluate(async()=>await(await fetch('/fixture/evidence')).json());
 check('Connection database unchanged and no write requests',evidence.unchanged&&evidence.writeAttempts===0);
 const sourceSha256=crypto.createHash('sha256').update(await fs.readFile(project+'/web/src/v6/Settings.tsx')).digest('hex');
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Production UI build in ego Chromium; isolated synthetic real HTTP; installed app not updated or validated',sourceSha256,checks,evidence},null,2));
 console.log({pass:true,checks:checks.length,out});
 await task.finish({keep:[]});
}catch(e){await fs.writeFile(out+'/browser-failure.json',JSON.stringify({checks,error:String(e)},null,2));throw e}
