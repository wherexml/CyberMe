// Protocol failures: unauthorized/origin/path/body, duplicate creates, deleted ID reuse.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),api='http://127.0.0.1:46110',bridge='http://127.0.0.1:46114',id='ui-side-'+randomUUID(),checks=[];
const token=(await readFile(new URL('.local/design/chat-bridge-key',root),'utf8')).trim();
const post=async(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
function check(name,pass){checks.push({name,status:pass?'PASS':'FAIL'});console.log({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)}
try{
 check('bridge requires capability',(await post(bridge+'/sessions',{id,title:'HTTP 合成验收'})).status===403);
 check('bridge rejects unknown origin',(await post(bridge+'/sessions',{id,title:'HTTP 合成验收'},{'X-OpsTwins-Chat':token,Origin:'https://invalid.example'})).status===403);
 check('bridge rejects arbitrary path',(await post(bridge+'/sessions/anything',{},{'X-OpsTwins-Chat':token})).status===404);
 check('bridge rejects extra input fields',(await post(bridge+'/sessions',{id,title:'HTTP 合成验收',extra:true},{'X-OpsTwins-Chat':token})).status===400);
 const before=await fetch(api+'/api/conversations/primary').then(r=>r.json());
 const first=await post(bridge+'/sessions',{id,title:'HTTP 合成验收'},{'X-OpsTwins-Chat':token});const a=await first.json();const second=await post(api+'/api/conversations/side',{id,title:'重复标题'}).then(r=>r.json());
 check('stable ID is idempotent',first.status===201&&a.id===id&&second.id===id&&second.title===a.title);
 const read=await fetch(bridge+'/sessions/'+id,{headers:{'X-OpsTwins-Chat':token}}).then(r=>r.json());check('lost create response can GET same ID',read.id===id);
 const after=await fetch(api+'/api/conversations/primary').then(r=>r.json());check('create preserves primary',before.conversationId===after.conversationId);
 await fetch(api+'/api/conversations/'+id,{method:'DELETE'});check('deleted ID cannot be recreated implicitly',(await post(api+'/api/conversations/side',{id,title:'删除后重试'})).status===409);
}catch(e){checks.push({name:'HTTP E2E stopped',status:'FAIL',error:e.message})}finally{await fetch(api+'/api/conversations/'+id,{method:'DELETE'}).catch(()=>{})}
const hashes={};for(const name of ['server/src/side-chats.ts','server/src/index.ts','scripts/macos-study-chat-bridge.mjs'])hashes[name]=createHash('sha256').update(await readFile(new URL(name,root))).digest('hex');
await mkdir(new URL('output/multi-chat-review/',root),{recursive:true});await writeFile(new URL('output/multi-chat-review/http-result.json',root),JSON.stringify({capturedAt:new Date().toISOString(),checks,hashes},null,2));if(checks.some(x=>x.status==='FAIL'))process.exitCode=1;
