#!/usr/bin/env node
// Real local HTTP journeys; persisted evidence excludes server/private bodies.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const api=process.env.OPSTWIN_API||'http://127.0.0.1:46110';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=root+'.local/acceptance/native-chat-product/'+new Date().toISOString().replaceAll(':','-');
const session='ui-side-'+randomUUID(),request='native-chat-e2e-'+randomUUID(),checks=[];
function check(name,ok,detail={}){checks.push({name,status:ok?'PASS':'FAIL',...detail});if(!ok)throw new Error(name);}
async function req(path,method='GET',body){const response=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(300000)});let data;try{data=await response.json()}catch{data={}};return {status:response.status,data};}
const fingerprint=value=>createHash('sha256').update(String(value||'')).digest('hex');
let primaryHash;
try {
 const before=await req('/api/conversations/primary');check('primary read',before.status===200);primaryHash=fingerprint(before.data.conversationId);
 const absent=await req('/api/chat/requests/'+request);check('unstarted request recovery is read-only 404',absent.status===404);
 const created=await req('/api/conversations/side','POST',{id:session,title:'原生产品HTTP验收 '+request.slice(-8)});check('stable side conversation create',created.status===201||created.status===200,{sessionId:session});
 const replay=await req('/api/conversations/side','POST',{id:session,title:'原生产品HTTP验收 '+request.slice(-8)});check('side create response-loss replay',replay.status===200&&replay.data.id===session);
 const primary=await req('/api/conversations/primary');check('side create preserves primary pointer',fingerprint(primary.data.conversationId)===primaryHash);
 const thread=await req('/api/conversations/'+session+'/messages?limit=50');check('independent empty side history',thread.status===200&&thread.data.items?.length===0);
 const payload={conversationId:session,requestId:request,message:'这是原生Chat只读验收。只回复 NATIVE_CHAT_OK，不读取文件，不调用工具，不创建任务，不外发。',readOnly:true,preservePrimary:true};
 const sent=await req('/api/chat','POST',payload);check('real Agent route completes isolated side message',sent.status===200&&sent.data.conversationId===session&&sent.data.assistantMessage?.content?.includes('NATIVE_CHAT_OK'),{http:sent.status});
 const recovered=await req('/api/chat/requests/'+request);check('GET recovers durable success without execution',recovered.status===200&&recovered.data.status==='succeeded'&&recovered.data.result?.requestId===request);
 const duplicated=await req('/api/chat','POST',payload);check('same request replays exact receipt',duplicated.status===200&&duplicated.data.replayed===true&&duplicated.data.assistantMessage?.id===sent.data.assistantMessage?.id);
 const conflict=await req('/api/chat','POST',{...payload,message:'另一条只读消息'});check('request payload conflict rejected',conflict.status===409&&conflict.data.error==='request_conflict');
 const after=await req('/api/conversations/'+session+'/messages?limit=50');check('replay does not duplicate history',after.status===200&&after.data.items?.length===2&&after.data.items.every(m=>m.conversationId===session));
 const running=await req('/api/chat/continuation/'+session);check('continuation reflects completed real run',running.status===200&&running.data.running===false&&Array.isArray(running.data.items));
 const afterPrimary=await req('/api/conversations/primary');check('Agent side send preserves primary pointer',fingerprint(afterPrimary.data.conversationId)===primaryHash);
} catch(error) {checks.push({name:'journey stopped',status:'FAIL',reason:String(error.message||error).slice(0,180)});}
await mkdir(out,{recursive:true});
const artifact={schema:1,api,createdAt:new Date().toISOString(),sessionId:session,requestId:request,primaryPointerHash:primaryHash,checks,passed:checks.every(c=>c.status==='PASS'),notRun:['native IME','native pixel comparison','real microphone permission/ASR','continuation steering/queue UI','unknown/partial injected recovery','native draft restart isolation']};
await writeFile(out+'/result.json',JSON.stringify(artifact,null,2));
console.log(JSON.stringify({artifact:out+'/result.json',passed:artifact.passed,checks:checks.length}));
process.exitCode=artifact.passed?0:1;
