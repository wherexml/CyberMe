// Requires the V6 build and scripts/v6-model-settings-fixture.mjs --empty.
const task=await taskSpace('CyberMe 模型设置验收'), page=task.page('p1');
const fs=await import('node:fs/promises');
const url='http://127.0.0.1:46981/cyberme.html';
const out='/Users/steve/Projects/cyberme/output/v6-model-settings';
const checks=[],screenshots=[];
const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name)};
const button=(name,partial=false)=>'loc=role:button[name'+(partial?'*=':'=')+JSON.stringify(name)+']';
const click=(name,partial=false)=>page.click(button(name,partial));
const wait=(s,timeout=8000)=>page.waitForFunction(text=>document.body.innerText.includes(text),s,{timeout});
const openModels=async()=>{await click('设置');await click('模型')};
const back=()=>page.click('button[aria-label="Back"]');
const fetchJSON=async(path,method='GET',data)=>{
 const r=await page.fetch(path,{method,...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
 return {status:r.status,value:typeof r.body==='string'?JSON.parse(r.body):r.body};
};
const fixture=data=>fetchJSON('/__fixture/switches','POST',data);
const read=async()=> (await fetchJSON('/api/settings/models')).value;
const screenshot=async(name)=>{
 await page.screenshot({path:out+'/'+name+'.png'});screenshots.push({path:out+'/'+name+'.png',url:await page.url()});
};
await fs.mkdir(out,{recursive:true});
try{
 await page.goto(url);
 await page.waitForSelector('textarea');
 check('model catalog is not fetched by workspace startup',(await fetchJSON('/__fixture/evidence')).value.catalogReads===0);
 await openModels();
 await wait('未选择');
 const empty=await read();
 check('fresh installation has a usable empty catalog',empty.providers?.length===0);
 await click('添加供应商');
 await page.fill('loc=role:textbox[name="名称"]','初次配置');
 await page.fill('loc=role:textbox[name="API 地址"]','http://127.0.0.1:46982');
 await page.fill('input[type=password]','synthetic-model-key-only');
 await click('手动添加');
 await page.fill('loc=role:textbox[name="模型 ID 1"]','public-first');
 await click('保存供应商');
 await wait('当前模型');
 const first=await read();
 check('first provider is saved without silently changing defaults',first.providers[0]?.models[0]==='public-first'&&!first.standard.model&&!first.deep.model);
 check('API does not return the saved key',!JSON.stringify(first).includes('synthetic-model-key-only'));
 await click('当前模型',true);
 await click('public-first',true);
 await click('保存');
 await wait('当前模型');
 const selectedFirst=await read();
 check('first model can be explicitly selected',selectedFirst.standard.model==='public-first'&&selectedFirst.deep.model==='public-first');

 await fixture({reseed:true,unavailable:true});
 await openModels();
 await wait('无法读取模型配置');
 check('HTTP load failure presents an explicit retry',await page.evaluate(()=>!![...document.querySelectorAll('button')].find(b=>b.innerText==='重试')));
 await fixture({unavailable:false,stall:true});
 await click('重试');
 await wait('正在读取模型');
 await wait('无法读取模型配置',14000);
 check('stalled read reaches a retryable timeout',true);
 await fixture({stall:false});
 await click('重试');
 await wait('示例网关 B');
 const legacy=await read();
 check('opening model settings does not rewrite differing legacy roles',legacy.standard.model==='public-chat'&&legacy.deep.model==='public-deep');
 check('existing and disabled providers are visible',await page.evaluate(()=>document.body.innerText.includes('停用示例网关')&&document.body.innerText.includes('已停用')));
 check('one model selection and one test action, with no duplicate role sections',await page.evaluate(()=>{
  const text=document.body.innerText;
  return text.split('当前模型').length===2&&text.split('测试连接').length===2&&!text.includes('模型与连接测试')&&!text.includes('自定义服务');
 }));
 await screenshot('models');
 await click('示例网关 A');
 await wait('模型目录');
 await click('public-chat');
 check('stored endpoint and model ID are editable, key input is blank',await page.evaluate(()=>{
  const form=document.querySelector('.cm-model-editor');
  return !!form.querySelector('input[type=url]').value&&form.querySelector('[aria-label="模型 ID 1"]').value==='public-chat'
   &&form.querySelector('input[type=password]').value===''&&form.querySelector('input[type=password]').placeholder==='••••••••';
 }));
 await screenshot('provider');
 await page.fill('loc=role:textbox[name="API 地址"]','http://127.0.0.1:46983');
 await click('保存供应商');
 await wait('请填写此地址和协议使用的 API 密钥');
 check('editing another endpoint cannot reuse a stored key', (await read()).version===legacy.version);
 await page.fill('loc=role:textbox[name="API 地址"]','http://127.0.0.1:46982/');
 await page.fill('loc=role:textbox[name="名称"]','已编辑网关 A');
 await page.click('text="模型参数"');
 check('legacy runtime model parameters are projected for editing',await page.evaluate(()=>document.querySelectorAll('input[type=number]')[1].value==='1024'));
 await page.fill('loc=role:spinbutton[name="最大输出 Token"]','1200');
 const b=legacy.providers.find(p=>p.id==='local-b');
 const providerPatch={id:b.id,name:b.name,baseUrl:b.baseUrl,api:b.api,enabled:b.enabled,definitions:b.definitions};
 const external=await fetchJSON('/api/settings/models/providers','PATCH',{version:legacy.version,provider:providerPatch});
 check('a concurrent provider update advances the lease',external.status===200&&external.value.version!==legacy.version);
 await click('保存供应商');
 await wait('模型配置已变更');
 check('save conflict retains the edited provider name',await page.evaluate(()=>document.querySelector('.cm-model-editor input').value==='已编辑网关 A'));
 await click('重新读取');
 await wait('已读取最新配置');
 await click('保存供应商');
 await wait('已编辑网关 A');
 const edited=await read();
 check('canonical edit preserves the credential and updates the model definition',edited.providers[0].configured&&edited.providers[0].definitions[0].maxTokens===1200);
 const stored=(await fetchJSON('/__fixture/evidence')).value;
 check('provider editing preserves unrelated configuration and private runtime options',stored.unrelatedPreserved&&stored.legacyOptionPreserved);

 await click('当前模型',true);
 await wait('public-deep');
 check('each enabled model occurs once and disabled models cannot be selected',await page.evaluate(()=>{
  const t=document.body.innerText;
  return t.split('public-deep').length===2&&t.split('public-chat').length===2&&!t.includes('public-off');
 }));
 await click('public-deep',true);
 check('selecting an option leaves stored roles until explicit save',(await read()).version===edited.version);
 await click('保存');
 await wait('当前模型');
 const selected=await read();
 check('explicit save switches both roles to the exact selected provider',selected.standard.providerId==='local-b'&&JSON.stringify(selected.standard)===JSON.stringify(selected.deep));
 await fixture({loseProbeResponse:true});
 await click('测试连接');
 await wait('正常',12000);
 const once=(await fetchJSON('/__fixture/evidence')).value;
 check('lost POST response recovered by the original receipt with one inference',once.posts.length===1&&once.calls.length===1
  &&once.calls[0].model==='public-deep'&&once.calls[0].authenticated&&once.calls[0].tools===0);
 await page.reload();
 await page.waitForSelector('textarea');
 await openModels();
 await wait('正常');
 check('refresh reads the previous receipt without another POST',(await fetchJSON('/__fixture/evidence')).value.posts.length===1);
 await fixture({failModel:true});
 await click('测试连接',true);
 await wait('供应商拒绝鉴权');
 check('provider auth error is actionable and upstream body is not rendered',await page.evaluate(()=>!document.body.innerText.includes('fixture private upstream response')));
 check('testing does not change model settings',(await read()).version===selected.version);
 await screenshot('test-failure');
 await back();
 await click('对话');
 await wait('示例深度历史');
 check('legacy modes are in the same list without type labels',await page.evaluate(()=>{
  const text=document.body.innerText;
  return text.includes('示例普通历史')&&!text.includes('侧边对话')&&!text.includes('深度思考')&&text.includes('新建会话');
 }));
 await page.click('css=div[role="button"]:has-text("示例深度历史")');
 await wait('旧会话的示例消息');
 check('legacy deep conversation opens its original messages',true);
 await click('新建会话');
 await page.waitForFunction(()=>!document.body.innerText.includes('旧会话的示例消息'));
 check('one new conversation entry creates a separate thread',await page.evaluate(()=>{
  const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui'));
  return ui.conversationId?.startsWith('ui-side-');
 }));
 console.log({spaceId:task.spaceId,checks:checks.length,url,screenshots});
}finally{
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({url,checks,screenshots},null,2));
}
