import {ApiError} from './integrations';
import {get,list,put,uid,hash,now,toolEvidence,publicValue} from './store';
import {agentPolicy} from './agent-policy';

type Action={name:string;method:'GET'|'POST'|'PATCH'|'DELETE';path:string;description:string;fields?:string[];entity?:boolean;external?:boolean;effect?:'read'|'write'};
export const actionWrites=(action:Action)=>action.effect? action.effect==='write':action.method!=='GET';
const a=(name:string,method:Action['method'],path:string,description:string,fields:string[]=[],extra:Partial<Action>={}):Action=>({name,method,path,description,fields,...extra});
export const applicationActions:Action[]=[
 a('entity_list','GET','/api/:resource','业务实体分页列表，返回items/total/nextOffset',['deleted','includeDeleted','offset','limit','query','status'],{entity:true}),
 a('entity_get','GET','/api/:resource/:id','读取完整实体',['includeDeleted'],{entity:true}),
 a('entity_create','POST','/api/:resource','创建本地业务实体，Inbox只创建本地草稿',[],{entity:true}),
 a('entity_update','PATCH','/api/:resource/:id','更新/完成/取消任务，修改项目/知识/草稿/设置连接/启停自动化；使用baseUpdatedAt',[],{entity:true}),
 a('entity_delete','DELETE','/api/:resource/:id','软删除实体，保留恢复和原业务限制',[],{entity:true}),
 a('entity_restore','POST','/api/:resource/:id/restore','恢复软删除实体',[],{entity:true}),
 a('inbox_triage','POST','/api/inbox/:id/triage','运行Jev判断',['force']),
 a('inbox_surface','POST','/api/inbox/:id/surface','恢复安静记录到Inbox'),
 a('inbox_process','POST','/api/inbox/:id/process-source','处理来源并排队真实分析'),
 a('inbox_process_retry','POST','/api/inbox/:id/process-source/retry','重试失败来源处理'),
 a('inbox_policy','GET','/api/inbox/:id/policy','读取草稿及处理政策'),
 a('inbox_draft','POST','/api/inbox/:id/draft','生成真实回复草稿',['mode','requestId','conversationId','retryOfRunId']),
 a('inbox_apply_candidate','POST','/api/inbox/:id/draft-candidate/apply','应用已审阅候选草稿',['requestId','baseUpdatedAt']),
 a('inbox_semantic_read','GET','/api/inbox/:id/semantic-check','读取语义证据'),
 a('inbox_semantic_check','POST','/api/inbox/:id/semantic-check','收集真实语义证据；不批准或发送'),
 a('inbox_semantic_revalidate','POST','/api/inbox/:id/semantic-check/revalidate','重新核验来源证据'),
 a('inbox_send','POST','/api/inbox/:id/send','发送或回读；仅服务端允许的本人QA项、明确本轮批准、原幂等键',['idempotencyKey','followup','addTask','taskTitle','dueDate','allowConflict'],{external:true}),
 a('inbox_undo','POST','/api/inbox/:id/undo','撤回已确认本人QA发送',['idempotencyKey'],{external:true}),
 a('calendar_create','POST','/api/inbox/:id/calendar','创建本人日历后续动作',['followup','allowConflict'],{external:true}),
 a('calendar_status','GET','/api/calendar/status','读取本人主日历连接'),
 a('calendar_list','GET','/api/calendar/events','已记录日程分页列表',['offset','limit','query','status']),
 a('calendar_get','GET','/api/calendar/events/:id','回读日程'),
 a('calendar_delete','DELETE','/api/calendar/events/:id','删除本项目本人QA日程',[],{external:true}),
 a('settings_read','GET','/api/settings','读取Identity/Autonomy/Channels设置'),
 a('settings_update','PATCH','/api/settings','保存用户设置，业务限制仍由服务端执行',['identity','autonomy','channels']),
 a('settings_history','GET','/api/settings/history','读取设置历史'),
 a('settings_restore','POST','/api/settings/restore','恢复设置历史',['historyId']),
 a('models_read','GET','/api/settings/models','脱敏渠道和普通/深度模型选择'),
 a('models_update','PATCH','/api/settings/models','已有私有渠道切换模型，不接受凭据',['version','standard','deep']),
 a('models_test','POST','/api/settings/models/test','真实模型连接测试',['role']),
 a('memory_history','GET','/api/memories/history','读取知识快照历史'),
 a('memory_snapshot','POST','/api/memories/snapshot','创建服务器知识快照'),
 a('memory_restore','POST','/api/memories/history/:id/restore','恢复知识快照，自动保留当前版本'),
 a('idea_think','POST','/api/ideas/think','真实模型发现灵感',['prompt','mode','conversationId','retryOfRunId']),
 a('idea_execute','POST','/api/ideas/:id/execute','执行灵感生成任务/草稿/文件/自动化',['action','schedule','enabled','kind','sourceIds','dueDate','projectId']),
 a('automation_run','POST','/api/automations/:id/run','真实运行本地自动化，不直接外发'),
 a('connection_test','POST','/api/connections/:id/test','检测已保存连接；凭据仅由服务器读取',['name','provider','type','endpoint','permissions','config']),
 a('connection_create_test','POST','/api/connections/test','新增并检测无凭据连接，OAuth未授权明确保留setup_required',['name','provider','type','endpoint','permissions','config']),
 a('connection_disconnect','POST','/api/connections/:id/disconnect','断开连接并阻断读取'),
 a('connection_window','GET','/api/connections/:id/working-window','预览连接工作时段',['at']),
 a('connection_read','POST','/api/connections/:id/read-resource','读取已授权REST或Skill内容',[],{effect:'read'}),
 a('connection_mcp_call','POST','/api/connections/:id/call-tool','调用已检测且授权的MCP工具，凭据仅服务器注入',['tool','arguments'],{external:true}),
 a('sync_read','GET','/api/feishu/sync','同步设置、历史和缓存数据大小',['offset']),
 a('sync_records','GET','/api/feishu/sync/records','读取索引缓存资料',['kind','offset','limit']),
 a('sync_update','PATCH','/api/feishu/sync/settings','设置同步窗口与频率',['chatIntervalMinutes','messagesPerChat','chatLimit','meetingEnabled','meetingIntervalMinutes','minutesLimit','minutesMessageLimit','mailEnabled','mailIntervalMinutes','mailLimit','analysisDelayMinutes','sourceChatName','includeAttachments']),
 a('sync_start','POST','/api/feishu/sync','采集飞书已授权数据并记录窗口/失败',['scope']),
 a('import_sources','POST','/api/import/sibling','从姊妹项目只读导入到独立数据库'),
 a('binding_read','GET','/api/feishu/binding','读取PersonalAgent Bot扫码绑定状态'),
 a('binding_start','POST','/api/feishu/binding','生成PersonalAgent Bot授权二维码'),
 a('binding_poll','POST','/api/feishu/binding/poll','轮询已有扫码授权；pending/slow_down不是故障'),
 a('wechat_status','GET','/api/connections/wechat-sync-local','读取只读个人微信连接状态'),
 a('wechat_connect','POST','/api/wechat/connect','连接本机只读GreenBubbles'),
 a('wechat_chats','GET','/api/wechat/chats','只读微信会话，正文不写审计',['cursor']),
 a('wechat_messages','GET','/api/wechat/messages','只读微信消息，正文不写审计',['conversation','cursor']),
 a('source_get','GET','/api/sources/:kind/:id','读取原始资料',['kind']),
 a('source_messages','GET','/api/sources/chats/:id/messages','分页读取会话历史',['offset','limit']),
 a('files_list','GET','/api/artifacts','分页读取已有文件元数据',['offset','limit','query','status']),
 a('file_preview','GET','/api/artifacts/:id/preview','提取可读文件正文'),
 a('file_generate','POST','/api/artifacts/generate','生成真实文件并记录写入账本',['kind','title','content','sourceIds']),
 a('file_archive','POST','/api/artifacts/:id/archive','归档文件并保留下载'),
 a('file_restore','POST','/api/artifacts/:id/restore','恢复已归档文件'),
 a('activity_read','GET','/api/activities','分页读取本地操作审计',['offset','limit','query','status']),
 a('activity_export','GET','/api/activity/export','导出真实审计，返回持久文件',['format']),
 a('runs_list','GET','/api/runs','分页读取执行记录',['offset','limit','query','status']),
 a('run_get','GET','/api/runs/:id','读取特定执行及工具回执'),
 a('dispatch_read','GET','/api/autonomous-dispatches','读取自主执行状态'),
 a('dispatch_tick','POST','/api/autonomous-dispatches/tick','执行一次授权调度检查',[],{external:true}),
 a('dispatch_cancel','POST','/api/autonomous-dispatches/:id/cancel','取消待执行计划'),
 a('dispatch_retry','POST','/api/autonomous-dispatches/:id/retry','按原计划重试',[],{external:true}),
 a('dispatch_reconcile','POST','/api/autonomous-dispatches/:id/reconcile','回读未知执行',[],{external:true}),
 a('notifications_read','GET','/api/notifications','读取通知状态'),
 a('notifications_preview','POST','/api/notifications/preview','预览通知渠道',['autonomy','timezone','at','urgent'],{effect:'read'}),
 a('notifications_tick','POST','/api/notifications/tick','执行一次已授权通知调度',[],{external:true}),
 a('notifications_retry','POST','/api/notifications/:id/retry','重试失败通知',[],{external:true}),
 a('notifications_reconcile','POST','/api/notifications/:id/reconcile','回读未知通知',[],{external:true}),
 a('health_read','GET','/api/health','检查应用服务健康'),
 a('diagnostics_read','GET','/api/diagnostics','检查脱敏配置、身份验证与导入状态'),
];
const resources=['tasks','projects','inbox','memories','ideas','automations','connections','conversations'];
const entityFields:Record<string,string[]>={
 tasks:['title','notes','status','completed','dueDate','projectId','subtasks'],projects:['title','name','notes','description','status'],
 inbox:['title','sender','channel','body','draft','status','attachments','context','category','sensitive','followup','dueDate','approved','sensitiveApproved'],
 memories:['title','body','content','kind','summary','entityId','contextIds'],ideas:['title','description','category','action','status'],
 automations:['title','prompt','schedule','enabled','mode','fileKind'],connections:['title','name','provider','type','endpoint','permissions','config'],conversations:['title','mode']
};
type Requester=(path:string,method:string,input?:any)=>Promise<any>;
let requester:Requester|undefined;
export function installAgentOperations(request:Requester){requester=request;}
export async function applicationRequest(path:string,method='GET',input?:any){if(!requester)throw new ApiError(503,'agent_operations_unavailable','Application operation dispatcher is not installed');return requester(path,method,input);}
export function capabilityCatalog(){const policy=agentPolicy();return {policy:{path:policy.path,hash:policy.hash},actions:applicationActions.map(x=>({...x,effect:actionWrites(x)?'write':'read',fields:x.entity&&['entity_create','entity_update'].includes(x.name)?Object.fromEntries(Object.entries(entityFields).map(([resource,fields])=>[resource,[...fields,'baseUpdatedAt','id']])):x.fields})),entityResources:resources,readOnlyListResources:['artifacts','activities','runs'],inboxTools:['query_inbox','set_inbox_status','bulk_set_inbox_status']};}
export function assertPublicInput(value:any){
 if(!value||typeof value!=='object')return;
 for(const [key,child]of Object.entries(value)){if(/api.?key|access.?token|refresh.?token|app.?secret|authorization|password|credential|headers|diskPath|^__proto__$|^constructor$|^prototype$/i.test(key))throw new ApiError(400,'private_field','Credentials and server fields cannot be passed through Agent tools');assertPublicInput(child);}
}
function directAuthorization(prompt:string){
 return prompt.replace(/```[\s\S]*?```|“[^”]*”|「[^」]*」|"[^"\n]*"|^\s*>.*$/gm,'').replace(/^(?:\s*请)?\s*(?:翻译|解释|总结|分析|阅读|translate|explain|summari[sz]e|review)[^：:\n]*[：:][\s\S]*$/i,'').replace(/(?:不要|禁止|切勿|勿|别|暂不|不能|不得|不许|不允许|不需要|无需|不是|不(?=执行|创建|删除|修改|发送|运行|调用|批准|恢复|生成|同步)|do\s+not|don['’]t|never)\s*[^，,。.;；\n！？!?]*/gi,'');
}
export function authorizeAgentWrite(prompt:string,evidence:unknown,external=false){
 if(typeof evidence!=='string'||!evidence.trim()||!prompt.includes(evidence))throw new ApiError(403,'user_evidence_required','evidence must quote the current user request');
 const direct=directAuthorization(prompt);
 if(/^(?:\s*请)?\s*(?:翻译|解释|分析|阅读|总结|translate|explain|analy[sz]e|summari[sz]e|review)\s*/i.test(direct)&&/(?:不要|禁止|勿|do not|don't)\s*(?:执行|操作|修改|创建|发送|execute|perform|modify|send)/i.test(direct))throw new ApiError(403,'quoted_instruction','Quoted material is not authorization');
 const verbs=external?/(发送|发给|发到|批准|撤回|创建.*日程|安排|删除.*日程|调用|执行|重试|回读|核对|send|approve|recall|schedule|delete|call|execute|retry|reconcile)/i:/(创建|建立|新增|添加|保存|记住|记录|整理|思考|建议|安排|更新|修改|改为|改成|设为|设置|完成|关闭|关掉|收掉|close|忽略|重新打开|恢复|删除|移除|归档|取消|执行|运行|重试|生成|同步|拉取|导入|连接|断开|绑定|启用|停用|暂停|开启|关闭|切换|检测|测试|检查|判断|处理|关注|复制|快照|create|add|save|remember|record|organize|think|suggest|update|edit|change|set|complete|done|dismiss|reopen|restore|delete|remove|archive|cancel|execute|run|retry|generate|sync|import|connect|disconnect|bind|enable|disable|pause|switch|test|check|assess|process|follow|snapshot)/i;
 if(!verbs.test(direct))throw new ApiError(403,'operation_not_requested','Current user request does not authorize this operation');
}
export async function executeApplicationAction(runId:string,prompt:string,params:any,readOnly=false){
 const action=applicationActions.find(x=>x.name===params.action);if(!action)throw new ApiError(400,'unknown_action','Unknown application action');
 const input=params.input||{};if(typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_input','input must be an object');assertPublicInput(input);
 const write=actionWrites(action);if(write){if(readOnly)throw new ApiError(403,'read_only','Read-only runs cannot write');authorizeAgentWrite(prompt,params.evidence,action.external);
  const direct=directAuthorization(prompt);
  const specific:Record<string,RegExp>={inbox_send:/(发送|发给|发到|send|approve)/i,inbox_undo:/(撤回|recall|undo)/i,calendar_create:/(日程|日历|安排|calendar|schedule)/i,calendar_delete:/(删除|移除|delete|remove)/i,connection_mcp_call:/(调用|执行.*工具|call|execute.*tool)/i,dispatch_tick:/(执行|运行|调度|execute|run|tick)/i,dispatch_retry:/(重试|retry)/i,dispatch_reconcile:/(回读|核对|核验|检查|reconcile|check)/i,notifications_tick:/(发送|通知|运行|调度|send|notify|run|tick)/i,notifications_retry:/(重试|retry)/i,notifications_reconcile:/(回读|核对|核验|检查|reconcile|check)/i};
  if(specific[action.name]&&!specific[action.name].test(direct))throw new ApiError(403,'operation_not_requested','Current request does not authorize '+action.name);
  if(action.name==='inbox_send'&&/(不要|禁止|勿|别|暂不|不|do not|don't|never)\s*(发送|外发|send)/i.test(prompt.replace(/```[\s\S]*?```|“[^”]*”|「[^」]*」|"[^"\n]*"/g,'')))throw new ApiError(403,'operation_not_requested','Current request forbids sending');
  if(action.name==='file_generate'&&!/(文件|报告|图|表格|pdf|word|docx|xlsx|markdown|diagram|chart|timeline|导出|export)/i.test(direct))throw new ApiError(403,'operation_not_requested','Current request does not request a file');
  const entityVerbs:Record<string,RegExp>={entity_create:/(创建|建立|新增|添加|生成|保存|记录|记住|整理|安排|create|add|generate|save|record|remember|organize|schedule)/i,entity_update:/(更新|修改|改为|改成|设为|设置|完成|关闭|关掉|收掉|忽略|重新打开|恢复|取消|启用|停用|暂停|开启|切换|update|edit|change|set|complete|close|done|dismiss|reopen|restore|cancel|enable|disable|pause|switch)/i,entity_delete:/(删除|移除|delete|remove)/i,entity_restore:/(恢复|还原|restore)/i};
  if(entityVerbs[action.name]&&!entityVerbs[action.name].test(direct))throw new ApiError(403,'operation_not_requested','Current request does not authorize '+action.name);
 }
 let path=action.path;const resource=params.resource;
 if(action.entity){if(!resources.includes(resource))throw new ApiError(400,'invalid_resource','Unsupported resource');path=path.replace(':resource',resource);}
 if(path.includes(':id')){if(typeof params.id!=='string'||!params.id.trim())throw new ApiError(400,'id_required','Entity id required');path=path.replace(':id',encodeURIComponent(params.id));}
 if(path.includes(':kind')){if(!['chats','persons','meetings','briefs','mails','mail'].includes(input.kind))throw new ApiError(400,'invalid_source','Unsupported source kind');path=path.replace(':kind',encodeURIComponent(input.kind));}
 const fields=action.entity&&['POST','PATCH'].includes(action.method)?[...(entityFields[resource]||[]),'baseUpdatedAt','id']:action.fields||[];
 if(Object.keys(input).some(k=>!fields.includes(k)))throw new ApiError(400,'invalid_action_field','Unsupported fields for '+action.name);
 if(action.name==='entity_create')input.createdByRunId=runId;
 if(action.entity&&resource==='inbox'&&action.method==='POST'&&input.channel&&input.channel!=='Internal')throw new ApiError(403,'local_draft_only','Agent-created Inbox entries are local Internal drafts');
 if(action.entity&&resource==='inbox'&&input.status&&!['pending','done','dismissed','cancelled'].includes(input.status))throw new ApiError(403,'managed_status','Outbound states are server-managed');
 if(write&&action.entity&&resource==='inbox'){
  const direct=directAuthorization(prompt);
  if(input.approved===true&&!/(批准|approve|授权发送)/i.test(direct))throw new ApiError(403,'approval_not_requested','Saving a draft does not authorize approval');
  if(input.sensitiveApproved===true&&!/(批准.{0,20}敏感|敏感.{0,20}批准|approve.{0,20}sensitive|sensitive.{0,20}approv)/i.test(direct))throw new ApiError(403,'sensitive_approval_not_requested','Sensitive approval requires an explicit request');
  if(input.sensitive===false&&!/(取消.{0,12}敏感|解除.{0,12}敏感|清除.{0,12}敏感|敏感.{0,20}(取消|解除|false|否|关闭)|remove.{0,20}sensitive|sensitive.{0,20}false)/i.test(direct))throw new ApiError(403,'sensitivity_change_not_requested','Clearing sensitivity requires an explicit request');
 }
 if(action.name==='file_generate'){input.runId=runId;input.conversationId=get('runs',runId)?.conversationId;}
 if(!write){if(action.method==='GET'){if(['entity_list','runs_list','activity_read','files_list','calendar_list'].includes(action.name)){input.offset??=0;input.limit??=50;}const query=new URLSearchParams();for(const [k,v]of Object.entries(input))if(k!=='kind'&&v!==undefined)query.set(k,String(v));if(query.size)path+='?'+query;}return applicationRequest(path,action.method,input);}
 // A persisted intent precedes dispatch. An interrupted intent blocks automatic replay.
 const id='agent-op-'+hash({runId,action:action.name,resource,id:params.id,input});const prior=get('agent_operations',id);
 if(prior?.status==='succeeded')return {...prior.result,replayed:true};
 if(prior&&['running','unknown'].includes(prior.status))throw new ApiError(409,'operation_requires_review','Earlier operation outcome requires readback',{operationId:id});
 put('agent_operations',{id,runId,action:action.name,status:'running',startedAt:now()});
 toolEvidence(runId,'application_operation_started',{action:action.name,operationId:id},{operationId:id},'pending',{effect:'write',commitState:'unknown'});
 try{const result=await applicationRequest(path,action.method,input);put('agent_operations',{id,runId,action:action.name,status:'succeeded',result:publicValue(result),completedAt:now()});const pendingResult=['sync_start','inbox_process','inbox_process_retry'].includes(action.name)&&(result.status==='running'||result.status==='queued'||result.jobs?.some((j:any)=>['running','queued'].includes(j.status)));toolEvidence(runId,'application_operation_committed',{action:action.name,operationId:id},{operationId:id,id:result?.id||result?.item?.id,pendingResult:!!pendingResult},'succeeded',{effect:'write',commitState:'committed'});const current=get('runs',runId);if(current)put('runs',{...current,tools:(current.tools||[]).map((t:any)=>t.name==='application_operation_started'&&t.input?.operationId===id?{...t,status:'succeeded',commitState:'settled'}:t)});return result;}
 catch(e){const unknown=!(e instanceof ApiError)||e.status>=500;put('agent_operations',{id,runId,action:action.name,status:unknown?'unknown':'failed',error:e instanceof ApiError?e.code:'operation_failed',completedAt:now()});if(!unknown){const current=get('runs',runId);if(current)put('runs',{...current,tools:(current.tools||[]).map((t:any)=>t.name==='application_operation_started'&&t.input?.operationId===id?{...t,status:'failed',commitState:'settled'}:t)});}throw e;}
}
