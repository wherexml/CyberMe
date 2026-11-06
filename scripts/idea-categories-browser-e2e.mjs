const task=await taskSpace('CyberMe 内容分类验收'),page=task.page('p1');console.log({taskSpaceId:task.spaceId});
const fs=await import('node:fs/promises'),out=process.cwd()+'/output/idea-categories-20261106',checks=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{await page.goto('http://127.0.0.1:46880');await page.waitForSelector('textarea');await page.click('text="简报"');await page.click('text="灵感"');await page.waitForSelector('[data-idea="design-a"]');
 check('all real generated category labels shown',await page.evaluate(()=>['设计反馈','采购信息','项目验收','产品体验'].every(s=>document.body.textContent.includes(s))));check('no internal category translation',await page.evaluate(()=>![...document.querySelectorAll('[data-idea]')].some(el=>el.textContent.includes('规律'))));
 await page.click('button:text-is("设计反馈")');check('generated category filters matching cards only',await page.evaluate(()=>document.querySelectorAll('[data-idea]').length===2&&!!document.querySelector('[data-idea="design-b"]')));
 await page.click('button:text-is("全部")');check('all restores entire list',await page.evaluate(()=>document.querySelectorAll('[data-idea]').length===5));await page.reload();await page.waitForSelector('[data-idea="design-a"]');check('reload preserves generated labels',await page.evaluate(()=>document.querySelector('[data-idea="design-a"]').textContent.includes('设计反馈')));
 await page.screenshot({path:out+'/categories-browser.png'});
 console.log({passed:checks.length});}finally{await fs.writeFile(out+'/browser-checks.json',JSON.stringify({checks},null,2));}
