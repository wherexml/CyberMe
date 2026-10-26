// Requires the isolated acceptance service started with --fail-jev (503 injection).
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(import.meta.dirname,'../output/chat-work-real-20261023','jev-failure-'+Date.now()),base='http://127.0.0.1:46640',checks=[];await mkdir(out,{recursive:true});
async function req(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const cid='ui-side-'+randomUUID(),operationId=randomUUID(),check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});console.log(name)};
try{
 await req('/api/conversations/side',{id:cid,title:'Jev 失败公开验收'});
 const r=await req('/api/chat/work/proposals',{operationId,conversationId:cid,sourceIds:['cw-public-plan','cw-public-discussion'],message:'请对比资料，提出不同整理方向；选定后再生成评审文档。'});check('Real proposal accepted before failed Jev check',r.status===202);
 await writeFile(resolve(out,'ids.json'),JSON.stringify({cid,operationId,panelId:r.body.panel.id},null,2));
 let panel;const deadline=Date.now()+120000;while(Date.now()<deadline){panel=(await req('/api/chat/work/panels/'+r.body.panel.id)).body;if(panel.status!=='preparing')break;await new Promise(r=>setTimeout(r,700))}
 await writeFile(resolve(out,'panel.json'),JSON.stringify(panel,null,2));check('Real model choices remain available with explicit failed Jev state',panel.status==='ready'&&panel.options.length>=2&&panel.jev.status==='failed'&&panel.jev.error.includes('503'));
 check('No fabricated Jev recommendation',panel.options.every(o=>!o.recommended)&&!panel.jev.recommendedOptionId);
 const projection=(await req('/api/chat/work/conversations/'+cid)).body;check('No execution starts before explicit user selection',projection.works.length===0);
}catch(e){checks.push({name:'Jev failure flow',status:'FAIL',error:e.message});process.exitCode=1;console.error(e.message)}
await writeFile(resolve(out,'result.json'),JSON.stringify({injection:'Jev endpoint HTTP 503 only; real business model',checks},null,2));console.log(out);
