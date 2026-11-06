// Run with ego-browser nodejs < scripts/window-task-browser-e2e.mjs against attention-browser-fixture on 46851.
const fs=await import('node:fs/promises'),out=process.cwd()+'/.local/acceptance/window-task-fix-20261106';
const t=await taskSpace('CyberMe 窗口与直接创建验收'),p=t.page('p1'),checks=[];
const check=(name,pass,detail)=>{checks.push({name,pass,detail});if(!pass)throw Error(name)};
try{
 await p.reload();await p.waitForSelector('[data-idea="idea-old"]');
 const visible=await p.evaluate(()=>{const a=document.getAnimations().filter(a=>['cmIn','cmRise','cmSlide','cmPop'].includes(a.animationName));for(const x of a){x.pause();x.currentTime=0}return a.map(x=>({name:x.animationName,opacity:getComputedStyle(x.effect.target).opacity}))});
 check('content remains visible with entry animations paused at first frame',visible.length>0&&visible.every(x=>Number(x.opacity)===1),visible);
 await p.fill('textarea','保留未发送草稿');
 const before=await p.evaluate(async()=>{const r=await(await fetch('/api/bootstrap')).json();return {tasks:r.tasks.length,messages:r.messages.length}});
 await p.evaluate(()=>{const b=document.querySelector('[data-idea="idea-old"] [data-action="create_task"]');b.click();b.click()});await p.waitForFunction(()=>!document.querySelector('[data-idea="idea-old"]'));
 const after=await p.evaluate(async()=>{const r=await(await fetch('/api/bootstrap')).json();return {tasks:r.tasks.length,messages:r.messages.length,draft:document.querySelector('textarea').value,created:r.tasks.filter(t=>t.ideaId==='idea-old'&&t.attentionKey)}});
 check('one direct task after double click',after.tasks===before.tasks+1&&after.created.length===1);
 check('no chat submission and draft preserved',after.messages===before.messages&&after.draft==='保留未发送草稿');
 await p.reload();await p.waitForSelector('textarea');
 check('task survives refresh',await p.evaluate(async()=>{const r=await(await fetch('/api/bootstrap')).json();return r.tasks.filter(t=>t.ideaId==='idea-old'&&t.attentionKey).length===1}));
 await p.screenshot({path:out+'/direct-task.png'});
}finally{await fs.writeFile(out+'/browser.json',JSON.stringify({checks},null,2));console.log(checks)}
