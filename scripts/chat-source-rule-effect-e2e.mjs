import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {put,get,inboxTriageVersion,TRIAGE_POLICY_VERSION}=await tsImport('../server/src/store.ts',import.meta.url);import fs from 'node:fs/promises';
const out=new URL('../output/chat-source-rules-20261003/',import.meta.url),marker='OPSADV-QA-RULE-EFFECT-'+Date.now();let id,sourceKey;const proof={marker,checks:[]};
async function req(path,method='GET',body){const r=await fetch('http://127.0.0.1:46110/api'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
function check(name,ok){proof.checks.push({name,status:ok?'PASS':'FAIL'});assert.ok(ok,name)}
try{
 const item=await req('/inbox','POST',{title:marker,sender:'Documentation user group',sourceId:marker,channel:'Internal',category:'群聊',origin:'human',status:'pending',body:'Steve，请直接回复我的问题：公开用户手册的下载地址是什么？答案已经明确在本消息里：https://example.com/guide ，只需要把这个链接回复给我。必须回复，内容已完整，无需任何审批、决策或补充资料，没有期限、承诺、费用或敏感信息。'});id=item.id;
 // Seed a known assessment to exercise the HTTP projection deterministically.
 // This is assessment fixture evidence, NOT a claim that Jev produced these scores.
 const triage={status:'succeeded',route:'quick_reply',method:'jev',needsReply:.95,needsOwner:.1,needsDeepThink:.1,missingContext:.1,risk:.1,sourceVersion:inboxTriageVersion(get('inbox',id)),policyVersion:TRIAGE_POLICY_VERSION,model:'E2E assessment fixture',completedAt:new Date().toISOString()};
 put('inbox_triages',{...triage,id});proof.assessmentEvidence='Seeded assessment fixture; model execution separately covered in http.json';proof.triage=triage;
 check('ordinary reply starts in attention',(await req('/inbox/'+id)).surfacing==='attention');
 sourceKey=(await req('/inbox-source-rules?query='+marker)).sources[0].id;
 await req('/inbox-source-rules','POST',{sourceKey,excluded:true});
 check('explicit source rule suppresses ordinary reply',(await req('/inbox/'+id)).surfacing==='quiet');
 await req('/inbox-source-rules','POST',{sourceKey,excluded:false});
 check('removing source rule restores ordinary reply',(await req('/inbox/'+id)).surfacing==='attention');proof.status='PASS';
}catch(e){proof.status='FAIL';proof.error=String(e);process.exitCode=1}finally{if(sourceKey)await req('/inbox-source-rules','POST',{sourceKey,excluded:false});if(id)await req('/inbox/'+id,'DELETE')}
await fs.writeFile(new URL('effect.json',out),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
