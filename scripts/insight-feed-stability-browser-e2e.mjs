// Run against the production HTTP fixture on 46933 with ego-browser nodejs.
// Replace RUN_LABEL with "fixed" or "baseline" to keep both runs in one TaskSpace.
const run='RUN_LABEL';
const out='/Users/steve/Projects/cyberme/output/insight-feed-flicker-20261109';
const base='http://127.0.0.1:46933';
const fs=await import('node:fs/promises');
const task=await taskSpace('CyberMe 洞察流刷新稳定性'),page=task.page('p1');
console.log({space:task.spaceId,run});
const checks=[];
const check=(name,pass,detail)=>checks.push({name,pass,detail});
const fx=(name,body)=>fetch(base+'/__fixture/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:1320,height:920,deviceScaleFactor:1,mobile:false});
 await page.goto(base+'/');
 await page.waitForSelector('[data-idea="idea-0"] [data-insight-visual]',{timeout:20000});
 await sleep(1100);
 await page.evaluate(()=>{
  const card=document.querySelector('[data-idea="idea-0"]'),graph=card.querySelector('[data-insight-visual]');
  const sample=window.__feedSample={graph,frames:0,missing:0,maxHeightDelta:0};
  const height=card.getBoundingClientRect().height;
  sample.run=true;
  const frame=()=>{
   if(!sample.run)return;
   sample.frames++;
   if(card.querySelector('[data-insight-visual]')!==graph)sample.missing++;
   sample.maxHeightDelta=Math.max(sample.maxHeightDelta,Math.abs(card.getBoundingClientRect().height-height));
   requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
 });
 await fx('slow',{ms:2000});
 await fx('change',{kind:'unrelated'});
 await focus();
 await sleep(3300);
 const continuity=await page.evaluate(()=>{const x=window.__feedSample;x.run=false;return {frames:x.frames,missing:x.missing,maxHeightDelta:x.maxHeightDelta}});
 check('unrelated refresh keeps the same graph and card height across painted frames',continuity.frames>0&&continuity.missing===0&&continuity.maxHeightDelta<=1,continuity);
 await fx('slow',{ms:0});
 await page.evaluate(()=>{
  const card=document.querySelector('[data-idea="idea-2"]'),scroll=card.closest('.cm-scroll');
  scroll.style.overflowAnchor='none'; // exercise the path used by engines without native scroll anchoring
  scroll.scrollTop+=card.getBoundingClientRect().top-scroll.getBoundingClientRect().top-6;
 });
 const top=()=>page.evaluate(()=>document.querySelector('[data-idea="idea-2"]').getBoundingClientRect().top);
 const before=await top();
 await fx('change',{kind:'insert'});
 await focus();
 await page.waitForSelector('[data-idea="idea-inserted"]',{timeout:20000});
 await sleep(700);
 const after=await top();
 check('insertion above viewport preserves reading position',Math.abs(after-before)<=2,{before,after});
 if(run==='fixed')await page.screenshot({path:out+'/feed-stable.png'});
 await fx('generate',{ids:['idea-5'],hold:'样例等待'});
 await sleep(250);
 check('pending generation preserves the card text',await page.evaluate(()=>document.querySelector('[data-idea="idea-5"] [data-idea-body]')?.dataset.ideaBody==='text'));
 await fx('release',{});
 await focus();
 await page.waitForSelector('[data-idea="idea-5"] [data-insight-visual]',{timeout:23000});
 check('completed generation renders without page reload',true);
 await fx('slow',{ms:2000});
 await fx('connection',{status:'disconnected'});
 await focus();
 await page.waitForFunction(()=>!document.querySelector('[data-insight-visual]'),undefined,{timeout:20000});
 await sleep(2300);
 check('revoked source clears visuals while keeping card text',await page.evaluate(()=>!document.querySelector('[data-insight-visual]')&&document.querySelector('[data-idea="idea-0"] [data-idea-body]')?.dataset.ideaBody==='text'));
} catch(e) {
 check('browser scenario',false,String(e));
}
const result={url:base+'/',run,checks};
await fs.writeFile(out+'/'+run+'.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if(run==='fixed'&&checks.every(c=>c.pass))await task.finish({keep:[]});
if(checks.some(c=>!c.pass))throw Error('Feed stability checks failed');
