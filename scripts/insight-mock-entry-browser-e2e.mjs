// Run: ego-browser nodejs < scripts/insight-mock-entry-browser-e2e.mjs
// Uses the same TaskSpace; create/adopt p1 before running if the previous review was finished.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/CyberMe',out=root+'/output/insight-mock-entry-20261111/'+Date.now();await fs.mkdir(out,{recursive:true});
const t=await taskSpace(9),p=t.page('p1'),checks=[];
const url='http://127.0.0.1:46781/v6.1-concept.html?original-v6';
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,...(detail?{detail}:{})});if(!pass)throw Error(name)};
const tabs=()=>[...document.querySelector('[aria-label="Hide panel"]').parentElement.parentElement.querySelectorAll('button')].filter(b=>!b.hasAttribute('aria-label')).map(b=>b.innerText.trim());
try{
 await p.goto(url);await p.reload();await p.waitForSelector('[data-mock-footer]');
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 check('common URL shows current four Chinese tabs',JSON.stringify(await p.evaluate(tabs))===JSON.stringify(['洞察','任务','记忆','设置']));
 check('common URL has no secondary decision/inspiration categories',await p.evaluate(()=>![...document.querySelectorAll('button')].some(b=>['Decisions','Inspirations','决定','灵感'].includes(b.innerText.trim()))));
 check('both kinds of content share the same feed',await p.evaluate(()=>document.querySelectorAll('[data-mock-decision]').length>0&&document.querySelectorAll('[data-mock-idea]').length>0));
 await p.screenshot({path:out+'/01-common-zh.png'});
 await p.click('text="English"');
 check('English uses Insights instead of Brief',JSON.stringify(await p.evaluate(tabs))===JSON.stringify(['Insights','Tasks','Memory','Settings']));
 check('English does not restore secondary categories',await p.evaluate(()=>![...document.querySelectorAll('button')].some(b=>['Brief','Decisions','Inspirations'].includes(b.innerText.trim()))));
 await p.screenshot({path:out+'/02-common-en.png'});
 await p.click('text="中文"');await p.reload();await p.waitForSelector('[data-mock-footer]');
 check('reloading original-v6 query keeps current UI',JSON.stringify(await p.evaluate(tabs))===JSON.stringify(['洞察','任务','记忆','设置']));
 await p.goto('http://127.0.0.1:46400/#overview');await p.waitForSelector('[data-v6-current]');
 check('current catalog labels common URL as current',await p.evaluate(()=>document.querySelector('[data-v6-current]').innerText.includes('当前 Mock')&&!document.body.innerText.includes('基准稿')&&!document.querySelector('[data-v6-archived]')));
 await p.click('.catalog-bar a[href="#overview-legacy"]');await p.waitForSelector('[data-v6-archived]');
 check('early category draft is only linked in archive',await p.evaluate(()=>document.querySelector('[data-v6-archived]').href.endsWith('/v6-baseline-20261111.html')&&document.body.innerText.includes('旧版工作区')));
 await p.click('[data-v6-archived]');await p.waitForSelector('[aria-label="CyberMe"]');
 check('historical draft remains available',await p.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Decisions')));
 await p.goto(url);await p.waitForSelector('[data-mock-footer]');
 await fs.writeFile(out+'/final-ax.txt',await p.snapshot());
 const hashes={};for(const f of ['.local/design-preview/v6-baseline-20261111.html','.local/design-preview/insights-current.html','.local/design-preview/v6.1-concept.html','mock/opstwins/catalog.js','mock/opstwins/app.js','scripts/build-insight-mock-revision.mjs'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/'+f)).digest('hex');
 check('old draft is preserved and common/current files match',hashes['.local/design-preview/v6-baseline-20261111.html']==='5277901d4f80f425c41494c44192dc347f8c69e77aa8c17de52a223cbb7727ee'&&hashes['.local/design-preview/v6.1-concept.html']===hashes['.local/design-preview/insights-current.html']);
 await fs.writeFile(out+'/sha256.json',JSON.stringify(hashes,null,2));
}catch(e){checks.push({name:'browser interaction completed',pass:false,error:String(e)});throw e}finally{await fs.writeFile(out+'/result.json',JSON.stringify({url,out,checks,scope:'Static Mock common URL, language and archive navigation; no production or model validation.'},null,2));console.log(JSON.stringify({out,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks},null,2))}
// Caller inspects screenshots and finishes the same TaskSpace.
