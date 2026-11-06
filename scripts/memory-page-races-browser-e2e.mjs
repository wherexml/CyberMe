// Run after memory-page-browser-e2e in the same Ego TaskSpace, with the same fixture.
const task=await taskSpace('CyberMe 记忆读取与语义验证'),page=task.page('p1');
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/memory-upgrade-20261105',base='http://127.0.0.1:46826';
const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const control=async v=>{await fetch(base+'/__memory/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)})};
const idle=()=>page.waitForFunction(()=>document.querySelector('[data-memory-page]')?.dataset.memoryRefreshing==='false',undefined,{timeout:15000});
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
try{
 await control({soul:'',document:'## 公开竞态笔记\n- 保存前旧值。',clearAutomatic:true,failures:{memory:0,soul:0,automatic:0,forget:0},holds:{memory:false,soul:false,automatic:false,forget:false},release:true});await focus();await idle();
 await control({holds:{memory:true}});await focus();await page.waitForFunction(async()=> (await (await fetch('/__memory/status')).json()).pending.includes('memory'));
 await page.click('[data-memory-page] .cm-row');await page.fill('[data-memory-page] textarea','## 公开竞态笔记\n- 保存后新值。');
 // The fixture holds GET only; PATCH commits and acknowledges normally.
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));
 await control({holds:{memory:false},release:true});await idle();
 await page.click('text="任务"');await page.click('text="记忆"');await idle();
 check('old GET cannot overwrite saved document or remount cache',await page.evaluate(()=>document.querySelector('[data-memory-page]').textContent.includes('保存后新值')&&!document.querySelector('[data-memory-page]').textContent.includes('保存前旧值')));
 // Cold-read one resource failure does not hide successful siblings or masquerade as empty.
 await control({failures:{automatic:503}});await page.reload();await page.waitForSelector('[data-memory-error="automatic"]');
 check('automatic load failure remains visible beside successful notes',await page.evaluate(()=>document.querySelector('[data-memory-page]').textContent.includes('保存后新值')&&!document.querySelector('[data-memory-page]').textContent.includes('还没有记住')));
 await control({failures:{automatic:0,memory:503}});await page.reload();await page.waitForSelector('[data-memory-error="memory"]');
 check('cold failed document cannot create a memory',await page.evaluate(()=>[...document.querySelectorAll('[data-memory-page] button')].find(b=>b.textContent.includes('新建记忆'))?.disabled));
 await control({failures:{memory:0}});await focus();await idle();
 // Persisted failed editor needs its document after a full reload, without silently changing its lease.
 await control({failures:{memory:503}});await page.click('[data-memory-page] .cm-row');await page.fill('[data-memory-page] textarea','## 公开竞态笔记\n- 公开待恢复输入。');
 await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>document.querySelector('[data-memory-page]').textContent.includes('保存失败'));
 await page.reload();await page.waitForSelector('[data-memory-page] textarea');
 check('failed editor text survives full reload',await page.evaluate(()=>document.querySelector('[data-memory-page] textarea').value.includes('公开待恢复输入')));
 await control({failures:{memory:0}});await focus();await idle();await page.click('[data-memory-page] button:text-is("完成")');await page.waitForFunction(()=>!document.querySelector('[data-memory-page] textarea'));
 check('restored editor can save after its document recovers',(await (await fetch(base+'/api/settings/documents/memory')).json()).content.includes('公开待恢复输入'));
 await fs.writeFile(out+'/browser-races-result.json',JSON.stringify({status:'PASS',checks},null,2));console.log({status:'PASS',checks:checks.length});
}catch(e){await fs.writeFile(out+'/browser-races-result.json',JSON.stringify({status:'FAIL',checks,error:String(e)},null,2));console.log(await page.snapshot());throw e}
