import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Explicit local draft generation only. Never calls an outbound endpoint.
const base='http://127.0.0.1:46110';
const directory=new URL('../output/reply-style-20261003/',import.meta.url);
await mkdir(directory,{recursive:true});
const items=await (await fetch(`${base}/api/inbox`)).json();
const matches=items.filter(item=>item.title==='郑方圆'&&item.body.includes('1300+600HKD'));
if(matches.length!==1)throw new Error('Expected exactly one matching source conversation');
const item=matches[0],requestId=`reply-style-${randomUUID()}`;
await writeFile(new URL('request.json',directory),JSON.stringify({itemId:item.id,requestId,beforeDraft:item.draft},null,2));
const response=await fetch(`${base}/api/inbox/${encodeURIComponent(item.id)}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,baseUpdatedAt:item.updatedAt}),signal:AbortSignal.timeout(240000)});
const result=await response.json();
if(!response.ok)throw new Error(JSON.stringify({status:response.status,result}));
const saved=await (await fetch(`${base}/api/inbox/${encodeURIComponent(item.id)}`)).json();
const draft=result.item.draft;
const checks={nonempty:!!draft.trim(),noCourtesy:!/(谢谢|感谢|辛苦|麻烦您|您好|已知悉|执行即可)/.test(draft),noAddress:!/(郑方圆|方圆|老师)/.test(draft),noTerminalPunctuation:draft.split('\n').filter(line=>line.trim()).every(line=>!/[，。！？；：、,.!?;:]$/.test(line.trim())),persisted:saved.draft===draft,unapproved:saved.approved===false,noSend:saved.status==='pending'&&!saved.receipt};
const evidence={at:new Date().toISOString(),itemId:item.id,requestId,beforeDraft:item.draft,draft,runId:result.run.id,model:result.run.model,status:result.run.status,checks};
await writeFile(new URL('result.json',directory),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
if(Object.values(checks).some(value=>!value))process.exitCode=1;
