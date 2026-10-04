// Failure inventory precedes implementation in the dated journey/output.
// Uses an already prepared, isolated real service. No configuration mutations.
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
const base='http://127.0.0.1:46254';
const out=resolve('output/native-parity-20261003/model-probe-recovery-20261004');
const requestId='OPSADV-QA-PROBE-'+randomUUID();
const report={requestId,base,scope:'real model HTTP; native GUI separately',checks:[]};
const outputName=process.argv.includes('--final')?'http-e2e-final.json':'http-e2e.json';
if(fs.existsSync(out+'/'+outputName))throw Error('Evidence already exists; use a new prepared scope instead of overwriting');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const get=async path=>{const r=await fetch(base+path);return {http:r.status,data:await r.json()};};
const post=async body=>{const r=await fetch(base+'/api/settings/models/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {http:r.status,data:await r.json()};};
const check=(name,ok,details={})=>{report.checks.push({name,status:ok?'PASS':'FAIL',...details});if(!ok)throw Error(name);};
try {
 const previous=(await get('/api/runs')).data.filter(r=>r.kind==='model_probe').length;
 const config=(await get('/api/settings/models')).data;
 const body={requestId,role:'standard',version:config.version};
 const ctl=new AbortController();
 const original=fetch(base+'/api/settings/models/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctl.signal}).then(()=>false,()=>true);
 let receipt;
 for(let n=0;n<100;n++){const r=await get('/api/settings/models/tests/'+requestId);if(r.http===200){receipt=r.data;break;}await wait(50);}
 check('receipt exists before response is received',!!receipt?.runId,{runId:receipt?.runId});
 ctl.abort();check('original client response deliberately lost',await original);
 const duplicate=await post(body);
 check('in-flight duplicate returns same run',duplicate.http===200&&duplicate.data.runId===receipt.runId,{status:duplicate.data.status});
 let recovered;
 for(let n=0;n<180;n++){recovered=(await get('/api/settings/models/tests/'+requestId)).data;if(['succeeded','failed'].includes(recovered.status))break;await wait(1000);}
 check('original real model completed successfully',recovered.status==='succeeded'&&recovered.run.readOnly===true&&recovered.run.model===config.standard.model&&recovered.run.tools.length===0&&recovered.run.artifactIds.length===0,{runId:recovered.runId,model:recovered.run.model,protocol:recovered.run.protocol,status:recovered.status,outputHash:createHash('sha256').update(recovered.run.output).digest('hex')});
 check('terminal duplicate uses same run',(await post(body)).data.runId===receipt.runId);
 const conflict=await post({...body,role:'deep'});check('same ID changed payload rejected',conflict.http===409,{http:conflict.http});
 const stale=await post({requestId:'OPSADV-QA-STALE-'+randomUUID(),role:'standard',version:'stale'});check('new stale version rejected',stale.http===409,{http:stale.http});
 const invalid=await post({...body,requestId:'../bad'});check('invalid ID rejected',invalid.http===400,{http:invalid.http});
 const runs=(await get('/api/runs')).data;
 check('exactly one new model probe',Array.isArray(runs)&&runs.filter(r=>r.kind==='model_probe').length===previous+1,{before:previous,after:previous+1});
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/'+outputName,JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,checks:report.checks.length,requestId}));
if(report.status!=='PASS')process.exitCode=1;
