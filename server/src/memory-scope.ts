import type {Hono} from 'hono';
import {get,meta} from './store';
import {ApiError} from './integrations';

// CyberMe has ONE global personal memory library (docs/public/global-memory.md).
// Legacy `memoryProjectId` on conversations, facts and request receipts is inert provenance:
// it is kept as stored and never narrows recall, extraction, forgetting or agent lookups.
// `none` remains the fail-closed state for a missing or deleted conversation.
export type MemoryScope=
 |{kind:'global'}
 |{kind:'none';reason:string};

export const boundProjectId=(conversation:any):string|undefined=>typeof conversation?.memoryProjectId==='string'&&conversation.memoryProjectId?conversation.memoryProjectId:undefined;
export const scopeKey=(scope:MemoryScope)=>scope.kind;

export function conversationScope(id?:string):MemoryScope{
 if(!id)return {kind:'global'};
 return get('conversations',id)?{kind:'global'}:{kind:'none',reason:'conversation_unavailable'};
}
// Message text and selected context no longer change the memory scope.
export const turnMemoryScope=(conversationId:string|undefined,_prompt?:string,_contextIds?:unknown):MemoryScope=>conversationScope(conversationId);

// Former acceptance guard. It never refuses now; it only carries a retried legacy request's
// stored provenance forward so its receipt keeps the original field.
export function guardChatScope(input:{requestId:string;fingerprint:string;conversation:any;message:string;contextIds:unknown;claimed:unknown;prior?:any}):string|undefined{
 return typeof input.prior?.memoryProjectId==='string'&&input.prior.memoryProjectId?input.prior.memoryProjectId:undefined;
}
// Replays keep their original conversation. Legacy bound conversations keep their stricter
// cross-conversation rejection: this is request/session isolation, not memory partitioning.
export function assertRequestConversation(requested:unknown,stored:any){
 if(requested===stored?.conversationId)return;
 const originalBound=stored?.memoryProjectId||boundProjectId(get('conversations',String(stored?.conversationId||''),true));
 const requestedBound=requested?boundProjectId(get('conversations',String(requested),true)):undefined;
 if(originalBound||requestedBound)throw new ApiError(409,'request_conflict','此请求 ID 已用于另一个会话',{conversationId:stored?.conversationId});
}

const internalMemoryRuns=new Set(['memory_extract','context_summary']);
export const runMemoryScope=(runId:string)=>conversationScope(get('runs',runId)?.conversationId);
// Model lookups: every conversation and memory is visible to a live chat; internal memory
// runs stay hidden. A run whose conversation is gone sees no conversation records.
export function lookupVisible(runId:string,resource:string,row:any){
 const scope=runMemoryScope(runId);
 if(resource==='runs')return !internalMemoryRuns.has(row?.kind)&&(scope.kind==='global'||typeof row?.conversationId!=='string'||!row.conversationId);
 if(resource==='conversations')return scope.kind==='global'||typeof row?.id!=='string'||!row.id;
 return true;
}
export function scopedLookupResult(runId:string,action:string,resource:unknown,result:any){
 const kind=action==='runs_list'||action==='run_get'?'runs':action==='entity_list'||action==='entity_get'?String(resource):'';
 if(!['runs','conversations'].includes(kind))return result;
 if(Array.isArray(result?.items))return {...result,items:result.items.filter((row:any)=>lookupVisible(runId,kind,row))};
 if(Array.isArray(result))return result.filter((row:any)=>lookupVisible(runId,kind,row));
 if(!lookupVisible(runId,kind,result))throw new ApiError(404,'not_found_in_scope','当前会话无法读取这条记录');
 return result;
}
// Global memory documents are writable from any live chat; a run without a conversation record
// (deleted mid-run) keeps the fail-closed rejection.
export function assertGlobalMemoryAccess(runId:string,action:string,resource:unknown){
 const touchesGlobal=['memory_document_read','memory_document_update','memory_history','memory_restore','memory_snapshot'].includes(action)||(['entity_create','entity_update','entity_delete','entity_restore'].includes(action)&&resource==='memories');
 if(touchesGlobal&&runMemoryScope(runId).kind!=='global')throw new ApiError(403,'memory_scope_rejected','会话已不可用，不能读取或修改记忆');
}
// Retired: the endpoint creates, moves and deletes nothing. Null keeps the old primary answer
// so an outdated client can return to the main conversation.
export function mountMemoryScope(app:Hono){
 app.post('/api/chat/memory-scope',async c=>{
  const input=await c.req.json().catch(()=>undefined) as any;
  if(input?.projectId===null){
   const id=meta<string|undefined>('primaryConversationId',undefined),primary=id?get('conversations',id):undefined;
   return c.json({conversationId:primary&&!boundProjectId(primary)?primary.id:null,memoryProjectId:null,retired:true});
  }
  throw new ApiError(410,'memory_scope_retired','记忆已统一为全局资料库，不再按项目切换范围');
 });
}
