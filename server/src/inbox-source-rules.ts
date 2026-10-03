import {activity, get, hash, list, put, db, toolEvidence} from './store';
import {ApiError} from './integrations';

export function inboxSources(query='') {
 const groups=new Map<string,any>();
 for(const item of list('inbox')) {
  if(!item.sourceId)continue;
  const key=hash([item.channel,item.sourceId]);
  const prior=groups.get(key);
  groups.set(key,{id:key,channel:item.channel,sourceId:item.sourceId,name:item.title,kind:item.category==='群聊'||prior?.kind==='group'?'group':'conversation'});
 }
 return [...groups.values()].filter(s=>s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(s=>({...s,excluded:get('inbox_source_rules',s.id)?.active===true}));
}
export function setInboxSourceRule(sourceKey:string,excluded:boolean,runId?:string) {
 const source=inboxSources().find(s=>s.id===sourceKey);
 if(!source)throw new ApiError(404,'source_not_found','来源不存在，请重新查找来源');
 db.exec('BEGIN IMMEDIATE');try{
 const rule=put('inbox_source_rules',{...get('inbox_source_rules',sourceKey),id:sourceKey,channel:source.channel,sourceId:source.sourceId,name:source.name,active:excluded,createdByRunId:runId});
 activity(`${excluded?'不再关注':'恢复关注'}来源：${source.name}`,'inbox_source_rule','succeeded',undefined,rule.id);
 if(runId)toolEvidence(runId,'inbox_source_rule_committed',{sourceKey,excluded},{id:rule.id},'succeeded',{effect:'write'});db.exec('COMMIT');
 return {rule,scope:'本地 Inbox、聊天待办与通知；原始来源保留',exceptions:'敏感、有草稿、失败、结果未知或判断不明确的事项仍保留关注'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function changeInboxSourceFromChat(runId:string,prompt:string,p:{sourceKey:string;query:string;excluded:boolean;evidence:string}) {
 const run=get('runs',runId);if(!run||run.readOnly)throw new ApiError(403,'read_only','当前运行不能修改规则');
 if(!p.evidence?.trim()||!prompt.includes(p.evidence)||!p.query?.trim()||!p.evidence.toLowerCase().includes(p.query.trim().toLowerCase()))throw new ApiError(400,'direct_request_required','必须引用当前用户的来源过滤请求');
 const exclude=/(不关注|不要.*(?:进入|进|显示|放入)|屏蔽|过滤|忽略|移出|exclude|mute|hide)/i;
 const restore=/(恢复|重新关注|取消.*(?:屏蔽|过滤|忽略)|重新.*(?:进入|显示)|unmute|restore|include again)/i;
 if(!(p.excluded?exclude:restore).test(p.evidence)||/(翻译|转述|引用|总结.*(?:消息|资料|内容)|translate|quoted|summarize)/i.test(prompt))throw new ApiError(400,'direct_request_required','只有当前用户直接要求才能修改来源规则');
 const matches=inboxSources(p.query);
 if(matches.length!==1||matches[0].id!==p.sourceKey)throw new ApiError(409,'ambiguous_source','来源名称有歧义，请用完整群名确认');
 return setInboxSourceRule(p.sourceKey,p.excluded,runId);
}
