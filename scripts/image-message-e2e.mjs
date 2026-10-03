// Run: ego-browser nodejs < scripts/image-message-e2e.mjs
const shared=process.env.EGO_TASK_SPACE;
const task=await taskSpace(shared?Number(shared):'Image message regression');const page=task.page('p1');
await page.goto('http://127.0.0.1:46100/inbox');await page.waitForSelector('.op-message-row');
const index=await page.evaluate(()=>[...document.querySelectorAll('.op-message-row')].findIndex(e=>e.getAttribute('aria-label')?.includes('张普竣')&&e.querySelector('.op-message-excerpt')?.textContent?.includes('[image]')));
if(index<0)throw new Error('Image message fixture missing');
await page.click(`.op-message-row >> nth=${index}`);await page.waitForSelector('.op-message-attachment img');
await page.waitForFunction(()=>[...document.querySelectorAll('.op-message-attachment img')].some(i=>i.complete&&i.naturalWidth>0));
const result=await page.evaluate(()=>{const image=document.querySelector('.op-message-attachment img');const card=image.closest('.op-message-attachment');const msg=card.closest('.op-source-message');return {url:location.href,imageLoaded:image.complete&&image.naturalWidth>0,noPlaceholder:![...msg.querySelectorAll('.op-source-bubble')].some(e=>/^\[image\]$/i.test(e.textContent.trim())),noFilename:card.innerText.trim()==='',noSize:!card.querySelector('small'),imageLink:!!image.closest('a[href]')};});
await page.evaluate(()=>document.querySelector('.op-message-attachment img').scrollIntoView({block:'center'}));
await page.screenshot({path:'/Users/steve/Projects/opstwin-advance/output/image-message-20261003/after.png'});
await(await import('node:fs/promises')).writeFile('/Users/steve/Projects/opstwin-advance/output/image-message-20261003/browser.json',JSON.stringify(result,null,2));console.log(result);
if(!shared)await task.finish({keep:[]});
if(Object.values(result).some(v=>v===false))throw new Error('Image presentation failed');
