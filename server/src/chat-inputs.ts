// One durable input stream per conversation. The SDK queue is a transport, not a second ledger.
import {db,get,put,now,publicValue} from './store';
import {ApiError} from './integrations';
import {completedAgentWrites} from './agent-effects';
export type AppendedInput={requestId:string;runId:string;message:string;contextIds:string[];attachmentIds:string[];readOnly:boolean;userMessage:any};
type Pending={id:string;conversationId:string;input:any;perform:()=>Promise<any>};
const pending=new Map<string,Pending>(),workers=new Map<string,Promise<void>>();
export function inputDelivery(message:string,explicit?:string){
 if(explicit)return explicit;
 // Only a direct, explicit amendment gets early delivery; quoted text and new work keep FIFO.
 const direct=message.replace(/```[\s\S]*?```|^\s*>.*$/gm,'').trim();
 return /^(?:补充(?:一下|说明)?|再补充(?:一下)?|更正(?:一下)?|纠正(?:一下)?)[：:,，\s]|^(?:correction|clarification|to clarify)\b/i.test(direct)?'steer':'followUp';
}
export function scheduleChatInput(item:Pending){pending.set(item.id,item);void pump(item.conversationId)}
async function pump(conversationId:string){
 if(workers.has(conversationId))return;
 const work=(async()=>{for(;;){const item=[...pending.values()].find(p=>p.conversationId===conversationId);if(!item)break;const active=db.prepare("SELECT 1 FROM chat_requests WHERE state='running' AND json_extract(data,'$.conversationId')=? LIMIT 1").get(conversationId);if(active){await new Promise(r=>setTimeout(r,100));continue}pending.delete(item.id);try{await item.perform()}catch{ /* perform persists its own failure */ }}})();
 workers.set(conversationId,work);try{await work}finally{workers.delete(conversationId);if([...pending.values()].some(p=>p.conversationId===conversationId))void pump(conversationId)}
}
export function takeAppendedInputs(conversationId:string,parentRunId:string,limit:number):AppendedInput[]{
 const items=[...pending.values()].filter(p=>p.conversationId===conversationId&&inputDelivery(p.input.message,p.input.appendDelivery)==='steer').slice(0,limit),result:AppendedInput[]=[];
 for(const item of items){
  const row=db.prepare('SELECT state,data FROM chat_requests WHERE id=?').get(item.id) as any;if(row?.state!=='queued'){pending.delete(item.id);continue}
  const saved=JSON.parse(row.data),claimedAt=now();
  db.prepare('UPDATE chat_requests SET state=?,data=?,updated_at=? WHERE id=?').run('running',JSON.stringify({...saved,parentRunId,claimedAt}),claimedAt,item.id);
  const run=get('runs',saved.runId);put('runs',{...run,status:'running',startedAt:claimedAt,parentRunId});pending.delete(item.id);
  result.push({requestId:item.id,runId:saved.runId,message:item.input.message,contextIds:item.input.contextIds||[],attachmentIds:item.input.attachmentIds||[],readOnly:item.input.readOnly===true,userMessage:saved.userMessage});
 }
 return result;
}
export function finishAppendedInputs(parentRunId:string,output?:any,error?:unknown){
 const rows=db.prepare("SELECT id,data FROM chat_requests WHERE state='running' AND json_extract(data,'$.parentRunId')=?").all(parentRunId) as any[];
 for(const row of rows){
  const saved=JSON.parse(row.data),run=get('runs',saved.runId),writes=completedAgentWrites(run),failedTools=(run?.tools||[]).filter((t:any)=>t.status==='failed'),pendingWrites=writes.filter((t:any)=>t.output?.pendingResult||t.commitState==='unknown');
  const status=error?(writes.length?'partial':'failed'):'succeeded';
  const completed=put('runs',{...run,status:error?'failed':'succeeded',completedAt:now(),...(error?{error:publicValue(String(error))}:{}),output:output?.assistantMessage?.content,agentSession:get('runs',parentRunId)?.agentSession,taskOutcome:{status:failedTools.length?(writes.length?'partial':'failed'):pendingWrites.length?'pending':writes.length?'succeeded':'not_executed',committedWrites:writes.filter((t:any)=>t.commitState!=='unknown').length,pendingActions:pendingWrites.map((t:any)=>t.input?.action||t.name),basis:'actual_tool_receipts; appended input'},artifactIds:run?.artifactIds||[]});
  const result=output?{...output,requestId:row.id,userMessage:saved.userMessage,run:completed,artifacts:(output.artifacts||[]).filter((a:any)=>(completed.artifactIds||[]).includes(a.id))}:undefined;
  db.prepare('UPDATE chat_requests SET state=?,data=?,updated_at=? WHERE id=?').run(status,JSON.stringify({...saved,run:completed,...(result?{result,memoryPending:!completed.readOnly}:{completedWrites:writes})}),now(),row.id);
 }
 return rows.map(row=>row.id as string);
}
export function failAppendedInput(input:AppendedInput,error:unknown){
 const row=db.prepare('SELECT data FROM chat_requests WHERE id=?').get(input.requestId) as any;if(!row)return;
 const saved=JSON.parse(row.data),run=get('runs',input.runId);put('runs',{...run,status:'failed',completedAt:now(),error:publicValue(String(error))});
 db.prepare('UPDATE chat_requests SET state=?,data=?,updated_at=? WHERE id=?').run('failed',JSON.stringify({...saved,completedWrites:[]}),now(),input.requestId);
}
export function editPendingInput(id:string,message:string){
 const item=pending.get(id);if(!item)throw new ApiError(409,'queue_locked','消息已开始处理');item.input.message=message;
 const row=db.prepare('SELECT data FROM chat_requests WHERE id=?').get(id) as any;const saved=JSON.parse(row.data);
 const userMessage=put('messages',{...saved.userMessage,content:message});db.prepare('UPDATE chat_requests SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({...saved,userMessage}),now(),id);
}
export function cancelPendingInput(id:string){
 if(!pending.delete(id))throw new ApiError(409,'queue_locked','消息已开始处理');
 const row=db.prepare('SELECT data FROM chat_requests WHERE id=?').get(id) as any;const saved=JSON.parse(row.data);put('runs',{...get('runs',saved.runId),status:'cancelled',stopReason:'user',completedAt:now()});db.prepare('UPDATE chat_requests SET state=?,updated_at=? WHERE id=?').run('cancelled',now(),id);
}

export function setPendingDelivery(id:string,delivery:'steer'|'followUp'){
 const item=pending.get(id);if(!item)throw new ApiError(409,'queue_locked','消息已开始处理');item.input.appendDelivery=delivery;const row=db.prepare('SELECT data FROM chat_requests WHERE id=?').get(id) as any;const saved=JSON.parse(row.data);db.prepare('UPDATE chat_requests SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({...saved,delivery}),now(),id);
}

// Delivery is observed at the SDK message boundary, separately from durable claiming/preparation.
export function markAppendedConsumed(id:string){
 const row=db.prepare("SELECT data FROM chat_requests WHERE id=? AND state='running'").get(id) as any;if(!row)return;
 const saved=JSON.parse(row.data);if(saved.consumedAt)return;
 db.prepare('UPDATE chat_requests SET data=?,updated_at=? WHERE id=?').run(JSON.stringify({...saved,consumedAt:now()}),now(),id);
}
