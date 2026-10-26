// Run: ego-browser nodejs < scripts/chat-work-browser-e2e.mjs
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=root+'/output/chat-work-real-20261023/browser-'+Date.now();await fs.mkdir(out,{recursive:true});
const t=await taskSpace(8),p=t.page('p1'),checks=[];
function check(name,ok){if(!ok)throw Error(name);checks.push({name,status:'PASS'});console.log(name)}
try{
 if(!await p.evaluate(()=>!!document.querySelector('[aria-label="新建侧会话"]')?.getClientRects().length))await p.click('button:text-is("会话")');
 await p.click('[aria-label="新建侧会话"]');await p.waitForFunction(()=>window.OpsTwinsChatSessions.selected()!=='chat-work-public-primary');
 const cid=await p.evaluate(()=>window.OpsTwinsChatSessions.selected());await fs.writeFile(out+'/conversation.json',JSON.stringify({conversationId:cid}));
 await p.click('#chat-work-source-button');await p.waitForSelector('.chat-work-picker input[type=checkbox]');
 await p.click('.chat-work-picker label:has-text("评审方案")');await p.click('.chat-work-picker label:has-text("评审讨论")');await p.click('#detail-dialog button:text-is("完成")');
 check('Two actual saved source notes can be selected',await p.evaluate(()=>document.querySelectorAll('#chat-work-sources .remove').length===2));
 await p.reload();await p.waitForSelector('#chat-work-sources .remove');check('Unsent source selection survives refresh',await p.evaluate(()=>document.querySelectorAll('#chat-work-sources .remove').length===2));
 await p.fill('#input','请对比这两份公开评审资料，给我不同的整理方向。选定后创建整理任务并生成一份 Markdown 评审文档，保留待确认事项，不编造时间和主持人。');await p.click('#send');
 await p.waitForSelector('.work-choice-pick:not(:disabled)',{state:'visible',timeout:120000});
 const projection=(await p.fetch('/api/chat/work/conversations/'+encodeURIComponent(cid))).body;const state=typeof projection==='string'?JSON.parse(projection):projection;
 const panel=state.panels.find(x=>x.status==='ready');check('Browser renders choices from the real model and Jev',panel?.jev?.status==='succeeded'&&panel.options.length>=2);
 await fs.writeFile(out+'/choices.snapshot.txt',await p.snapshot());
 await p.click('.work-choice-pick:not(:disabled) >> nth=0');await p.waitForSelector('.work-artifact',{state:'visible',timeout:120000});
 const data=(await p.fetch('/api/chat/work/conversations/'+encodeURIComponent(cid))).body;const final=typeof data==='string'?JSON.parse(data):data,w=final.works.find(x=>x.status==='succeeded');check('Selecting a direction produces a completed task and verified file',w?.artifacts?.[0]?.verified===true);
 const downloadPromise=p.waitForEvent('download',{timeout:30000});await p.click('.work-download');const download=await downloadPromise;await download.saveAs(out+'/downloaded.md');const bytes=await fs.readFile(out+'/downloaded.md');check('Browser download matches the registered file hash',crypto.createHash('sha256').update(bytes).digest('hex')===w.artifacts[0].sha256);check('Generated document has one title and retains public evidence',(bytes.toString().match(/^# /gm)||[]).length===1&&bytes.includes('MINT-7319'));
 await p.click('.work-artifact>button:first-child');await p.waitForSelector('#desktop-file-panel',{state:'visible'});check('Artifact opens in the existing preview',await p.evaluate(()=>document.querySelector('#desktop-file-panel').textContent.includes('待确认')));
 await p.reload();await p.waitForSelector('.work-artifact',{state:'visible'});const afterRaw=(await p.fetch('/api/chat/work/conversations/'+encodeURIComponent(cid))).body,after=typeof afterRaw==='string'?JSON.parse(afterRaw):afterRaw;check('Refresh preserves exactly the same task and artifact',after.works.length===1&&after.works[0].task.id===w.task.id&&after.works[0].artifacts[0].id===w.artifacts[0].id);
 const roles=await p.evaluate(()=>[...document.querySelectorAll('#messages>.message')].map(x=>x.classList.contains('user')?'user':'assistant'));check('Canonical user turns precede their result cards',roles.join(',')==='user,assistant,user,assistant');check('Consumed options cannot be clicked again',await p.evaluate(()=>[...document.querySelectorAll('.work-choice-pick')].every(x=>x.disabled)));
 await fs.writeFile(out+'/final.snapshot.txt',await p.snapshot());await fs.writeFile(out+'/work.json',JSON.stringify(w,null,2));
}catch(e){checks.push({name:'Browser journey',status:'FAIL',error:e.message});await fs.writeFile(out+'/failure.snapshot.txt',await p.snapshot());console.error(e.message);process.exitCode=1;}
await fs.writeFile(out+'/result.json',JSON.stringify({checks},null,2));console.log(out);
