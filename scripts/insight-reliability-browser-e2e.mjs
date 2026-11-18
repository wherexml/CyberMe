// Browser journey for the footer's background status (docs/public/insight-reliability.md) against a fresh
// scripts/insight-reliability-fixture.mjs (46891) serving built V6 assets. Same conventions as scripts/insight-footer-browser-e2e.mjs:
// run with ego-browser nodejs, passing the coordinator's TaskSpace and project root: --task-space=<id> --root=<absolute path> [--page=p1]
// (or INSIGHT_RELIABILITY_TASK_SPACE / INSIGHT_RELIABILITY_ROOT / INSIGHT_RELIABILITY_PAGE where the runtime exposes env). Nothing is
// hardcoded; a missing value stops before any browser action. Physical clicks only (15 s timeout).
// The caller inspects screenshots and finishes the TaskSpace; this script never finishes it.
// B4 note: a browser cannot restart the server, so the restart state is seeded through /__fixture/meta exactly as the restarted
// server reports it (status unknown, error server_interrupted, no in-memory flight). The real restart is covered by the HTTP E2E (H8).
const arg=k=>(globalThis.process?.argv||[]).find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3)??globalThis.process?.env?.['INSIGHT_RELIABILITY_'+k.toUpperCase().replace(/-/g,'_')];
const TASK_SPACE=Number(arg('task-space')),PAGE=arg('page')||'p1',ROOT=arg('root');
if(!Number.isInteger(TASK_SPACE)||TASK_SPACE<=0||!ROOT||!ROOT.startsWith('/'))throw Error('usage: --task-space=<id> --root=<absolute project root> [--page=p1]');
const fs=await import('node:fs/promises');
const root=ROOT.replace(/\/+$/,''),base='http://127.0.0.1:46891',url=base+'/cyberme.html';
const out=root+'/output/insight-reliability-browser-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'/'+new Date().toISOString().replace(/[:.]/g,'-');
const task=await taskSpace(TASK_SPACE),page=task.page(PAGE);
const T=15000,checks=[],shots=[];
const check=(id,name,pass,detail)=>{checks.push({id,name,pass:!!pass,...(detail!==undefined?{detail}:{})});if(!pass)throw Error(id+' '+name)};
const click=(selector,label)=>page.click(selector,{label,timeout:T});
const until=(fn,arg)=>page.waitForFunction(fn,arg,{timeout:T});
const fx=async(name,body={})=>JSON.parse((await page.fetch('/__fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).body);
const ev=async()=>JSON.parse((await page.fetch('/__fixture/evidence')).body);
const refreshPosts=async()=>(await ev()).refreshPosts;
const footer=()=>page.evaluate(()=>{const s=document.querySelector('[data-footer-status]'),b=document.querySelector('[data-footer-refresh]');
 return {status:s?.getAttribute('data-footer-status')||null,source:s?.getAttribute('data-footer-source')||null,error:s?.getAttribute('data-footer-error')||null,role:s?.getAttribute('role')||null,
  text:s?.querySelector('span')?.textContent||'',retry:!!document.querySelector('[data-footer-retry]'),refreshText:b?.textContent||'',refreshDisabled:!!b?.disabled,
  footerText:document.querySelector('[data-insight-footer]')?.textContent||''}});
const COPY={zh:{failed:'查找未完成',running:'查找中…'},en:{failed:"Search didn't finish",running:'Looking…'}};
const TECH=/provider_|_exhausted|server_interrupted|llm_|502|stream/i;
async function load(){await page.goto(url);await page.waitForSelector('[data-insight-footer]',{timeout:T});await page.evaluate(()=>document.querySelector('[data-insight-footer]')?.scrollIntoView({block:'end'}))}
async function shot(name){await new Promise(r=>setTimeout(r,500));const path=out+'/'+name+'.png';await page.screenshot({path});shots.push(path)}
async function setTheme(theme){await page.evaluate(t=>{const k='cyberme-v6-ui',ui=JSON.parse(localStorage.getItem(k)||'{}');ui.theme=t;localStorage.setItem(k,JSON.stringify(ui))},theme)}
async function automaticFailure(){await fx('fault',{clear:true});await fx('fault',{kind:'5xx',count:100});await fx('touch-source',{id:'rel-source',body:'公开试点 浏览器'+Date.now()});const r=await fx('automatic',{ignoreBackoff:true});await fx('fault',{clear:true});return r}
await fs.mkdir(out,{recursive:true});
try{
 await fx('seed',{relevant:{}});
 for(const [lang,language] of [['zh','zh-CN'],['en','en']]){
  await fx('language',{language});
  for(const theme of ['quiet','night'])for(const width of [1320,760]){
   const tag=`${lang}-${theme}-${width}`;
   await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:920,deviceScaleFactor:2,mobile:false});
   // B1 automatic failure only, then a fresh page load.
   const auto=await automaticFailure();check('B1',tag+' automatic run failed server-side',auto.ok===false,auto);
   await load();await setTheme(theme);await load();
   await until(()=>document.querySelector('[data-footer-status="failed"][data-footer-source="background"]'));
   let f=await footer();
   check('B1',tag+' footer shows failure with retry, role=alert, error code attribute only',f.text===COPY[lang].failed&&f.retry&&f.role==='alert'&&f.error==='provider_unavailable'&&!TECH.test(f.footerText),f);
   await shot('b1-'+tag);
   // B6 reload/remount keeps it without any POST.
   const p0=await refreshPosts();await load();f=await footer();check('B6',tag+' reload keeps failure without POST',f.status==='failed'&&await refreshPosts()===p0);
   // B5 held automatic retry after the failure: failure stays visible, no retry button, refresh disabled.
   await fx('fault',{kind:'hold',on:'answer'});await fx('automatic',{ignoreBackoff:true,wait:false});await until(()=>true);
   for(let i=0;i<50&&(await ev()).held<1;i++)await new Promise(r=>setTimeout(r,200));
   await load();f=await footer();
   check('B5',tag+' running retry keeps 查找未完成 without retry and disables refresh',f.text===COPY[lang].failed&&!f.retry&&f.refreshDisabled&&f.refreshText===COPY[lang].running,f);
   // B3 clicking the disabled button sends nothing.
   const p1=await refreshPosts();await page.click('[data-footer-refresh]',{label:'点击禁用的刷新',timeout:T,force:true}).catch(()=>{});await new Promise(r=>setTimeout(r,800));
   check('B3',tag+' disabled refresh sends no POST while background runs',await refreshPosts()===p1);
   await shot('b5-'+tag);
   await fx('release',{});await new Promise(r=>setTimeout(r,1500));await fx('fault',{clear:true});
   // B4 restart state (seeded as reported after restart): retryable, not success.
   await fx('meta',{status:'unknown',error:'server_interrupted',completedAt:new Date().toISOString()});
   await load();f=await footer();check('B4',tag+' unknown after restart is retryable failure, not success',f.status==='failed'&&f.retry&&f.error==='server_interrupted'&&!TECH.test(f.footerText),f);
   // B2 one physical retry: exactly one POST; success copy; failure cleared on the server.
   const p2=await refreshPosts();await fx('touch-source',{id:'rel-source',body:'公开试点安排改到下周三，请按新日期准备。'+Date.now()});
   await click('[data-footer-retry]','重试');
   await until(()=>['done'].includes(document.querySelector('[data-footer-status]')?.getAttribute('data-footer-status')||''));
   const bg=(await ev()).background;
   check('B2',tag+' retry sends exactly one POST and clears the failure on success',await refreshPosts()===p2+1&&bg.status==='succeeded'&&!bg.lastError,{posts:(await refreshPosts())-p2,status:bg.status,lastError:bg.lastError});
   await shot('b2-'+tag);
  }
 }
 const e=await ev();check('scope','no sends, no chat messages',e.sends===0&&e.messages===0,{sends:e.sends,messages:e.messages});
}catch(e){checks.push({id:'harness',name:String(e?.message||e),pass:false})}
await fs.writeFile(out+'/browser.json',JSON.stringify({url,checks,shots},null,2));
console.log(JSON.stringify({out,total:checks.length,failed:checks.filter(c=>!c.pass).map(c=>c.id+' '+c.name)}));
