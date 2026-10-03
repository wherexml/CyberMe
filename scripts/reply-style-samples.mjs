import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base='http://127.0.0.1:46110';
const directory='output/reply-style-samples-20261003';
await mkdir(directory,{recursive:true});
const names=['贾晨璐','黄欣宇','应昊建','郑重其','刘锦汕'];
const results=[];
for(const name of names){
 const items=await(await fetch(`${base}/api/inbox`)).json();
 const matches=items.filter(x=>x.title===name&&x.id.startsWith('chat-')&&x.status==='pending');
 if(matches.length!==1)throw Error(`Ambiguous source: ${name}`);
 const item=matches[0],requestId=`style-sample-${randomUUID()}`;
 const sample={name,itemId:item.id,requestId,latest:item.body.split('\n').filter(Boolean).at(-1),beforeDraft:item.draft};
 results.push(sample);
 await writeFile(`${directory}/results.json`,JSON.stringify(results,null,2));
 try{
  const response=await fetch(`${base}/api/inbox/${encodeURIComponent(item.id)}/draft`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,baseUpdatedAt:item.updatedAt}),signal:AbortSignal.timeout(240000)});
  const data=await response.json();
  if(!response.ok){sample.error={httpStatus:response.status,code:data.code||data.error,message:data.message};}
  else{
   const saved=await(await fetch(`${base}/api/inbox/${encodeURIComponent(item.id)}`)).json();
   Object.assign(sample,{draft:data.item.draft,runId:data.run.id,model:data.run.model,status:data.run.status,persisted:saved.draft===data.item.draft,approved:saved.approved,savedStatus:saved.status});
  }
 }catch(e){sample.error=String(e);}
 await writeFile(`${directory}/results.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(sample));
}
