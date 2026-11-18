import {activity, get, hash, list, put, db, toolEvidence} from './store';
import {ApiError} from './integrations';
import {ruleMode,INBOX_SOURCE_MODES,type InboxSourceMode} from '../../shared/inbox-source-mode';

export function inboxSources(query='') {
 const groups=new Map<string,any>();
 for(const item of list('inbox')) {
  if(!item.sourceId)continue;
  const key=hash([item.channel,item.sourceId]);
  const prior=groups.get(key);
  groups.set(key,{id:key,channel:item.channel,sourceId:item.sourceId,name:item.title,kind:item.category==='群聊'||prior?.kind==='group'?'group':'conversation'});
 }
 return [...groups.values()].filter(s=>s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(s=>{const mode=ruleMode(get('inbox_source_rules',s.id));return {...s,mode,excluded:mode==='exclude'};});
}
const LABEL:Record<InboxSourceMode,string>={all:'恢复关注全部消息',mentions:'仅关注@我的消息',exclude:'不再关注'};
/** Legacy callers pass `excluded:boolean`; new callers pass a mode. `active` stays equal to mode==='exclude'. */
export function setInboxSourceRule(sourceKey:string,modeOrExcluded:InboxSourceMode|boolean,runId?:string) {
 const mode:InboxSourceMode=typeof modeOrExcluded==='boolean'?(modeOrExcluded?'exclude':'all'):modeOrExcluded;
 if(!INBOX_SOURCE_MODES.includes(mode))throw new ApiError(400,'invalid_rule','mode 只能是 all、mentions 或 exclude');
 const source=inboxSources().find(s=>s.id===sourceKey);
 if(!source)throw new ApiError(404,'source_not_found','来源不存在，请重新查找来源');
 db.exec('BEGIN IMMEDIATE');try{
 const previous=get('inbox_source_rules',sourceKey),previousMode=ruleMode(previous);
 const rule=put('inbox_source_rules',{...previous,id:sourceKey,channel:source.channel,sourceId:source.sourceId,name:source.name,mode,active:mode==='exclude',createdByRunId:runId});
 activity(`${LABEL[mode]}来源：${source.name}`,'inbox_source_rule','succeeded',undefined,rule.id);
 if(runId)toolEvidence(runId,'inbox_source_rule_committed',{sourceKey,mode},{id:rule.id,mode,previousMode},'succeeded',{effect:'write'});db.exec('COMMIT');
 return {rule,mode,previousMode,excluded:mode==='exclude',
  scope:'本地 Inbox、聊天待办、默认草稿与洞察来源；原始来源消息保留',
  mentionDetection:mode==='mentions'?'仅使用连接器提供的可信@我元数据；无元数据时保持关注，不按正文文字猜测':undefined,
  exceptions:mode==='mentions'?'发送中、结果未知、外发失败与人工草稿保留关注；提及元数据未知时保持关注':'敏感、有草稿、失败、结果未知或判断不明确的事项仍保留关注'};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
const CLAUSE=/[。.;；\n！？!?]/;
const NEG='(?:不需要|无需|不要|禁止|切勿|勿|别|暂不|不能|不得|不许|不允许|do\\s+not|don[\'’]t|never)';
// "only @me" in its common forms; requires an explicit restriction word, so "没有@我" never matches.
const MENTIONS=/(?:只|仅)(?:看|关注|提醒|保留|显示|接收|要|留)?[^，,。.;；\n！？!?]{0,8}?(?:@|＠|艾特|提到|提及|at)\s*我|only\s+(?:show\s+|keep\s+|notify\s+(?:me\s+)?)?(?:when\s+i'?m\s+mentioned|(?:@|at\s+)?mentions?|@me|mentioned)|mentions?[-\s]only/gi;
/** Direction of a user clause: exclude / all (restore) / mentions; undefined when absent or contradictory. */
export function sourceRuleDirection(text:string):InboxSourceMode|undefined{
 // Negated commands are removed before deciding. Cancelling an exclusion is a restoration.
 let intent=text.replace(new RegExp(NEG+'\\s*(?:再\\s*)?(?:只|仅|only)[^，,。.;；\\n！？!?]*','gi'),'');
 intent=intent.replace(new RegExp('(?:'+NEG.slice(3,-1)+'|不(?=恢复|重新关注|屏蔽|过滤|忽略|移出))\\s*(?:再\\s*)?(?:恢复|重新关注|取消|屏蔽|过滤|忽略|移出|关注|restore|unmute|include|exclude|mute|hide)[^，,。.;；\\n！？!?]*','gi'),'');
 MENTIONS.lastIndex=0;const mentions=MENTIONS.test(intent);MENTIONS.lastIndex=0;
 // "只看@我的，其他的不要进入" restricts to mentions; the "others" clause is part of the same intent.
 const rest=mentions?intent.replace(MENTIONS,'').replace(/(?:其他|其余|其它|别的|everything\s+else|other\s+messages?|the\s+rest)[^，,。.;；\n！？!?]*/gi,''):intent;
 const exclude=/(不关注|不要[^，,。.;；\n！？!?]*(?:进入|进|显示|放入)|屏蔽|过滤|忽略|移出|\b(?:exclude|mute|hide)\b)/i;
 const restore=/(恢复(?:关注)?|重新关注|取消[^，,。.;；\n！？!?]*(?:屏蔽|过滤|忽略)|重新[^，,。.;；\n！？!?]*(?:进入|显示)|全部消息|所有消息|\b(?:unmute|restore|include again|all messages)\b)/gi;
 const restores=restore.test(rest);restore.lastIndex=0;
 const excludes=exclude.test(rest.replace(restore,''));
 const kinds=[mentions&&'mentions',excludes&&'exclude',restores&&'all'].filter(Boolean) as InboxSourceMode[];
 return kinds.length===1?kinds[0]:undefined;
}
export function changeInboxSourceFromChat(runId:string,prompt:string,p:{sourceKey:string;query:string;excluded?:boolean;mode?:InboxSourceMode;evidence:string}) {
 const run=get('runs',runId);if(!run||run.readOnly)throw new ApiError(403,'read_only','当前运行不能修改规则');
 if(p.mode!==undefined&&!INBOX_SOURCE_MODES.includes(p.mode))throw new ApiError(400,'invalid_rule','mode 只能是 all、mentions 或 exclude');
 if(p.mode===undefined&&typeof p.excluded!=='boolean')throw new ApiError(400,'invalid_rule','需要 mode 或 excluded');
 const legacy:InboxSourceMode|undefined=typeof p.excluded==='boolean'?(p.excluded?'exclude':'all'):undefined;
 if(p.mode&&legacy&&!(p.mode===legacy||(p.mode==='mentions'&&p.excluded===false)))throw new ApiError(400,'conflicting_rule','mode 与 excluded 不一致');
 const mode:InboxSourceMode=p.mode||legacy!;
 // Only current-user prose may authorize this tool. In particular, a verbatim
 // substring in quoted/source material is still not a user request.
 const direct=prompt.replace(/```[\s\S]*?```|<([\w:-]+)\b[^>]*>[\s\S]*?<\/\1\s*>|“[^”]*”|「[^」]*」|"[^"\n]*"|^\s*>.*$/gm,'');
 const query=p.query?.trim().toLocaleLowerCase()||'';
 if(!p.evidence?.trim()||!direct.includes(p.evidence)||!query||!p.evidence.toLocaleLowerCase().includes(query))throw new ApiError(400,'direct_request_required','必须引用当前用户的来源过滤请求');
 const targetsSource=(text:string)=>text.split(CLAUSE).some(clause=>clause.toLocaleLowerCase().includes(query)&&sourceRuleDirection(clause)===mode);
 if(sourceRuleDirection(p.evidence)!==mode||sourceRuleDirection(direct)!==mode||!targetsSource(p.evidence)||!targetsSource(direct)||/(翻译|转述|引用|总结.*(?:消息|资料|内容)|仅作为资料|不执行其中指令|translate|quoted|summarize)/i.test(prompt))throw new ApiError(400,'direct_request_required','只有当前用户直接要求且来源与方向一致才能修改来源规则');
 // A unique exact (case-insensitive) name wins over longer names that merely contain it; duplicate exact
 // names, or no exact name with several partial matches, stay ambiguous.
 const matches=inboxSources(p.query),exact=matches.filter(s=>String(s.name).trim().toLocaleLowerCase()===query);
 const candidates=exact.length?exact:matches;
 if(candidates.length!==1||candidates[0].id!==p.sourceKey)throw new ApiError(409,'ambiguous_source','来源名称有歧义，请用完整群名确认',{exactMatches:exact.length,partialMatches:matches.length});
 const result=setInboxSourceRule(p.sourceKey,mode,runId);
 // Readback from storage, so the tool result states what is actually persisted.
 const stored=get('inbox_source_rules',p.sourceKey);
 return {...result,readback:{mode:ruleMode(stored),active:stored?.active===true}};
}
