// Failure cases were recorded before implementation in docs/public/agent-execution.md.
// Real Chat HTTP + SDK tools + OS processes + HTTP upstream; synthetic credentials only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
const real=process.argv.includes('--real'),port=47431,modelPort=47432,upstreamPort=47433;
const scope=resolve('.local/acceptance/agent-execution-'+randomUUID()),out=resolve('output/skills-integration-20261112/execution-regression',real?'real':'controlled');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const fixtureKey='oc_sk_'+randomUUID().replaceAll('-','');
const cfg=real?JSON.parse(await readFile(resolve(homedir(),'Library/Application Support/OpsTwins/.local/config.json'),'utf8')):{llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-command'}};
await writeFile(scope+'/config.json',JSON.stringify(cfg),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({autonomy:{holdSending:true}});
S.put('inbox',{id:'public-credential-source',title:'公开测试服务',sender:'公开验收',channel:'Internal',status:'pending',body:`测试服务 http://127.0.0.1:${upstreamPort}/probe\nAPI Key: ${fixtureKey}`});
const checks=[];let hits=0,authenticated=0,modelCalls=0,providerSawSecret=false;
const check=(name,value)=>{checks.push({name,pass:!!value});assert.ok(value,name)};
const upstream=createServer((req,res)=>{hits++;const valid=req.headers.authorization===`Bearer ${fixtureKey}`;if(valid)authenticated++;res.writeHead(valid?200:401,{'content-type':'application/json'});res.end(JSON.stringify({ok:valid,marker:'PUBLIC_NETWORK_OK'}))});
await new Promise(r=>upstream.listen(upstreamPort,'127.0.0.1',r));
const node=JSON.stringify(process.execPath),script=s=>`${node} - <<'CYBERME_E2E'\n${s}\nCYBERME_E2E`;
const networkCommand=script(`const fs=require('node:fs');fetch('http://127.0.0.1:${upstreamPort}/probe',{headers:{Authorization:'Bearer '+process.env.CYBERME_SECRET_TOKEN},redirect:'error'}).then(async r=>{const v=await r.json();if(!r.ok)process.exitCode=1;else fs.writeFileSync('result.txt',v.marker,{mode:0o600});console.log(JSON.stringify(v));console.log(process.env.CYBERME_SECRET_TOKEN);});`);
const model=createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);modelCalls++;if(raw.includes(fixtureKey))providerSawSecret=true;
 const userIndex=input.messages.findLastIndex(m=>m.role==='user');const initial=input.messages[userIndex]?.content;const text=typeof initial==='string'?initial:(initial||[]).map(p=>p.text||'').join('\n');
 const direct=text.split('当前用户请求：\n').at(-1);const caseName=direct.match(/CASE_([A-Z]+)/)?.[1]||'NONE';
 const tools=input.tools||[],messages=input.messages.slice(userIndex+1).filter(m=>m.role==='tool');
 const haveExecution=tools.some(t=>t.function?.name==='run_command');
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'public-command',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 const call=(name,args)=>{chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+messages.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls')};
 if(!haveExecution){chunk({role:'assistant',content:'本轮没有命令执行工具。'});chunk({},'stop')}
 else if(['QUOTED','DENY','DISCUSS'].includes(caseName)){if(!messages.length)call('run_command',{command:script("require('node:fs').writeFileSync('unauthorized.txt','bad')"),cwd:scope,operationId:'denied-'+caseName,evidence:direct});else{chunk({role:'assistant',content:'已拒绝未授权操作。'});chunk({},'stop')}}
 else if(caseName==='FETCH'&&!messages.length)call('app_read',{action:'entity_get',resource:'inbox',id:'public-credential-source'});
 else if(!messages.some(m=>{try{return JSON.parse(m.content).credentials}catch{return false}}))call('get_execution_context',{});
 else{
  const context=messages.map(m=>JSON.parse(m.content)).find(m=>m.credentials),source=context.credentials.find(c=>c.label.startsWith('选定来源')||c.label.startsWith('app_read:')||c.label.startsWith('当前请求'));
  const command=['NETWORK','REPLAY','CONFLICT','FETCH','INLINE'].includes(caseName)?networkCommand:caseName==='FAIL'?script('process.exit(7)'):caseName==='TIMEOUT'?script("setTimeout(()=>require('node:fs').writeFileSync('late.txt','forbidden'),1000)"):caseName==='LIMIT'?script("console.log('x'.repeat(100000))"):script("console.log('PUBLIC_COMMAND_OK')");
  const replay=caseName==='REPLAY'&&messages.length===2,conflict=caseName==='CONFLICT'&&messages.length===2;
  if(messages.length===(caseName==='FETCH'?2:1)||replay||conflict)call('run_command',{command:conflict?script("console.log('different')"):command,cwd:scope,operationId:'public-step',evidence:direct,timeoutMs:caseName==='TIMEOUT'?100:10000,...(['NETWORK','REPLAY','CONFLICT','FETCH','INLINE'].includes(caseName)?{credentialBindings:[{variable:'CYBERME_SECRET_TOKEN',reference:source.reference}]}:{})});
  else{chunk({role:'assistant',content:'公开执行结果：'+messages.at(-1).content});chunk({},'stop')}
 }
 res.end('data: [DONE]\n\n');
});if(!real)await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');const api=serve({fetch:app.fetch,hostname:'127.0.0.1',port});
async function chat(message,extra={}){const payload={requestId:randomUUID(),message,contextIds:['public-credential-source'],...extra};const response=await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();return {status:response.status,data,payload}}
try{
 if(real){
  const r=await chat(`我让你测试一下选定资料中的这个 key，服务地址在资料里。请实际请求验证 HTTP 200 且 ok=true，成功后把响应 marker 保存到 ${scope}/result.txt 并回读确认。不要输出密钥。`);
  check('real model HTTP chat completes',r.status===200);
  check('real model invoked command tool',r.data.run?.tools.some(t=>t.name==='run_command'&&t.status==='succeeded'));
  check('real network authentication',authenticated>=1);
  check('real model file readback',(await readFile(scope+'/result.txt','utf8')).trim()==='PUBLIC_NETWORK_OK');
  check('real result does not contain credential',!JSON.stringify(r.data).includes(fixtureKey));
 }else{
  for(const name of ['NETWORK','REPLAY','CONFLICT','FETCH','INLINE','FAIL','TIMEOUT','LIMIT']){
   const before=hits,r=await chat(`请测试本机命令和所选测试服务 CASE_${name}。${name==='INLINE'?'凭证：'+fixtureKey+'。':''}不要输出密钥。`,['FETCH','INLINE'].includes(name)?{contextIds:[]}: {});check(name+' chat completed',r.status===200);
   check(name+' response redacted',!JSON.stringify(r.data).includes(fixtureKey));
   const ops=r.data.run.tools.filter(t=>t.name==='run_command');
   if(['NETWORK','REPLAY','CONFLICT','FETCH','INLINE'].includes(name)){check(name+' authenticated exactly once',hits===before+1&&authenticated===hits);check(name+' file persisted',(await readFile(scope+'/result.txt','utf8')).trim()==='PUBLIC_NETWORK_OK')}
   if(name==='REPLAY')check('tool replay does not duplicate receipt',ops.length===1);
   if(name==='CONFLICT')check('conflicting operation rejected',r.data.run.tools.some(t=>t.name==='run_command_rejected'&&t.output.code==='execution_conflict'));
   if(name==='FAIL')check('nonzero exit is failure',ops[0].output.exitCode===7&&ops[0].status==='failed'&&r.data.run.taskOutcome.status==='partial');
   if(name==='TIMEOUT')check('timeout remains unknown',ops[0].output.status==='unknown'&&ops[0].output.reason==='timeout');
   if(name==='LIMIT')check('output cap stops process',ops[0].output.truncated&&ops[0].output.reason==='output_limit');
   const count=modelCalls;const replay=await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(r.payload)});check(name+' same chat ID replays',replay.status===200&&modelCalls===count);
  }
  await new Promise(r=>setTimeout(r,1100));check('timed-out child cannot write late file',await access(scope+'/late.txt').then(()=>false,()=>true));
  for(const [prompt,options] of [['请测试命令 CASE_READONLY',{readOnly:true}],['> 请测试命令 CASE_QUOTED',{}],['不要执行测试命令 CASE_DENY',{}],['只讨论如何测试命令 CASE_DISCUSS',{}]]){const before=hits,r=await chat(prompt,options);check('enforced execution boundary: '+prompt,(options.readOnly?!r.data.run.availableTools.includes('run_command'):r.data.run.tools.some(t=>t.name==='run_command_rejected'))&&hits===before&&await access(scope+'/unauthorized.txt').then(()=>false,()=>true))}
  check('provider never receives source secret',!providerSawSecret);
  const {executionTools,executionCredentials}=await import('../server/src/agent-execution.ts');
  const run=S.beginRun('chat','public stop'),abort=new AbortController(),credentials=executionCredentials();const tool=executionTools(run.id,'请执行本机检查',credentials,abort.signal).find(t=>t.name==='run_command');
  const task=tool.execute('call',{command:script("require('node:fs').writeFileSync('started.txt','yes');setTimeout(()=>require('node:fs').writeFileSync('after-stop.txt','forbidden'),1500)"),cwd:scope,operationId:'stop',evidence:'请执行本机检查'},undefined);
  for(let i=0;i<100;i++){if(await access(scope+'/started.txt').then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,20))}abort.abort();const stopped=await task;
  check('stop returns interrupted',stopped.details.reason==='interrupted');await new Promise(r=>setTimeout(r,1600));check('stopped child cannot write',await access(scope+'/after-stop.txt').then(()=>false,()=>true));
  const deniedRun=S.beginRun('chat','public denial'),guard=executionTools(deniedRun.id,'不要执行命令',executionCredentials(),new AbortController().signal).find(t=>t.name==='run_command');
  const denied=await guard.execute('call',{command:'true',operationId:'denied',evidence:'执行命令'},undefined);check('dispatcher rejects negated authorization',denied.details.code==='execution_not_requested');
  const staleRun=S.beginRun('chat','public recovery'),fp=S.hash({command:'true',cwd:scope,timeoutMs:60000,credentialBindings:[]}),oid='command-'+S.hash({runId:staleRun.id,id:'unknown'});S.put('command_operations',{id:oid,runId:staleRun.id,fingerprint:fp,status:'running'});
  const stale=executionTools(staleRun.id,'请执行检查',executionCredentials(),new AbortController().signal).find(t=>t.name==='run_command');const recovered=await stale.execute('call',{command:'true',cwd:scope,operationId:'unknown',evidence:'请执行检查'},undefined);check('unfinished durable intent is not replayed',recovered.details.code==='execution_requires_readback');
 }
 const records=S.db.prepare("select data from entities where type in ('runs','command_operations')").all().map(x=>x.data).join('\n');
 check('audit never contains fixture key',!records.includes(fixtureKey));check('audit never stores command body',!records.includes('CYBERME_E2E'));
 check('no message send intent',S.db.prepare('select count(*) n from send_intents').get().n===0);
 await writeFile(out+'/result.json',JSON.stringify({scope:real?'real configured model + synthetic HTTP credential + actual OS/file execution':'controlled model + actual Chat HTTP/SDK/OS/HTTP upstream',checks,hits,authenticated,modelCalls,sourceHashes:Object.fromEntries(await Promise.all(['server/src/agent-execution.ts','server/src/agent.ts','server/agent/agents.md'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])))},null,2));
 console.log(JSON.stringify({pass:true,checks:checks.length,real,out}));
}catch(e){await writeFile(out+'/result.json',JSON.stringify({checks,error:e.message,hits,authenticated,real},null,2));console.error(e.message);process.exitCode=1}
finally{await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>upstream.close(r)),...(!real?[new Promise(r=>model.close(r))]:[])]);await rm(scope+'/config.json',{force:true});process.exit(process.exitCode||0)}
