// Real installed gateway/model/command; disposable local upstream and synthetic key.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve('.'),out=resolve('output/agent-execution-20261106/installed'),dir=resolve('.local/acceptance/installed-execution-'+randomUUID());
await mkdir(out,{recursive:true});await mkdir(dir,{recursive:true,mode:0o700});
const stateRoot=resolve(homedir(),'Library/Application Support/OpsTwins'),link=JSON.parse(await readFile(stateRoot+'/.local/mygo-desktop/connection.json','utf8'));
const conversationId='ui-side-'+randomUUID(),requestId=randomUUID(),key='oc_sk_'+randomUUID().replaceAll('-',''),port=46884,marker='PUBLIC_INSTALLED_EXECUTION_OK';
const checks=[];let hits=0,authenticated=0;
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const probe=createServer((req,res)=>{hits++;const ok=req.headers.authorization==='Bearer '+key;if(ok)authenticated++;res.writeHead(ok?200:401,{'content-type':'application/json'});res.end(JSON.stringify({ok,marker}))});await new Promise(r=>probe.listen(port,'127.0.0.1',r));
const request=async(path,method='GET',body)=>{const r=await fetch('http://127.0.0.1:'+link.port+path,{method,headers:{'X-OpsTwins-Pilot':link.token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(135000)});return {status:r.status,data:await r.json()}};
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
try{
 const candidate=JSON.parse(await readFile(root+'/output/agent-execution-20261106/candidate.json','utf8')),receipt=JSON.parse(await readFile(root+'/.local/updates/last-result.json','utf8'));
 check('updater installed the reviewed candidate',receipt.status==='installed'&&receipt.version.build===candidate.build&&receipt.signatureVerified);
 for(const [p,expected]of Object.entries(candidate.hashes))check('installed source: '+p,await hash('/Applications/CyberMe.app/Contents/Resources/runtime/'+p)===expected);
 execFileSync('codesign',['--verify','--deep','--strict','/Applications/CyberMe.app'],{stdio:'pipe'});check('installed Developer ID seal verifies',true);
 const h=await request('/api/health');check('standalone health through native gateway',h.status===200&&h.data.runtimeMode==='standalone');
 const dbBefore=new DatabaseSync(stateRoot+'/data/opstwin-advance.db',{readOnly:true});const primaryBefore=dbBefore.prepare("select value from meta where key='primaryConversationId'").get()?.value;dbBefore.close();
 check('dedicated side conversation created',(await request('/api/conversations/side','POST',{id:conversationId,title:'执行能力验收 · 11月6日'})).status===201);
 await writeFile(out+'/request.json',JSON.stringify({requestId,conversationId,artifact:dir+'/result.txt',build:candidate.build},null,2));
 const message=`请测试这个本机公开验收服务的 key：${key}。目标是 http://127.0.0.1:${port}/probe，使用 Bearer 认证，确认 HTTP 200 和 ok=true 后把响应 marker 保存到 ${dir}/result.txt 并回读。不要输出密钥。这是独立验收，不处理其他事项，不发消息。`;
 const result=await request('/api/chat','POST',{requestId,conversationId,preservePrimary:true,message});
 check('installed real-model chat completed',result.status===200);
 check('new command capability actually invoked',result.data.run?.tools.some(t=>t.name==='run_command'&&t.status==='succeeded'));
 check('authenticated HTTP request observed',authenticated>=1&&hits===authenticated);
 check('file produced and read back',(await readFile(dir+'/result.txt','utf8')).trim()===marker);
 check('public result contains no key',!JSON.stringify(result.data).includes(key));
 check('run used installed policy',result.data.run.agentPolicy.hash===candidate.hashes['server/agent/agents.md']);
 const db=new DatabaseSync(stateRoot+'/data/opstwin-advance.db',{readOnly:true});
 const audit=db.prepare("select data from entities where (type='runs' and id=?) or (type='command_operations' and json_extract(data,'$.runId')=?)").all(result.data.run.id,result.data.run.id).map(x=>x.data).join('\n');
 check('durable execution audit contains no key',!audit.includes(key));check('primary conversation preserved',db.prepare("select value from meta where key='primaryConversationId'").get()?.value===primaryBefore);db.close();
 const before=hits;const replay=await request('/api/chat','POST',{requestId,conversationId,preservePrimary:true,message});check('installed same-ID replay performs no new request',replay.status===200&&replay.data.replayed===true&&hits===before);
 const record={checks,hits,authenticated,conversationId,requestId,runId:result.data.run.id,build:candidate.build,artifact:dir+'/result.txt',scope:'installed standalone native gateway + configured real model + actual command/network/file; synthetic key, not third-party credential validation'};
 await writeFile(out+'/result.json',JSON.stringify(record,null,2));console.log(JSON.stringify({pass:true,checks:checks.length,build:candidate.build,out}));
}catch(e){await writeFile(out+'/result.json',JSON.stringify({checks,hits,authenticated,requestId,conversationId,error:e.message},null,2));console.error(e.message);process.exitCode=1}
finally{probe.closeAllConnections();probe.close()}
