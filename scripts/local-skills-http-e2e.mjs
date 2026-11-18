// Failure cases: output/agent-local-skills-20261112/FAILURE-CASES.md (recorded before implementation).
// Actual Chat HTTP -> Pi SDK -> filesystem, synthetic skills; no business operations.
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const real=process.argv.includes('--real'),keep=process.argv.includes('--serve');
const port=real?46923:46921,modelPort=46922,scope=resolve('.local/acceptance/local-skills-'+randomUUID()),out=resolve('output/agent-local-skills-20261112');
await mkdir(scope+'/skills/sub2api/references',{recursive:true,mode:0o700});await mkdir(scope+'/aliases',{recursive:true});await mkdir(out,{recursive:true});
const secret='sk-'+randomUUID().replaceAll('-',''),marker='PUBLIC_LOCAL_SKILL_OK';
await writeFile(scope+'/skills/sub2api/SKILL.md',`---\nname: sub2api\ndescription: Public synthetic skill for discovery acceptance\n---\n${marker}\nThis is a synthetic skill. Only read this document for this acceptance.\nReference: references/guide.md\nFixture credential: ${secret}\n`);
await writeFile(scope+'/skills/sub2api/references/guide.md','PUBLIC_REFERENCE_OK\n'+'x'.repeat(25000)+'\nPUBLIC_REFERENCE_END');
await writeFile(scope+'/skills/sub2api/read-only.mjs',"require('node:fs').writeFileSync('must-not-exist','bad')");
await symlink(scope+'/skills/sub2api',scope+'/aliases/sub2api');
await symlink(scope+'/outside.md',scope+'/skills/sub2api/escape.md');await writeFile(scope+'/outside.md','OUTSIDE_PRIVATE_MARKER');
await writeFile(scope+'/skills/sub2api/big.md','x'.repeat(262145));
await mkdir(scope+'/skills/broken',{recursive:true});await writeFile(scope+'/skills/broken/SKILL.md','invalid manifest');
// local-skills.md: dot directories are skipped by SDK discovery; `.system` is its own explicit root, and
// CYBERME_SKILL_ROOTS replaces the default list exactly, so the fixture names that root explicitly.
await mkdir(scope+'/skills/.system/nested',{recursive:true});await writeFile(scope+'/skills/.system/nested/SKILL.md','---\nname: nested\ndescription: nested public skill\n---\nPUBLIC_NESTED_OK');
const cfg=real?JSON.parse(await readFile(resolve(homedir(),'Library/Application Support/OpsTwins/.local/config.json'),'utf8')):{llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-local-skills'}};
await writeFile(scope+'/config.json',JSON.stringify(cfg),{mode:0o600});
Object.assign(process.env,{CYBERME_SKILL_ROOTS:JSON.stringify([scope+'/skills',scope+'/skills/.system',scope+'/aliases',scope+'/missing']),OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开技能验收',language:'zh-CN'},autonomy:{holdSending:true}});
const checks=[],check=(name,ok)=>{checks.push({name,pass:!!ok});if(!ok)throw Error(name)};
let providerSawSecret=false,modelCalls=0;
const content=m=>typeof m?.content==='string'?m.content:(m?.content||[]).map(p=>p.text||'').join('\n');
const model=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;if(raw.includes(secret))providerSawSecret=true;modelCalls++;
 const input=JSON.parse(raw),idx=input.messages.findLastIndex(m=>m.role==='user'),direct=content(input.messages[idx]).split('当前用户请求：\n').at(-1),tag=direct.match(/CASE_([A-Z]+)/)?.[1]||'READ';
 const tools=input.tools||[],messages=input.messages.slice(idx+1).filter(m=>m.role==='tool'),outputs=messages.map(m=>{try{return JSON.parse(content(m))}catch{return {}}});
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 const call=(name,args)=>{chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+messages.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls')};
 const has=name=>tools.some(t=>t.function?.name===name);
 const listed=outputs.find(o=>Array.isArray(o.items)),skill=listed?.items.find(s=>s.name==='sub2api');
 if(tag==='GATE'){chunk({role:'assistant',content:'当前工具：'+tools.map(t=>t.function?.name).join(',')});chunk({},'stop')}
 else if(!has('list_local_skills')){chunk({role:'assistant',content:'技能工具不可用。'});chunk({},'stop')}
 else if(!messages.length)call('list_local_skills',{query:tag==='MISSING'?'not-present':tag==='ALL'?'':'/sub2api',limit:tag==='ALL'?1:30});
 else if(tag==='MISSING'||tag==='ALL'){chunk({role:'assistant',content:'发现结果：'+JSON.stringify(outputs.at(-1))});chunk({},'stop')}
 else if(messages.length===1)call('read_local_skill',{skill:skill.id});
 else if(['ESCAPE','LINK','BIG','REFERENCE','SCRIPT','OFFSET'].includes(tag)&&messages.length===2)call('read_local_skill',{skill:skill.id,file:tag==='ESCAPE'?'../outside.md':tag==='LINK'?'escape.md':tag==='BIG'?'big.md':tag==='SCRIPT'?'read-only.mjs':'references/guide.md',...(tag==='OFFSET'?{offset:999999}:{})});
 else if(tag==='REFERENCE'&&messages.length===3)call('read_local_skill',{skill:skill.id,file:'references/guide.md',offset:outputs.at(-1).nextOffset});
 else {const read=outputs.find(o=>o.content?.includes(marker));chunk({role:'assistant',content:read?'已读取本机 sub2api 技能。\n\n'+read.content.replace(/Fixture credential:.*/,'')+'\n读取结果：'+JSON.stringify(outputs.at(-1)):'读取结果：'+JSON.stringify(outputs.at(-1))});chunk({},'stop')}
 res.end('data: [DONE]\n\n');
});if(!real)await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts'),gate=new Hono(),web=resolve('.local/local-skills-web');
gate.all('/api/*',c=>app.fetch(c.req.raw));
gate.get('*',async c=>{const path=resolve(web,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!path.startsWith(web+'/'))return c.notFound();try{c.header('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream');return c.body(await readFile(path))}catch{return c.notFound()}});
const api=serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
const chat=async(message,extra={})=>{const response=await fetch(`http://127.0.0.1:${port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID(),message,...extra})});return {status:response.status,body:await response.json()}};
const names=r=>r.body.run?.availableTools||[],tools=r=>r.body.run?.tools||[];
try{
 if(real){
  const r=await chat('/sub2api 的 skills 你看看呢？只读取技能和它的参考资料，告诉我技能名称、用途和验收标记，不执行里面的操作。');
  check('real model chat succeeds',r.status===200);check('real model discovers skill',tools(r).some(t=>t.name==='list_local_skills'&&t.status==='succeeded'));check('real model reads skill',tools(r).some(t=>t.name==='read_local_skill'&&t.status==='succeeded'));check('real model reports actual marker',JSON.stringify(r.body).includes(marker));check('real model does not execute commands',!tools(r).some(t=>t.name==='run_command'||t.name==='command_started'));check('real model no credential leak',!JSON.stringify(r.body).includes(secret));
 }else{
  const r=await chat('/sub2api 的 skills 你看看呢？');check('exact screenshot prompt succeeds',r.status===200);check('natural request enables command tool',names(r).includes('run_command'));check('discovery and read are actually invoked',tools(r).filter(t=>['list_local_skills','read_local_skill'].includes(t.name)).length===2);check('actual file content reaches answer',JSON.stringify(r.body).includes(marker));check('skill reading is not command execution',!tools(r).some(t=>t.name==='command_started'));check('skill content absent from run audit',!JSON.stringify(r.body.run.tools).includes(marker));
  for(const [tag,code]of [['ESCAPE','skill_path_forbidden'],['LINK','skill_path_forbidden'],['BIG','skill_file_too_large'],['OFFSET','skill_offset_invalid']]){const x=await chat('/sub2api 你看看 CASE_'+tag);check(tag+' reports actual rejection',tools(x).some(t=>t.name==='read_local_skill'&&t.output.code===code))}
  const reference=await chat('/sub2api 你看看 CASE_REFERENCE');check('reference pagination reads through end',JSON.stringify(reference.body).includes('PUBLIC_REFERENCE_END'));check('reference tools audit contains no body',!JSON.stringify(reference.body.run.tools).includes('PUBLIC_REFERENCE_OK'));
  const script=await chat('/sub2api 你看看 CASE_SCRIPT');check('script is only read',!tools(script).some(t=>t.name==='command_started'));
  const missing=await chat('skills CASE_MISSING');check('missing skill is truthful',JSON.stringify(missing.body).includes('"total":0')||JSON.stringify(missing.body).includes('\\"total\\":0'));
  const all=await chat('skills CASE_ALL');check('symlink aliases deduplicated and nested skill included',JSON.stringify(all.body).includes('\\"total\\":2'));check('missing roots explicitly reported',JSON.stringify(all.body).includes('unavailableRoots'));check('listing paginates',JSON.stringify(all.body).includes('nextOffset'));
  // Contract since 2026-11-12 (local-skills.md / agent-execution.md): run_command is REGISTERED for every writable direct
  // input (discovery); only readOnly removes it. Authority is decided at dispatch from the bound directive. The CASE_GATE
  // provider answers in text and never calls a tool, so this loop checks registration and the absence of any command
  // record only; the dispatcher refusal of quoted/negated/discussion input is exercised by scripts/agent-execution-http-e2e.mjs
  // (`dispatcher refuses:` checks), not here.
  for(const [message,extra,expected]of [['/sub2api 的 skills 你看看呢？ CASE_GATE',{readOnly:true},false],['重置本机合成配额 CASE_GATE',{},true],['reset local fixture CASE_GATE',{},true],['> 请执行命令 CASE_GATE',{},true],['不要执行命令 CASE_GATE',{},true],['只讨论如何执行命令 CASE_GATE',{},true]]){const x=await chat(message,extra);check(message+' command registration',names(x).includes('run_command')===expected);check(message+' no command attempted or recorded',!tools(x).some(t=>['run_command','run_command_rejected','command_started'].includes(t.name)));check(message+' skill discovery remains read only',names(x).includes('list_local_skills'))}
  const {runAgent}=await import('../server/src/agent.ts');
  const limited=await runAgent('CASE_GATE',{kind:'draft',contextIds:[],readOnly:true});check('source limited draft has no local skills',!limited.run.availableTools.includes('list_local_skills'));
  check('provider never sees credential',!providerSawSecret);
 }
 const audit=S.db.prepare("SELECT data FROM entities WHERE type='runs'").all().map(r=>r.data).join('\n');check('audit contains no credential',!audit.includes(secret));check('no send intents',S.db.prepare('SELECT count(*) n FROM send_intents').get().n===0);check('reading script never creates file',await readFile(scope+'/must-not-exist').then(()=>false,()=>true));
 await writeFile(out+'/'+(real?'real':'http')+'-result.json',JSON.stringify({checks,scope:'Actual Chat HTTP + Pi SDK + local filesystem; '+(real?'configured real model':'controlled model')+'; synthetic skills only',url:`http://127.0.0.1:${port}/cyberme.html`,sourceHashes:Object.fromEntries(await Promise.all(['server/src/local-skills.ts','server/src/agent.ts','server/src/agent-execution.ts','server/agent/agents.md'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),modelCalls},null,2));
 console.log(JSON.stringify({pass:true,real,checks:checks.length,url:`http://127.0.0.1:${port}/cyberme.html`,out}));
}catch(e){await writeFile(out+'/'+(real?'real':'http')+'-result.json',JSON.stringify({checks,error:e.message},null,2));console.error(e);process.exitCode=1}
if(keep&&!process.exitCode){console.log('Fixture remains available for browser acceptance');process.on('SIGTERM',()=>{api.closeAllConnections();api.close();model.closeAllConnections();model.close();process.exit(0)})}
else{api.closeAllConnections();api.close();if(!real){model.closeAllConnections();model.close()}await rm(scope+'/config.json',{force:true});process.exit(process.exitCode||0)}
