// Build .local/chat-order-v6-web; start scripts/chat-order-v6-fixture.mjs.
// ego-browser nodejs < scripts/chat-order-v6-browser-e2e.mjs
const task=await taskSpace('CyberMe V6 历史消息顺序 20261108'),page=task.page('p1');
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/chat-order-v6-20261108';await fs.mkdir(out,{recursive:true});
const checks=[],url='http://127.0.0.1:46818',phase='initial';
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const ids=()=>page.evaluate(()=>[...document.querySelectorAll('[data-mid]')].map(x=>x.dataset.mid));
const expected=['idless','old-failure','u-failure','u-partial','u-success','a-success','same-time-first','u-second','a-second','tie-history','same-text'];
const verify=async name=>{const got=(await ids()).filter(x=>x!=='older-only'&&!x.startsWith('u-cyberme-')&&!x.startsWith('a-cyberme-'));check(name,JSON.stringify(got)===JSON.stringify(expected));};
try{
 await page.goto(url);await page.waitForSelector('textarea');
 if(phase==='initial'){
  await page.evaluate(async()=>{const records=await(await fetch('/fixture/seed')).json();const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui')||'{}');localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,requests:records,panel:false,conversationId:'primary'}))});
 }
 await page.reload();await page.waitForSelector('[data-mid="a-success"]');
 await verify(phase+' merges old failures with canonical history');
 check('runId links partial without duplicate local bubble',!(await ids()).includes('saved-partial'));
 check('same content with different request IDs remains twice',(await page.evaluate(()=>[...document.querySelectorAll('[data-mid]')].filter(x=>x.textContent.includes('same-time-first')).length))===2);
 check('partial has no retry button',await page.evaluate(()=>{const p=document.querySelector('[data-mid="u-partial"]');return p&&!p.nextElementSibling.textContent.includes('重试')}));
 const before=(await page.evaluate(async()=>await(await fetch('/fixture/evidence')).json())).posts.length;
 if(phase==='initial'){
  await page.fill('textarea','新消息排序验收');await page.press('textarea','Enter');
  await page.waitForFunction(async n=>(await(await fetch('/fixture/evidence')).json()).posts.length===n,before+1);
  const e=await page.evaluate(async()=>await(await fetch('/fixture/evidence')).json());
  await page.waitForSelector('[data-mid="a-'+e.posts.at(-1)+'"]');
  await verify('new successful reply leaves old failures at original positions');
  check('new send exactly one POST',e.posts.length===before+1);
  check('new turn is the last user and assistant pair',JSON.stringify((await ids()).slice(-2))===JSON.stringify(['u-'+e.posts.at(-1),'a-'+e.posts.at(-1)]));
 }
 await page.reload();await page.waitForSelector('[data-mid="a-success"]');await verify('reload preserves order');
 check('reload does not replay old failed or partial requests',(await page.evaluate(async()=>await(await fetch('/fixture/evidence')).json())).posts.length===before+(phase==='initial'?1:0));
 await page.evaluate(()=>{const sc=document.querySelector('.cm-chat-scroll');sc.scrollTop=0;sc.dispatchEvent(new Event('scroll',{bubbles:true}))});await page.waitForSelector('[data-mid="older-only"]');await verify('pagination preserves receipt positions');
 await page.evaluate(()=>{document.querySelector('.cm-chat-scroll').scrollTop=0});
 await page.screenshot({path:out+'/'+phase+'-ordered.png'});
 await page.evaluate(()=>{const sc=document.querySelector('.cm-chat-scroll');sc.scrollTop=sc.scrollHeight});
 await page.screenshot({path:out+'/'+phase+'-latest.png'});
 await fs.writeFile(out+'/'+phase+'-dom.json',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-mid]')].map(x=>({id:x.dataset.mid,text:x.textContent}))),null,2));
 await page.evaluate(()=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,conversationId:'side'}))});await page.reload();await page.waitForSelector('[data-mid="side-only"]');
 check('side conversation excludes primary and id-less receipts',JSON.stringify(await ids())===JSON.stringify(['side-only']));
 await page.evaluate(()=>{const ui=JSON.parse(localStorage.getItem('cyberme-v6-ui'));localStorage.setItem('cyberme-v6-ui',JSON.stringify({...ui,conversationId:'primary'}))});await page.reload();await page.waitForSelector('[data-mid="a-success"]');await verify('return to primary restores exact order');
 console.log({pass:true,checks:checks.length,url,out,spaceId:task.spaceId});
}finally{await fs.writeFile(out+'/'+phase+'-result.json',JSON.stringify({url,phase,checks},null,2))}
// Leave task active for the same-space restart phase; finish once after that phase.
