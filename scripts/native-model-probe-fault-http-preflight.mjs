// Real HTTP qualification only; no positive model POST and no model output saved.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'output/native-parity-20261003/model-probe-faults-20261004');
if(process.argv.length!==2)throw Error('no_runtime_overrides');
const readyPath=path.join(out,'ready.json'),original=fs.readFileSync(readyPath),ready=JSON.parse(original);
const assert=(v,e)=>{if(!v)throw Error(e);},sha=b=>createHash('sha256').update(b).digest('hex');
assert(ready.status==='READY'&&ready.work===path.join(root,'.local/acceptance/model-probe-faults-20261004',ready.scope),'scope_not_ready');
const base='http://127.0.0.1:46255',checks=[];
async function call(name,route,status,options={}){
 const response=await fetch(base+route,{...options,signal:AbortSignal.timeout(5000)}),bytes=Buffer.from(await response.arrayBuffer());
 checks.push({name,http:response.status,bytes:bytes.length,sha256:sha(bytes),expected:status,pass:response.status===status});
 assert(response.status===status,name+'_failed');return JSON.parse(bytes);
}
const before=await call('initial_stats','/__qa/stats',200);
assert(before.scope===ready.scope&&before.apiPID===ready.apiPID&&before.postCount===0&&before.forwardedPostCount===0,'requires_fresh_no_post_scope');
await call('health','/api/health',200);
const models=await call('redacted_model_catalog','/api/settings/models',200);
await call('public_bootstrap','/api/bootstrap',200);
for(const route of ['/api/feishu/binding','/api/calendar','/api/connections/feishu-local/sync','/api/settings/models/tests/OPSADV-QA-not-registered'])await call('blocked_get_'+route,route,403);
await call('origin_rejected','/api/health',403,{headers:{origin:'https://invalid.example'}});
await call('model_write_rejected','/api/settings/models',403,{method:'PATCH',headers:{'content-type':'application/json'},body:'{}'});
await call('invalid_role_rejected','/api/settings/models/test',403,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'OPSADV-QA-'+randomUUID(),role:'invalid',version:models.version})});
await call('oversized_probe_rejected','/api/settings/models/test',413,{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(8193)});
try{
 fs.writeFileSync(readyPath,JSON.stringify({...ready,status:'STARTING'}));
 await call('replaced_ready_blocks_valid_probe_before_forward','/api/settings/models/test',503,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'OPSADV-QA-'+randomUUID(),role:'deep',version:models.version})});
}finally{fs.writeFileSync(readyPath,original);}
const after=await call('final_stats','/__qa/stats',200);
assert(after.postCount===0&&after.forwardedPostCount===0&&after.requestIds.length===0,'negative_probe_forwarded');
const report={status:'PASS',scope:ready.scope,apiPID:ready.apiPID,entrySHA256:ready.entrySHA256,sourceHashes:ready.sourceHashes,readyRestored:sha(fs.readFileSync(readyPath))===sha(original),modelVersion:models.version,checks,modelPosts:after.postCount,modelForwards:after.forwardedPostCount,boundary:'HTTP gate only; no positive model run or native GUI'};
fs.writeFileSync(path.join(out,'http-preflight.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,checks:checks.length,modelPosts:0,modelForwards:0}));
