// Start a fresh isolated service first. Uses only public fixture data.
const fs=await import('node:fs/promises'),root='/Users/steve/Projects/opstwin-advance',out=root+'/output/idea-discussion-20261023';
const t=await taskSpace('CyberMe 灵感草稿 20261023'),p=t.page('p1'),checks=[];
await fs.mkdir(out,{recursive:true});
const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
const evidence=async()=>JSON.parse((await p.fetch('/evidence')).body);
try{
 await p.goto('http://127.0.0.1:46672/desktop.html');await p.waitForFunction(()=>window.OpsTwinsDesktop?.v17&&!document.querySelector('#desktop-boot'));
 await p.fill('textarea[placeholder="输入消息…"]','原主会话草稿');await p.click('button[aria-label="灵感"]');
 await p.waitForFunction(()=>document.querySelectorAll('.idea-artwork').length===8&&[...document.querySelectorAll('.idea-artwork')].every(x=>x.complete&&x.naturalWidth>0));
 const icons=await p.evaluate(()=>[...document.querySelectorAll('.idea-artwork')].map(x=>x.dataset.iconKey));
 check('all eight illustrations loaded and varied',new Set(icons).size>=4);await fs.writeFile(out+'/icons.snapshot.txt',await p.snapshot());
 const baseline=await evidence();
 await p.click('button[aria-label="深入聊聊：公开建议 7"]');await p.waitForFunction(()=>document.querySelector('#input').value.includes('确认下一步'));
 const initial=await p.evaluate(()=>({id:window.OpsTwinsChatSessions.selected(),draft:document.querySelector('#input').value,main:window.OpsTwinsChatSessions.main()}));
 check('editable title description and steps',initial.draft.includes('公开建议 7')&&initial.draft.includes('先核对方案')&&initial.draft.includes('1. 核对资料'));
 check('click invokes neither Chat nor model',(await evidence()).posts===baseline.posts&&(await evidence()).calls===baseline.calls);
 await p.fill('#input',initial.draft+'\n\n我补充：先讨论风险，不执行。');
 await p.reload();await p.waitForFunction(()=>window.OpsTwinsDesktop?.v17&&!document.querySelector('#desktop-boot'));
 check('refresh restores edited draft',await p.evaluate(()=>document.querySelector('#input').value.endsWith('我补充：先讨论风险，不执行。')));
 await p.click('button[aria-label="灵感"]');
 check('icons stable across reload',JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('.idea-artwork')].map(x=>x.dataset.iconKey)))===JSON.stringify(icons));
 await p.click('button[aria-label="深入聊聊：公开建议 7"]');await p.waitForFunction(()=>document.querySelector('#view-chat').classList.contains('active'));
 check('same suggestion reuses session and preserves edits',await p.evaluate(id=>window.OpsTwinsChatSessions.selected()===id&&document.querySelector('#input').value.endsWith('我补充：先讨论风险，不执行。')&&document.querySelector('#input').value.split('公开建议 7').length===2,initial.id));
 check('original main draft preserved',await p.evaluate(id=>JSON.parse(localStorage.getItem('opstwins-design-sessions-v1')).drafts[id]==='原主会话草稿',initial.main));
 check('refresh and repeated click still zero sends',(await evidence()).posts===baseline.posts);
 await fs.writeFile(out+'/editable-draft.snapshot.txt',await p.snapshot());
 await p.click('button[aria-label="发送消息"]');await p.waitForFunction(async()=>(await(await fetch('/evidence')).json()).posts>0);
 const sent=(await evidence()).submissions.at(-1);
 check('explicit send contains edited text',sent.message.endsWith('我补充：先讨论风险，不执行。'));
 check('explicit send retains exact sources and discussion permission',JSON.stringify(sent.contextIds)===JSON.stringify(['public-note','public-source'])&&sent.readOnly===true&&sent.preservePrimary===true);
 await p.waitForFunction(()=>window.OpsTwinsDesignChat.entries().some(r=>r.status==='succeeded'));
 const after=await evidence();await p.reload();await p.waitForFunction(()=>window.OpsTwinsDesktop?.v17&&!document.querySelector('#desktop-boot'));
 check('sent request is not replayed on reload',(await evidence()).posts===after.posts);
}catch(e){checks.push({name:String(e),pass:false})}
await fs.writeFile(out+'/browser.json',JSON.stringify({scope:'Product HTML + production HTTP; controlled local model; installed App NOT_RUN',checks},null,2));console.log(checks);if(checks.some(x=>!x.pass))throw Error('Browser acceptance failed');
