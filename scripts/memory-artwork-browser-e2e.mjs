// Isolated actual HTTP/SQLite page. Start memory-artwork-fixture.mjs first.
const task=await taskSpace('CyberMe 旧版图标与安装验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),crypto=await import('node:crypto'),root=process.cwd(),out=root+'/output/memory-artwork-20261106';
await fs.mkdir(out,{recursive:true});const checks=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const catalog=JSON.parse(await fs.readFile(root+'/shared/idea-icon-catalog.json','utf8'));
const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('[data-content-icon] img')].every(i=>i.complete&&i.naturalWidth===48));
try{
 for(const icon of catalog){const a=await fs.readFile(root+'/docs/design/assets/idea-icons/'+icon.file),b=await fs.readFile('../opstwin-advance/docs/design/assets/idea-icons/'+icon.file);check('legacy artwork parity '+icon.id,a.equals(b));}
 await page.goto('http://127.0.0.1:46874');await page.waitForSelector('textarea');await page.click('text="简报"');await page.click('text="决策"');await page.waitForSelector('[data-item="artwork-decision"]');await ready();
 check('brief decision content uses drawn meeting artwork',await page.evaluate(()=>document.querySelector('[data-item="artwork-decision"] [data-content-icon]')?.dataset.contentIcon==='meeting'));
 console.log(await page.snapshot());
 await page.click('text="灵感"');await page.waitForSelector('[data-idea="artwork-report"]');await ready();
 const icons=await page.evaluate(()=>[...document.querySelectorAll('[data-idea]')].map(card=>({id:card.dataset.idea,key:card.querySelector('[data-content-icon]')?.dataset.contentIcon,loaded:card.querySelector('img')?.naturalWidth,local:card.querySelector('img')?.src.startsWith('data:image/svg+xml')})));
 check('all 48 explicit choices are preserved',catalog.every(i=>icons.some(x=>x.id==='artwork-'+i.id&&x.key===i.id&&x.loaded===48&&x.local)));
 check('invalid path falls back to local title-matched artwork',icons.some(i=>i.id==='artwork-invalid'&&i.key==='files'&&i.loaded===48&&i.local));
 await page.screenshot({path:out+'/01-brief-artwork.png'});
 await page.evaluate(()=>{const i=document.querySelector('[data-idea="artwork-report"] img');i.dispatchEvent(new Event('error'))});await page.waitForFunction(()=>document.querySelector('[data-idea="artwork-report"] [data-content-icon]')?.dataset.iconFallback==='true');
 check('image error preserves fallback size and actions',await page.evaluate(()=>{const c=document.querySelector('[data-idea="artwork-report"]'),i=c.querySelector('[data-content-icon]');return i.dataset.iconFallback==='true'&&i.offsetWidth===44&&c.querySelectorAll('button').length>=3}));
 await page.reload();await page.waitForSelector('[data-idea="artwork-report"]');await ready();
 check('reopening retries image after transient failure',await page.evaluate(()=>document.querySelector('[data-idea="artwork-report"] img')?.naturalWidth===48));
 await page.click('text="记忆"');await page.waitForSelector('.mem-overview');await ready();
 const expected={'section:0':'contact','section:1':'roadmap','section:2':'focus',people:'team',automatic:'knowledge',soul:'workflow'};
 check('all memory category icons share original artwork',await page.evaluate(expected=>Object.entries(expected).every(([view,key])=>document.querySelector('[data-memory-folder="'+view+'"] [data-content-icon]')?.dataset.contentIcon===key),expected));
 check('overview uses same drawn profile icon',await page.evaluate(()=>document.querySelector('.mem-overview [data-content-icon]')?.dataset.contentIcon==='contact'));
 await page.click('[data-memory-folder="section:1"]');await page.waitForSelector('[data-memory-view="section:1"]');await page.click('.mem-breadcrumb');await page.waitForSelector('.mem-overview');
 check('folder navigation remains functional',true);
 for(const theme of ['quiet','night']){
  await page.evaluate(theme=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,theme,tab:'memory'}))},theme);await page.reload();await page.waitForSelector('.mem-overview');await ready();
  for(const width of [1000,1400]){await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await page.waitForFunction(w=>innerWidth===w,width);await page.waitForFunction(w=>{const p=document.querySelector('[data-memory-page]');return w===1000?p.clientWidth<380:p.clientWidth>380},width);
   check('memory art fits '+theme+' '+width,await page.evaluate(()=>{const p=document.querySelector('[data-memory-page]');return p.scrollWidth<=p.clientWidth+1&&[...p.querySelectorAll('[data-memory-folder] img')].every(i=>i.complete&&i.naturalWidth===48&&i.getBoundingClientRect().width<=44)}));
   await page.screenshot({path:out+'/memory-'+theme+'-'+width+'.png'});
  }
 }
 console.log({passed:checks.length});
}finally{await fs.writeFile(out+'/browser-checks.json',JSON.stringify({checks},null,2));}
