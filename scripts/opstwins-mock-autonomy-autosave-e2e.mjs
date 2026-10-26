// Historical v16 coverage includes quiet times removed in v17; current delta: opstwins-mock-knowledge-paths-e2e.mjs.
// Run with ego-browser nodejs. No model, executor or external permission writes.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-autonomy-autosave-20261017/'+Date.now();await fs.mkdir(out,{recursive:true});
const t=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins autonomy immediate save'),p=t.page('p1'),key='opstwins-product-mock-v1',results=[];let original,backed=false,tick=0;
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
const state=()=>p.evaluate(()=>window.OpsTwinsMock.getState()),click=a=>p.click(`[data-action="${a}"]`);
async function go(route='settings/autonomy'){await p.goto('http://127.0.0.1:46400/?v=16&e2e='+(++tick)+'-'+Date.now()+'#'+route);await p.waitForSelector('#workspace')}
async function choose(name,value){const c=await p.evaluate(({name,value})=>{const s=document.querySelector(`select[name="${name}"]`);return {id:s.dataset.selectNative,index:[...s.options].findIndex(o=>o.value===value)}},{name,value});await p.click(`[data-vm-id="${c.id}"]`);await p.click(`#vm-select-menu [data-vm-option="${c.index}"]`)}
async function shot(name){await p.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await p.snapshot())}
try{
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1239,height:961,deviceScaleFactor:1,mobile:false});await go();original=await p.evaluate(k=>localStorage.getItem(k),key);backed=true;
 await p.evaluate(async k=>{const{initial}=await import('./data.js');localStorage.setItem(k,JSON.stringify({version:1,data:structuredClone(initial)}))},key);await go();
 check('自主权限无取消或保存操作栏',await p.evaluate(()=>!document.querySelector('form[data-kind=autonomy] .form-actions')&&!document.querySelector('form[data-kind=autonomy] button[type=submit]')));
 const before=(await state()).autonomy;await p.click('label.switch:has(input[name=hold])');check('暂停发送立即保存',(await state()).autonomy.hold===!before.hold);
 for(const [name,value]of [['reply','read'],['tasks','auto'],['files','read'],['calendar','auto'],['connections','confirm'],['deep','read']]){await choose(name,value);check(name+'立即保存',(await state()).autonomy[name]===value)}
 for(const name of ['notify','disclose']){await p.click(`label.switch:has(input[name="${name}"])`);check(name+'布尔值即时保存',(await state()).autonomy[name]===!before[name])}
 for(const[name,value]of [['quietStart','22:30'],['quietEnd','06:45']]){await p.fill(`[name="${name}"]`,value);await p.press(`[name="${name}"]`,'Tab');check(name+'时间保存',(await state()).autonomy[name]===value)}
 const saved=(await state()).autonomy;await go();check('全部设置刷新恢复',JSON.stringify((await state()).autonomy)===JSON.stringify(saved));
 await p.evaluate(()=>document.querySelector('#settings-scroll').scrollTop=9999);await shot('autonomy-bottom');
 await p.evaluate(k=>{const set=Storage.prototype.setItem;window.__realSetItem=set;window.__failAutonomy=true;Storage.prototype.setItem=function(key,value){if(key===k&&window.__failAutonomy)throw new DOMException('public fixture quota failure','QuotaExceededError');return set.call(this,key,value)}},key);
 await choose('deep','auto');check('存储失败保留控件值但不冒充保存',await p.evaluate(()=>document.querySelector('[name=deep]').value==='auto'&&document.querySelector('.form-feedback').textContent.includes('保存失败'))&&(await state()).autonomy.deep==='read');
 check('存储中的原值未改变',await p.evaluate(k=>JSON.parse(localStorage.getItem(k)).data.autonomy.deep,key)==='read');
 await p.click('.settings-nav [data-action="setting:general"]');await p.click('.settings-nav [data-action="setting:autonomy"]');check('失败后切页保留草稿与重试',await p.evaluate(()=>document.querySelector('[name=deep]').value==='auto'&&!!document.querySelector('[data-action=retry-autonomy-save]')));await p.evaluate(()=>document.querySelector('#settings-scroll').scrollTop=9999);await shot('save-failed');
 await p.evaluate(()=>window.__failAutonomy=false);await click('retry-autonomy-save');check('明确重试保存并清错误',(await state()).autonomy.deep==='auto'&&await p.evaluate(()=>document.querySelector('.form-feedback').textContent===''));
 await go();check('重试后刷新恢复',(await state()).autonomy.deep==='auto');
 await go('settings/provider-new');check('其他设置仍保留显式提交',await p.evaluate(()=>!!document.querySelector('#settings-form .form-actions button.primary')));
 await go();await p.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:850,deviceScaleFactor:1,mobile:false});await p.evaluate(()=>document.querySelector('#settings-scroll').scrollTop=9999);check('窄窗无横向溢出且底栏移除',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&!document.querySelector('form[data-kind=autonomy] .form-actions')));await shot('autonomy-bottom-660');
 const hashes={};for(const f of ['app.js','settings.js'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+f)).digest('hex');await fs.writeFile(out+'/result.json',JSON.stringify({scope:'public local Mock autonomy UI only',spaceId:t.spaceId,results,hashes},null,2));console.log({spaceId:t.spaceId,passed:results.length,out});
}catch(e){await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(e)},null,2));await shot('failure');throw e}
finally{if(backed){await p.evaluate(({key,original})=>{if(window.__realSetItem)Storage.prototype.setItem=window.__realSetItem;original===null?localStorage.removeItem(key):localStorage.setItem(key,original)},{key,original});const exact=await p.evaluate(k=>localStorage.getItem(k),key)===original;await fs.writeFile(out+'/restoration.json',JSON.stringify({exactMatch:exact}));if(!exact)throw Error('State restoration mismatch')}}
