// Run after the main browser journey, in the same TaskSpace and synthetic fixture.
const task=await taskSpace('CyberMe 记忆资料库设计'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/memory-library-20261106',base='http://127.0.0.1:46870';
const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const control=async v=>{const r=await fetch(base+'/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});if(!r.ok)throw Error('control')};
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
try{
 await control({document:'',holds:{memory:true,soul:true,automatic:true,people:true}});await page.reload();await page.waitForSelector('[data-memory-loading="memory"]');
 check('cold read has no false empty summary',!await page.evaluate(()=>!!document.querySelector('.mem-summary-empty')));
 check('creation disabled until personal document loads',await page.evaluate(()=>document.querySelector('.mem-add').disabled));
 await control({holds:{memory:false,soul:false,automatic:false,people:false},release:true});await page.waitForSelector('.mem-overview');
 check('automatic-only memory appears in overview',await page.evaluate(()=>document.querySelector('.mem-summary')?.textContent.includes('我长期偏好用折线图')));
 await control({document:'## 工作\n- 原有工作内容。'});await focus();await page.waitForSelector('[data-memory-folder="section:0"]');
 await page.click('[data-memory-folder="section:0"]');await page.click('[data-memory-page] .cm-row');await control({failures:{memory:503}});
 await page.fill('[data-memory-page] textarea','## 工作\n- 保留在当前资料夹的修订。');await page.waitForFunction(()=>document.querySelector('[data-memory-page]').textContent.includes('保存失败'));
 await control({document:'## 前置新增\n- 不能误显示这条。\n\n## 工作\n- 远端内容。',failures:{memory:0}});await focus();
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>document.querySelector('[data-memory-page]').textContent.includes('重新载入'));
 await page.click('[data-memory-page] button:text-is("重新载入")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page]').textContent.includes('重新载入'));
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));
 check('reconciled editor stays in the reanchored folder',await page.evaluate(()=>document.querySelector('[data-memory-page]').dataset.memoryView==='section:1'&&document.querySelector('[data-memory-page]').textContent.includes('保留在当前资料夹的修订')&&!document.querySelector('[data-memory-page]').textContent.includes('不能误显示')));
 await page.click('.mem-breadcrumb');
 await control({failures:{memory:503}});await focus();await page.waitForSelector('[data-memory-error="memory"]');
 check('failed personal refresh retains last successful folders',await page.evaluate(()=>!!document.querySelector('[data-memory-folder="section:1"]')));
 await control({failures:{memory:0}});await page.click('[data-memory-error="memory"] button');await page.waitForFunction(()=>!document.querySelector('[data-memory-error="memory"]'));
 check('personal refresh retry recovers',true);
 console.log({passed:checks.length});
}finally{await fs.writeFile(out+'/recovery-checks.json',JSON.stringify({checks},null,2));}
