// Stop chat-queue-fixture before running. Own isolated DB; restarts real API/SDK process.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const scope=resolve('.local/acceptance/chat-queue-restart-'+randomUUID()),out=resolve('output/chat-queue-20261111');await mkdir(scope,{recursive:true,mode:0o700});
const base='http://127.0.0.1:46831',checks=[];let child;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {http:r.status,...await r.json()}};
const until=async f=>{for(let i=0;i<200;i++){try{if(await f())return}catch{}await wait(100)}throw Error('wait timed out')};
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const start=async()=>{child=spawn(process.execPath,['--import','tsx','scripts/chat-queue-fixture.mjs'],{env:{...process.env,CHAT_QUEUE_SCOPE:scope},stdio:'ignore'});await until(async()=>(await api('GET','/api/health')).http===200)};
const stop=async()=>{child.kill('SIGTERM');await until(()=>child.exitCode!==null||child.signalCode!==null)};
const body=id=>({requestId:id,conversationId:'queue-primary',message:id,queueCurrent:true,readOnly:true});
try{
 await start();await api('POST','/api/chat',body('QUEUE-HOLD-RESTART'));await until(async()=>(await api('GET','/fixture/state')).held.length===1);await api('POST','/api/chat',body('QUEUE-RESTART-WAIT'));
 check('pending request durably queued',(await api('GET','/api/chat/requests/QUEUE-RESTART-WAIT')).status==='queued');await stop();await start();
 const a=await api('GET','/api/chat/requests/QUEUE-HOLD-RESTART'),b=await api('GET','/api/chat/requests/QUEUE-RESTART-WAIT');
 check('active run fails truthfully after restart',a.status==='failed'&&a.failureCode==='server_interrupted');check('unstarted queued request is reviewable',b.status==='failed'&&b.failureCode==='server_interrupted');check('restart never invokes model automatically',(await api('GET','/fixture/state')).seen.length===0);
 await api('POST','/api/chat',body('QUEUE-RESTART-WAIT'));await until(async()=>(await api('GET','/api/chat/requests/QUEUE-RESTART-WAIT')).status==='succeeded');
 check('explicit retry of unstarted request succeeds',true);const s=await api('GET','/fixture/state');check('only retried request calls model',s.seen.length===1&&s.seen[0].tag==='QUEUE-RESTART-WAIT');
 const messages=await api('GET','/api/conversations/queue-primary/messages');check('retry reuses original user bubble',(messages.items||[]).filter(m=>m.requestId==='QUEUE-RESTART-WAIT'&&m.role==='user').length===1);
 console.log({checks:checks.length,pass:true});
}finally{await stop().catch(()=>{});await writeFile(out+'/restart-result.json',JSON.stringify({url:base,scope:'Real process restart + isolated durable SQLite + controlled SDK provider',checks},null,2))}
