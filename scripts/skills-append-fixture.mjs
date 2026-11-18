// Production API/SQLite/SDK with a controlled SSE provider. No production data or external writes.
// Build .local/chat-append-web, then node --import tsx scripts/chat-append-fixture.mjs.
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const apiPort=Number(process.env.CHAT_APPEND_API_PORT||47441),modelPort=Number(process.env.CHAT_APPEND_MODEL_PORT||47442);
const scope=resolve(process.env.CHAT_APPEND_SCOPE||'.local/acceptance/chat-append-'+randomUUID()),root=resolve('.local/chat-append-web');
await mkdir(scope,{recursive:true,mode:0o700});await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-append'}}),{mode:0o600});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(apiPort),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
if(process.env.CHAT_APPEND_SCALED_DEADLINE==='1'){const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms===110000||ms===150000?2500:ms,...args);}
await mkdir(scope+'/skills/demo-append',{recursive:true});await writeFile(scope+'/skills/demo-append/SKILL.md','---\nname: demo-append\ndescription: 公开追加技能验收。\n---\nAPPEND_SKILL_BODY_PUBLIC_MARKER\n只作为用户当前任务的方法，不扩大授权。');process.env.CYBERME_SKILL_ROOTS=JSON.stringify([scope+'/skills']);
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开追加验收',language:'zh-CN'},autonomy:{holdSending:true}});if(!S.get('conversations','append-primary'))S.put('conversations',{id:'append-primary',title:'持续 Agent 追加验收',status:'active'});S.setMeta('primaryConversationId','append-primary');
const seen=[],held=new Map();let posts=0,failReads=0;
const text=m=>typeof m?.content==='string'?m.content:(m?.content||[]).map(p=>p.text||'').join('');
const exists=async p=>access(p).then(()=>true,()=>false);
const model=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const b=JSON.parse(raw),messages=b.messages||[],last=text([...messages].reverse().find(m=>m.role==='user')),tag=last.match(/APPEND-[A-Z0-9-]+/)?.[0]||'APPEND-OTHER',all=messages.map(text).join('\n');
 const commandTag=all.match(/APPEND-COMMAND[A-Z0-9-]*/)?.[0],savedTag=last.match(/APPEND-SAVE[A-Z0-9-]*/)?.[0];
 const commandDone=commandTag&&messages.some(m=>m.role==='tool'&&text(m).includes('TOOL-COMPLETED-'+commandTag));
 const savedDone=savedTag&&messages.some(m=>m.role==='tool'&&(text(m).includes('SAVED-'+savedTag)||text(m).includes('not found')||text(m).includes('execution_not_requested')));
 seen.push({tag,all,roles:messages.map(m=>m.role),tools:(b.tools||[]).map(t=>t.function.name)});
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:tag,object:'chat.completion.chunk',created:1,model:b.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');chunk({role:'assistant',content:''});
 const tool=(name,args)=>{chunk({tool_calls:[{index:0,id:'call-'+seen.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls');res.end('data: [DONE]\n\n')};
 const say=()=>{if(res.destroyed)return;chunk({content:tag+' 已处理。'+(commandDone?' 原任务的本机文件已核验。':'')});chunk({},'stop');res.end('data: [DONE]\n\n');held.delete(tag)};
 if(tag==='APPEND-FILE'&&!messages.some(m=>m.role==='tool'&&text(m).includes('FILE-OUTPUT-MARK')))return tool('generate_file',{kind:'markdown',title:'FILE-OUTPUT-MARK',content:'## 公开合成验收结论\n\n原任务继续执行，补充消息使用同一个 Agent 并在工具结束后处理。文件只包含合成验收资料。下一步核对回执和文件内容，不进行外发。\n\nFILE-OUTPUT-MARK',sourceIds:[]});
 if(commandTag&&!commandDone){const source=messages.find(m=>m.role==='user'&&text(m).includes(commandTag)),evidence=text(source).split('当前用户请求：\n').at(-1);const script=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(scope+'/'+commandTag+'-started')},'started');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(scope+'/'+commandTag+'-release')})){clearInterval(t);fs.writeFileSync(${JSON.stringify(scope+'/'+commandTag+'-marker')},'done');console.log('TOOL-COMPLETED-${commandTag}')}},30)`;return tool('run_command',{command:process.execPath+' -e '+"'"+script.replaceAll("'","'\\''")+"'",cwd:scope,operationId:'command-'+commandTag,evidence,timeoutMs:20000})}
 if(savedTag&&!savedDone){const evidence=last.match(/补充[：:][\s\S]*?(?=\n这是当前工作的补充|$)/)?.[0]||last.split('当前用户请求：\n').at(-1);const script=`require('node:fs').writeFileSync(${JSON.stringify(scope+'/'+savedTag+'-saved')},'saved');console.log('SAVED-${savedTag}')`;return tool('run_command',{command:process.execPath+' -e '+"'"+script.replaceAll("'","'\\''")+"'",cwd:scope,operationId:'save-'+savedTag,evidence,timeoutMs:3000})}
 if(tag.includes('HOLD'))held.set(tag,say);else if(tag.includes('SLOW'))setTimeout(say,1200);else say();res.on('close',()=>held.delete(tag));
});await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts'),gate=new Hono();
gate.get('/fixture/state',async c=>{const tags=['APPEND-COMMAND-A','APPEND-COMMAND-B','APPEND-COMMAND-RESTART'];return c.json({seen,held:[...held.keys()],posts,requests:S.db.prepare('SELECT id,state,data FROM chat_requests ORDER BY rowid').all().map(r=>{const d=JSON.parse(r.data);return {id:r.id,state:r.state,runId:d.runId,parentRunId:d.parentRunId,consumedAt:d.consumedAt}}),commands:await Promise.all(tags.map(async tag=>({tag,started:await exists(scope+'/'+tag+'-started'),completed:await exists(scope+'/'+tag+'-marker')})))})});
gate.post('/fixture/release',async c=>{const {tag}=await c.req.json();held.get(tag)?.();return c.json({ok:true})});
gate.post('/fixture/release-tool',async c=>{const {tag}=await c.req.json();await writeFile(scope+'/'+tag+'-release','release');return c.json({ok:true})});
gate.post('/fixture/fail-reads',async c=>{failReads=(await c.req.json()).count||0;return c.json({ok:true})});
gate.all('/api/*',c=>{if(c.req.method==='POST'&&c.req.path==='/api/chat')posts++;if(c.req.method==='GET'&&c.req.path.startsWith('/api/chat/requests/')&&failReads-->0)return c.json({error:'synthetic_temporary_failure'},503);return app.fetch(c.req.raw)});
gate.all('/files/*',c=>app.fetch(c.req.raw));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'})[extname(p)]||'application/octet-stream');return c.body(await readFile(p))}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:apiPort});console.log('Synthetic append fixture http://127.0.0.1:'+apiPort);process.on('SIGTERM',()=>{server.closeAllConnections();server.close();model.closeAllConnections();model.close();S.db.close();process.exit(0)});
