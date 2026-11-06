// Real HTTP + Anthropic SSE + production agent; intentionally never-ending provider body.
import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {serve} from '@hono/node-server';
const scope=resolve('.local/acceptance/stream-abort-'+randomUUID()),out=resolve('output/chat-update-20261105');await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46788',OPSTWIN_WEB_PORT:'46788'});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46789',apiKey:'public-fixture',api:'anthropic-messages',model:'public-stream'}}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({autonomy:{holdSending:true}});S.put('conversations',{id:'public',title:'SSE cancellation'});S.setMeta('primaryConversationId','public');
let hanging=true,calls=0,closed=0;const checks={};
const model=createServer(async(req,res)=>{for await(const b of req){}calls++;const hold=hanging;res.writeHead(200,{'Content-Type':'text/event-stream'});const event=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
 event('message_start',{message:{id:'public',type:'message',role:'assistant',model:'public-stream',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});event('content_block_start',{index:0,content_block:{type:'text',text:''}});event('content_block_delta',{index:0,delta:{type:'text_delta',text:'公开回复'}});
 if(hold)res.on('close',()=>closed++);else{event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});event('message_stop',{});res.end()}
});await new Promise(r=>model.listen(46789,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:46788});
const request=async(id)=>{const r=await fetch('http://127.0.0.1:46788/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:id,conversationId:'public',message:'公开流取消验收，只回复一句话，不使用工具。',readOnly:true,interruptCurrent:true}),signal:AbortSignal.timeout(125000)});return {status:r.status,body:await r.json()}};
const until=async(fn,ms=15000)=>{const start=Date.now();while(Date.now()-start<ms){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('condition_timeout')};
const check=(name,pass)=>{checks[name]=!!pass;assert.ok(pass,name)};
try{
 const first=request('first');await until(()=>calls===1&&S.list('runs').some(r=>r.phase==='streaming'));
 hanging=false;const next=await request('second');check('second_succeeds_after_stream_abort',next.status===200);
 const old=await first;check('old_request_cancelled',old.status===409&&old.body.error==='chat_interrupted');await until(()=>closed===1);check('provider_connection_closed',closed===1);check('only_two_model_calls',calls===2);
 if(!process.argv.includes('--interrupt-only')){hanging=true;const started=Date.now(),timed=await request('timeout');check('timeout_settles',timed.status===504);check('bounded_110s_deadline',Date.now()-started<120000);await until(()=>closed===2);check('timeout_closes_provider',closed===2);hanging=false;check('chat_after_timeout_succeeds',(await request('after-timeout')).status===200)}
 check('no_running_chat_requests',S.db.prepare("select count(*) n from chat_requests where state='running'").get().n===0);check('no_external_sends',S.db.prepare('select count(*) n from send_intents').get().n===0);
}catch(e){checks.failure=String(e);process.exitCode=1}finally{await writeFile(out+(process.argv.includes('--interrupt-only')?'/stream-interrupt-result.json':'/stream-timeout-result.json'),JSON.stringify({checks,calls,closed,scope:'real HTTP/SSE, production SDK, controlled model'},null,2));console.log({checks,calls,closed});server.closeAllConnections();server.close();model.closeAllConnections();model.close();S.db.close()}
