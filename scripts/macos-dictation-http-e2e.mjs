// Real loopback boundary checks. Never print capability, private configuration or audio.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),token=(await readFile(new URL('.local/design/chat-bridge-key',root),'utf8')).trim(),url='http://127.0.0.1:46114',checks=[];
async function check(name,path,options,expected){const r=await fetch(url+path,{...options,headers:{'X-OpsTwins-Chat':token,...options?.headers}});const result=await r.json();checks.push({name,status:r.status===expected?'PASS':'FAIL',http:r.status,error:result.error});}
await check('voice configured status','/voice/status',{},200);
await check('capability required','/voice/status',{headers:{'X-OpsTwins-Chat':''}},403);
await check('unknown origin rejected','/voice/status',{headers:{Origin:'https://invalid.example'}},403);
await check('unknown voice path rejected','/voice/arbitrary',{},404);
await check('JSON rejected','/voice/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},400);
await check('malformed multipart rejected','/voice/transcribe',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=broken'},body:'broken'},400);
for(const [name,form,expected] of [
 ['missing file',new FormData(),400],
 ['empty audio',(()=>{const f=new FormData();f.append('file',new Blob([],{type:'audio/webm'}),'empty.webm');return f})(),413],
 ['extra field',(()=>{const f=new FormData();f.append('file',new Blob(['fixture'],{type:'audio/webm'}),'fixture.webm');f.append('extra','fixture');return f})(),400],
 ['duplicate file',(()=>{const f=new FormData();for(let i=0;i<2;i++)f.append('file',new Blob(['fixture'],{type:'audio/webm'}),'fixture.webm');return f})(),400],
 ['oversized audio',(()=>{const f=new FormData();f.append('file',new Blob([new Uint8Array(12*1024*1024+1)],{type:'audio/webm'}),'oversized.webm');return f})(),413]
])await check(name,'/voice/transcribe',{method:'POST',body:form},expected);
const dir=new URL('output/dictation-ui-review/',root);await mkdir(dir,{recursive:true});await writeFile(new URL('http-result.json',dir),JSON.stringify({capturedAt:new Date().toISOString(),checks},null,2));console.log({passed:checks.filter(c=>c.status==='PASS').length,failed:checks.filter(c=>c.status==='FAIL').length});if(checks.some(c=>c.status==='FAIL'))process.exitCode=1;
