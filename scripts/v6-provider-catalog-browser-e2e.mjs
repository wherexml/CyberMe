// Use the ego-browser TaskSpace already started for this user task, or create it for a fresh reproduction.
const title='CyberMe 获取模型与批量测试';
const known=(await listTaskSpaces()).find(space=>space.name===title);
const task=known?.ownership==='user'?await claimTaskSpace(known.id):known?await taskSpace(known.id):await taskSpace(title);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
const fs=await import('node:fs/promises');
const base='http://127.0.0.1:46991',url=base+'/cyberme.html',route='/api/settings/models';
const out='/Users/steve/Projects/cyberme/output/v6-model-discovery';
const checks=[],screenshots=[];
const check=(name,ok)=>{checks.push({name,pass:!!ok});if(!ok)throw Error(name)};
const role=(type,name,partial=false)=>'loc=role:'+type+'[name'+(partial?'*=':'=')+JSON.stringify(name)+']';
const click=(name,partial=false)=>page.click(role('button',name,partial));
const select=id=>page.click(role('checkbox',id));
const fill=(name,text)=>page.fill(role('textbox',name),text);
const text=needle=>page.waitForFunction(value=>document.body.innerText.includes(value),needle,{timeout:10000});
const back=()=>page.click('button[aria-label="Back"]');
async function json(path,method='GET',data){
 const r=await page.fetch(path,{method,...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
 return typeof r.body==='string'?JSON.parse(r.body):r.body;
}
const control=data=>json('/__fixture/control','POST',data);
const settings=()=>json(route);
async function screenshot(name){
 const path=out+'/'+name+'.png';await page.screenshot({path});screenshots.push({path,url:await page.url()});
}
await fs.mkdir(out,{recursive:true});
try{
 await page.goto(url);
 await page.waitForSelector('textarea');
 await control({clear:true,catalogState:'default',losePost:false});
 await click('设置');await click('模型');
 await text('示例 Anthropic');
 const before=await settings();
 await click('示例 Anthropic');
 await text('获取模型');
 check('Compatibility is hidden for existing Anthropic suppliers',!await page.evaluate(()=>document.body.innerText.includes('兼容模式')));
 await click('获取模型');
 await text('public-claude-new');
 check('Already-added ID is excluded from selection',await page.evaluate(()=>!document.querySelector('.cm-model-pick-list').innerText.includes('saved-claude')));
 await select('public-claude-new');await click('添加所选',true);
 check('Fetched model waits for explicit Save', (await settings()).version===before.version);
 await click('批量测试');
 await page.waitForFunction(()=>document.querySelectorAll('.cm-model-outcome[data-status="succeeded"]').length===2,undefined,{timeout:10000});
 let e=await json('/__fixture/evidence');
 check('Test for the old provider uses its saved compatible transport',e.calls.filter(c=>c.kind==='test').length===2
  &&e.calls.filter(c=>c.kind==='test').every(c=>c.compatibility&&c.auth&&c.tiny));
 await back();await click('示例 Anthropic');
 await text('正常');
 check('Opening provider again reads the saved test receipt without resubmission',(await json('/__fixture/evidence')).posts.length===1);
 await fill('名称','示例 Anthropic');
 await click('保存供应商');await text('当前模型');
 check('Saving without the compatibility control preserves the legacy binding',(await json('/__fixture/evidence')).compatibilityPreserved);
 const original=await settings();

 await click('添加供应商');
 await text('获取模型');
 check('New provider opens without a blank manual ID field',await page.evaluate(()=>!document.querySelector('input[aria-label="模型 ID 1"]')));
 await fill('名称','示例代理');
 await fill('API 地址','http://127.0.0.1:46992/v1');
 await page.fill('input[type=password]','public-fixture-draft-key');
 await click('获取模型');await text('public-good');
 check('No keys or duplicated IDs are rendered as model options',await page.evaluate(()=>{
  const t=document.querySelector('.cm-model-pick-list').innerText;
  return t.split('public-good').length===2&&!t.includes('public-fixture')&&!t.includes('not a model id');
 }));
 await screenshot('fetch-models');
 for(const model of ['public-good','public-denied','public-empty'])await select(model);
 await click('添加所选',true);
 check('Only selected models join the draft',await page.evaluate(()=>document.querySelectorAll('.cm-model-row').length===3));
 await control({clear:true,losePost:true});
 await click('批量测试');
 await page.waitForFunction(()=>document.querySelectorAll('.cm-model-outcome[data-status="failed"]').length===2,undefined,{timeout:12000});
 check('Shows distinct statuses for success, auth failure and empty response',await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.cm-model-row')].map(x=>x.innerText);
  return rows.some(x=>x.includes('public-good')&&x.includes('正常'))
   &&rows.some(x=>x.includes('public-denied')&&x.includes('鉴权失败'))
   &&rows.some(x=>x.includes('public-empty')&&x.includes('响应为空'));
 }));
 e=await json('/__fixture/evidence');
 check('Lost POST response recovered through readback with one short request per model',e.posts.length===1&&e.calls.length===3&&e.calls.every(c=>c.tiny&&c.auth));
 check('Unsaved tests do not change configuration',(await settings()).version===original.version);
 await screenshot('batch-results');
 await click('保存供应商');await text('示例代理');
 const final=await settings(),entry=final.providers.find(p=>p.name==='示例代理');
 check('Save retains discovered parameters and exact chosen model IDs',entry.models.length===3&&entry.definitions.find(d=>d.id==='public-good').maxTokens===800);
 check('Saving another provider does not change current model roles',JSON.stringify(final.standard)===JSON.stringify(original.standard)&&JSON.stringify(final.deep)===JSON.stringify(original.deep));
 await click('示例代理');
 await control({catalogState:'unsupported'});
 await click('获取模型');await text('供应商未提供目录接口');
 check('Manual entry is offered after a missing upstream catalog',await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.innerText==='手动添加'&&!b.disabled)));
 await click('手动添加');
 await text('新模型');
 await fill('模型 ID 4','public-manual');
 await click('保存供应商');await text('当前模型');
 check('Fallback manual entry is saved',(await settings()).providers.find(p=>p.name==='示例代理').models.includes('public-manual'));
 await click('示例代理');
 await page.fill('input[type=password]','public-fixture-existing-key');
 await click('批量测试');
 await page.waitForFunction(()=>document.querySelectorAll('.cm-model-outcome[data-status="succeeded"]').length===2,undefined,{timeout:10000});
 await back();await click('示例代理');
 check('Results for a discarded credential draft are not reused on the saved provider',await page.evaluate(()=>!document.querySelector('.cm-model-outcome')));
 console.log({spaceId:task.spaceId,checks:checks.length,url,screenshots});
}catch(error){
 checks.push({name:'Execution error',pass:false,error:error.message});throw error;
}finally{
 await control({catalogState:'default'}).catch(()=>{});
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({url,checks,screenshots},null,2));
}
