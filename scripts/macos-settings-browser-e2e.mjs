/* New acceptance: ego-browser nodejs < scripts/macos-settings-browser-e2e.mjs
   To resume a space, prefix globalThis.OPS_UI_SPACE with its printed numeric ID. */
const fs=await import('node:fs/promises');
const crypto=await import('node:crypto');
const path=await import('node:path');
const base='/Users/steve/Projects/opstwin-advance',out=path.join(base,'output/ui-review');await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPS_UI_SPACE??'OpsTwins settings acceptance');
const page=task.page('p1'),checks=[];
const entry='docs/design/macos-ui-study.html',html=await fs.readFile(path.join(base,entry),'utf8');const sources=[entry,...new Set([...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(m=>'docs/design/'+m[1]).filter(f=>!f.includes('/../')&&!f.includes('://')))];const loadedHashes={};for(const file of sources)loadedHashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(base,file))).digest('hex');
function check(name,pass,metrics={}){checks.push({name,status:pass?'PASS':'FAIL',...metrics});if(!pass)throw new Error(name);}
async function viewport(width,height){await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
async function section(name){await page.click('[data-setting="'+name+'"]');}
async function screenshot(name){const clip=await page.evaluate(()=>{const r=document.querySelector('#settings-window').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});await page.waitForFunction(()=>{const buttons=[...document.querySelectorAll('.settings-nav button')];const probe=document.createElement('span');document.querySelector('#settings-window').append(probe);const ok=buttons.every(b=>{probe.style.color=b.getAttribute('aria-pressed')==='true'?'var(--blue)':'var(--ink)';return getComputedStyle(b).color===getComputedStyle(probe).color;});probe.remove();return ok;});await page.screenshot({path:path.join(out,name+'.png'),clip});}
const synthetic='/OpsTwins-Design-QA/Blocked';
const syntheticModel='opstwins-design-qa/model';
async function addBlocked(type,value){await page.click('text="'+(type==='folder'?'添加文件夹':'添加应用')+'"');await page.fill('.ss-dialog input',value);await page.click('.ss-dialog .primary');}
async function choose(label,value){const index=await page.evaluate(({label,value})=>[...document.querySelector('select[aria-label="'+label+'"]').options].findIndex(x=>x.value===value),{label,value});if(index<0)throw new Error('Option missing');await page.click('.ss-select-trigger[aria-label="'+label+'"]');await page.click('.ss-select-menu [role=option]:nth-child('+(index+1)+')');}
async function removeSyntheticModel(){await page.evaluate(value=>{const button=[...document.querySelectorAll('#settings-content .ss-row')].find(row=>row.querySelector('strong')?.textContent===value)?.querySelector('button');if(!button)throw new Error('Synthetic model remove button missing');button.setAttribute('data-qa-remove-model','');},syntheticModel);await page.click('[data-qa-remove-model]');}
async function savePolicy(){await page.click('#settings-content .ss-form-footer .primary');}
let originalStorage;
try{
 await page.goto('file://'+path.join(base,'docs/design/macos-ui-study.html'));await page.cdp('Page.bringToFront');await viewport(1440,1000);originalStorage=await page.evaluate(()=>({local:Object.fromEntries(['opstwins-ui-study-prefs','opstwins-ui-study-state-v2','opstwins-device-study-v1'].map(k=>[k,localStorage.getItem(k)])),settings:sessionStorage.getItem('opstwins-settings-study-v1')}));await page.snapshot();
 await page.click('button[aria-label="设置"]');await section('filesystem');
 const oldTest=await page.evaluate(v=>document.querySelector('#settings-content').textContent.includes(v),synthetic);if(oldTest){await page.click('[aria-label="移除文件夹：'+synthetic+'"]');await savePolicy();}
 const states=await page.evaluate(()=>({unknown:document.querySelector('#settings-content').textContent.includes('未检测'),disabled:[...document.querySelectorAll('#settings-content input[role=switch]')].every(x=>x.disabled&&!x.checked),links:[...document.querySelectorAll('#settings-content a')].map(x=>x.getAttribute('href'))}));
 check('unknown OS permissions stay disabled',states.unknown&&states.disabled&&states.links[0].includes('Privacy_AllFiles'));
 await addBlocked('folder','relative/path');check('reject relative path',await page.evaluate(()=>document.querySelector('.ss-dialog input').validationMessage==='请输入绝对路径'));
 await page.fill('.ss-dialog input',synthetic);await page.click('.ss-dialog .primary');check('folder draft visible',await page.evaluate(v=>document.querySelector('#settings-content').textContent.includes(v),synthetic));
 await savePolicy();await page.reload();await page.click('button[aria-label="设置"]');await section('filesystem');
 check('folder survives refresh',await page.evaluate(v=>document.querySelector('#settings-content').textContent.includes(v),synthetic));
 await addBlocked('folder',synthetic+'/');check('reject duplicate path',await page.evaluate(()=>document.querySelector('.ss-dialog input').validationMessage==='已添加'));
 await page.keyboard.press('Escape');check('nested Escape preserves settings',await page.evaluate(()=>document.querySelector('#settings-window').open&&!document.querySelector('.ss-dialog').open));
 check('nested focus returns to add button',await page.evaluate(()=>document.activeElement.textContent==='添加文件夹'));
 await page.click('[aria-label="移除文件夹：'+synthetic+'"]');await page.click('#settings-content .ss-form-footer button:not(.primary)');check('cancel restores folder',await page.evaluate(v=>document.querySelector('#settings-content').textContent.includes(v),synthetic));
 await page.click('[aria-label="移除文件夹：'+synthetic+'"]');await savePolicy();check('folder removal saved',await page.evaluate(v=>!document.querySelector('#settings-content').textContent.includes(v),synthetic));
 await screenshot('file-access');
 const visible=await page.evaluate(()=>[...document.querySelectorAll('[data-setting]')].map(x=>x.dataset.setting));
 check('MVP groups omit deferred features',visible.length===12&&['computer','data','secure','wallet'].every(x=>!visible.includes(x))&&['filesystem','dictation','devices'].every(x=>visible.includes(x)));
 await section('dictation');
 await page.click('.ss-select-trigger[aria-label="按住说话快捷键"]');
 check('popup has selected tick and stays in viewport',await page.evaluate(()=>{const menu=document.querySelector('.ss-select-menu'),r=menu.getBoundingClientRect();return !!menu.querySelector('[aria-selected=true] .ss-select-tick').textContent&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
 await page.keyboard.press('Escape');check('menu Escape preserves settings and focus',await page.evaluate(()=>!document.querySelector('.ss-select-menu')&&document.querySelector('#settings-window').open&&document.activeElement.getAttribute('aria-label')==='按住说话快捷键'));
 await choose('按住说话快捷键','option-double');await choose('免手持快捷键','option-double');
 check('reject conflicting dictation shortcuts',await page.evaluate(()=>!document.querySelector('select[aria-label="免手持快捷键"]').checkValidity()));
 await page.click('#settings-content .ss-form-footer button:not(.primary)');
 await page.click('input[aria-label="听写提示音"]');await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='opstwins-device-study-v1')throw new Error('synthetic storage failure');return window.__originalSetItem.call(this,key,value);};});await savePolicy();
 check('storage failure retains draft and shows retry',await page.evaluate(()=>document.querySelector('#toast').textContent==='保存失败，请重试'&&document.querySelector('.ss-save-state').textContent==='未保存'&&!document.querySelector('.ss-form-footer .primary').disabled));
 await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem;});await page.click('#settings-content .ss-form-footer button:not(.primary)');
 await section('models');
 const hasModels=await page.evaluate(()=>!!document.querySelector('.ss-page-heading button:not(:disabled)'));
 if(hasModels){
  const existing=await page.evaluate(v=>[...document.querySelectorAll('.ss-row')].find(x=>x.querySelector('strong')?.textContent===v)?.querySelector('button')!=null,syntheticModel);
  if(existing){await removeSyntheticModel();}
  await page.click('text="新增模型"');await page.fill('input[aria-label="新增模型 ID"]',syntheticModel);await page.click('.ss-dialog .ss-actions button:not(.primary)');
  check('model cancel does not add',await page.evaluate(v=>![...document.querySelectorAll('.ss-row strong')].some(x=>x.textContent===v),syntheticModel));
  await page.click('text="新增模型"');await page.fill('input[aria-label="新增模型 ID"]',syntheticModel);
  await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='opstwins-settings-study-v1')throw new Error('synthetic catalog storage failure');return window.__originalSetItem.call(this,key,value);};});
  await page.click('.ss-dialog .primary');
  check('model storage failure retains input and dialog',await page.evaluate(v=>document.querySelector('.ss-dialog').open&&document.querySelector('input[aria-label="新增模型 ID"]').value===v&&document.querySelector('.ss-dialog .ss-warning').textContent==='保存失败，请重试',syntheticModel));
  await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem;});await page.click('.ss-dialog .primary');
  check('added model appears for its channel',await page.evaluate(v=>[...document.querySelectorAll('.ss-row strong')].some(x=>x.textContent===v)&&[...document.querySelectorAll('select option')].some(x=>x.value===v),syntheticModel));
  await page.reload();await page.click('button[aria-label="设置"]');await section('models');
  check('model catalog survives refresh',await page.evaluate(v=>!![...document.querySelectorAll('.ss-row strong')].find(x=>x.textContent===v),syntheticModel));
  await page.click('text="新增模型"');await page.fill('input[aria-label="新增模型 ID"]',syntheticModel);await page.click('.ss-dialog .primary');
  check('duplicate model is rejected',await page.evaluate(()=>document.querySelector('input[aria-label="新增模型 ID"]').validationMessage==='此渠道已包含该模型'));
  await page.keyboard.press('Escape');await removeSyntheticModel();
  check('model removal is reversible catalog change only',await page.evaluate(v=>![...document.querySelectorAll('.ss-row strong')].some(x=>x.textContent===v),syntheticModel));
 }else checks.push({name:'model add requires a configured channel',status:'NOT_RUN'});
 const groups=await page.evaluate(()=>[...document.querySelectorAll('[data-setting]')].map(x=>x.dataset.setting));
 for(const [width,height] of (globalThis.OPS_SETTINGS_VIEWPORTS??[[1440,1000],[900,700],[390,844],[760,450]])){
  await viewport(width,height);
  for(const group of groups){await section(group);const metrics=await page.evaluate(()=>{const content=document.querySelector('#settings-content'),nav=document.querySelector('.settings-nav'),dialog=document.querySelector('#settings-window'),r=dialog.getBoundingClientRect();return {overflow:content.scrollWidth-content.clientWidth,navScroll:nav.scrollWidth-nav.clientWidth,dialogInView:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,heading:!!content.querySelector('h2'),buttons:[...content.querySelectorAll('.ss-button')].map(x=>Math.round(x.getBoundingClientRect().width))};});check('layout '+width+'×'+height+' '+group,metrics.overflow<=1&&metrics.dialogInView&&metrics.heading,{overflow:metrics.overflow});}
  await section('general');const control=await page.evaluate(()=>({radioWidth:document.querySelector('.ss-language-option input').offsetWidth,switchWidth:document.querySelector('input[aria-label="减少动态效果"]').offsetWidth,buttonWidth:document.querySelector('.settings-nav button').offsetWidth,navWidth:document.querySelector('.settings-nav').clientWidth}));check('control sizing '+width,control.radioWidth<=20&&control.switchWidth<=40&&(width>760||control.buttonWidth<control.navWidth/2),control);
  await page.click('.ss-select-trigger[aria-label="正文大小"]');
  check('popup bounds '+width+'x'+height,await page.evaluate(()=>{const r=document.querySelector('.ss-select-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}));await page.keyboard.press('Escape');
  await section('autonomy');
  const checked=await page.evaluate(()=>document.querySelector('.ss-check-list input').checked);
  await page.click('.ss-check-list .ss-check:first-of-type:has(input[type=checkbox]) span');
  check('checkbox label toggles '+width,await page.evaluate(v=>document.querySelector('.ss-check-list input').checked!==v,checked));
  await page.click('.ss-check-list .ss-check:first-of-type:has(input[type=checkbox]) span');
  await page.click('.ss-select-trigger[aria-label="确认收到自主等级"]');
  check('row menu bounds '+width,await page.evaluate(()=>{const r=document.querySelector('.ss-select-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}));await page.keyboard.press('Escape');
  const rows=await page.evaluate(()=>[...document.querySelectorAll('.ss-row')].every(row=>{const card=row.closest('.ss-card');if(!card)return true;const padding=parseFloat(getComputedStyle(card).paddingRight);return row.lastElementChild.getBoundingClientRect().right<=card.getBoundingClientRect().right-padding+1;}));check('row controls respect card inset '+width,rows);
  await section('general');if(width===390)await screenshot('settings-mobile');
 }
 await viewport(1440,1000);await section('general');await page.click('text="深色"');check('dark mode applied',await page.evaluate(()=>document.body.classList.contains('dark')));await screenshot('settings-dark');await page.click('text="浅色"');await screenshot('settings-light');
 await page.keyboard.press('Escape');check('Escape returns workspace focus',await page.evaluate(()=>!document.querySelector('#settings-window').open&&document.activeElement.getAttribute('aria-label')==='设置'));
 for(const [width,height] of [[1440,1000],[390,844]]){await viewport(width,height);for(const name of ['chat','inbox','ideas','tasks']){await page.click('[data-page="'+name+'"]');const metric=await page.evaluate(()=>{const view=document.querySelector('.view.active');return {overflow:view.scrollWidth-view.clientWidth,bodyOverflow:document.documentElement.scrollWidth-innerWidth,contentWidth:view.clientWidth};});check('workspace '+width+' '+name,metric.overflow<=1&&metric.bodyOverflow<=1,{...metric});}}
 await page.click('[data-page="search"]');check('search focuses input',await page.evaluate(()=>document.querySelector('#search-dialog').open&&document.activeElement.id==='workspace-query'));await page.keyboard.press('Escape');check('search restores original page',await page.evaluate(()=>document.querySelector('#view-tasks').classList.contains('active')));
 await viewport(1440,1000);await page.click('[data-page="settings"]');await section('filesystem');
}catch(error){checks.push({name:'E2E stopped',status:'FAIL',error:error.message});}
finally{
 await page.evaluate(()=>{if(window.__originalSetItem){Storage.prototype.setItem=window.__originalSetItem;delete window.__originalSetItem;}}).catch(()=>{});
 if(originalStorage)await page.evaluate(saved=>{for(const [key,value] of Object.entries(saved.local)){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}if(saved.settings===null)sessionStorage.removeItem('opstwins-settings-study-v1');else sessionStorage.setItem('opstwins-settings-study-v1',saved.settings);},originalStorage);
 await page.cdp('Emulation.clearDeviceMetricsOverride');await page.reload();
}
const files=sources;const hashes={};for(const file of files)hashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(base,file))).digest('hex');
checks.push({name:'source stayed unchanged during acceptance',status:JSON.stringify(hashes)===JSON.stringify(loadedHashes)?'PASS':'FAIL'});
const report={capturedAt:new Date().toISOString(),spaceId:task.spaceId,scope:'HTML preview only; no business writes, TCC grants, external sends or private text in report',checks,hashes,screenshots:['file-access.png','settings-light.png','settings-dark.png','settings-mobile.png'],nativePermissions:'NOT_RUN',businessEnforcement:'NOT_RUN'};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log({artifact:path.join(out,'result.json'),passed:checks.filter(x=>x.status==='PASS').length,failed:checks.filter(x=>x.status==='FAIL').length});if(checks.some(x=>x.status==='FAIL'))throw new Error('Acceptance failed; see result.json');
