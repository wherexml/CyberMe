// Durable queued chat progress budget fixture: the production server app (HTTP, Pi SDK session, SQLite, real
// run_command child processes) on isolated synthetic data, plus a controlled OpenAI-compatible SSE provider.
// Failure cases: /Users/steve/.local/state/m2max-claude-remote/runs/cyberme-progress-timeout-20261113T130240-cf0b63/FAILURE-CASES.md
//
//   npx vite build --config web/mygo.vite.config.ts --outDir ../.local/chat-progress-budget-web   (browser only)
//   node --import tsx scripts/chat-progress-budget-fixture.mjs
// Env: PROGRESS_API_PORT (47561; source browser 47565), PROGRESS_MODEL_PORT (47562; browser 47566), PROGRESS_SCOPE.
// SCALED CLOCK: phase windows are lowered through the real server env knobs (which can only lower them); the legacy
// single answer budget (CYBERME_CHAT_ANSWER_BUDGET_MS) stays 2s for synchronous/internal baselines.
// Budgets are scaled through the real server env knobs; /fixture/env changes them between cases (read per run).
// No production data, secrets, real provider, Feishu or sub2api. Every OS effect is a marker file in the scope.
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const port=Number(process.env.PROGRESS_API_PORT||47561),modelPort=Number(process.env.PROGRESS_MODEL_PORT||47562);
const scope=resolve(process.env.PROGRESS_SCOPE||'.local/acceptance/chat-progress-budget-'+randomUUID());
const web=resolve(process.env.PROGRESS_WEB||'.local/chat-progress-budget-web');
await mkdir(scope,{recursive:true,mode:0o700});
const put=async(p,s)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p,s,{mode:0o600})};
const exists=p=>access(p).then(()=>true,()=>false);
const skillDir=scope+'/skills/progress-demo';
const fresh=!await exists(scope+'/seeded');
if(fresh){
 await put(skillDir+'/SKILL.md',`---\nname: progress-demo\ndescription: 合成多步骤标记流程，仅用于时间预算验收。\n---\n# Synthetic multi-step marker flow\nRun scripts/step.mjs with run_command (cwd = this directory) for each requested step, then read markers back.\nNever contact any service.\n`);
 // Each step records start (with pid), sleeps, then records end. An aborted step never writes end.
 await put(skillDir+'/scripts/step.mjs',`import fs from 'node:fs';const [id,step,ms]=process.argv.slice(2);fs.mkdirSync('markers',{recursive:true});fs.appendFileSync('markers/'+id+'.log','start '+step+' '+process.pid+'\\n');setTimeout(()=>{fs.appendFileSync('markers/'+id+'.log','end '+step+'\\n');console.log('STEP_OK '+id+' '+step)},Number(ms)||0);`);
}
const BASE_ENV={CYBERME_SKILL_ROOTS:JSON.stringify([scope+'/skills']),CYBERME_CHAT_ANSWER_BUDGET_MS:'2000',CYBERME_CHAT_HEADERS_MS:'2000',CYBERME_CHAT_FIRST_CONTENT_MS:'2000',CYBERME_CHAT_STREAM_SILENCE_MS:'1500',CYBERME_CHAT_TOOL_GRACE_MS:'1000',CYBERME_CHAT_TOOL_FALLBACK_MS:'4000',CYBERME_CHAT_PREPARE_BUDGET_MS:'20000',CYBERME_CHAT_DURABLE_HARD_CAP_MS:'20000',CYBERME_AGENT_SESSION_COMPACT_RATIO:'0.95'};
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:String(port),OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',...BASE_ENV});
await put(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-progress-model'}}));
const S=await import('../server/src/store.ts');
if(fresh){
 S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开处理时限验收',language:'zh-CN'},autonomy:{holdSending:true}});
 S.put('conversations',{id:'primary',title:'公开处理时限验收'});S.setMeta('primaryConversationId','primary');
 // A successful read whose BUSINESS data has a `code` field (must not be classified as a tool error).
 S.put('tasks',{id:'qa-task-code',title:'合成任务（含业务编码）',status:'todo',code:'BIZ-001'});
 // A no-auth, read-permitted REST connection to the fixture's own delayed JSON endpoint (production connection_read path,
 // inner 12s fetch bound, no watchdog-known own limit). Only reachable on 127.0.0.1 inside this isolated scope.
 S.put('connections',{id:'qa-slow-rest',name:'合成慢接口',type:'rest',provider:'custom',status:'connected',permissions:['read'],endpoint:`http://127.0.0.1:${modelPort}/slow`,config:{authMethod:'none'}});
 await put(scope+'/seeded','true');
}

// ---------- controlled provider ----------
// The tag in the current user request selects the script: #<case>:<id>. Rounds = tool results after that request.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const textOf=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.map(p=>p.text||'').join(''):'';
const seen=[];const node=JSON.stringify(process.execPath);
const EVIDENCE='请实际在公开隔离目录运行合成步骤脚本并回读标记';
const step=(id,i,ms,timeoutMs=60000,cwd)=>({command:`${node} scripts/step.mjs ${id} ${i} ${ms}`,cwd:cwd||skillDir,operationId:`${id}-${i}`,evidence:EVIDENCE,timeoutMs});
const slow={hits:0,completed:0};
const provider=createServer(async(req,res)=>{
 if(req.url?.startsWith('/slow')){slow.hits++;await sleep(Number(process.env.PROGRESS_SLOW_MS||2000));slow.completed++;res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({synthetic:true,value:'SLOW_READ_OK'}))}
 let raw='';for await(const b of req)raw+=b;let input;try{input=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
 const messages=input.messages||[],tools=(input.tools||[]).map(t=>t.function?.name).filter(Boolean);
 const idx=messages.findLastIndex(m=>m.role==='user'&&/#[a-z]+:[\w-]+/.test(textOf(m)));
 const tagM=idx>=0?textOf(messages[idx]).match(/#([a-z]+):([\w-]+)/):null,kind=tagM?.[1]||'',id=tagM?.[2]||'';
 const rounds=idx>=0?messages.slice(idx+1).filter(m=>m.role==='tool').length:0;
 const entry={at:Date.now(),kind,id,rounds,tools:tools.length,probe:/Reply with exactly OK/.test(textOf(messages.at(-1))),closed:false,headers:false};seen.push(entry);if(seen.length>2000)seen.shift();
 let closed=false;res.on('close',()=>{closed=true;entry.closed=!res.writableEnded});
 const hold=async ms=>{const end=Date.now()+ms;while(Date.now()<end&&!closed)await sleep(25);return !closed};
 const head=()=>{res.writeHead(200,{'content-type':'text/event-stream'});entry.headers=true};
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'p',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 const done=()=>{res.write('data: '+JSON.stringify({id:'p',object:'chat.completion.chunk',created:1,model:input.model,choices:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\n');res.end('data: [DONE]\n\n')};
 const say=async(text,streamMs=0)=>{head();const parts=streamMs?8:1;for(let i=0;i<parts;i++){if(closed)return;chunk({role:'assistant',content:text.slice(Math.floor(i*text.length/parts),Math.floor((i+1)*text.length/parts))});if(streamMs&&!await hold(streamMs/parts))return}chunk({},'stop');done()};
 const call=(name,args)=>{head();chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+seen.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls');done()};
 const calls=list=>{head();chunk({role:'assistant',tool_calls:list.map(([name,args],i)=>({index:i,id:'call-'+seen.length+'-'+i,type:'function',function:{name,arguments:JSON.stringify(args)}}))});chunk({},'tool_calls');done()};
 // Valid deltas spread over `ms`: text, reasoning (provider reasoning_content) or streamed tool-call arguments.
 const slowText=async(text,ms,parts=20)=>{head();for(let i=0;i<parts;i++){if(closed)return;chunk({role:'assistant',content:text.slice(Math.floor(i*text.length/parts),Math.floor((i+1)*text.length/parts))||'.'});if(!await hold(ms/parts))return}chunk({},'stop');done()};
 const slowThink=async(ms,parts=20)=>{head();for(let i=0;i<parts;i++){if(closed)return;chunk({role:'assistant',reasoning_content:'合成推理'+i+'。'});if(!await hold(ms/parts))return}chunk({content:'THINK_DONE'});chunk({},'stop');done()};
 const slowArgs=async(name,args,ms,parts=20)=>{head();const a=JSON.stringify(args),cid='call-'+seen.length;chunk({role:'assistant',tool_calls:[{index:0,id:cid,type:'function',function:{name,arguments:''}}]});for(let i=0;i<parts;i++){if(closed)return;chunk({tool_calls:[{index:0,function:{arguments:a.slice(Math.floor(i*a.length/parts),Math.floor((i+1)*a.length/parts))}}]});if(!await hold(ms/parts))return}chunk({},'tool_calls');done()};
 const fail500=()=>{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'synthetic provider failure'}}))};
 const attemptsFor=()=>seen.filter(e=>e.id===id&&e.rounds===rounds).length;
 if(entry.probe){if(!await hold(Number(process.env.PROGRESS_PROBE_HOLD_MS||0)))return;return say('OK')}
 if(!tools.length)return say('SUMMARY: synthetic progress fixture.');
 // Header latency per round, like the reported 1.5–5.2s provider rounds (scaled).
 const latency=Number(process.env.PROGRESS_HEADER_MS||300);
 switch(kind){
  case 'replay':{ // slow read (0.9 idle) + 6 commands + final stream; total several idle windows, all progressing.
   if(!await hold(latency))return;
   if(rounds===0)return call('run_command',step(id,0,1800));
   if(rounds<=6)return call('run_command',step(id,rounds,200));
   return say('REPLAY_DONE 已完成全部合成步骤并回读标记。',1200);
  }
  case 'hdrstall':{if(rounds===0){if(!await hold(latency))return;return call('run_command',step(id,0,100))}await hold(600000);return}
  case 'streamstall':{head();while(!closed){chunk({role:'assistant',content:'.'});await hold(300)}return} // endless VALID stream: only the hard cap ends it
  case 'longstream':{if(rounds===0){if(!await hold(latency))return;return slowText('LONG_STREAM_OK '+'有效输出'.repeat(40),Number(process.env.PROGRESS_LONG_MS||8000))}return say('UNEXPECTED')}
  case 'longthink':{if(!await hold(latency))return;return slowThink(Number(process.env.PROGRESS_LONG_MS||8000))}
  case 'longargs':{if(!await hold(latency))return;if(rounds===0)return slowArgs('run_command',step(id,0,100),Number(process.env.PROGRESS_LONG_MS||8000));return say('LONG_ARGS_DONE')}
  case 'firststall':{head();while(!closed){res.write(': keepalive\n\n');await hold(300)}return} // 200 + SSE comments, no content
  case 'emptyframes':{head();while(!closed){chunk({role:'assistant',content:''});await hold(300)}return} // 200 + empty deltas
  case 'silence':{head();chunk({role:'assistant',content:'partial '});while(!closed){res.write(': keepalive\n\n');await hold(300)}return} // content, then pings only
  case 'latetool':{if(rounds===0){if(!await hold(1600))return;return call('run_command',step(id,0,2500,4000))}if(!await hold(latency))return;return say('LATE_TOOL_DONE')}
  case 'parallel':{if(!await hold(latency))return;if(rounds===0)return calls([['run_command',step(id,'A',3000,5000)],['run_command',step(id,'B',300,5000)]]);return say('PARALLEL_DONE')}
  case 'retry':{if(attemptsFor()===1)return fail500();if(!await hold(latency))return;return say('RETRY_OK')}
  case 'retryfail':return fail500();
  case 'getentity':{if(!await hold(latency))return;if(rounds<3)return call('get_entity',{type:'tasks',id:'qa-task-code'});return say('GET_ENTITY_DONE')} // identical SUCCESSFUL reads
  case 'structerr':{if(!await hold(latency))return;return call('get_entity',{type:'tasks',id:'qa-missing-entity'})} // wrapper {error,code}
  case 'cmdfail':{if(!await hold(latency))return;return call('run_command',{command:`${node} -e "process.exit(3)"`,cwd:skillDir,operationId:id+'-fail',evidence:EVIDENCE,timeoutMs:5000})} // nonzero exit, no effect
  case 'cmdunknown':{if(!await hold(latency))return;if(rounds===0)return call('run_command',step(id,'U',3000,500));return say('UNKNOWN_REPORTED')} // executor timeout -> unknown receipt
  case 'fallback':{if(!await hold(latency))return;if(rounds===0)return call('app_read',{action:'connection_read',id:'qa-slow-rest'});return say('UNEXPECTED_AFTER_FALLBACK')}
  case 'repeaterr':{if(!await hold(latency))return;return call('run_command',step(id,'R',100,60000,skillDir+'/missing-directory'))} // identical args + identical error
  case 'toolstall':{if(!await hold(latency))return;if(rounds===0)return call('run_command',step(id,0,30000));return say('UNEXPECTED_AFTER_TOOLSTALL')}
  case 'loop':{if(!await hold(latency))return;return call('run_command',step(id,rounds,100))} // endless fast progress
  case 'append':{if(!await hold(latency))return;return call('run_command',step(id,rounds,600))}
  case 'stop':{if(!await hold(latency))return;return call('run_command',step(id,rounds,800))}
  default:return say('NO_TAG');
 }
});
await new Promise(r=>provider.listen(modelPort,'127.0.0.1',r));

const {app}=await import('../server/src/index.ts');
const gate=new Hono();let chatPosts=0;
const ENV_KEYS=['CYBERME_CHAT_ANSWER_BUDGET_MS','CYBERME_CHAT_DURABLE_HARD_CAP_MS','CYBERME_CHAT_DURABLE_MAX_PROVIDER_REQUESTS','CYBERME_CHAT_HEADERS_MS','CYBERME_CHAT_FIRST_CONTENT_MS','CYBERME_CHAT_STREAM_SILENCE_MS','CYBERME_CHAT_TOOL_GRACE_MS','CYBERME_CHAT_TOOL_FALLBACK_MS','CYBERME_CHAT_REPEAT_ERROR_LIMIT','PROGRESS_HEADER_MS','PROGRESS_PROBE_HOLD_MS','PROGRESS_SLOW_MS'];
gate.get('/fixture/state',c=>c.json({scope,skillDir,port,modelPort,chatPosts,slow,provider:seen.map(({at,kind,id,rounds,closed,headers,probe})=>({at,kind,id,rounds,closed,headers,probe})),env:Object.fromEntries(ENV_KEYS.map(k=>[k,process.env[k]??null]))}));
gate.post('/fixture/env',async c=>{const b=await c.req.json();for(const [k,v] of Object.entries(b)){if(!ENV_KEYS.includes(k))return c.json({error:'key_not_allowed',key:k},400);if(v===null)delete process.env[k];else process.env[k]=String(v)}return c.json({ok:true})});
gate.post('/fixture/env/reset',c=>{for(const k of ENV_KEYS)delete process.env[k];Object.assign(process.env,BASE_ENV);return c.json({ok:true})});
gate.get('/fixture/markers/:id',async c=>{const t=await readFile(skillDir+'/markers/'+c.req.param('id').replace(/[^\w-]/g,'')+'.log','utf8').catch(()=>'');return c.json({lines:t.split('\n').filter(Boolean)})});
gate.post('/api/chat',async c=>{chatPosts++;return app.fetch(c.req.raw)});
gate.all('/api/*',c=>app.fetch(c.req.raw));
gate.get('*',async c=>{const p=resolve(web,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(web+'/'))return c.notFound();try{c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(p)]||'application/octet-stream');return c.body(await readFile(p))}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log(JSON.stringify({ready:true,port,modelPort,scope,url:`http://127.0.0.1:${port}/cyberme.html`}));
process.on('SIGTERM',()=>{server.closeAllConnections?.();server.close();provider.closeAllConnections();provider.close();try{S.db.close()}catch{}process.exit(0)});
