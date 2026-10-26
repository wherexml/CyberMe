// Run via ego-browser nodejs < this file. Set OPSTWIN_EGO_SPACE to reuse the goal's TaskSpace.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const root=process.env.OPSTWIN_REPO||'/Users/steve/Projects/opstwin-advance',out=root+'/output/task-agents-direct-20261017/browser-'+Date.now();await fs.mkdir(out,{recursive:true});
const t=typeof reusedTaskSpaceId==='number'?await taskSpace(reusedTaskSpaceId):await taskSpace('OpsTwins native Agent E2E');
const p=t.page('p1'),report={spaceId:t.spaceId,checks:[],runs:[],result:'RUNNING'};
async function check(name,ok){report.checks.push({name,status:ok?'PASS':'FAIL'});await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log({name,ok});if(!ok)throw Error(name)}
async function task(title,note){if(await p.evaluate(()=>!!document.querySelector('[aria-label="关闭详情"]')))await p.click('button[aria-label="关闭详情"]');await p.click('button[aria-label="新建任务"]');await p.fill('input[aria-label="任务标题"]',title);await p.fill('textarea[aria-label="任务内容 Markdown"]',note);await p.click('#task-form .primary');await p.waitForSelector('#task-agent-panel');await p.waitForFunction(()=>document.querySelector('.task-agent-auth')?.textContent.includes('已登录'),undefined,{timeout:20000})}
async function record(){return p.evaluate(async()=>{const taskId=document.querySelector('#task-agent-panel').dataset.taskId,id=JSON.parse(localStorage.getItem('opstwins-direct-requests'))[taskId],r=await fetch('/api/task-agents/requests/'+id,{headers:{'x-opstwins-client':localStorage.getItem('opstwins-direct-client'),'x-opstwins-agent':'direct'}});const d=await r.json();return {requestId:id,engine:d.engine,status:d.status,nativeSessionId:d.nativeSessionId,nativeCalls:d.nativeCalls,sourceSessionId:d.sourceSessionId,continuation:d.continuation}})}
try{
 await p.goto('http://127.0.0.1:46412/?v=direct#task-detail');await p.waitForSelector('#task-agent-panel');
 const marker='OPSTWINS_BROWSER_'+crypto.randomUUID().slice(0,8);
 await task('原生连接公开验收 · Codex','Do not use tools or read files. Reply exactly with this public marker: '+marker);
 await p.fill('textarea[aria-label="任务执行补充要求"]','Public browser E2E; do not change files.');await p.reload();await p.waitForSelector('#task-agent-panel');
 await check('unsent_draft_survives_refresh',await p.evaluate(()=>document.querySelector('[data-agent-field=draft]').value==='Public browser E2E; do not change files.'));
 await p.waitForFunction(()=>!document.querySelector('[data-agent="start"]').disabled,undefined,{timeout:20000});await p.click('[data-agent=start]');
 await p.waitForFunction(m=>document.querySelector('.task-agent-output')?.textContent.includes(m)&&document.querySelector('.task-agent-result b')?.textContent==='已完成',marker,{timeout:180000});
 const codex=await record();report.runs.push(codex);await check('codex_actual_button_executes',codex.status==='succeeded'&&codex.nativeCalls===1);
 await p.reload();await p.waitForFunction(m=>document.querySelector('.task-agent-output')?.textContent.includes(m),marker,{timeout:20000});
 const after=await record();await check('refresh_gets_original_request',after.requestId===codex.requestId&&after.nativeSessionId===codex.nativeSessionId&&after.nativeCalls===1);
 await p.evaluate(()=>document.querySelector('.task-agent-result').scrollIntoView({block:'center'}));await p.screenshot({path:out+'/codex-result.png'});
 const candidates=(await fs.readdir(root+'/output/task-agents-direct-20261017')).filter(x=>/^http-.*\.json$/.test(x)).sort().reverse();let original;for(const file of candidates){const prior=JSON.parse(await fs.readFile(root+'/output/task-agents-direct-20261017/'+file,'utf8'));if(prior.result==='PASS'){original=prior.runs.find(x=>x.engine==='claude'&&!x.sourceSessionId&&x.status==='succeeded');if(original)break}}if(!original)throw Error('Run the real HTTP E2E first');
 await task('原生连接公开验收 · Claude 历史','Do not use tools. Reply only with the exact public marker I previously asked you to remember in this conversation.');
 await p.selectOption('select[aria-label="任务执行器"]','claude');await p.waitForFunction(()=>document.querySelector('.task-agent-auth')?.textContent.includes('API Key'),undefined,{timeout:20000});
 await check('claude_explicit_model_visible',await p.evaluate(()=>document.querySelector('[data-agent-field=model]').value==='claude-opus-5-5'));
 await p.selectOption('select[aria-label="任务历史会话"]',original.nativeSessionId);await p.click('[data-agent=history]');await p.waitForSelector('.task-agent-history');
 await check('selected_public_history_preview',await p.evaluate(()=>document.querySelector('.task-agent-history').textContent.includes('OPSTWINS_NATIVE_CLAUDE_')));
 await p.click('[data-agent=start]');await p.waitForFunction(()=>document.querySelector('.task-agent-result b')?.textContent==='已完成'&&document.querySelector('.task-agent-output')?.textContent.includes('OPSTWINS_NATIVE_CLAUDE_'),undefined,{timeout:180000});
 const claude=await record();report.runs.push(claude);await check('claude_history_button_forks_native',claude.status==='succeeded'&&claude.sourceSessionId===original.nativeSessionId&&claude.nativeSessionId!==original.nativeSessionId);
 await p.reload();await p.waitForFunction(()=>document.querySelector('.task-agent-output')?.textContent.includes('OPSTWINS_NATIVE_CLAUDE_'),undefined,{timeout:20000});await check('claude_refresh_preserves_request',(await record()).requestId===claude.requestId);
 await p.waitForFunction(()=>document.querySelector('.task-agent-auth')?.textContent.includes('API Key'),undefined,{timeout:20000});await check('selected_history_survives_refresh',await p.evaluate(id=>document.querySelector('[data-agent-field=source]').value===id,original.nativeSessionId));await p.evaluate(()=>document.querySelector('.task-agent-result').scrollIntoView({block:'center'}));await p.screenshot({path:out+'/claude-result.png'});
 report.result='PASS';
}catch(e){report.result='FAIL';report.failure=e.message;await p.screenshot({path:out+'/failure.png'}).catch(()=>{});throw e}
finally{report.completedAt=new Date().toISOString();await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log({result:report.result,artifact:out+'/result.json',spaceId:t.spaceId})}
