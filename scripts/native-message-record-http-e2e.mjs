#!/usr/bin/env node
// Failure inventory precedes implementation: docs/journeys/native-message-record.md.
// Read-only real public A conversation; never serialize message/run bodies.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),base='http://127.0.0.1:46110',cid='ui-side-bccfabcf-a98a-4bfe-ba64-9ad500eb62b8';
const out=join(root,'output','native-message-record-'+Date.now()),checks=[];
await mkdir(out,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const sources=['server/src/index.ts','native/macos/crates/opstwin-api/src/chat_product.rs'];
const fingerprints=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await readFile(join(root,p)))])));
const before=await fingerprints();
async function get(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json()};}
const check=(name,ok,evidence={})=>checks.push({name,status:ok?'PASS':'FAIL',...evidence});
try{
 const page=await get('/api/conversations/'+encodeURIComponent(cid)+'/messages?limit=200');
 const rows=page.data.items||[],user=rows.findLast(x=>x.role==='user'&&String(x.content).startsWith('OPSADV-QA-V11-INLINE'));
 const receipt=user&&await get('/api/chat/requests/'+encodeURIComponent(user.requestId));
 const assistant=receipt?.data.result?.assistantMessage;
 check('existing public native GUI request and assistant found',page.status===200&&Boolean(user&&assistant));
 if(!user||!assistant)throw Error('public request not found');
 const message=await get('/api/messages/'+encodeURIComponent(assistant.id));
 check('exact message GET exists',message.status===200,{httpStatus:message.status});
 check('message identity and original run linkage match',message.data.id===assistant.id&&message.data.runId===assistant.runId&&message.data.conversationId===cid);
 if(message.status===200){
  const run=await get('/api/runs/'+encodeURIComponent(message.data.runId));
  check('actual native-created run GET matches succeeded request',run.status===200&&run.data.id===assistant.runId&&run.data.status==='succeeded',{httpStatus:run.status,runId:assistant.runId,runStatus:run.data.status});
 }
 const noRun=await get('/api/messages/'+encodeURIComponent(user.id));
 check('user message without run remains readable',noRun.status===200&&noRun.data.id===user.id&&!noRun.data.runId,{httpStatus:noRun.status});
 const missing=await get('/api/messages/OPSADV-QA-missing-'+randomUUID());
 check('missing message rejects with object not-found',missing.status===404&&missing.data.error==='not_found',{httpStatus:missing.status,errorCode:missing.data.error});
 const forbidden=/"(?:apiKey|api_key|accessToken|refreshToken|credential|password|diskPath|authorization)"\s*:/i;
 check('public message and run payload do not expose private fields',!forbidden.test(JSON.stringify(message.data))&&!forbidden.test(JSON.stringify(noRun.data)));
}catch(e){check('public read-only journey completes',false,{errorHash:hash(String(e))});}
const after=await fingerprints(),sourceStable=JSON.stringify(before)===JSON.stringify(after);
const report={kind:'read-only real production HTTP on existing public native-created Chat; GUI button retest separate',sourceHashes:before,sourceStable,checks,counts:{pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length},externalSends:0};
report.status=report.counts.fail?'FAIL':sourceStable?'PASS':'BLOCKED';
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({artifact:join(out,'report.json'),status:report.status,counts:report.counts}));
process.exitCode=report.status==='PASS'?0:1;
