// Run: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/v6-only-web
// Then node --import tsx scripts/v6-only-fixture.mjs; ego-browser nodejs < this file.
const task=await taskSpace('CyberMe 仅保留新版入口'),p=task.page('p1'),base='http://127.0.0.1:46859';
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/v6-only-20261105',checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const settled=async()=>await p.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});
const noLegacy=async()=>await p.evaluate(()=>!document.body.innerText.match(/完整工作区|完整收件箱|Full workspace|full Inbox/)&&!document.querySelector('[href*="desktop.html"]'));
try{
 await p.goto(base+'/cyberme.html');await p.waitForSelector('textarea');await p.click('text="简报"');await p.click('css=button:text-is("灵感")');
 for(let n=1;n<=6;n++){await p.click('text="公开灵感 '+n+'"');await p.waitForFunction(n=>document.body.innerText.includes('完整正文结尾 '+n),n);check('idea '+n+' full content available',true);check('idea '+n+' stays in V6',await noLegacy());if(n===6)await settled();if(n===6)await p.screenshot({path:out+'/idea-detail.png'});await p.click('button[aria-label="Back"]')}
 await p.click('css=button:text-is("查看详情")');check('inbox detail retains draft',await p.evaluate(()=>document.body.innerText.includes('保留的公开草稿')));check('inbox has no legacy action',await noLegacy());await settled();await p.screenshot({path:out+'/inbox-detail.png'});
 await p.click('text="设置"');check('settings has no full workspace',await noLegacy());await settled();await p.screenshot({path:out+'/settings.png'});
 for(const label of ['模型','隐私与数据','应用连接','技能']){await p.click('loc=role:button[name="'+label+'"]');check(label+' stays in V6',await noLegacy());await p.click('button[aria-label="Back"]')}
 await p.goto(base+'/desktop.html#inbox/startup-inbox');await p.waitForURL('**/cyberme.html');await p.waitForSelector('textarea');check('retired deep link returns to V6',(await p.url()).endsWith('/cyberme.html'));check('classic bootstrap never executes',await p.evaluate(()=>!window.OpsTwinsDesktop));
 check('navigation causes no business writes',(await(await fetch(base+'/fixture/metrics')).json()).counts.writes===0);
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({synthetic:true,checks},null,2));console.log({checks,spaceId:task.spaceId});
}catch(error){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,error:String(error)},null,2));throw error}
// Inspect screenshots before task.finish({keep:[]}).
