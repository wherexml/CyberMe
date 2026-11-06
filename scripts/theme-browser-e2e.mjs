// Build .local/remove-paper-theme-web and start .local/remove-paper-theme-fixture.mjs.
// Run: ego-browser nodejs < scripts/theme-browser-e2e.mjs
const task=await taskSpace('CyberMe 移除纸张主题'),page=task.page('p1');
console.log({spaceId:task.spaceId});
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/remove-paper-theme-20261106';
const checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{
 await page.goto('http://127.0.0.1:46796');await page.waitForSelector('textarea');
 await page.evaluate(()=>localStorage.setItem('cyberme-v6-ui',JSON.stringify({theme:'paper',tab:'settings',panel:true,panelRatio:.4,drafts:{primary:{text:'主题迁移保留草稿',refs:[],quote:'保留引用',auto:null,pick:null}},buddy:'classic',cfg:{enterSend:false,progress:true}})));
 await page.reload();await page.waitForSelector('textarea');
 check('legacy paper becomes light',await page.evaluate(()=>document.querySelector('#cyberme-v6-root').dataset.theme==='quiet'));
 check('draft and quote survive fallback',await page.evaluate(()=>document.querySelector('textarea').value==='主题迁移保留草稿'&&!!document.querySelector('[aria-label="Remove quote"]')));
 await page.click('text="通用"');
 check('only two theme options',await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='浅色');return b&&b.parentElement.children.length===2&&!document.body.innerText.includes('纸张')}));
 for(const [label,theme] of [['深色','night'],['浅色','quiet']]){
  await page.click('text="'+label+'"');
  await page.waitForFunction(theme=>document.querySelector('#cyberme-v6-root').dataset.theme===theme,theme);
  check(theme+' persisted',await page.evaluate(theme=>JSON.parse(localStorage.getItem('cyberme-v6-ui')).theme===theme,theme));
  for(const width of [1400,800]){
   await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:false});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   check(theme+' '+width+' visible controls without overflow',await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].filter(e=>['浅色','深色'].includes(e.textContent));return b.every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})&&document.documentElement.scrollWidth<=innerWidth}));
   await page.screenshot({path:out+'/'+theme+'-'+width+'.png'});
  }
  await page.reload();await page.waitForSelector('textarea');
  check(theme+' reload and draft preserved',await page.evaluate(theme=>document.querySelector('#cyberme-v6-root').dataset.theme===theme&&document.querySelector('textarea').value==='主题迁移保留草稿',theme));
  check(theme+' unrelated preferences retained',await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));return s.cfg.enterSend===false&&s.panelRatio===.4&&s.drafts.primary.quote==='保留引用'}));
  await page.click('text="通用"');
 }
 check('no paper styles or fonts loaded',await page.evaluate(()=>{const root=document.querySelector('#cyberme-v6');return !getComputedStyle(root).getPropertyValue('--color-neutral-300')&&![...document.fonts].some(f=>f.family.includes('Source Serif'))}));
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({scope:'Built V6, isolated synthetic HTTP, Chromium; installed app not updated',checks},null,2));
 console.log({pass:true,checks:checks.length,out});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({checks,error:String(e)},null,2));throw e}
await page.cdp('Emulation.clearDeviceMetricsOverride');
await task.finish({keep:[]});
