// Phase-scoped watchdog for durable queued persistent chat (docs/public/chat-time-budgets.md).
// One owner and ONE timer scheduled at the earliest live deadline among: the non-renewable hard cap, the current
// model-phase window (only while no tool is in flight) and each in-flight tool call's own window. It never aborts by
// itself: expiry calls `onExpire`, and the caller uses the existing lifetime/session abort path.
// Stream liveness (non-empty deltas) only keeps a stream alive; business progress is counted separately.
import {
 CHAT_PHASE_HEADERS_GRACE_MS,CHAT_PHASE_FIRST_CONTENT_MS,CHAT_PHASE_STREAM_SILENCE_MS,CHAT_PHASE_TOOL_FALLBACK_MS,
 CHAT_PHASE_TOOL_GRACE_MS,CHAT_PHASE_REPEAT_ERROR_LIMIT,CHAT_PHASE_MAX_ATTEMPTS_PER_STEP,clampBudget,
} from '../../shared/chat-budgets';
import {createHash} from 'node:crypto';

export type PhaseExpiry='hard'|'headers'|'first_content'|'stream_silence'|'tool'|'no_progress';
type ModelState='between'|'awaiting_headers'|'retry_wait'|'awaiting_first_content'|'streaming';
export interface PhaseConfig{headersMs:number;firstContentMs:number;streamSilenceMs:number;toolFallbackMs:number;toolGraceMs:number;repeatErrorLimit:number;hardMs:number}

/** Effective phase windows. Env values can only LOWER the defaults (E2E scaling); they never extend anything. */
export function phaseConfig(providerTimeoutMs:number,hardMs:number):PhaseConfig{
 const env=process.env,headersDefault=providerTimeoutMs+CHAT_PHASE_HEADERS_GRACE_MS;
 return {
  headersMs:clampBudget(env.CYBERME_CHAT_HEADERS_MS,headersDefault,headersDefault),
  firstContentMs:clampBudget(env.CYBERME_CHAT_FIRST_CONTENT_MS,CHAT_PHASE_FIRST_CONTENT_MS,CHAT_PHASE_FIRST_CONTENT_MS),
  streamSilenceMs:clampBudget(env.CYBERME_CHAT_STREAM_SILENCE_MS,CHAT_PHASE_STREAM_SILENCE_MS,CHAT_PHASE_STREAM_SILENCE_MS),
  toolFallbackMs:clampBudget(env.CYBERME_CHAT_TOOL_FALLBACK_MS,CHAT_PHASE_TOOL_FALLBACK_MS,CHAT_PHASE_TOOL_FALLBACK_MS),
  toolGraceMs:clampBudget(env.CYBERME_CHAT_TOOL_GRACE_MS,CHAT_PHASE_TOOL_GRACE_MS,CHAT_PHASE_TOOL_GRACE_MS),
  repeatErrorLimit:Math.max(2,Math.floor(clampBudget(env.CYBERME_CHAT_REPEAT_ERROR_LIMIT,CHAT_PHASE_REPEAT_ERROR_LIMIT,CHAT_PHASE_REPEAT_ERROR_LIMIT))),
  hardMs,
 };
}

/** A tool's own allowance from its actual start. Known own-deadline tools get their real executor limit plus a small
 *  cleanup grace (their executor timeout is unchanged); everything else gets the bounded fallback. */
function toolAllowance(name:string,args:any,c:PhaseConfig){
 if(name==='run_command'){const t=Number(args?.timeoutMs);const own=Number.isInteger(t)&&t>=100&&t<=60000?t:60000;return own+c.toolGraceMs;}
 // Both GitHub readers use the same 15s `gh` executor timeout (agent-execution.ts githubRead).
 if(name==='read_github_issue'||name==='read_github_pull_request')return 15000+c.toolGraceMs;
 return c.toolFallbackMs;
}

/** Classify a returned tool result by the tools' actual return contracts, not by arbitrary business fields:
 *  - any thrown tool error (SDK isError) is an error;
 *  - chat tool wrappers report failures as `{error:<message>,code}` (a business entity's own `code` field alone is data);
 *  - run_command receipts report `status:'failed'|'unknown'` with exitCode/reason (no error/code) — not progress;
 *  - GitHub readers report failures as a details object containing only `{code}`.
 *  Returns a stable error key, or undefined for a successful result. */
export function toolErrorKey(name:string,result:any,isError:boolean):string|undefined{
 let d:any=result?.details;
 if(!d||typeof d!=='object'){const text=Array.isArray(result?.content)?result.content.map((p:any)=>typeof p?.text==='string'?p.text:'').join(''):typeof result==='string'?result:'';
  if(text&&text.trimStart().startsWith('{'))try{d=JSON.parse(text)}catch{d=undefined}}
 if(isError)return String((d&&typeof d==='object'&&(d.code||d.error))||'tool_error').slice(0,120);
 if(!d||typeof d!=='object'||Array.isArray(d))return undefined;
 if(typeof d.error==='string'&&d.error)return String(d.code||'tool_error').slice(0,120);
 if(name==='run_command'&&(d.status==='failed'||d.status==='unknown'))return ('command_'+d.status+':'+(d.reason||'exit_'+String(d.exitCode))).slice(0,120);
 if((name==='read_github_issue'||name==='read_github_pull_request')&&typeof d.code==='string'&&Object.keys(d).length===1)return d.code.slice(0,120);
 return undefined;
}
const digest=(v:unknown)=>{try{return createHash('sha256').update(JSON.stringify(v??null)).digest('hex').slice(0,16)}catch{return 'unhashable'}};

export function createPhaseWatchdog(c:PhaseConfig,onExpire:(kind:PhaseExpiry,detail:{phase:string;toolName?:string})=>void){
 const startedAt=Date.now(),hardAt=startedAt+c.hardMs;
 let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
 let state:ModelState='between',modelDeadline=startedAt+c.headersMs,attempts=0;
 const tools=new Map<string,{name:string;deadline:number;args:string}>();const ended=new Set<string>();
 let streak=0,lastErr='',retriesInStep=0;
 const stats={steps:0,attempts:0,retries:0,toolCalls:0,maxParallelTools:0,toolErrors:0,deltas:0,lastPhase:'between' as string};
 const modelKind=():PhaseExpiry=>state==='awaiting_first_content'?'first_content':state==='streaming'?'stream_silence':'headers';
 const setModel=(s:ModelState,deadline:number)=>{state=s;modelDeadline=deadline;stats.lastPhase=s;schedule()};
 const expire=(kind:PhaseExpiry,detail:{phase:string;toolName?:string})=>{if(disposed)return;dispose();onExpire(kind,detail)};
 function fire(){
  timer=undefined;if(disposed)return;const now=Date.now();
  if(hardAt<=now)return expire('hard',{phase:tools.size?'tool':state});
  for(const t of tools.values())if(t.deadline<=now)return expire('tool',{phase:'tool',toolName:t.name});
  if(!tools.size&&modelDeadline<=now)return expire(modelKind(),{phase:state});
  schedule();
 }
 function schedule(){
  if(disposed)return;if(timer)clearTimeout(timer);
  let next=hardAt;for(const t of tools.values())next=Math.min(next,t.deadline);if(!tools.size)next=Math.min(next,modelDeadline);
  timer=setTimeout(fire,Math.max(0,next-Date.now()));
 }
 function dispose(){disposed=true;if(timer)clearTimeout(timer);timer=undefined;tools.clear();}
 schedule();
 return {
  /** A provider request is about to be sent. Only the first MAX attempts of one step get a fresh headers window. */
  payload(){if(disposed)return;attempts++;stats.attempts++;if(attempts===1)stats.steps++;
   if(attempts<=CHAT_PHASE_MAX_ATTEMPTS_PER_STEP)setModel('awaiting_headers',Date.now()+c.headersMs);else{state='awaiting_headers';stats.lastPhase=state;schedule();}},
  /** Only a 2xx response starts successful-stream timing. */
  headers(status:number){if(disposed||!(status>=200&&status<300))return;setModel('awaiting_first_content',Date.now()+c.firstContentMs)},
  /** Non-empty text/thinking/toolcall delta: stream liveness only. */
  delta(kind:string,delta:unknown){if(disposed||!['text_delta','thinking_delta','toolcall_delta'].includes(kind)||typeof delta!=='string'||!delta.length)return;stats.deltas++;setModel('streaming',Date.now()+c.streamSilenceMs)},
  /** SDK backoff before its single bounded retry; the wait itself is bounded, the attempt count is not reset. */
  // Only the configured finite retries of one step get a bounded wait; duplicate/stale retry events never re-arm.
  retry(delayMs:number){if(disposed||retriesInStep>=CHAT_PHASE_MAX_ATTEMPTS_PER_STEP-1)return;retriesInStep++;stats.retries++;const d=Math.min(Math.max(0,Number(delayMs)||0),60000);setModel('retry_wait',Date.now()+d+Math.min(CHAT_PHASE_HEADERS_GRACE_MS,c.headersMs))},
  /** Assistant message finished. Success ends the step; an error keeps the current (non-fresh) deadline. */
  messageEnd(ok:boolean){if(disposed)return;if(!ok)return;attempts=0;retriesInStep=0;if(!tools.size)setModel('between',Date.now()+c.headersMs)},
  toolStart(id:string,name:string,args:any){if(disposed||!id||tools.has(id)||ended.has(id))return;stats.toolCalls++;tools.set(id,{name,deadline:Date.now()+toolAllowance(name,args,c),args:digest(args)});stats.maxParallelTools=Math.max(stats.maxParallelTools,tools.size);stats.lastPhase='tool';schedule()},
  /** Returns true for business progress (a successful tool result); repeated identical errors stop the run. */
  toolEnd(id:string,result:any,isError:boolean):boolean{
   const t=disposed||!id?undefined:tools.get(id);if(!t)return false;tools.delete(id);ended.add(id);if(ended.size>500)ended.clear();
   const name=t.name,err=toolErrorKey(name,result,isError);
   if(err){stats.toolErrors++;const key=name+'|'+t.args+'|'+err;streak=key===lastErr?streak+1:1;lastErr=key;}else{streak=0;lastErr='';}
   if(!tools.size){attempts=0;retriesInStep=0;setModel('between',Date.now()+c.headersMs)}else schedule();
   if(err&&streak>=c.repeatErrorLimit){expire('no_progress',{phase:'tool',toolName:name});return false;}
   return !err;
  },
  dispose,
  inFlightTools:()=>tools.size,
  snapshot:()=>({watchdog:'phase',phases:{headersMs:c.headersMs,firstContentMs:c.firstContentMs,streamSilenceMs:c.streamSilenceMs,toolFallbackMs:c.toolFallbackMs,toolGraceMs:c.toolGraceMs,repeatErrorLimit:c.repeatErrorLimit,maxAttemptsPerStep:CHAT_PHASE_MAX_ATTEMPTS_PER_STEP},...stats}),
 };
}
export type PhaseWatchdog=ReturnType<typeof createPhaseWatchdog>;
