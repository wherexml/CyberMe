// Browser journey for a withheld new insight whose visual failed (docs/public/insight-visuals.md, 2026-11-14), against a fresh
// scripts/insight-reliability-fixture.mjs (46891) serving built V6 assets. Run with ego-browser nodejs:
//   --task-space=<id> --root=<absolute project root> [--page=p1]   (or INSIGHT_RELIABILITY_TASK_SPACE / _ROOT / _PAGE)
// Physical clicks only (15 s timeout). The caller inspects screenshots and finishes the TaskSpace; this script never does.
const arg=k=>(globalThis.process?.argv||[]).find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3)??globalThis.process?.env?.['INSIGHT_RELIABILITY_'+k.toUpperCase().replace(/-/g,'_')];
const TASK_SPACE=Number(arg('task-space')),PAGE=arg('page')||'p1',ROOT=arg('root');
if(!Number.isInteger(TASK_SPACE)||TASK_SPACE<=0||!ROOT||!ROOT.startsWith('/'))throw Error('usage: --task-space=<id> --root=<absolute project root> [--page=p1]');
const fs=await import('node:fs/promises');
const root=ROOT.replace(/\/+$/,''),base='http://127.0.0.1:46891',url=base+'/cyberme.html';
const out=root+'/output/insight-reliability-visual-browser-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'/'+new Date().toISOString().replace(/[:.]/g,'-');
const task=await taskSpace(TASK_SPACE),page=task.page(PAGE);
const T=15000,checks=[],shots=[];
const check=(id,name,pass,detail)=>{checks.push({id,name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(id+' '+name)};
const fx=async(name,body={})=>JSON.parse((await page.fetch('/__fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const ev=async()=>JSON.parse((await page.fetch('/__fixture/evidence')).body);
const visualPosts=async()=>(await ev()).posts.filter(p=>p.path==='/api/ideas/visuals/generate').length;
const footer=()=>page.evaluate(()=>{const s=document.querySelector('[data-footer-source="visual"]');return {status:s?.getAttribute('data-footer-status')||null,error:s?.getAttribute('data-footer-error')||null,role:s?.getAttribute('role')||null,text:s?.querySelector('span')?.textContent||'',retry:!!document.querySelector('[data-footer-visual-retry]'),footerText:document.querySelector('[data-insight-footer]')?.textContent||''}});
const COPY={zh:{held:'有洞察未完成',running:'查找中…'},en:{held:"An insight didn't finish",running:'Looking…'}};
const TECH=/reasoning_|provider_|exhausted|max_tokens|OpenCode/i;
async function load(){await page.goto(url);await page.waitForSelector('[data-insight-footer]',{timeout:T});await page.evaluate(()=>document.querySelector('[data-insight-footer]')?.scrollIntoView({block:'end'}))}
async function shot(name){await new Promise(r=>setTimeout(r,500));const path=out+'/'+name+'.png';await page.screenshot({path});shots.push(path)}
await fs.mkdir(out,{recursive:true});
try{
 await fx('seed',{relevant:{}});await fx('config',{model:'x/deepseek-test',modelOptions:{contextWindow:200000,maxTokens:7000,reasoning:true,vision:false}});
 for(const [lang,language,width] of [['zh','zh-CN',1320],['en','en',760]]){
  await fx('language',{language});await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:920,deviceScaleFactor:2,mobile:false});
  const id='vis-browser-'+lang;await fx('visual-seed',{id});
  // First attempt fails server-side (reasoning-only cut) without any page involvement.
  await fx('fault',{clear:true});await fx('fault',{kind:'reasoning_error_text',count:4});
  await page.fetch('/api/ideas/visuals/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:[id]})});
  await load();let f=await footer();
  check('W1',lang+' withheld insight shows one concise retryable line, cause code as attribute only',f.status==='failed'&&f.text===COPY[lang].held&&f.retry&&f.role==='alert'&&f.error==='reasoning_exhausted'&&!TECH.test(f.footerText),f);
  check('W1',lang+' withheld card is not rendered',await page.evaluate(i=>!document.body.textContent.includes('公开视觉洞察 '+i),id));
  await shot('w1-'+lang);
  // Retry: exactly one POST, running label while held, then read back (second counted attempt fails → no further action offered).
  await fx('fault',{clear:true});await fx('fault',{kind:'hold'});const p0=await visualPosts();
  await page.click('[data-footer-visual-retry]',{label:'重试',timeout:T});
  await page.waitForFunction(()=>document.querySelector('[data-footer-source="visual"]')?.getAttribute('data-footer-status')==='running',undefined,{timeout:T});
  f=await footer();check('W2',lang+' retry shows the running label without a retry button',f.text===COPY[lang].running&&!f.retry,f);
  await fx('fault',{clear:true});await fx('fault',{kind:'reasoning_error_text',count:4});await fx('release',{});
  await page.waitForFunction(()=>document.querySelector('[data-footer-source="visual"]')?.getAttribute('data-footer-status')!=='running',undefined,{timeout:60000});
  check('W2',lang+' exactly one generate POST',await visualPosts()===p0+1,{posts:(await visualPosts())-p0});
  await load();f=await footer();check('W3',lang+' terminal failure stays visible as one concise line with no retry action, nothing replayed',f.status==='failed'&&f.text===COPY[lang].held&&f.role==='alert'&&!f.retry&&await visualPosts()===p0+1,f);
  await shot('w3-'+lang);
  // W4 held AUTOMATIC retry: reloads keep the failure line (retrying, no action), no client POST; a reviewed success publishes the card.
  const auto='vis-auto-'+lang;await fx('visual-seed',{id:auto});await fx('fault',{clear:true});await fx('fault',{kind:'connection',count:4});
  await page.fetch('/api/ideas/visuals/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:[auto]})});
  const p4=await visualPosts();await fx('visual-expire/'+auto,{});await fx('fault',{clear:true});await fx('fault',{kind:'hold',then:'visual_success'});await fx('fault',{kind:'visual_success',count:6});
  await fx('visual-background',{pollMs:300});for(let i=0;i<150&&(await ev()).held<1;i++)await new Promise(r=>setTimeout(r,200));
  for(const n of [1,2]){await load();f=await footer();const retrying=await page.evaluate(()=>document.querySelector('[data-footer-source="visual"]')?.getAttribute('data-footer-retrying'));
   check('W4',lang+' reload '+n+' during the automatic retry keeps the failure line without an action',f.status==='failed'&&f.text===COPY[lang].held&&!f.retry&&retrying==='true',f)}
  check('W4',lang+' no client POST during the automatic retry',await visualPosts()===p4);
  await shot('w4-'+lang);
  await fx('release',{});
  for(let i=0;i<300;i++){const r=JSON.parse((await page.fetch('/__fixture/visual-row/'+auto)).body);if(r?.status==='ready')break;await new Promise(r=>setTimeout(r,200))}
  await fx('visual-background',{stop:true});await load();
  check('W4',lang+' reviewed success publishes the card',await page.evaluate(i=>document.body.textContent.includes('公开视觉洞察 '+i),auto));
 }
 // W5 (case 11): a successful manual refresh must not mask a later withheld new insight on the SAME mounted page (no reload).
 {await fx('language',{language:'zh-CN'});await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:2,mobile:false});
  // Earlier terminal rows are retired through the normal idea API so they cannot satisfy this check.
  for(const id of ['vis-browser-zh','vis-browser-en'])await page.fetch('/api/ideas/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'dismissed'})});
  await fx('fault',{clear:true});await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周四上午，请按新日期准备。'});
  await load();check('W5','no visual line before the scenario',!(await footer()).status);
  await page.click('[data-footer-refresh]',{label:'刷新洞察',timeout:T});
  await page.waitForFunction(()=>document.querySelector('[data-footer-status]')?.getAttribute('data-footer-status')==='done',undefined,{timeout:60000});
  const w5='vis-w5';await fx('visual-seed',{id:w5});await fx('fault',{kind:'reasoning_error_text',count:4});
  await page.fetch('/api/ideas/visuals/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:[w5]})});await fx('fault',{clear:true});
  // Same page: the existing focus-driven workspace reload, no navigation.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('[data-footer-source="visual"]')?.getAttribute('data-footer-status')==='failed',undefined,{timeout:T});
  let f=await footer();check('W5','after a successful manual refresh the later visual failure is visible without reload',f.text===COPY.zh.held&&f.retry&&f.role==='alert'&&f.error==='reasoning_exhausted'&&!TECH.test(f.footerText),f);
  await shot('w5-failed');
  const p5=await visualPosts();await fx('fault',{kind:'hold',then:'visual_success'});await fx('fault',{kind:'visual_success',count:6});
  await page.click('[data-footer-visual-retry]',{label:'重试',timeout:T});
  await page.waitForFunction(()=>document.querySelector('[data-footer-source="visual"]')?.getAttribute('data-footer-status')==='running',undefined,{timeout:T});
  check('W5','not cleared while the retry is only running',!!(await footer()).status);
  await fx('release',{});
  for(let i=0;i<300;i++){const r=JSON.parse((await page.fetch('/__fixture/visual-row/'+w5)).body);if(r?.status==='ready')break;await new Promise(r=>setTimeout(r,200))}
  await page.waitForFunction(()=>!document.querySelector('[data-footer-source="visual"]'),undefined,{timeout:30000});
  check('W5','exactly one visual retry POST; line cleared only after the reviewed ready result; card shown',await visualPosts()===p5+1&&JSON.parse((await page.fetch('/__fixture/visual-row/'+w5)).body)?.status==='ready'&&await page.evaluate(i=>document.body.textContent.includes('公开视觉洞察 '+i),w5),{posts:(await visualPosts())-p5});
  await shot('w5-cleared');}
 const e=await ev();check('scope','no sends, no chat messages',e.sends===0&&e.messages===0);
}catch(e){checks.push({id:'harness',name:String(e?.message||e),pass:false})}
await fs.writeFile(out+'/browser.json',JSON.stringify({url,checks,shots},null,2));
console.log(JSON.stringify({out,total:checks.length,failed:checks.filter(c=>!c.pass).map(c=>c.id+' '+c.name)}));
