/* ego-browser nodejs < scripts/macos-ui-refinement-browser-e2e.mjs
   To reuse this goal's space: prefix globalThis.OPS_UI_SPACE=<printed number>.
   Records geometry/status only. Private text never enters report or screenshots. */
const fs=await import('node:fs/promises'),path=await import('node:path'),crypto=await import('node:crypto');
const base='/Users/steve/Projects/opstwin-advance',out=path.join(base,'output/macos-ui-refinement-20261003');await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPS_UI_SPACE??'macOS UI refinement acceptance'),page=task.page('p1'),checks=[];
console.log({spaceId:task.spaceId});
const entry='macos-ui-study.html',html=await fs.readFile(path.join(base,'docs/design',entry),'utf8');
const sources=[entry,...new Set([...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(m=>m[1]).filter(f=>!f.startsWith('../')&&!f.includes('://')))];
const hashes={};for(const f of sources)hashes[f]=crypto.createHash('sha256').update(await fs.readFile(path.join(base,'docs/design',f))).digest('hex');
function check(name,pass,metrics={}){console.log({check:name,status:pass?'PASS':'FAIL'});checks.push({name,status:pass?'PASS':'FAIL',...metrics});if(!pass)throw new Error(name);}
async function stable(){await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'),undefined,{timeout:5000});}
async function viewport(width,height){await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
async function openSettings(){await page.click('[data-page="settings"]');await stable();}
async function closeSettings(){await page.click('#close-settings');}
async function general(){await page.click('[data-setting="general"]');}
async function shot(name){await stable();const r=await page.evaluate(()=>{const r=document.querySelector('#settings-window').getBoundingClientRect();return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width)-1,height:Math.floor(r.height)-1}});await page.screenshot({path:path.join(out,name+'.png'),clip:r});}
let originalPrefs;
try{
 await page.goto('file://'+path.join(base,'docs/design/macos-ui-study.html'));await page.cdp('Page.bringToFront');await viewport(1668,957);await stable();
 // Storage stays in the Node process memory only; never serialized into evidence.
 originalPrefs=await page.evaluate(()=>({prefs:localStorage.getItem('opstwins-ui-study-prefs'),state:localStorage.getItem('opstwins-ui-study-state-v2'),device:localStorage.getItem('opstwins-device-study-v1'),settings:sessionStorage.getItem('opstwins-settings-study-v1')}));
 const md=await page.evaluate(()=>({messages:document.querySelectorAll('[data-message-id]').length,strong:document.querySelectorAll('#messages strong').length,lists:document.querySelectorAll('#messages ul,#messages ol').length,plain:document.querySelectorAll('#messages .md-plain').length,parser:typeof window.marked?.parse==='function',reading:document.querySelector('.reading').getBoundingClientRect().width,nav:document.querySelector('.nav button').getBoundingClientRect().height,rail:document.querySelector('.muse-rail').getBoundingClientRect().width,brand:document.querySelectorAll('.sidebar .brand').length,toolbar:document.querySelectorAll('.main>.toolbar').length}));
 check('real saved messages render Markdown',md.messages>0&&md.strong>0&&md.lists>0&&md.plain===0&&md.parser,md);
 check('sidebar and reading contract',md.nav===44&&md.rail===78&&md.reading===680&&md.brand===0&&md.toolbar===0);
 check('icon rail retains accessible names and hides text',await page.evaluate(()=>[...document.querySelectorAll('.muse-rail button[data-page]')].every(b=>b.getAttribute('aria-label')&&b.dataset.tooltip&&[...b.querySelectorAll('span')].every(x=>getComputedStyle(x).display==='none'))));
 await page.mouse.move(350,80,{label:'移开导航指针'});await page.hover('[data-page="chat"]');await page.waitForFunction(()=>!document.querySelector('#rail-tooltip').hidden,undefined,{timeout:3000});
 check('rail hover name escapes sidebar clipping',await page.evaluate(()=>{const t=document.querySelector('#rail-tooltip'),r=t.getBoundingClientRect(),b=document.querySelector('.muse-rail [data-page="chat"]').getBoundingClientRect();return t.textContent.includes('对话')&&r.left>=b.right&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));
 await page.keyboard.press('Escape');check('Escape dismisses rail hint',await page.evaluate(()=>document.querySelector('#rail-tooltip').hidden));
 // Synthetic Markdown is rendered by the same production adapter, isolated from workspace data.
 const synthetic='# 标题\n\n**粗体** 与 *斜体*\n\n- 第一项\n- 第二项\n\n> 引用\n\n```js\n'+('long_code_'.repeat(100))+'\n```\n\n| 列一 | 列二 |\n| --- | --- |\n| 值 | 内容 |\n\n[有效链接](https://example.com)\n\n[危险链接](javascript:alert(1))\n<script>window.__mdAttack=true</script><img src=x onerror="window.__mdAttack=true">';
 check('GFM and content safety',await page.evaluate(text=>{const host=document.createElement('div');host.id='md-acceptance';host.className='bubble chat-real-text';host.style.cssText='position:fixed;left:16px;top:16px;width:330px;max-width:330px;z-index:100;background:var(--bg);padding:16px';document.body.append(host);window.OpsTwinsMarkdown.render(host,text);return !!host.querySelector('h1,strong,em,blockquote')&&!!host.querySelector('ul li')&&!!host.querySelector('pre code')&&!!host.querySelector('table')&&!host.querySelector('script,img,[onclick],[onerror],a[href^="javascript:"]')&&!window.__mdAttack},synthetic));
 await viewport(390,844);
 check('wide Markdown scrolls locally',await page.evaluate(()=>{const h=document.querySelector('#md-acceptance'),c=h.querySelector('.md-code-scroll');return h.scrollWidth<=h.clientWidth+1&&c.scrollWidth>c.clientWidth}));
 const syntheticClip=await page.evaluate(()=>{const r=document.querySelector('#md-acceptance').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y)}});await page.screenshot({path:path.join(out,'markdown-synthetic.png'),clip:syntheticClip});
 check('parser failure retains original text',await page.evaluate(()=>{const h=document.querySelector('#md-acceptance'),parser=window.marked;window.marked=null;window.OpsTwinsMarkdown.render(h,'**保留原文**');window.marked=parser;const ok=h.textContent==='**保留原文**'&&h.classList.contains('md-plain');h.remove();return ok}));
 for(const [width,height] of [[1668,957],[1680,904],[900,700],[390,844],[760,450]]){
  await viewport(width,height);await page.click('[data-page="inbox"]');
  if(width<=760&&!await page.evaluate(()=>document.querySelector('.inbox-layout').classList.contains('show-detail')))await page.click('#inbox-items .inbox-item >> nth=0');await stable();
  const geometry=await page.evaluate(()=>{const s=document.querySelector('.detail-scroll'),a=document.querySelector('.detail>.actions'),sr=s.getBoundingClientRect(),ar=a.getBoundingClientRect(),buttons=[...a.querySelectorAll('button')];return {scrollBottom:sr.bottom,actionsTop:ar.top,actionsBottom:ar.bottom,viewportHeight:innerHeight,position:getComputedStyle(a).position,bodyOverflow:document.documentElement.scrollWidth-innerWidth,font:buttons.map(b=>getComputedStyle(b).fontSize),sendRight:buttons.at(-1).id==='send-reply'}});
  check('inbox reserves action height '+width+'x'+height,geometry.scrollBottom<=geometry.actionsTop+1&&geometry.actionsBottom<=height+1&&geometry.position==='static'&&geometry.bodyOverflow<=1&&geometry.sendRight&&geometry.font.every(x=>x==='13px'),geometry);
  const pos=await page.evaluate(()=>{const r=document.querySelector('.detail-scroll').getBoundingClientRect();return {x:r.x+4,y:r.top+r.height/2}});
  await page.mouse.move(pos.x,pos.y,{label:'滚动草稿正文区域'});await page.mouse.wheel(0,4000,{label:'查看回复草稿末尾'});await page.waitForFunction(()=>{const s=document.querySelector('.detail-scroll');return s.scrollTop>=s.scrollHeight-s.clientHeight-1},undefined,{timeout:5000});
  // Action auto-scroll brings the editable draft into view using real wheel input.
  await page.click('#edit-draft');
  check('draft is editable without action overlap '+width,await page.evaluate(()=>{const d=document.querySelector('#draft'),s=document.querySelector('.detail-scroll').getBoundingClientRect(),a=document.querySelector('.detail>.actions').getBoundingClientRect(),r=d.getBoundingClientRect();return d.isContentEditable&&s.bottom<=a.top+1&&r.top<a.top}));
  await page.click('#edit-draft');
 }
 await viewport(1668,957);await page.click('[data-page="chat"]');await openSettings();await general();
 check('settings is nonmodal',await page.evaluate(()=>document.querySelector('#settings-window').open&&!document.querySelector('#settings-window').matches(':modal')&&!document.querySelector('.window').inert));
 await page.click('[data-page="tasks"]');
 check('main navigation remains available with settings open',await page.evaluate(()=>document.querySelector('#settings-window').open&&document.querySelector('#view-tasks').classList.contains('active')));
 await openSettings();await general();
 check('single settings instance',await page.evaluate(()=>document.querySelectorAll('#settings-window[open]').length===1));
 check('general has no save/cancel footer',await page.evaluate(()=>!document.querySelector('#settings-content .ss-form-footer')));
 await page.click('input[aria-label="English"]');await page.reload();await openSettings();await general();
 check('language preference persists immediately',await page.evaluate(()=>document.querySelector('input[aria-label="English"]').checked));
 await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='opstwins-ui-study-prefs')throw new Error('synthetic failure');return window.__originalSetItem.call(this,k,v)}});
 await page.click('input[aria-label="简体中文"]');
 check('failed preference save retains selection and retry',await page.evaluate(()=>document.querySelector('input[aria-label="简体中文"]').checked&&!!document.querySelector('.ss-preference-error [type=button]')));
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem});await page.click('text="重试保存"');
 check('preference retry clears error',await page.evaluate(()=>!document.querySelector('.ss-preference-error')));
 await page.click('#settings-content button:text-is("深色")');await shot('settings-dark');
 check('dark appearance applied',await page.evaluate(()=>document.body.classList.contains('dark')));
 await page.click('#settings-content button:text-is("浅色")');await shot('settings-light');
 await page.click('[data-setting="filesystem"]');await page.click('text="添加文件夹"');await page.keyboard.press('Escape');
 check('nested Escape only closes child',await page.evaluate(()=>document.querySelector('#settings-window').open&&!document.querySelector('.ss-dialog').open));
 await general();await page.keyboard.press('Escape');
 check('settings Escape restores entry focus',await page.evaluate(()=>!document.querySelector('#settings-window').open&&document.activeElement.dataset.page==='settings'));
 await page.click('[data-page="tasks"]');
 check('task groups and completed collapse',await page.evaluate(()=>document.querySelectorAll('[data-task-group]').length===3&&!document.querySelector('[data-task-group="done"]').open));
 await page.click('[data-task-group="done"]>summary');
 const tasks=await page.evaluate(()=>({rows:document.querySelectorAll('.taskrow').length,completed:document.querySelectorAll('.taskrow.done').length}));
 check('completed records remain accessible',tasks.rows>0&&tasks.completed>0,tasks);
 await page.click('[data-task-group="done"] .task-check >> nth=0');
 check('reopened task appears in active group',await page.evaluate(()=>document.querySelectorAll('[data-task-group="today"] .taskrow,[data-task-group="later"] .taskrow').length>0));
 await page.reload();await page.click('[data-page="tasks"]');
 check('task reopening survives refresh',await page.evaluate(()=>document.querySelectorAll('[data-task-group="today"] .taskrow,[data-task-group="later"] .taskrow').length>0));
 if(await page.evaluate(()=>document.querySelector('[data-task-group="done"]').open))await page.click('[data-task-group="done"]>summary');
 await page.click('[data-task-group="today"] .task-open,[data-task-group="later"] .task-open >> nth=0');
 await page.selectOption('#task-dialog select[aria-label="任务状态"]','done');await page.click('#task-dialog .task-save');await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-task-group="done"]>summary'),undefined,{timeout:3000});
 check('completing into collapsed group restores visible summary focus',await page.evaluate(()=>!document.querySelector('#task-dialog').open&&!document.querySelector('[data-task-group="done"]').open&&document.activeElement===document.querySelector('[data-task-group="done"]>summary')));

 await page.click('[data-page="ideas"]');
 check('idea titles are clickable and repeated view buttons removed',await page.evaluate(()=>document.querySelectorAll('.idea-open').length>0&&!document.querySelector('.idea-primary')));
 await page.click('.idea-open >> nth=0');check('idea opens details',await page.evaluate(()=>document.querySelector('#detail-dialog').open));await page.keyboard.press('Escape');
 const count=await page.evaluate(()=>document.querySelectorAll('.idea-card').length);await page.hover('.idea-card >> nth=0');await page.click('.idea-ignore >> nth=0');
 check('ignore removes one idea',await page.evaluate(n=>document.querySelectorAll('.idea-card').length===n-1,count));await page.click('.toast-undo');
 check('undo restores idea',await page.evaluate(n=>document.querySelectorAll('.idea-card').length===n,count));
 await page.click('[data-page="search"]');check('Spotlight focus',await page.evaluate(()=>document.querySelector('#search-dialog').open&&document.activeElement.id==='workspace-query'));await page.keyboard.press('Escape');
 for(const [width,height] of [[900,700],[390,844],[760,450]]){
  await viewport(width,height);await openSettings();const groups=await page.evaluate(()=>[...document.querySelectorAll('[data-setting]')].map(b=>b.dataset.setting));
  for(const group of groups){await page.click('[data-setting="'+group+'"]');const metric=await page.evaluate(()=>{const d=document.querySelector('#settings-window').getBoundingClientRect(),c=document.querySelector('#settings-content');return {overflow:c.scrollWidth-c.clientWidth,inView:d.left>=-1&&d.top>=-1&&d.right<=innerWidth+1&&d.bottom<=innerHeight+1}});check('settings layout '+width+' '+group,metric.overflow<=1&&metric.inView,metric);}
  await general();if(width===390)await shot('settings-mobile');await closeSettings();
 }
}catch(error){checks.push({name:'E2E stopped',status:'FAIL',error:error.message});}
finally{
 await page.evaluate(()=>{if(window.__originalSetItem){Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem}}).catch(()=>{});
 if(originalPrefs)await page.evaluate(saved=>{for(const [key,value] of [['opstwins-ui-study-prefs',saved.prefs],['opstwins-ui-study-state-v2',saved.state],['opstwins-device-study-v1',saved.device]]){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}if(saved.settings===null)sessionStorage.removeItem('opstwins-settings-study-v1');else sessionStorage.setItem('opstwins-settings-study-v1',saved.settings)},originalPrefs);
 await page.cdp('Emulation.clearDeviceMetricsOverride');await page.reload();
}
const finalHashes={};for(const f of sources)finalHashes[f]=crypto.createHash('sha256').update(await fs.readFile(path.join(base,'docs/design',f))).digest('hex');
checks.push({name:'source stable during E2E',status:JSON.stringify(hashes)===JSON.stringify(finalHashes)?'PASS':'FAIL',changed:sources.filter(f=>hashes[f]!==finalHashes[f])});
const report={capturedAt:new Date().toISOString(),spaceId:task.spaceId,checks,hashes,scope:'HTML preview only; no HTTP writes, external sends, permissions or private text recorded',native:'NOT_RUN'};
await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log({artifact:path.join(out,'result.json'),passed:checks.filter(c=>c.status==='PASS').length,failed:checks.filter(c=>c.status==='FAIL').length});
if(checks.some(c=>c.status==='FAIL'))throw new Error('E2E failed: '+checks.find(c=>c.status==='FAIL').name);
