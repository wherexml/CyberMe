// Run node scripts/conversation-memory-ui-service.mjs, then ego-browser nodejs < this file.
const fs=await import('node:fs/promises'),out='/Users/steve/Projects/opstwin-advance/output/conversation-memory-fix-20261019';
const t=await taskSpace('Memory summary recovery 20261019'),p=t.page('p1'),checks=[];
function check(name,pass){checks.push({name,pass});if(!pass)throw Error(name)}
await p.click('button[aria-label="查看记忆"]');await p.waitForSelector('#desktop-memory-dialog[open]');
check('three failures render one recovery entry',await p.evaluate(()=>document.querySelectorAll('.memory-row').length===1));
// Screenshot capture timed out on this browser; functional receipts remain repeatable.
await p.click('text="重试整理"');await p.waitForFunction(()=>document.querySelector('.memory-row button')?.disabled===true);
check('running disables repeated retries',JSON.parse((await p.fetch('/evidence')).body).posts===1);
await p.fetch('/finish',{method:'POST'});await p.click('text="刷新"');await p.waitForFunction(()=>document.querySelector('#desktop-memory-dialog').textContent.includes('公开摘要已恢复'));
check('recovered summary clears error rows and notice',await p.evaluate(()=>!document.querySelector('.memory-row')&&document.querySelector('#desktop-memory-notice').hidden));
console.log(await p.snapshot());
await p.press('#desktop-memory-dialog','Escape');check('escape closes dialog',await p.evaluate(()=>!document.querySelector('#desktop-memory-dialog').open));
await fs.writeFile(out+'/browser.json',JSON.stringify({scope:'production memory UI module, isolated public HTTP state; full native App NOT_RUN',checks},null,2));console.log(checks);await t.finish({keep:[]});
