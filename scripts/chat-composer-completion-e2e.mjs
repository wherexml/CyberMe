// Continue after scripts/chat-composer-e2e.mjs in TaskSpace54 p1.
const fs=await import('node:fs/promises');const out='/Users/steve/Projects/opstwin-advance/output/chat-composer-20261002';
const e=JSON.parse(await fs.readFile(`${out}/root-evidence.json`,'utf8'));
const task=await taskSpace(Number(process.env.OPSADV_QA_SPACE||54)),page=task.page(process.env.OPSADV_QA_PAGE||'p1');
await page.waitForFunction(async id=>{const response=await fetch(`/api/chat/continuation/${id}`);if(!response.ok)return false;const state=await response.json();return !state.running&&!state.items.length},e.conversationId,{timeout:55000});
const state=await (await fetch('http://127.0.0.1:46110/api/bootstrap')).json();
const messages=state.messages.filter(m=>m.conversationId===e.conversationId);
const retained=await page.evaluate(()=>document.querySelector('.chat-composer>textarea').value);
const results={messageCount:messages.length,exactUserMessages:messages.filter(m=>m.role==='user').length===3,insertedReply:messages.some(m=>m.role==='assistant'&&m.content.trim()==='INSERT_OK'),editedReply:messages.some(m=>m.role==='assistant'&&m.content.trim()==='EDITED_OK'),removedNotExecuted:!messages.some(m=>m.requestId===e.removeId),draftRetained:retained===`${e.marker}-DRAFT`};
if(Object.entries(results).some(([k,v])=>k!=='messageCount'&&!v))throw Error(JSON.stringify(results));
const runs=await Promise.all(messages.filter(m=>m.runId&&m.role==='assistant').map(async m=>await (await fetch(`http://127.0.0.1:46110/api/runs/${m.runId}`)).json()));
if(runs.some(r=>r.status!=='succeeded'||r.tools?.some(t=>t.name!=='load_user_context')))throw Error('Expected real successful runs without agent-invoked tools');
await page.screenshot({path:`${out}/completed.png`});
await fs.writeFile(`${out}/completion.json`,JSON.stringify({result:'PASS',results,messages,runs:runs.map(r=>({id:r.id,status:r.status,engine:r.engine,model:r.model,tools:r.tools.map(t=>({name:t.name,status:t.status}))}))},null,2));e.phase='PASS';e.completionEvidence='completion.json';await fs.writeFile(`${out}/root-evidence.json`,JSON.stringify(e,null,2));console.log(results);
