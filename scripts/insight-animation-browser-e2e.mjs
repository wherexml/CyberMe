// Run against scripts/insight-actions-fixture.mjs using ego-browser nodejs. Controlled pause of a real browser animation.
const t=await taskSpace('CyberMe 安装动画兜底验收'),p=t.page('p1'),fs=await import('node:fs/promises'),out='/Users/steve/Projects/CyberMe/output/insight-actions-installed-20261107',checks=[];
await p.reload();await p.waitForSelector('[data-idea="recommended"]');
await p.evaluate(()=>{const original=Element.prototype.animate;window.restoreAnimation=()=>{Element.prototype.animate=original};Element.prototype.animate=function(...args){const a=original.apply(this,args);if(this.parentElement===document.body&&this.style.zIndex==='9999')a.pause();return a;}});
await p.click('[data-idea="recommended"] [data-action="ask-cyberme"]');
await p.waitForFunction(()=>document.querySelector('textarea').value.includes('帮我分析判断与下一步')&&document.activeElement===document.querySelector('textarea'));
checks.push({name:'composer focused without animation frames',pass:true});
await p.waitForFunction(()=>![...document.body.children].some(e=>e.style.zIndex==='9999'),undefined,{timeout:5000});checks.push({name:'paused fly overlay cleaned within bounded time',pass:true});
await p.evaluate(()=>window.restoreAnimation());
await p.screenshot({path:out+'/animation-browser.png'});
await fs.writeFile(out+'/animation-browser.json',JSON.stringify({url:await p.url(),checks},null,2));console.log(JSON.stringify(checks));await t.finish({keep:[]});
