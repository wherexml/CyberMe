// Actual production HTTP handler, pre-existing public request. No model dispatch.
import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const scope='.local/mock-chat/e2e-'+randomUUID(),dir=scope+'/requests',out='output/mock-real-chat-20261017/recovery-'+Date.now();mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(out,{recursive:true});
const clientId=randomUUID(),id=randomUUID(),input={requestId:id,clientId,sessionId:'public-recovery',history:[],question:'公开恢复请求，不应重新运行',quotes:[]};
const payloadHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');writeFileSync(dir+'/'+id+'.json',JSON.stringify({requestId:id,input,payloadHash,status:'running',text:'',upstreamCalls:1,updatedAt:Date.now()}),{mode:0o600});
const base='http://127.0.0.1:46413',headers={'Origin':base,'Content-Type':'application/json','X-OpsTwins-Mock':'chat','X-OpsTwins-Client':clientId},results=[];let child;
function check(name,ok){results.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name)}
async function start(){child=spawn(process.execPath,['scripts/opstwins-mock-server.mjs'],{env:{...process.env,OPSTWIN_MOCK_PORT:'46413',OPSTWIN_MOCK_CHAT_DIR:process.cwd()+'/'+dir},stdio:'ignore'});for(let i=0;i<100;i++){try{const r=await fetch(base);if(r.status===200)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('startup_failed')}
async function stop(){if(child?.exitCode===null){const wait=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await wait}}
try{
 await start();let r=await fetch(base+'/api/mock-chat/requests/'+id,{headers}),d=await r.json();check('服务重启把原running保留为unknown',d.status==='unknown'&&d.upstreamCalls===1&&d.requestId===id);
 r=await fetch(base+'/api/mock-chat/requests/'+id,{method:'POST',headers,body:JSON.stringify(input)});d=await r.json();check('原POST不重放未知记录',d.status==='unknown'&&d.upstreamCalls===1);
 r=await fetch(base+'/api/mock-chat/requests/'+id,{method:'POST',headers,body:JSON.stringify({...input,question:'不同正文'})});check('原ID不同正文拒绝409',r.status===409);
 r=await fetch(base+'/api/mock-chat/requests/'+id,{headers:{...headers,Origin:'https://example.com'}});check('跨站Origin拒绝',r.status===403);
 r=await fetch(base+'/api/mock-chat/requests/'+id,{headers:{...headers,'Sec-Fetch-Site':'cross-site'}});check('跨站FetchMetadata拒绝',r.status===403);
 r=await fetch(base+'/api/mock-chat/requests/'+id,{headers:{...headers,'X-OpsTwins-Client':randomUUID()}});check('不同clientId不泄漏记录',r.status===404);
 const bad={...input,requestId:randomUUID(),question:'x'.repeat(20001)};r=await fetch(base+'/api/mock-chat/requests/'+bad.requestId,{method:'POST',headers,body:JSON.stringify(bad)});check('超限明确拒绝不调用模型',r.status===400);
 r=await fetch(base+'/api/mock-chat/requests/'+id,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'{}'});check('拒绝非JSON跨站简单请求',r.status===415);
 r=await fetch(base+'/.local/config.json');check('静态根不提供私有配置',r.status!==200);
 await stop();await start();d=await (await fetch(base+'/api/mock-chat/requests/'+id,{headers})).json();check('再次重启unknown保持且没有新增调用',d.status==='unknown'&&d.upstreamCalls===1&&JSON.parse(readFileSync(dir+'/'+id+'.json')).status==='unknown');
 writeFileSync(out+'/result.json',JSON.stringify({scope:'real HTTP restart with public pre-existing fixture; zero actual model calls',results,originalRequestId:id},null,2));console.log({passed:results.length,out});
}catch(e){writeFileSync(out+'/failure.json',JSON.stringify({results,error:String(e)},null,2));throw e}finally{await stop()}
