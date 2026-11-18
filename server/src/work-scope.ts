// Exact task continuation (docs/public/agent-execution.md, "跨轮工作范围").
//
// A small internal record in generic entity storage (type `agent_work_scopes`) binds one
// originating user message/run in one conversation to its allowed target, selected skill refs and
// a stable identity for operation keys. It stores ids and hashes only: the directive text is read
// from the original message at bind time, so deletion/forgetting of that message ends the scope.
// It is not a task product, scheduler or UI. Authority is never widened: readOnly, autonomy,
// source limits and per-call evidence checks stay authoritative; only the original user words
// can be quoted as evidence.
import {db,get,list,put,now,hash} from './store';
import {excludedRunIds} from './agent-session';

export type ScopeSkillRef={id:string;name:string;hash:string;invoked:boolean};
export type WorkScope={id:string;conversationId:string;originRunId:string;originRequestId?:string;originMessageId?:string;directiveHash:string;targetIds:string[];skillRefs:ScopeSkillRef[];explicitInvocation?:boolean;status:'open'|'completed'|'closed';closedReason?:string;boundRunIds:string[];lastOutcome?:string;createdAt?:string;updatedAt?:string};
const TYPE='agent_work_scopes';
export const scopesEnabled=()=>process.env.CYBERME_WORK_SCOPE!=='off';

// Whole-message continuation phrases only; anything longer is a new or amended request.
const CONTINUE=/^\s*(?:(?:好的?|嗯|ok|okay)\s*[，,、]?\s*)?(?:继续(?:吧|做|执行|处理|推进)?|接着(?:做|来|处理)?|按(?:这个|此|你说的)(?:做|来|办|执行)|就按这个(?:做|来)|照(?:这个|此)(?:做|办)|continue|go\s+on|go\s+ahead|proceed|carry\s+on|keep\s+going)\s*[。.!！~～]*\s*$/i;
export const isContinuation=(raw:string)=>CONTINUE.test(String(raw||''));

function origin(runId:string){
 const run=get('runs',runId),requestId=run?.requestId;
 let messageId:string|undefined;
 if(requestId){try{const row=db.prepare('SELECT data FROM chat_requests WHERE id=?').get(requestId) as any;messageId=row?JSON.parse(row.data).userMessage?.id:undefined}catch{}}
 return {requestId,messageId};
}
export const scopeIdFor=(conversationId:string,originRunId:string)=>'work-scope-'+hash({conversationId,originRunId}).slice(0,32);
export function openScope(input:{conversationId:string;runId:string;directive:string;explicitInvocation?:boolean;targetIds:string[];skillRefs?:ScopeSkillRef[]}):WorkScope{
 const id=scopeIdFor(input.conversationId,input.runId),prior=get(TYPE,id);if(prior)return prior;
 const o=origin(input.runId);
 return put(TYPE,{id,conversationId:input.conversationId,originRunId:input.runId,originRequestId:o.requestId,originMessageId:o.messageId,directiveHash:hash(input.directive),explicitInvocation:input.explicitInvocation===true,targetIds:[...new Set(input.targetIds)],skillRefs:input.skillRefs||[],status:'open',boundRunIds:[input.runId]}) as WorkScope;
}
export function closeScope(scope:WorkScope,reason:string,status:'completed'|'closed'='closed'){return put(TYPE,{...get(TYPE,scope.id),status,closedReason:reason}) as WorkScope;}
export function addScopeSkills(scopeId:string,refs:ScopeSkillRef[]){
 const scope=get(TYPE,scopeId) as WorkScope|undefined;if(!scope||!refs.length)return;
 const map=new Map(scope.skillRefs.map(r=>[r.id,r]));for(const r of refs)map.set(r.id,{...r,invoked:r.invoked||map.get(r.id)?.invoked===true});
 put(TYPE,{...scope,skillRefs:[...map.values()].slice(-20)});
}
/** New, unrelated direct work in the same conversation ends earlier open scopes (no silent revival). */
export function closeOpenScopes(conversationId:string,reason:string,except?:string){
 for(const s of list(TYPE) as WorkScope[])if(s.conversationId===conversationId&&s.status==='open'&&s.id!==except)closeScope(s,reason);
}
// Unresolved steps recorded under this scope, for the binding note. Command outputs are not stored.
export function unresolvedSteps(scopeId:string){
 const rows=[...list('command_operations'),...list('agent_operations')].filter((o:any)=>o.scopeId===scopeId&&['running','unknown','failed'].includes(o.status));
 return rows.slice(0,20).map((o:any)=>({step:o.stepId||o.action,status:o.status==='running'?'unknown':o.status,operationId:o.id}));
}

export type ScopeResolution={kind:'none'}|{kind:'bound';scope:WorkScope;directive:string;targetIds:string[];via?:'retry'}|{kind:'refused';reason:string;candidates?:number;steps?:any[]}|{kind:'fresh'};
const sameTargets=(a:string[],b:string[])=>a.length===b.length&&a.every(id=>b.includes(id));
// Origin validity shared by continuation and retry. Returns the current directive, or the reason
// (and closes the scope) when the origin was removed, forgotten, edited, stopped or lost its target.
function validate(scope:WorkScope,excluded:Set<string>,targetExists:(id:string)=>boolean):{directive:string}|{reason:string}{
 const message=scope.originMessageId?get('messages',scope.originMessageId):undefined;
 const runs=scope.boundRunIds.map(id=>get('runs',id)).filter(Boolean);
 let reason:string|undefined;
 if(!message||typeof message.content!=='string')reason='origin_removed';
 else if([scope.originRunId,...scope.boundRunIds].some(id=>excluded.has(id)))reason='origin_forgotten';
 else if(hash(message.content)!==scope.directiveHash)reason='origin_changed';
 // A stopped or interrupted round ends the scope; a timeout/failure keeps it open for recovery.
 else if(runs.some((r:any)=>r.status==='cancelled'))reason='stopped';
 else if(scope.targetIds.some(id=>!targetExists(id)))reason='target_removed';
 if(reason){if(scope.status!=='closed'||scope.closedReason!==reason)closeScope(scope,reason);return {reason}}
 return {directive:message.content};
}
/**
 * The scope a continuation (or a bare skill selection) may rebind: exactly one valid open scope
 * in this conversation, or the one whose exact targets the user selected. Never the newest guess.
 * A confirmed target change (one candidate, different selection) closes that scope; its recorded
 * operations stay for readback.
 */
export function resolveContinuation(conversationId:string,currentRunId:string,contextIds:string[],targetExists:(id:string)=>boolean):ScopeResolution{
 const open=(list(TYPE) as WorkScope[]).filter(s=>s.conversationId===conversationId&&s.status==='open'&&s.originRunId!==currentRunId);
 const valid:{scope:WorkScope;directive:string}[]=[];
 const excluded=excludedRunIds(open.flatMap(s=>[s.originRunId,...s.boundRunIds]));
 for(const scope of open){const v=validate(scope,excluded,targetExists);if('directive' in v)valid.push({scope,directive:v.directive});}
 if(!valid.length)return {kind:'none'};
 if(contextIds.length){
  const exact=valid.filter(v=>sameTargets(contextIds,v.scope.targetIds));
  if(exact.length===1)return {kind:'bound',scope:exact[0].scope,directive:exact[0].directive,targetIds:exact[0].scope.targetIds};
  if(exact.length>1)return {kind:'refused',reason:'ambiguous',candidates:exact.length};
  if(valid.length===1){closeScope(valid[0].scope,'target_changed');return {kind:'refused',reason:'target_changed'}}
  return {kind:'refused',reason:'ambiguous',candidates:valid.length};
 }
 if(valid.length>1)return {kind:'refused',reason:'ambiguous',candidates:valid.length};
 const {scope,directive}=valid[0];
 return {kind:'bound',scope,directive,targetIds:scope.targetIds};
}
/**
 * A retry (same requestId, or retryOfRunId) links to the exact scope of the run it retries, so its
 * steps meet the original receipts. An unsafe link is refused (never replaced by a fresh grant):
 * other conversation, missing/revoked/stopped/completed origin, changed payload or target, or
 * unknown effects of an unscoped origin. 'fresh' means the retried run had no scope and no
 * unresolved effects, so ordinary new-request handling applies.
 */
export function resolveRetry(i:{conversationId:string;priorRunId:string;raw:string;contextIds:string[];targetExists:(id:string)=>boolean}):ScopeResolution{
 const prior=get('runs',i.priorRunId);
 if(!prior)return {kind:'refused',reason:'retry_origin_missing'};
 if(prior.conversationId!==i.conversationId)return {kind:'refused',reason:'retry_cross_conversation'};
 const scope=(list(TYPE) as WorkScope[]).find(s=>s.conversationId===i.conversationId&&(s.originRunId===i.priorRunId||(s.boundRunIds||[]).includes(i.priorRunId)));
 if(!scope){
  const steps=[...list('command_operations'),...list('agent_operations')].filter((o:any)=>o.runId===i.priorRunId&&['running','unknown'].includes(o.status)).slice(0,20).map((o:any)=>({step:o.stepId||o.action,status:'unknown',operationId:o.id}));
  return steps.length?{kind:'refused',reason:'retry_requires_readback',steps}:{kind:'fresh'};
 }
 if(scope.status==='completed')return {kind:'refused',reason:'retry_origin_completed'};
 // A retry may reopen a scope closed only by a later topic change; any other closure is final.
 if(scope.status==='closed'&&scope.closedReason!=='topic_changed')return {kind:'refused',reason:'retry_origin_'+(scope.closedReason||'closed')};
 const v=validate(scope,excludedRunIds([scope.originRunId,...scope.boundRunIds]),i.targetExists);
 if('reason' in v)return {kind:'refused',reason:'retry_origin_'+v.reason};
 if(hash(i.raw)!==scope.directiveHash)return {kind:'refused',reason:'retry_payload_changed'};
 if(!sameTargets(i.contextIds,scope.targetIds))return {kind:'refused',reason:'retry_target_changed'};
 const reopened=scope.status==='open'?scope:put(TYPE,{...scope,status:'open',closedReason:undefined,reopenedAt:now()}) as WorkScope;
 return {kind:'bound',scope:reopened,directive:v.directive,targetIds:scope.targetIds,via:'retry'};
}
export function bindRun(scope:WorkScope,runId:string){const current=get(TYPE,scope.id) as WorkScope;return put(TYPE,{...current,boundRunIds:[...new Set([...(current.boundRunIds||[]),runId])].slice(-50)}) as WorkScope;}
/** Turn end: a fully settled successful outcome completes the scope; anything else keeps it open. */
export function settleScope(scopeId:string,runStatus:string,taskOutcome:any,stopReason?:string){
 const scope=get(TYPE,scopeId) as WorkScope|undefined;if(!scope||scope.status!=='open')return;
 if(runStatus==='cancelled'){closeScope(scope,stopReason==='new_message'?'interrupted':'stopped');return}
 const outcome=taskOutcome?.status||runStatus;
 if(runStatus==='succeeded'&&outcome==='succeeded'&&!unresolvedSteps(scopeId).some(s=>s.status==='unknown')){put(TYPE,{...scope,status:'completed',closedReason:'outcome_succeeded',lastOutcome:outcome,completedAt:now()});return}
 put(TYPE,{...scope,lastOutcome:outcome});
}
export function scopeNote(r:ScopeResolution,raw:string){
 const said=raw.trim().slice(0,40);
 if(r.kind==='bound'){
  const steps=unresolvedSteps(r.scope.id);
  return `${r.via==='retry'?`本轮是对原交办的重试，已关联原工作范围 ${r.scope.id}（原始运行 ${r.scope.originRunId}）及其操作回执`:`用户本轮输入「${said}」承接本会话唯一未完成的交办（工作范围 ${r.scope.id}，原始运行 ${r.scope.originRunId}）`}。本轮工具授权依据该原交办原文（evidence 须逐字引用它）；目标、对象与范围不得超出原交办。原交办原文：\n${r.directive}\n${steps.length?`未确认或失败的步骤（先回读实际结果，未知步骤不得换 operationId 重放）：${JSON.stringify(steps)}`:'没有未确认的步骤记录。'}${r.scope.skillRefs.length?`\n原交办已选用的技能：${r.scope.skillRefs.map(s=>`${s.name}(${s.id})`).join('、')}；需要时重新 read_local_skill 核对当前版本。`:''}\n只读、自主权限、发送批准与来源限制仍按当前设置执行。`;
 }
 if(r.kind==='refused'){
  if(r.reason==='ambiguous')return `用户说“${said}”，但本会话有 ${r.candidates} 项可能的未完成交办；本轮不承接任何一项的执行授权，请简短询问用户要继续哪一项。`;
  if(r.reason==='target_changed')return `用户说“${said}”，但本轮选定的对象与原未完成交办不同；原交办的执行授权已撤销（已记录的操作仍可回读），本轮不承接，请确认目标。`;
  if(r.reason.startsWith('retry_'))return `本轮是重试，但不能安全关联原交办（${r.reason}）。本轮不执行命令或业务写入，也不以本轮消息作为新的执行授权；先用只读工具回读原操作的实际结果并如实告知用户。${r.steps?.length?`未确认的原操作：${JSON.stringify(r.steps)}`:''}`;
 }
 return `用户说“${said}”，但本会话没有可承接的未完成交办（可能已完成、停止、换题、被遗忘或删除）。不要恢复旧的执行授权；如需执行请让用户说明要做什么。`;
}
