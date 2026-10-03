/** Existing real entities, browser-only navigation and observation; no new sends. */
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../output/root-journey/manifest.json',import.meta.url),'utf8'));
const config={root,space:Number(process.env.OPSADV_QA_SPACE||35),page:process.env.OPSADV_QA_PAGE||'p3',web:process.env.OPSTWIN_VERIFY_WEB||'http://127.0.0.1:46100',lineage:manifest.lineage};
const source=`
const fs=await import('node:fs/promises');
const config=${JSON.stringify(config)};
const p=(await taskSpace(config.space)).page(config.page);
const destination=config.root+'/output/browser-replay-'+new Date().toISOString().replace(/[:.]/g,'-');
await fs.mkdir(destination,{recursive:true});
const views=[
 {name:'chat',path:'/chat',ready:'.chat-scroll'},
 {name:'original-inbox',path:'/inbox?item='+config.lineage.itemId,ready:'.op-draft-card'},
 {name:'original-deep',path:'/deep-think?item='+config.lineage.itemId,ready:'.op-deep-chat'},
 {name:'original-sent',path:'/sent?item='+config.lineage.itemId,ready:'.op-sent-page'},
 {name:'original-activity',path:'/activity?entity='+config.lineage.itemId,ready:'.op-activity-main'},
 {name:'sources',path:'/sources',ready:'.source-grid'},
 {name:'tasks',path:'/tasks',ready:'.task-workbench'},
];
const checks=[];
for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const view of views){
 const id=view.name+'-'+viewport.width;
 try{
  await p.cdp('Page.bringToFront',{});
  await p.cdp('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  await p.goto(config.web+view.path);
  await p.cdp('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  await p.waitForSelector(view.ready,{timeout:10000});
  const observed=await p.evaluate(()=>({url:location.href,innerWidth,rootWidth:document.documentElement.scrollWidth,title:document.querySelector('h1')?.textContent,attachments:[...document.querySelectorAll('.op-artifact-tile')].map(e=>({id:e.getAttribute('data-artifact-id'),right:e.getBoundingClientRect().right})),latestMessage:[...document.querySelectorAll('[data-message-id]')].at(-1)?.getAttribute('data-message-id')}));
  const shot=destination+'/'+id+'.png';await p.screenshot({path:shot});
  if(observed.innerWidth!==viewport.width||observed.rootWidth>viewport.width+1)throw new Error('Viewport/overflow mismatch '+JSON.stringify(observed));
  if(observed.attachments.some(a=>a.right>viewport.width+1))throw new Error('Attachment paints outside viewport '+JSON.stringify(observed.attachments));
  checks.push({id,status:'PASS',viewport,observed,screenshot:shot});
 }catch(e){checks.push({id,status:'FAIL',error:String(e)});}
 await fs.writeFile(destination+'/progress.json',JSON.stringify(checks,null,2));
}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await p.goto(config.web+'/chat');
const result={mode:'read-only browser replay of existing real E2E entities',createdAt:new Date().toISOString(),taskSpace:config.space,page:config.page,sourceManifest:'output/root-journey/manifest.json',lineage:config.lineage,externalWrites:0,checks,pass:checks.every(c=>c.status==='PASS')};
await fs.writeFile(destination+'/manifest.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({pass:result.pass,checks:checks.length,artifact:destination+'/manifest.json',externalWrites:0}));
if(!result.pass)throw new Error('One or more browser replay checks failed; inspect manifest.');
`;
const child=spawn(process.execPath,['scripts/ego-locked.mjs','nodejs'],{cwd:root,stdio:['pipe','inherit','inherit']});
child.stdin.end(source);child.on('error',e=>{console.error(e);process.exitCode=1});child.on('exit',code=>process.exitCode=code??1);
