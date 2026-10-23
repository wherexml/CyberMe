// Fault injection affects only this public fixture tab; real UI actions and HTTP remain in use.
const p=(await taskSpace(9)).page('p1'),fs=await import('node:fs/promises'),checks=[];
const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
await p.reload();await p.waitForFunction(()=>window.OpsTwinsDesktop?.v17&&!document.querySelector('#desktop-boot'));await p.click('button[aria-label="灵感"]');
const before=JSON.parse((await p.fetch('/evidence')).body).posts;
await p.evaluate(()=>{const set=Storage.prototype.setItem;window.restoreStorage=()=>Storage.prototype.setItem=set;Storage.prototype.setItem=function(k,v){if(k==='opstwins-idea-discussions-v1')throw Error('公开保存失败');return set.call(this,k,v)}});
await p.click('button[aria-label="深入聊聊：公开建议 6"]');
check('storage failure keeps Ideas and sends nothing',await p.evaluate(()=>document.querySelector('#view-ideas').classList.contains('active')&&!JSON.parse(localStorage.getItem('opstwins-idea-discussions-v1'))['public-idea-6']));await p.evaluate(()=>window.restoreStorage());
await p.evaluate(()=>{const D=window.OpsTwinsDesktop,create=D.createSession;window.restoreCreate=()=>D.createSession=create;D.createSession=async(...args)=>{await new Promise(resolve=>window.releaseCreate=resolve);return create(...args)}});
await p.click('button[aria-label="深入聊聊：公开建议 6"]');await p.waitForFunction(()=>typeof window.releaseCreate==='function');await p.click('button[aria-label="任务"]');
await p.evaluate(()=>{window.releaseCreate();window.restoreCreate()});
await p.waitForFunction(()=>window.OPSTWINS_DESIGN_DATA.conversations.some(x=>x.title==='公开建议 6'));
check('late session creation does not steal navigation',await p.evaluate(()=>document.querySelector('#view-tasks').classList.contains('active')));
await p.click('button[aria-label="灵感"]');await p.click('button[aria-label="深入聊聊：公开建议 6"]');await p.waitForFunction(()=>document.querySelector('#input').value.includes('公开建议 6'));
check('reentry uses original side session and fills draft',await p.evaluate(()=>window.OPSTWINS_DESIGN_DATA.conversations.filter(x=>x.title==='公开建议 6').length===1));
check('all recovery operations produce zero Chat posts',JSON.parse((await p.fetch('/evidence')).body).posts===before);
await fs.writeFile('/Users/steve/Projects/opstwin-advance/output/idea-discussion-20261023/recovery.json',JSON.stringify({checks},null,2));console.log(checks);
