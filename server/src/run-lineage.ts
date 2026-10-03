import {get} from './store';
import {ApiError} from './integrations';
export function retryLineage(input:any){if(!input.retryOfRunId)return {};const prior=get('runs',String(input.retryOfRunId));if(!prior)throw new ApiError(404,'not_found','对象不存在');if(prior.status!=='failed')throw new ApiError(400,'invalid_retry_run','只能关联已失败的原运行');return {originalFailedRunId:prior.id,retryOfRunId:prior.id,previousModel:prior.model,retryStrategy:input.mode==='chat'?'explicit_regular':'explicit_same_model'};}
