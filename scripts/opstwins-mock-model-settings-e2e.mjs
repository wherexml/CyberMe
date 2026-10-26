const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/mock-model-settings-20261017/'+Date.now();await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPSTWIN_MOCK_SPACE||'OpsTwins model settings'),page=task.page('p1'),results=[];
const click=a=>page.click(`${a==='setting:models'?'.settings-nav ':''}[data-action="${a}"]`),state=()=>page.evaluate(()=>window.OpsTwinsMock.getState());
const check=(name,pass)=>{results.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
async function choose(selector,value){const c=await page.evaluate(({selector,value})=>{const s=document.querySelector(selector);return {id:s.dataset.selectNative,index:[...s.options].findIndex(o=>o.value===value)}},{selector,value});if(c.index<0)throw Error('Missing option '+value);await page.click(`[data-vm-id="${c.id}"]`);await page.click(`[data-vm-option="${c.index}"]`)}
const screenshot=async name=>{await page.screenshot({path:out+'/'+name+'.png'});await fs.writeFile(out+'/'+name+'.ax.txt',await page.snapshot())};
const idle=()=>page.waitForFunction(()=>document.querySelector('[data-probe-status]')?.dataset.probeStatus!=='running');
let original;
try{
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await page.goto('http://127.0.0.1:46400/?v=5#settings/models');await page.reload();await page.waitForSelector('[data-action=model-test]');
 original=await page.evaluate(()=>localStorage.getItem('opstwins-product-mock-v1'));
 check('初始选择无保存栏',await page.evaluate(()=>document.querySelector('form[data-kind=model] .form-actions').hidden));await screenshot('01-models');
 await click('model-test');check('测试先显示运行中',await page.evaluate(()=>document.querySelector('[data-probe-status]').dataset.probeStatus==='running'&&document.querySelector('[data-action=model-test]').disabled));await idle();
 check('正常反馈为带预览标识的成功',await page.evaluate(()=>document.querySelector('[data-probe-status=passed]')?.textContent.includes('预览')));await screenshot('02-test-success');
 await page.click('.probe-details summary');check('成功详情可展开',await page.evaluate(()=>document.querySelector('.probe-details').open));
 const base=await state(),baseId=base.model.providerId,baseModel=base.model.model;
 const alternate=base.modelProviders.find(p=>p.id===baseId).models.find(m=>m!==baseModel);
 await choose('select[name=model]',alternate);check('变更模型清旧结果并显示保存',await page.evaluate(()=>!document.querySelector('[data-probe-status]')&&!document.querySelector('form[data-kind=model] .form-actions').hidden));
 await click('scenario:error');check('场景重建保留未保存模型',await page.evaluate(v=>document.querySelector('select[name=model]').value===v,alternate));
 await click('model-test');await idle();check('失败不显示成功',await page.evaluate(()=>!!document.querySelector('[data-probe-status=failed]')));await page.click('.probe-details summary');await screenshot('03-test-failure');
 await click('scenario:unknown');await click('model-test');await idle();await click('model-test-lookup');check('未知只读查看原记录',await page.evaluate(()=>document.querySelector('.probe-lookup').textContent==='原记录仍未确认'));await screenshot('04-test-unknown');
 await click('scenario:partial');await click('model-test');await idle();check('中断保留部分反馈',await page.evaluate(()=>!!document.querySelector('[data-probe-status=partial]')));
 await click('scenario:loading');await click('model-test');await click('model-test-cancel');check('停止测试不显示成功',await page.evaluate(()=>!!document.querySelector('[data-probe-status=cancelled]')&&!document.querySelector('[data-action=model-test]').disabled));
 await click('scenario:normal');await click('model-test');await click('setting:general');await page.waitForFunction(()=>document.querySelector('.settings-content h1')?.textContent==='通用');await click('setting:models');check('离开后旧请求不污染返回页面',await page.evaluate(()=>!document.querySelector('[data-probe-status]')));
 await click('cancel-setting');await choose('select[name=model]',alternate);await page.click('#settings-form .primary');await page.reload();await page.waitForSelector('[data-action=model-test]');check('模型保存并刷新恢复',(await state()).model.model===alternate);
 await click('edit-provider:'+baseId);await screenshot('05-provider');
 await page.fill('[name=credential]','public-mock-key-do-not-persist');await click('provider-key-toggle');check('可显示RAM密钥',await page.evaluate(()=>document.querySelector('[name=credential]').type==='text'));
 await page.fill('[name=provider]',base.model.provider+' · 配置预览');await click('provider-fetch');await page.waitForFunction(()=>document.querySelector('#provider-fetch-feedback').textContent.includes('已获取'));
 check('模型获取独立且保留输入',await page.evaluate(()=>document.querySelector('[name=credential]').value==='public-mock-key-do-not-persist'&&document.querySelectorAll('.provider-model-item').length>=3));
 await page.fill('[aria-label="手动添加模型 ID"]','public-custom-model');await page.press('[aria-label="手动添加模型 ID"]','Enter');check('Enter仅添加模型不提交表单',await page.evaluate(()=>JSON.parse(document.querySelector('[name=models]').value).includes('public-custom-model')&&document.querySelector('[name=credential]').value==='public-mock-key-do-not-persist'));
 await click('provider-model-remove:public-custom-model');check('可移除模型',await page.evaluate(()=>!JSON.parse(document.querySelector('[name=models]').value).includes('public-custom-model')));
 await page.fill('[name=credential]','');await screenshot('06-provider-models');
 await page.fill('[name=credential]','public-mock-key-do-not-persist');await page.click('#settings-form .primary');await page.reload();await page.waitForSelector('.model-provider-page');
 check('供应商保存刷新精确恢复',(await state()).modelProviders.find(p=>p.id===baseId).provider.endsWith('配置预览'));
 check('显示后的密钥不落存储和刷新',await page.evaluate(()=>!localStorage.getItem('opstwins-product-mock-v1').includes('public-mock-key-do-not-persist')&&document.querySelector('[name=credential]').value===''));
 await page.fill('[name=provider]','取消的修改');await click('cancel-setting');check('取消回到已保存配置',await page.evaluate(()=>document.querySelector('[name=provider]').value.endsWith('配置预览')));
 await click('scenario:error');await page.fill('[name=endpoint]','https://failed.example.invalid/v1');await click('provider-fetch');await page.waitForFunction(()=>document.querySelector('#provider-fetch-feedback').textContent.includes('获取失败'));check('获取失败保留原模型列表',await page.evaluate(()=>document.querySelectorAll('.provider-model-item').length>=3));
 await page.click('#settings-form .primary');check('保存失败保留草稿',await page.evaluate(()=>document.querySelector('[name=endpoint]').value==='https://failed.example.invalid/v1'&&document.querySelector('.form-feedback').textContent.includes('输入已保留')));
 await click('scenario:normal');await click('cancel-setting');await click('setting:models');await click('setting:provider-new');await page.fill('[name=provider]','第二供应商 · 公开预览');await page.fill('[name=endpoint]','https://second.example.invalid/v1');await click('provider-fetch');await page.waitForFunction(()=>document.querySelector('#provider-fetch-feedback').textContent.includes('已获取'));await page.click('#settings-form .primary');
 check('新增供应商独立保存而不覆盖当前',(await state()).modelProviders.length===base.modelProviders.length+1&&(await state()).model.providerId===baseId);
 await click('setting:models');const added=(await state()).modelProviders.at(-1);await choose('select[name=providerId]',added.id);check('供应商切换联动模型列表',await page.evaluate(()=>document.querySelector('select[name=model]').options.length===3));
 await click('scenario:error');check('场景切换保留精确供应商草稿',await page.evaluate(id=>document.querySelector('select[name=providerId]').value===id,added.id));await click('scenario:normal');await page.click('#settings-form .primary');await page.reload();await page.waitForSelector('[data-action=model-test]');check('不同供应商选择刷新恢复',(await state()).model.providerId===added.id);
 await click('edit-provider:'+baseId);check('编辑精确供应商而非当前供应商',await page.evaluate(()=>document.querySelector('[name=provider]').value.endsWith('配置预览')));
 await page.fill('[name=endpoint]','https://draft-one.example.invalid/v1');await click('setting:models');await click('edit-provider:'+added.id);check('不同供应商草稿隔离',await page.evaluate(()=>document.querySelector('[name=endpoint]').value==='https://second.example.invalid/v1'));
 await click('setting:models');await click('edit-provider:'+baseId);check('返回原供应商保留其草稿',await page.evaluate(()=>document.querySelector('[name=endpoint]').value==='https://draft-one.example.invalid/v1'));
 await click('cancel-setting');await click('setting:models');await click('tweaks');await click('theme:dark');await click('close');await click('model-test');await idle();await screenshot('07-dark');check('深色成功反馈仍可读',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'&&!!document.querySelector('[data-probe-status=passed]')));
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:660,height:850,deviceScaleFactor:1,mobile:false});await screenshot('08-scaled');check('缩放无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}catch(error){results.push({name:'browser operation',status:'FAIL',error:String(error)});await fs.writeFile(out+'/failure.json',JSON.stringify({results,error:String(error)},null,2));await screenshot('failure');throw error}
finally{
 if(original!=null){await page.evaluate(value=>localStorage.setItem('opstwins-product-mock-v1',value),original);await page.goto('http://127.0.0.1:46400/?v=5#settings/models');await page.reload();await page.waitForSelector('[data-action=model-test]');check('运行前存储精确恢复',await page.evaluate(value=>localStorage.getItem('opstwins-product-mock-v1')===value,original))}
 const hashes={};for(const f of ['app.js','settings.js','model-settings.js','model-settings.css','index.html'])hashes[f]=crypto.createHash('sha256').update(await fs.readFile(root+'/mock/opstwins/'+f)).digest('hex');
 await fs.writeFile(out+'/result.json',JSON.stringify({taskSpace:task.spaceId,results,hashes,scope:'public mock only; original local state restored'},null,2));console.log({spaceId:task.spaceId,out,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length});
}
