// Reuse the current goal's ego TaskSpace; this checks public browser UI, never native GUI.
import {spawnSync} from 'node:child_process';
const space=Number(process.argv[2]);if(!Number.isSafeInteger(space)||space<1)throw Error('Usage: node scripts/mygo-preview-browser-e2e.mjs <existing-ego-space-id>');
const code=`
const task=await taskSpace(${space}),p=task.page('p1');
await p.goto('http://127.0.0.1:46300/pilot.html');
await p.waitForFunction(()=>document.body.innerText.includes('同一组件和样式'));
const checks=[];
for(const [label,expected,name] of [['对话','公开布局预览','chat'],['收件箱','草稿','inbox'],['模型设置','当前模型','models']]){
 await p.click('button[aria-label="'+label+'"]');
 await p.waitForFunction(text=>document.body.innerText.includes(text),expected);
 checks.push({name,status:'PASS'});
 await p.screenshot({path:'${process.cwd()}/output/mygo-1007/browser-'+name+'.png'});
}
await p.click('button[aria-label="对话"]');
await p.fill('textarea[placeholder="输入消息…"]','OPSADV-QA-PREVIEW');
await p.click('button[aria-label="发送消息"]');
await p.waitForFunction(()=>document.body.innerText.includes('只读布局预览'));
checks.push({name:'preview-mutation-rejected',status:'PASS'});
const fs=await import('node:fs/promises');await fs.writeFile('${process.cwd()}/output/mygo-1007/browser-e2e.json',JSON.stringify({at:new Date().toISOString(),checks,nativeGUI:'NOT_RUN',preview:true},null,2));
console.log({checks});
`;
const run=spawnSync('ego-browser',['nodejs'],{input:code,encoding:'utf8',stdio:['pipe','inherit','inherit']});process.exitCode=run.status??1;
