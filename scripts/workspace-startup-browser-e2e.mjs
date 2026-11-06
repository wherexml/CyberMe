// Start workspace-startup-fixture.mjs fresh, then ego-browser nodejs < this file.
const task=await taskSpace('CyberMe 启动与收件箱修复'),p=task.page('p1'),base='http://127.0.0.1:46849';
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/workspace-startup-20261105',checks=[];
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const metrics=async()=>await(await fetch(base+'/fixture/metrics')).json();
try{
 const before=await metrics();check('auxiliary endpoints deliberately held',before.held);const start=Date.now();await p.goto(base);await p.waitForSelector('textarea');const readyMs=Date.now()-start;check('workspace usable before auxiliary results',readyMs<3000&&(await metrics()).held);
 await p.evaluate(()=>{for(let i=0;i<8;i++)window.dispatchEvent(new Event('focus'))});await p.fill('textarea','公开未发送草稿');
 const pending=await metrics();check('refresh requests coalesced',pending.counts.bootstrap-before.counts.bootstrap===1);check('bootstrap supplies primary without extra fetch',pending.counts.primary===before.counts.primary);check('auxiliary requests started',pending.counts.models>0&&pending.counts.work>0);
 await p.screenshot({path:out+'/ready-before-auxiliary.png'});await fetch(base+'/fixture/release',{method:'POST'});
 await p.click('css=button:text-is("灵感")');await p.click('css=button:text-is("查看详情")');await p.waitForSelector('css=button:text-is("在完整收件箱中打开")');const opened=Date.now();await p.click('css=button:text-is("在完整收件箱中打开")');await p.waitForFunction(()=>document.querySelector('#draft')?.dataset.itemId==='startup-inbox');const inboxMs=Date.now()-opened;
 check('exact inbox deep link preserved',(await p.url()).endsWith('desktop.html#inbox/startup-inbox'));check('existing draft readable',await p.evaluate(()=>document.querySelector('#draft')?.value==='保留的公开草稿'));check('navigation made no business writes',(await metrics()).counts.writes===0);await p.screenshot({path:out+'/classic-inbox.png'});
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({synthetic:true,readyMs,inboxMs,checks},null,2));console.log({readyMs,inboxMs,checks,spaceId:task.spaceId});
}catch(error){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,error:String(error)},null,2));throw error}
// The coordinator inspects the screenshots, then finishes this one TaskSpace.
