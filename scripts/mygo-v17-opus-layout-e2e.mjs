// Run with ego-browser nodejs; existing TaskSpace103/p1, read-only public fixture.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root='/Users/steve/Projects/opstwin-advance',out=globalThis.OPSTWIN_V17_LAYOUT_OUT||root+'/output/mygo-v17-opus-acceptance-20261017/layout';await fs.mkdir(out,{recursive:true});
const p=(await taskSpace(103)).page('p1'),checks=[];const check=(name,pass,evidence)=>checks.push({name,status:pass?'PASS':'FAIL',evidence});
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1100,height:760,deviceScaleFactor:1,mobile:false});await p.goto('http://127.0.0.1:46500/desktop.html');await p.waitForFunction(()=>!!window.OpsTwinsDesktop?.v17,undefined,{timeout:15000});if(await p.evaluate(()=>document.querySelector('#task-dialog').open))await p.click('#close-task');if(await p.evaluate(()=>document.querySelector('#settings-window').open))await p.click('#close-settings');await p.click('button[aria-label="收件箱"]');await p.click('[data-filter=all]');await p.waitForSelector('#inbox-items button');await p.click('#inbox-items button >> nth=0');
for(const width of [1100,660])for(const dark of [false,true]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:760,deviceScaleFactor:1,mobile:false});await p.evaluate(d=>document.body.classList.toggle('dark',d),dark);
 await p.click('button[aria-label="收件箱"]');
 const name=`${width}-${dark?'dark':'light'}`;
 const geometry=await p.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const card=document.querySelector('.jev-card');return {card:box(card),heading:box(card.querySelector('.jev-heading')),labels:[...card.querySelectorAll('.judgment>div>span')].map(box),meters:[...card.querySelectorAll('.judgment-meter')].map(box),statuses:[...card.querySelectorAll('.inline-note')].map(box)}});
 check(name+' judgment content contained',geometry.labels.concat(geometry.meters,geometry.statuses).every(b=>b.width>0&&b.x>=geometry.card.x&&b.right<=geometry.card.right+1),geometry);
 check(name+' statuses below meter row',geometry.statuses.every(b=>b.y>=Math.max(...geometry.meters.map(m=>m.bottom))),geometry);
 await p.screenshot({path:out+'/inbox-'+name+'.png'});
 await p.click('button[aria-label="任务"]');
 const colors=await p.evaluate(()=>[...document.querySelectorAll('.desktop-task-tools button')].map(b=>{const c=getComputedStyle(b);return {text:b.textContent,foreground:c.color,background:c.backgroundColor}}));
 check(name+' task buttons have distinct text and surface',colors.length===3&&colors.every(c=>c.foreground!==c.background&&c.background!=='rgba(0, 0, 0, 0)'),colors);
 await p.screenshot({path:out+'/tasks-'+name+'.png'});
}
await p.cdp('Emulation.clearDeviceMetricsOverride');await p.evaluate(()=>document.body.classList.remove('dark'));
const source=await fs.readFile(root+'/web/src/desktop/full/v17.css');const report={checks,sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),scope:'real browser public E2E; ephemeral body dark class for theme projection; no canonical settings writes'};await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log({pass:checks.filter(c=>c.status==='PASS').length,total:checks.length});if(checks.some(c=>c.status==='FAIL'))throw Error('layout regression');
