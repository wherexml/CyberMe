// Configured real supplier + isolated real Chat/SDK/OS/files. Synthetic skills and effects only.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const scope=resolve('.local/acceptance/skills-real-'+randomUUID()),out=resolve('output/skills-integration-20261112'),base='http://127.0.0.1:47423',checks=[];await mkdir(scope,{recursive:true,mode:0o700});
const check=(name,ok,detail)=>{checks.push({name,pass:!!ok,...(!ok?{detail}: {})});console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw Error(name)},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn(process.execPath,['--import','tsx','scripts/skills-integration-fixture.mjs'],{cwd:resolve('.'),env:{...process.env,SKILLS_REAL:'1',SKILLS_SCOPE:scope,SKILLS_API_PORT:'47423',SKILLS_MODEL_PORT:'47424'},stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});return {http:r.status,...await r.json()}};
const conv=async title=>(await api('POST','/api/conversations',{title})).id,chat=(cid,message)=>api('POST','/api/chat',{requestId:randomUUID(),conversationId:cid,message}),calls=r=>r.run?.tools||[];
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await api('GET','/api/health')).ok){ready=true;break}}catch{}await sleep(100)}check('isolated real-model fixture starts',ready);
 const cid=await conv('真实模型主动使用技能'),request='请整理这个公开隔离工作区的状态，采用现成的本机流程保存验收标记，并实际回读标记文件和操作次数。只操作公开验收文件，不处理其他业务；参数已在本机流程中给出。';
 const a=await chat(cid,request);check('natural-language real-model chat succeeds',a.http===200,{http:a.http,failureCode:a.failureCode,error:a.error});
 check('real model selects and reads actual skill',calls(a).some(t=>t.name==='read_local_skill'&&t.status==='succeeded'));
 check('real model executes actual command',calls(a).some(t=>t.name==='run_command'&&t.status==='succeeded'));
 check('real script creates expected marker',(await readFile(scope+'/skills/demo-work/marker.txt','utf8')).trim()==='PUBLIC_SKILL_ACTION_OK');
 check('real script applies effect once',(await readFile(scope+'/skills/demo-work/effects.log','utf8')).trim()==='APPLIED');
 check('real model reports readback result',JSON.stringify(a).includes('PUBLIC_SKILL_ACTION_OK'));
 const session=await api('GET',`/api/chat/conversations/${cid}/agent-session`);
 const refresh=await chat(cid,'请读取 demo-work 的参考文档，告诉我其公开标记，只读即可。');check('real explicit reference inspection succeeds',refresh.http===200&&JSON.stringify(refresh).includes('PUBLIC_PROCEDURE_V1'));check('real conversation reuses same instance',(await api('GET',`/api/chat/conversations/${cid}/agent-session`)).instanceId===session.instanceId);
 const rcid=await conv('真实模型跨轮恢复'),firstRequest='请按公开恢复流程执行第一步：用流程给出的脚本保存标记，把命令 timeoutMs 设为 200 毫秒。超时后明确保留待核对状态，本轮先停在这里；稍后我说继续时只回读实际文件和次数，不能重复执行写入。';
 const first=await chat(rcid,firstRequest);check('real recovery first round returns',first.http===200||first.http===409);check('real first operation actually times out',calls(first).some(t=>t.name==='run_command'&&t.output?.status==='unknown'));
 check('real first effect exists exactly once',(await readFile(scope+'/skills/demo-recovery/progress.log','utf8')).trim()==='APPLIED');
 const second=await chat(rcid,'继续');check('real continuation obtains same-task executor',second.run?.availableTools.includes('run_command'));check('real continuation uses tools',calls(second).some(t=>t.name==='run_command'&&t.status==='succeeded'));
 check('real continuation does not repeat unknown effect',(await readFile(scope+'/skills/demo-recovery/progress.log','utf8')).trim()==='APPLIED');check('real continuation reports actual marker',JSON.stringify(second).includes('PUBLIC_RECOVERY_OK'));
 await writeFile(out+'/real-result.json',JSON.stringify({checks,scope,boundary:'Configured real model; actual production Chat API/SDK/OS; synthetic skills/files only; no real business reset/send/deploy.',url:base+'/cyberme.html'},null,2));console.log({pass:true,checks:checks.length});
}catch(e){await writeFile(out+'/real-result.json',JSON.stringify({checks,scope,error:e.message},null,2));console.error(e.message);process.exitCode=1}
finally{child.kill('SIGTERM');for(let i=0;i<70&&child.exitCode===null;i++)await sleep(100);await rm(scope+'/config.json',{force:true})}
