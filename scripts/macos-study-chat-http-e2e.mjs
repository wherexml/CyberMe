// Repeatable HTTP acceptance. Only replays a completed synthetic UI run; no new task.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const out=new URL('../output/idea-judgment-review/',import.meta.url),checks=[];
const token=readFileSync(new URL('../.local/design/chat-bridge-key',import.meta.url),'utf8').trim(),api='http://127.0.0.1:46110',bridge='http://127.0.0.1:46114';
function check(name,pass,metrics={}){checks.push({name,status:pass?'PASS':'FAIL',...metrics});if(!pass)throw Error(name)}
async function get(url,headers={}){const r=await fetch(url,{headers});return {status:r.status,data:await r.json()}}
try{
 const ui=JSON.parse(readFileSync(new URL('result.json',out),'utf8')),real=ui.checks.find(c=>c.name==='real run has persisted identifiers'&&c.status==='PASS');
 if(!real)throw Error('Run browser E2E first');
 const run=await get(api+'/api/runs/'+real.runId),requestId=run.data.requestId;
 check('persisted run exposes recovery ID',!!requestId);
 check('synthetic acceptance task made no business writes',(run.data.tools||[]).every(t=>t.effect==='read'||t.name==='load_user_context'),{tools:(run.data.tools||[]).map(t=>({name:t.name,effect:t.effect||'context_read'}))});
 const denied=await get(api+'/api/chat/requests/'+requestId,{Origin:'null'});check('canonical API rejects file Origin',denied.status===403);
 check('bridge rejects malformed capability',(await get(bridge+'/requests/'+requestId,{Origin:'null','X-OpsTwins-Chat':'z'.repeat(64)})).status===403);
 check('bridge rejects missing capability',(await get(bridge+'/requests/'+requestId,{Origin:'null'})).status===403);
 check('bridge rejects hostile Origin',(await get(bridge+'/requests/'+requestId,{Origin:'https://example.com','X-OpsTwins-Chat':token})).status===403);
 const headers={Origin:'null','X-OpsTwins-Chat':token,'Content-Type':'application/json'};
 check('bridge disallows arbitrary proxy paths',(await get(bridge+'/api/settings',headers)).status===404);
 check('unknown request can be distinguished',(await get(bridge+'/requests/design-nonexistent-e2e',headers)).status===404);
 const state=await get(bridge+'/requests/'+requestId,headers);check('recovery returns completed request',state.status===200&&state.data.status==='succeeded'&&state.data.result?.assistantMessage?.content?.includes('UI-E2E-OK'));
 const value={requestId,message:state.data.userMessage.content,conversationId:state.data.conversationId,contextIds:state.data.userMessage.contextIds||[]};
 const replay=await fetch(bridge+'/chat',{method:'POST',headers,body:JSON.stringify(value)}),result=await replay.json();
 check('completed POST replay is idempotent',replay.ok&&result.replayed===true&&result.run.id===real.runId,{resultHash:createHash('sha256').update(result.assistantMessage.content).digest('hex')});
 const conflict=await fetch(bridge+'/chat',{method:'POST',headers,body:JSON.stringify({...value,message:'different synthetic request'})});check('same request ID rejects changed context',conflict.status===409);
 const invalid=await fetch(bridge+'/chat',{method:'POST',headers,body:JSON.stringify({...value,url:'https://example.com'})});check('arbitrary fields rejected',invalid.status===400);
 check('capability files private',['chat-bridge-key','chat-capability.js'].every(f=>(statSync(new URL('../.local/design/'+f,import.meta.url)).mode&0o777)===0o600));
}catch(error){checks.push({name:'HTTP stopped',status:'FAIL',error:error.message})}
writeFileSync(new URL('http-result.json',out),JSON.stringify({capturedAt:new Date().toISOString(),checks,scope:'real HTTP cached synthetic run; no new model task, bodies or capability recorded'},null,2));console.log({passed:checks.filter(x=>x.status==='PASS').length,failed:checks.filter(x=>x.status==='FAIL').length});if(checks.some(x=>x.status==='FAIL'))process.exitCode=1;
