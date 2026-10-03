// Real saved-model invocations. Failure matrix item 37 precedes implementation.
// No config edits, private bodies, keys or provider endpoints in evidence.
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const api=process.env.OPSTWIN_API||'http://127.0.0.1:46110';
const out=process.env.OPSTWIN_QA_OUTPUT||'.local/acceptance/native-model-probe/'+new Date().toISOString().replaceAll(':','-');
await mkdir(out,{recursive:true});
const rows=[];const runs=[];const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function req(path,method='GET',input){const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json'},body:input?JSON.stringify(input):undefined});return {status:r.status,data:await r.json()};}
function check(name,ok){rows.push({name,status:ok?'PASS':'FAIL'});console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)throw Error(name);}
try{
 const before=await req('/api/settings/models');check('read redacted saved config',before.status===200&&!!before.data.version);
 const missing=await req('/api/settings/models/test','POST',{role:'standard'});check('missing version refused',missing.status===409&&missing.data.error==='model_settings_changed');
 const stale=await req('/api/settings/models/test','POST',{role:'deep',version:before.data.version+'-stale'});check('stale version refused',stale.status===409&&stale.data.error==='model_settings_changed');
 for(const role of ['standard','deep']){
  const current=await req('/api/settings/models');check(role+' config unchanged before invocation',hash(current.data)===hash(before.data));
  const result=await req('/api/settings/models/test','POST',{role,version:current.data.version});
  const run=result.data.run;const text=result.data.text;
  runs.push({role,httpStatus:result.status,runId:run?.id,status:run?.status,model:run?.model,protocol:run?.protocol,readOnly:run?.readOnly,outputCharacters:typeof text==='string'?text.length:0,outputHash:hash(text||''),errorCode:result.data.error});
  check(role+' real invocation succeeded',result.status===200&&run?.status==='succeeded'&&typeof text==='string'&&text.trim().length>0);
  check(role+' actual saved model used',run.model===current.data[role].model);
  const provider=current.data.providers.find(p=>p.id===current.data[role].providerId);
  check(role+' actual saved protocol used',!!provider&&run.protocol===provider.api);
  check(role+' run read only',run.readOnly===true);
  const saved=await req('/api/runs/'+encodeURIComponent(run.id));check(role+' durable run readable',saved.status===200&&saved.data.status==='succeeded'&&saved.data.model===run.model);
 }
 const after=await req('/api/settings/models');check('model configuration unchanged',hash(after.data)===hash(before.data));
}catch(e){rows.push({name:'execution',status:'FAIL',reason:e.message});process.exitCode=1;}
await writeFile(out+'/result.json',JSON.stringify({at:new Date().toISOString(),scope:'Real HTTP model inference; native control GUI NOT_RUN',api,rows,runs},null,2));console.log(out+'/result.json');
