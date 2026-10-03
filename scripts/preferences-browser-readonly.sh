#!/bin/sh
exec /Users/steve/.local/bin/ego-browser nodejs <<'JS'
const task=await taskSpace(47);const page=task.page('p2');
await page.goto('http://127.0.0.1:46100/settings/general');
console.log('GENERAL');console.log(await page.snapshot());
await page.goto('http://127.0.0.1:46100/settings/identity');
await page.waitForFunction(()=>document.body.innerText.includes('memory.md')&&document.body.innerText.includes('soul.md'),undefined,{timeout:10000});
console.log('IDENTITY');console.log((await page.snapshot({scope:'full_page'})).split('\n').filter(l=>/soul.md|memory.md|中文沟通|saved records|communication preferences|Written by you|保存的知识/.test(l)).join('\n'));
await page.goto('http://127.0.0.1:46100/chat');
await page.waitForFunction(()=>document.body.innerText.includes('已记住：之后用中文和你沟通。'),undefined,{timeout:10000});
console.log('CHAT latest confirmations');console.log((await page.snapshot({scope:'full_page'})).split('\n').filter(l=>/使用中文和我沟通啊|已记住：之后用中文和你沟通。|中文沟通|Your twin/.test(l)).join('\n'));
JS
