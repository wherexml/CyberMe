const task=await taskSpace(process.env.EGO_SPACE_ID ? Number(process.env.EGO_SPACE_ID) : 'Verify removed manual makers'),page=task.page('p1');
const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/remove-manual-makers-20261002';
const results=[];
async function check(name,selector){
 await page.waitForSelector(selector);
 const state=await page.evaluate(selector=>({found:!!document.querySelector(selector),removed:[...document.querySelectorAll('button')].filter(b=>/生成文件|生成图表|Make a file|Make a chart|Generate a chart|Gen a pic/.test((b.getAttribute('aria-label')||'')+' '+b.textContent)).map(b=>b.outerHTML),panels:document.querySelectorAll('.op-file-maker,.maker-select,.op-maker-toggle').length,inputs:document.querySelectorAll(selector+' textarea').length,uploads:document.querySelectorAll(selector+' input[type=file]').length}),selector);
 results.push({name,pass:state.found&&state.removed.length===0&&state.panels===0&&state.inputs>0&&state.uploads>0,...state});
 await page.screenshot({path:out+'/'+name+'.png'});
 if(!results.at(-1).pass)throw new Error(name+' failed');
}
try{
 await page.cdp('Emulation.clearDeviceMetricsOverride');
 await page.goto('http://127.0.0.1:46100/chat');await check('chat-desktop','.chat-composer');
 await page.click('.twin-entry');await check('floating-desktop','.floating-twin');await page.click('.twin-entry');
 await page.goto('http://127.0.0.1:46100/deep-think');await check('deep-think','.op-deep-composer');
 await page.reload();await check('deep-think-reload','.op-deep-composer');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await check('deep-think-mobile','.op-deep-composer');
 await page.goto('http://127.0.0.1:46100/chat');await check('chat-mobile','.chat-composer');await page.keyboard.press('Meta+k');await check('floating-mobile','.floating-twin');
 await page.cdp('Emulation.clearDeviceMetricsOverride');
}finally{await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(results);await task.finish({keep:[]});
