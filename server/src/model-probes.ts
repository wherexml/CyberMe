import {beginRun, get, put, hash, db} from './store';
import {runAgent} from './agent';
import {modelSettings} from './model-settings';
import {ApiError} from './integrations';

// Process-local ownership distinguishes an active call from a run left by a
// stopped process. Durable receipts never cause a model call on GET/restart.
const active = new Set<string>();
export function modelProbe(id:string) {
 const receipt=get('model_probes',id);
 if(!receipt)throw new ApiError(404,'model_probe_not_found','未收到此测试请求。 / Test request not received.');
 const run=get('runs',receipt.runId);
 // Global startup recovery records interrupted runs as failed. That is a
 // local interruption marker, not a verified model failure/result.
 const status=run?.error==='server_interrupted'?'unknown':run?.status==='succeeded'?'succeeded':run?.status==='failed'?'failed':active.has(id)?'running':'unknown';
 return {requestId:id,role:receipt.role,runId:receipt.runId,status,run};
}
export async function startModelProbe(input:any) {
 if(typeof input.requestId!=='string'||!/^[\w-]{1,128}$/.test(input.requestId))throw new ApiError(400,'invalid_request_id','测试请求 ID 无效。');
 if(!['standard','deep'].includes(input.role))throw new ApiError(400,'invalid_model_role','请选择普通任务或深度思考。 / Choose a model role.');
 const fingerprint=hash({role:input.role,version:input.version});
 const old=get('model_probes',input.requestId);
 if(old){if(old.fingerprint!==fingerprint)throw new ApiError(409,'model_probe_conflict','此请求 ID 已用于其他测试。');return modelProbe(input.requestId);}
 if(input.version!==modelSettings().version)throw new ApiError(409,'model_settings_changed','配置已变更，请先重新读取。 / Configuration changed. Reload first.');
 const run=(()=>{
  db.exec('BEGIN IMMEDIATE');
  try {
   const created=beginRun('model_probe','Model connection test: '+input.role,{mode:input.role==='deep'?'deep':'chat',readOnly:true});
   put('model_probes',{id:input.requestId,role:input.role,fingerprint,runId:created.id});
   db.exec('COMMIT');return created;
  }catch(e){db.exec('ROLLBACK');throw e;}
 })();
 active.add(input.requestId);
 try {await runAgent('Reply with exactly OK.',{runId:run.id,kind:'model_probe',title:run.title,mode:input.role==='deep'?'deep':'chat',readOnly:true});}
 catch {/* The original run contains the failure; a receipt is not success. */}
 finally {active.delete(input.requestId);}
 return modelProbe(input.requestId);
}
