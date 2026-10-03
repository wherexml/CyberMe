// Real HTTP failure journey for native stable task IDs; GUI recovery is separate.
// Start native-ui-proxy.mjs on 46191 first. Only public synthetic test data is used.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const API=process.env.OPSTWIN_API||'http://127.0.0.1:46191';
if(!/^http:\/\/127\.0\.0\.1:\d{5}$/.test(API))throw Error('Local five-digit QA proxy required');
const id='task-OPSADV-QA-RECOVERY-'+Date.now();
const out='output/native-task-recovery-'+Date.now();await mkdir(out,{recursive:true});
const rows=[];let created=false;
async function request(path,method='GET',body){const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
function check(name,ok){rows.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);}
await writeFile(out+'/request.json',JSON.stringify({id}));
try {
 check('stable id initially absent',(await request('/api/tasks/'+id)).status===404);
 await request('/__qa/drop-task-response','POST',{});
 let lost=false;try{await request('/api/tasks','POST',{id,title:'OPSADV-QA 任务丢响应',notes:'公开合成恢复资料',status:'active'});}catch{lost=true;}
 check('upstream response intentionally lost',lost);
 const recovered=await request('/api/tasks/'+id);created=recovered.status===200;
 check('same id GET restores committed task',created&&recovered.data.id===id);
 const proxy=await request('/__qa/status');const calls=proxy.data.attempts.filter(x=>x.requestId===id);
 check('recovery readback has one original POST',calls.length===1&&calls[0].status===201&&calls[0].responseDropped);
 check('duplicate id negative check refused',(await request('/api/tasks','POST',{id,title:'OPSADV-QA duplicate must fail'})).status===409);
} catch(e){rows.push({name:'execution',status:'FAIL',reason:e.message});}
finally {
 const read=await request('/api/tasks/'+id);if(read.status===200)await request('/api/tasks/'+id,'DELETE');
 const sourceHashes={};for(const path of ['native/macos/app/src/tasks.rs','scripts/native-ui-proxy.mjs'])sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 const status=(await request('/__qa/status')).data;
 await writeFile(out+'/report.json',JSON.stringify({kind:'real HTTP; not native GUI acceptance',id,api:API,rows,sourceHashes,attempts:status.attempts.filter(x=>x.requestId===id),readbacks:status.readbacks.filter(x=>x.path==='/api/tasks/'+id)},null,2));
 console.log(out+'/report.json');if(rows.some(x=>x.status==='FAIL'))process.exitCode=1;
}
