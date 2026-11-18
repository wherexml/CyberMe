// ego-browser nodejs < scripts/local-skills-browser-e2e.mjs
// Start local-skills-http-e2e.mjs --serve first; synthetic data + controlled provider.
const task=await taskSpace('CyberMe 本机技能读取验收'),page=task.page('p1');
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/agent-local-skills-20261112',url='http://127.0.0.1:46921/cyberme.html';
const checks=[],check=(name,ok)=>{checks.push({name,pass:!!ok});if(!ok)throw Error(name)};
try{
 await page.goto(url);await page.waitForSelector('textarea');
 const c=await page.fetch('/api/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'本机技能验收'})});const conversation=typeof c.body==='string'?JSON.parse(c.body):c.body;
 await page.evaluate(id=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...s,conversationId:id}))},conversation.id);
 await page.reload();await page.waitForSelector('textarea');console.log(await page.snapshot());
 await page.fill('textarea','/sub2api 的 skills 你看看呢？');await page.click('button[aria-label="Send"]');
 await page.waitForFunction(()=>document.body.innerText.includes('已读取本机 sub2api 技能。'),undefined,{timeout:30000});
 check('screenshot request produces readable response',await page.evaluate(()=>document.body.innerText.includes('PUBLIC_LOCAL_SKILL_OK')));
 check('composer remains available',await page.evaluate(()=>!document.querySelector('textarea').disabled&&document.querySelector('textarea').value===''));
 const state=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));return s.requests.filter(r=>r.conversationId===s.conversationId)});
 await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('cyberme-v6-ui'));return s.requests.some(r=>r.conversationId===s.conversationId&&r.status==='succeeded')});
 check('request finishes with succeeded receipt',true);
 await page.screenshot({path:out+'/browser-skills.png'});
 await page.reload();await page.waitForFunction(()=>document.body.innerText.includes('PUBLIC_LOCAL_SKILL_OK'));
 check('refresh retains actual read answer',true);
 const runs=await page.fetch('/api/runs?limit=100'),body=typeof runs.body==='string'?JSON.parse(runs.body):runs.body,rows=Array.isArray(body)?body:body.items;
 const run=rows.find(r=>r.availableTools?.includes('read_local_skill')&&r.tools?.some(t=>t.name==='read_local_skill'));
 check('production run contains skill read evidence',!!run);
 check('skill discovery never creates command intent',!run.tools.some(t=>t.name==='command_started'));
 await fs.writeFile(out+'/browser-result.json',JSON.stringify({url,scope:'Built production V6 + actual HTTP/SDK/filesystem; controlled provider and synthetic skill; Chromium, not installed WebKit',checks},null,2));
 console.log({pass:true,checks:checks.length,url,screenshot:out+'/browser-skills.png'});
 await task.finish({keep:[]});
}catch(e){await fs.writeFile(out+'/browser-result.json',JSON.stringify({url,checks,error:e.message},null,2));throw e}
