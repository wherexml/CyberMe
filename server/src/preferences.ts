import { db, get, list, put, remove, uid, settings, snapshotMemories, toolEvidence } from './store';

const keys = ['language', 'tone', 'format'];

// Preferences remain editable/deletable memory entities, never system instructions.
export function savePreference(runId:string, prompt:string, input:{key:string;value:string;evidence:string}) {
 const run=get('runs',runId);if(!run||run.readOnly)throw new Error('Preference writes require a writable run');
 if(!keys.includes(input.key))throw new Error('Unsupported communication preference');
 const value=String(input.value||'').trim(), evidence=String(input.evidence||'').trim();
 if(!value||value.length>600||evidence.length<2||!prompt.includes(evidence))throw new Error('A preference requires a short value and an exact quote from the current user request');
 db.exec('BEGIN IMMEDIATE');
 try {
  const matches=list('memories').filter(m=>m.kind==='preference'&&m.preferenceKey===input.key&&!m.sourceSystem).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const old=matches[0];
  if(old?.body===value&&(!old.content||old.content===value)&&matches.length===1){db.exec('COMMIT');return {memory:old,unchanged:true};}
  snapshotMemories('communication_preference');
  for(const duplicate of matches.slice(1))remove('memories',duplicate.id);
  const memory=put('memories',{...old,id:old?.id||uid('memory'),kind:'preference',preferenceKey:input.key,title:`Communication preference: ${input.key}`,body:value,content:value,source:'direct_user',evidence,createdByRunId:old?.createdByRunId||runId,updatedByRunId:runId});
  // Keep the write receipt in the same transaction as the mutation for crash recovery.
  toolEvidence(runId,'preference_committed',{key:input.key},{memoryId:memory.id},'succeeded',{effect:'write'});
  db.exec('COMMIT');
  return {memory,unchanged:false};
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function userContext(runId:string) {
 const identity=settings().identity;
 const memories=list('memories').filter(m=>!m.sourceSystem&&['preference','personal'].includes(m.kind));
 const preferences=keys.flatMap(key=>memories.filter(m=>m.kind==='preference'&&m.preferenceKey===key).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,1));
 // Older personal memories stay available as user context, below structured preferences.
 // Imported persons/meetings/briefs are retrieved as facts, not user instructions.
 const personal=memories.filter(m=>m.kind==='personal').slice(0,50);
 const selected=[...preferences,...personal];
 toolEvidence(runId,'load_user_context',{}, {identityFields:['name','role','about','instructions'],memoryIds:selected.map(m=>m.id),preferenceIds:preferences.map(m=>m.id),interfaceLanguageUsedForReply:false});
 return {replyDefaults:'仅回应当前请求。偏好调整成功时简短确认偏好和保存结果，不回顾历史任务，不罗列未做的发送/草稿/文件，不追加无关建议或澄清。这些表达默认可被用户当前要求覆盖。',identity:typeof (identity as any).markdown==='string'?{markdown:(identity as any).markdown}:{name:identity.name,role:identity.role,about:identity.about,instructions:identity.instructions},preferences:preferences.map(m=>({id:m.id,key:m.preferenceKey,value:m.body,updatedAt:m.updatedAt})),personalMemories:personal.map(m=>({id:m.id,body:String(m.body||'').slice(0,m.id==='opstwins-memory-document'?200000:4000),updatedAt:m.updatedAt}))};
}
