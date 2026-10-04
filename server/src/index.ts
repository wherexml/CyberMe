import {installSideChats} from './side-chats';
import {syncOverview,startSync,rescheduleSync} from './connection-sync';
import {saveSyncSettings,syncedAsset,syncRecords,type SyncScope} from './feishu-sync-data';
import {beginFeishuBinding,feishuBindingStatus} from './feishu-binding';
import {connectWechat,wechatChats,wechatMessages,wechatContacts,wechatSearch,wechatMessage,wechatCapabilities,wechatAttachment,wechatAttachmentContent,clearWechatReader} from './wechat-sync';
import { sourceMessageAsset } from './source-message-assets';
import { presentInbox } from './message-presentation';
import {inboxSources,setInboxSourceRule} from './inbox-source-rules';
import {inboxFeedback,recordInboxFeedback} from './store';
import {replyMessages} from '../../shared/reply-scope';
import {analyzeInbox,startInboxTriage} from './inbox-triage';
import {prepareSemanticAuthorization,getSemanticAuthorization,revalidateSemanticAuthorization,invalidateSemanticAuthorizationsForEntity,installSemanticCalendarProvider} from './semantic-authorization';
import {semanticCalendarProvider} from './semantic-calendar-provider';
import {installChatContinuation} from './chat-continuation';
import {autonomousState,tickAutonomousDispatches,cancelAutonomousDispatch,reconcileAutonomousDispatch,retryAutonomousDispatch,startAutonomousDispatch} from './autonomous-dispatch';
import {notificationState,notificationPreview,tickNotifications,reconcileNotification,retryNotification,startNotifications} from './notifications';
import {enqueueSourceProcessing,retrySourceProcessing,startSourceProcessing} from './source-processing';
import {retryLineage} from './run-lineage';
import {generateInboxDraft} from './drafts';
import {attachmentContradiction} from './attachment-consistency';
import {syncFeishu, startConnectionScheduler} from './connection-sync';
import {migrateAutomaticReplyFiles} from './automatic-files';
import { draftPolicy,workingWindow } from './policy';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { bootstrap, ROOT, DATA, db, get, list, put, remove, restore, settings, patchSettings, settingsHistory, snapshotMemories, memoryHistory, restoreMemories, activity, publicValue, TYPES, uid, hash, now, meta, setMeta, revision, beginRun, toolEvidence } from './store';
import { importSibling, sourceDetail, sourceChatMessages } from './import';
import { ApiError, feishuAuth, testConnection, sendItem, undoItem, connectionPermission } from './integrations';
import { llmConfig, runAgent } from './agent';
import { upload, generateArtifact, artifactText } from './artifacts';
import { nextScheduled, runAutomation, startScheduler } from './automations';
import { normalizeFollowup, createCalendarFromInbox, knownCalendarEvents, readCalendarEvent, deleteCalendarEvent, primaryCalendar } from './calendar';
import {voiceStatus,transcribeVoice} from './voice';
import {modelSettings,saveModelSettings,saveModelProvider} from './model-settings';
import {capabilityCatalog,installAgentOperations} from './agent-capabilities';
import {queryInbox,bulkInboxStatus} from './inbox-operations';
import {completedAgentWrites} from './agent-effects';
import {readConnectionResource,callConnectionTool} from './connection-resources';
import {mountNativeApi} from './native-api';
import {installWorkspaceSearch} from './workspace-search';
import {mountChatStatus} from './chat-status';
import {validateConnectionConfig,putConnection} from './connection-auth';

migrateAutomaticReplyFiles();
installSemanticCalendarProvider(semanticCalendarProvider);
export const app=new Hono();
const configuredWebPort=Number(process.env.OPSTWIN_WEB_PORT||46100),configuredApiPort=Number(process.env.OPSTWIN_API_PORT||46110);
if([configuredWebPort,configuredApiPort].some(port=>!Number.isInteger(port)||port<10000||port>65535))throw new Error('Use five-digit service ports');
const webOrigins=['http://localhost:'+configuredWebPort,'http://127.0.0.1:'+configuredWebPort];
const localOrigins=[...webOrigins,'http://localhost:'+configuredApiPort,'http://127.0.0.1:'+configuredApiPort];
app.use('*',cors({origin:origin=>webOrigins.includes(origin)?origin:undefined,allowMethods:['GET','POST','PATCH','DELETE','OPTIONS'],allowHeaders:['Content-Type'],credentials:false}));
// Only task-local Web origins may mutate this loopback API. Avoid ambient browser cross-origin writes.
app.use('/api/*',async(c,next)=>{const origin=c.req.header('origin');if(origin&&!localOrigins.includes(origin))throw new ApiError(403,'origin_blocked','请求来源不被允许');await next();});
app.onError((e,c)=>{const api=e instanceof ApiError?e:new ApiError(500,'internal_error',String(e));return c.json(publicValue({error:api.code,message:api.message,...(api.detail?{detail:api.detail}:{})}),api.status as any);});
app.get('/api/feishu/binding',async c=>c.json(await feishuBindingStatus()));
app.post('/api/feishu/binding',async c=>c.json(await beginFeishuBinding()));
app.post('/api/feishu/binding/poll',async c=>c.json(await feishuBindingStatus(true)));
app.notFound(c=>c.json({error:'not_found',message:'接口不存在'},404));
const json=(c:any,value:any,status=200)=>c.json(publicValue(value),status);
async function body(c:any) {let value;try{value=await c.req.json();}catch{throw new ApiError(400,'invalid_json','请求必须是 JSON 对象');}if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'invalid_body','请求必须是 JSON 对象');return value;}
// Existing UI callers keep arrays; Agent pagination requests receive an explicit envelope.
function listResponse(c:any,values:any[],legacyLimit?:number){
 const query=c.req.query();if(query.query)values=values.filter(v=>[v.title,v.name,v.body,v.notes].some(t=>String(t||'').toLowerCase().includes(String(query.query).toLowerCase())));if(query.status)values=values.filter(v=>v.status===query.status);
 if(query.offset===undefined&&query.limit===undefined)return legacyLimit?values.slice(0,legacyLimit):values;
 const offset=Number(query.offset??0),limit=Number(query.limit??50);if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw new ApiError(400,'invalid_pagination','offset must be nonnegative; limit must be 1–200');
 const items=values.slice(offset,offset+limit);return {items,total:values.length,offset,limit,nextOffset:offset+items.length,hasMore:offset+items.length<values.length};
}
function need(type:string,id:string,includeDeleted=false) {const item=get(type,id,includeDeleted);if(!item)throw new ApiError(404,'not_found','对象不存在');return item;}
function validate(type:string,input:any,old:any={}) {
 if(type==='inbox')for(const field of ['sourceRule','dismissalFeedbackActive','surfacing','attentionOverride','triage','sourceProcessing','draftRunId','semanticAuthorization','semanticAuthorizationId','semanticClassification','semanticClassificationId','effectiveCategory','autonomousDispatch'])if(input[field]!==undefined&&JSON.stringify(input[field])!==JSON.stringify(old[field]))throw new ApiError(403,'server_managed_field',field+' is managed by the server');
 if(type==='inbox'&&['sending','sent','recalled','send_unknown'].includes(old.status))for(const field of ['draft','body','attachments','recipientId','isSelfTest','testMarker','sentDraft','sentText','sentAttachments'])if(input[field]!==undefined&&JSON.stringify(input[field])!==JSON.stringify(old[field]))throw new ApiError(409,'locked_send_payload','已外发或结果未知的消息内容已冻结，请复制创建新的审批项');
 const data={...old,...input};delete data.deleted;delete data.localEdited;delete data.diskPath;delete data.sourceSystem;delete data.receipt;delete data.recallReceipt;delete data.baseUpdatedAt;for(const field of ['calendarEvent','calendarReceipt','calendarStatus','calendarIntentKey','calendarRunId']){delete data[field];if(old[field]!==undefined)data[field]=old[field];}
 if(old.sourceSystem)data.sourceSystem=old.sourceSystem;
 if(['tasks','projects','ideas','memories','automations','conversations','inbox','connections'].includes(type)){data.title=String(data.title||data.name||'').trim();if(!data.title)throw new ApiError(400,'title_required','标题不能为空');if(data.title.length>500)throw new ApiError(400,'title_too_long','标题最多 500 字');}
 if(type==='tasks'){data.status=data.status||'active';if(!['active','pending','in_progress','completed','done','cancelled'].includes(data.status))throw new ApiError(400,'invalid_status','任务状态无效');if(data.status==='done')data.status='completed';data.completed=data.status==='completed';if(input.completed!==undefined&&input.status===undefined)data.status=input.completed?'completed':'active';if(data.projectId&&!get('projects',data.projectId))throw new ApiError(400,'invalid_project','关联项目不存在');if(data.dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate))throw new ApiError(400,'invalid_due_date','截止日期使用 YYYY-MM-DD');if(data.subtasks&&!Array.isArray(data.subtasks))throw new ApiError(400,'invalid_subtasks','子任务必须是数组');}
 if(type==='projects'){data.name=data.title;}
 if(type==='ideas'){data.description=String(data.description||'');data.category=data.category||'productivity';data.status=data.status||'new';}
 if(type==='inbox'){data.sender=data.sender||'许茂林';data.channel=data.channel||'Internal';data.origin=data.origin||'human';data.body=String(data.body||'');data.status=data.status||'pending';if(['draft','body','attachments'].some(field=>input[field]!==undefined&&JSON.stringify(old[field])!==JSON.stringify(input[field]))){data.approved=false;data.sensitiveApproved=false;}if(['sending','sent','recalled','send_unknown'].includes(data.status)&&data.status!==old.status)throw new ApiError(400,'invalid_status','发送状态只能由真实发送/撤回结果更新');if(['sending','sent','recalled','send_unknown'].includes(old.status)&&data.status!==old.status)throw new ApiError(409,'locked_send_state','已有发送结果的状态只能通过发送回读或撤回更新');if(old.receipt)data.receipt=old.receipt;if(old.recallReceipt)data.recallReceipt=old.recallReceipt;if(data.isSelfTest){if(data.recipientId!=='self'||!/^OPSADV-QA-[\w-]{6,100}$/.test(data.testMarker||''))throw new ApiError(400,'invalid_self_test','本人测试项需要 recipientId:self 和独立 OPSADV-QA 标记');data.sender='许茂林';data.channel='Feishu';}}
 if(type==='inbox'&&data.approved){const contradiction=attachmentContradiction(data);if(contradiction)throw new ApiError(409,'draft_attachment_mismatch',contradiction);}
 if(type==='memories'){data.kind=data.kind||'note';data.body=String(data.body||data.content||'');}
 if(type==='connections'){data.name=data.name||data.title;data.provider=data.provider||'Custom';data.type=data.type||'REST';data.status=old.status||'setup_required';if(input.status&&input.status!==data.status)throw new ApiError(400,'test_required','连接状态由真实检测结果决定');validateConnectionConfig(data,old);}
 if(type==='automations'){data.prompt=String(data.prompt||'').trim();if(!data.prompt)throw new ApiError(400,'prompt_required','请输入自动化执行内容');data.schedule=String(data.schedule||'daily 09:00');const computed=nextScheduled(data.schedule);data.enabled=!!data.enabled;data.nextRun=data.enabled?(old.schedule===data.schedule&&old.enabled&&old.nextRun?old.nextRun:computed):undefined;data.status=data.status||'ready';}
 return data;
}

app.get('/api/health',c=>json(c,{ok:true,name:'OpsTwin Advance',timestamp:now(),revision:revision(),database:'independent'}));
app.get('/api/agent/capabilities',c=>json(c,capabilityCatalog()));
app.get('/api/inbox/query',c=>json(c,queryInbox(c.req.query())));
app.post('/api/inbox/bulk-status',async c=>json(c,await bulkInboxStatus(await body(c))));
app.post('/api/connections/:id/read-resource',async c=>{const input=await body(c);if(Object.keys(input).length)throw new ApiError(400,'invalid_input','Use saved connection resource only');return json(c,await readConnectionResource(c.req.param('id')));});
app.post('/api/connections/:id/call-tool',async c=>json(c,await callConnectionTool(c.req.param('id'),await body(c))));
app.post('/api/artifacts/:id/archive',c=>{const item=need('artifacts',c.req.param('id'));const saved=put('artifacts',{...item,archivedAt:now()});activity('归档文件','archive','succeeded',undefined,item.id);return json(c,saved);});
app.post('/api/artifacts/:id/restore',c=>{const item=need('artifacts',c.req.param('id'));const saved=put('artifacts',{...item,archivedAt:undefined});activity('恢复文件','restore','succeeded',undefined,item.id);return json(c,saved);});
app.get('/api/voice/status',c=>json(c,voiceStatus()));
app.post('/api/voice/transcribe',async c=>{let form:FormData;try{form=await c.req.formData();}catch{throw new ApiError(400,'voice_form_required','语音上传需要multipart表单');}return json(c,await transcribeVoice(form.get('file') as File,c.req.raw.signal));});
app.get('/api/bootstrap',c=>json(c,bootstrap()));
app.get('/api/diagnostics',async c=>{const config=llmConfig();let auth:any;try{auth=await feishuAuth(true);}catch(e){auth={ready:false,error:String(e)};}return json(c,{pi:{installed:true,version:JSON.parse(readFileSync(ROOT+'/node_modules/@earendil-works/pi-coding-agent/package.json','utf8')).version,engine:'PI',restrictedTools:true},llm:{configured:!!config,baseUrl:config?.baseUrl,model:config?.model,deepModel:config?.deepModel},feishu:auth,import:meta<any>('sources',{}).counts||{},revision:revision(),runtime:{apiPort:46110,host:'127.0.0.1',scheduler:true}});});
app.get('/api/autonomous-dispatches',c=>json(c,autonomousState()));
app.post('/api/autonomous-dispatches/tick',async c=>{await tickAutonomousDispatches();return json(c,autonomousState());});
app.post('/api/autonomous-dispatches/:id/cancel',c=>json(c,cancelAutonomousDispatch(c.req.param('id'))));
app.post('/api/autonomous-dispatches/:id/retry',c=>json(c,retryAutonomousDispatch(c.req.param('id'))));
app.post('/api/autonomous-dispatches/:id/reconcile',async c=>json(c,await reconcileAutonomousDispatch(c.req.param('id'))));
app.get('/api/notifications',c=>json(c,notificationState()));
app.post('/api/notifications/preview',async c=>json(c,notificationPreview(await body(c))));
app.post('/api/notifications/tick',async c=>{await tickNotifications();return json(c,notificationState());});
app.post('/api/notifications/:id/reconcile',async c=>json(c,await reconcileNotification(c.req.param('id'))));
app.post('/api/notifications/:id/retry',async c=>json(c,await retryNotification(c.req.param('id'))));
app.get('/api/settings',c=>json(c,settings()));
app.get('/api/settings/models',c=>{c.header('Cache-Control','no-store');return json(c,modelSettings());});
app.patch('/api/settings/models/providers',async c=>json(c,saveModelProvider(await body(c))));
app.patch('/api/settings/models',async c=>json(c,saveModelSettings(await body(c))));
app.post('/api/settings/models/test',async c=>{
 const input=await body(c);
 if(!['standard','deep'].includes(input.role))throw new ApiError(400,'invalid_model_role','请选择普通任务或深度思考。 / Choose a model role.');
 if(input.version!==modelSettings().version)throw new ApiError(409,'model_settings_changed','配置已变更，请先重新读取。 / Configuration changed. Reload first.');
 return json(c,await runAgent('Reply with exactly OK.',{kind:'model_probe',title:'Model connection test: '+input.role,mode:input.role==='deep'?'deep':'chat',readOnly:true}));
});
app.patch('/api/settings',async c=>{const input=await body(c);if(input.identity && Object.hasOwn(input.identity,'language') && !['en','zh-CN'].includes(input.identity.language))throw new ApiError(400,'invalid_language','Choose English or 简体中文.');for(const key of ['memories','memory','memorySnapshots','memoryHistory'])delete input[key];if(input.autonomy?.levels){for(const value of Object.values(input.autonomy.levels))if(!['observe','draft','send_undo','autonomous','approval','auto'].includes(String(value)))throw new ApiError(400,'invalid_autonomy','自主级别无效');}return json(c,patchSettings(input));});
app.get('/api/settings/history',c=>json(c,settingsHistory()));
app.post('/api/settings/restore',async c=>{const input=await body(c);const row=db.prepare('SELECT data FROM settings_history WHERE id=?').get(String(input.historyId||'')) as any;if(!row)throw new ApiError(404,'history_not_found','历史版本不存在');return json(c,patchSettings(JSON.parse(row.data),'restore'));});
app.post('/api/import/sibling',c=>json(c,importSibling()));
app.get('/api/source-message-assets/:messageId/:fileKey',c=>{let asset;try{asset=sourceMessageAsset(c.req.param('messageId'),c.req.param('fileKey'));}catch{}if(!asset)throw new ApiError(404,'source_asset_unavailable','来源附件尚未缓存或不可用');c.header('Content-Type',asset.mime);c.header('X-Content-Type-Options','nosniff');c.header('Content-Security-Policy',"default-src 'none'; sandbox");const inline=/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(asset.mime);c.header('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.name)}`);return c.body(asset.bytes as any);});
app.get('/api/sources/:kind/:id',c=>{const item=sourceDetail(c.req.param('kind'),c.req.param('id'));if(!item)throw new ApiError(404,'source_not_found','来源不存在');return json(c,item);});
app.get('/api/sources/chats/:id/messages',c=>{const offset=Number(c.req.query('offset')||0),limit=Number(c.req.query('limit')||80);if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw new ApiError(400,'invalid_pagination','offset>=0，limit在1–200之间');const result=sourceChatMessages(c.req.param('id'),offset,limit);if(!result)throw new ApiError(404,'source_not_found','聊天来源不存在');return json(c,result);});
app.get('/api/memories/history',c=>json(c,{history:memoryHistory()}));
app.post('/api/memories/snapshot',c=>json(c,snapshotMemories(),201));
app.post('/api/memories/history/:id/restore',c=>{const result=restoreMemories(c.req.param('id'));if(!result)throw new ApiError(404,'history_not_found','知识快照不存在');return json(c,result);});
mountNativeApi(app);
installWorkspaceSearch(app);
mountChatStatus(app);
app.get('/api/conversations/primary',c=>{const id=meta<string|undefined>('primaryConversationId',undefined);return json(c,{conversationId:id,conversation:id?get('conversations',id):undefined});});
app.post('/api/sync/feishu',async c=>json(c,await syncFeishu()));
app.get('/api/feishu/sync',c=>json(c,syncOverview(Math.max(0,Math.floor(Number(c.req.query('offset'))||0)))));
app.patch('/api/feishu/sync/settings',async c=>{const saved=saveSyncSettings(await body(c));rescheduleSync();return json(c,saved);});
app.post('/api/feishu/sync',async c=>{const input=await body(c);return json(c,startSync((input.scope||'all') as SyncScope));});
app.get('/api/feishu/sync/records',c=>json(c,syncRecords(c.req.query('kind')||'chats',Math.max(0,Math.floor(Number(c.req.query('offset'))||0)))));
app.get('/api/feishu/sync/assets/:id',c=>{const asset=syncedAsset(c.req.param('id'));c.header('Content-Type',asset.mime);c.header('X-Content-Type-Options','nosniff');c.header('Content-Security-Policy',"default-src 'none'; sandbox");c.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`);return c.body(asset.bytes as any);});

app.post('/api/inbox/:id/process-source',c=>json(c,{jobs:enqueueSourceProcessing([need('inbox',c.req.param('id')).id])}));
app.post('/api/inbox/:id/process-source/retry',c=>json(c,retrySourceProcessing(c.req.param('id'))));
app.get('/api/runs',c=>json(c,listResponse(c,list('runs'),100)));
app.get('/api/runs/:id',c=>json(c,need('runs',c.req.param('id'))));
// Native message actions resolve the exact associated run, independently of
// entity CRUD (messages are deliberately not a writable generic resource).
app.get('/api/messages/:id',c=>json(c,need('messages',c.req.param('id'))));
app.get('/api/activities',c=>json(c,listResponse(c,list('activities'))));
app.get('/api/activities/:id',c=>json(c,need('activities',c.req.param('id'))));
app.get('/api/artifacts',c=>json(c,listResponse(c,list('artifacts'))));
app.get('/api/artifacts/:id',c=>json(c,need('artifacts',c.req.param('id'))));

app.post('/api/wechat/connect',async c=>json(c,await connectWechat()));
app.get('/api/wechat/chats',async c=>json(c,await wechatChats(c.req.query('cursor'),c.req.query('limit'))));
app.get('/api/wechat/capabilities',c=>json(c,wechatCapabilities()));
app.post('/api/wechat/contacts',async c=>json(c,await wechatContacts(await body(c))));
app.post('/api/wechat/messages/search',async c=>json(c,await wechatSearch(await body(c))));
app.post('/api/wechat/message',async c=>json(c,await wechatMessage(await body(c))));
app.post('/api/wechat/attachment',async c=>json(c,await wechatAttachment(await body(c))));
app.get('/api/wechat/attachments/:token',async c=>{const result=await wechatAttachmentContent(c.req.param('token'));return c.body(new Uint8Array(result.bytes),200,{'Content-Type':result.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});});
app.get('/api/wechat/messages',async c=>json(c,await wechatMessages(c.req.query('conversation')||'',c.req.query('cursor'),c.req.query('limit'))));
app.post('/api/connections/test',async c=>json(c,await testConnection(await body(c))));
app.post('/api/connections/:id/test',async c=>{let input={};if(c.req.header('content-length')!=='0'){try{input=await c.req.json();}catch{}}return json(c,await testConnection(input,c.req.param('id')));});
app.post('/api/connections/:id/disconnect',c=>{const old=need('connections',c.req.param('id'));const connection=put('connections',{...old,status:'disconnected',disconnectedAt:now()});if(old.id==='wechat-sync-local')clearWechatReader();activity(`断开连接：${old.name}`,'connection','succeeded',undefined,old.id);return json(c,connection);});
app.post('/api/inbox/:id/send',async c=>{const input=await body(c);const originalItem=need('inbox',c.req.param('id'));const followup=normalizeFollowup(input.followup===undefined?originalItem.followup:input.followup);const priorSend=db.prepare('SELECT key FROM send_intents WHERE key=?').get(String(input.idempotencyKey||''));if(!priorSend&&followup?.kind==='calendar'&&new Date(followup.endAt!).getTime()<=Date.now())throw new ApiError(400,'calendar_time_passed','不能安排已经完全过去的日程');const result=await sendItem(c.req.param('id'),{...input,followup,...(followup?.kind==='task'?{addTask:true,taskTitle:followup.title,dueDate:followup.dueDate}:{})});if(followup?.kind==='calendar'){try{const calendar=await createCalendarFromInbox(c.req.param('id'),{followup,allowConflict:input.allowConflict});return json(c,{...result,item:calendar.item,calendarEvent:calendar.event,calendarReceipt:calendar.receipt,calendarRun:calendar.run});}catch(e){const latest=need('inbox',c.req.param('id'));const saved=put('inbox',{...latest,followup,calendarStatus:latest.calendarStatus==='unknown'?'unknown':'failed',calendarError:String(e),calendarCode:e instanceof ApiError?e.code:'calendar_failed',calendarConflicts:e instanceof ApiError?e.detail?.conflicts:undefined});return json(c,{...result,item:saved,calendarStatus:saved.calendarStatus,calendarError:String(e),calendarDetail:e instanceof ApiError?e.detail:undefined});}}return json(c,result);});
app.post('/api/inbox/:id/undo',async c=>json(c,await undoItem(c.req.param('id'))));
app.post('/api/inbox/:id/calendar',async c=>json(c,await createCalendarFromInbox(c.req.param('id'),await body(c))));
app.get('/api/calendar/status',async c=>json(c,await primaryCalendar()));
app.get('/api/calendar/events',c=>json(c,listResponse(c,knownCalendarEvents())));
app.get('/api/calendar/events/:id',async c=>json(c,await readCalendarEvent(c.req.param('id'))));
app.delete('/api/calendar/events/:id',async c=>json(c,await deleteCalendarEvent(c.req.param('id'))));

app.post('/api/chat',async c=>{
 const input=await body(c);const message=String(input.message||'').trim();if(!message)throw new ApiError(400,'message_required','请输入消息');if(message.length>80000)throw new ApiError(413,'message_too_long','消息超过 80000 字');if(input.mode&&!['chat','deep'].includes(input.mode))throw new ApiError(400,'invalid_mode','模式无效');if(input.readOnly!==undefined&&typeof input.readOnly!=='boolean')throw new ApiError(400,'invalid_read_only','readOnly必须是布尔值');
 if(input.preservePrimary!==undefined&&typeof input.preservePrimary!=='boolean')throw new ApiError(400,'invalid_preserve_primary','preservePrimary必须是布尔值');
 const requestId=String(input.requestId||uid('request'));if(requestId.length>128||!/^[\w-]+$/.test(requestId))throw new ApiError(400,'invalid_request_id','请求 ID 无效');const fingerprint=hash({message,attachmentIds:input.attachmentIds||[],mode:input.mode||'chat',contextIds:input.contextIds||[],...(input.readOnly?{readOnly:true}:{}),...(input.retryOfRunId?{retryOfRunId:input.retryOfRunId}:{})});const existing=db.prepare('SELECT * FROM chat_requests WHERE id=?').get(requestId) as any;const requestData=existing?JSON.parse(existing.data):undefined;
 if(existing){if(existing.hash!==fingerprint)throw new ApiError(409,'request_conflict','此请求 ID 已用于另一条消息');if(existing.state==='succeeded')return json(c,{...requestData.result,replayed:true});if(existing.state==='running')throw new ApiError(409,'request_in_progress','原消息正在处理中；请等待原运行终态',{conversationId:requestData.conversationId,requestId,runId:requestData.runId});if(existing.state==='partial')throw new ApiError(409,'partial_run_requires_review','原运行已执行本地写入，请先检查这些结果再提出新请求',{conversationId:requestData.conversationId,requestId,run:requestData.run,completedWrites:requestData.completedWrites});}
 const primaryId=meta<string|undefined>('primaryConversationId',undefined);const priorPrimary=primaryId?get('conversations',primaryId):undefined;
 const conversation=requestData?.conversationId?need('conversations',requestData.conversationId):input.conversationId?need('conversations',input.conversationId):priorPrimary||put('conversations',{title:message.slice(0,60),mode:input.mode||'chat',status:'active'});if(!conversation.sideChat&&input.preservePrimary!==true)setMeta('primaryConversationId',conversation.id);
 const busy=([...db.prepare("SELECT id,data FROM chat_requests WHERE state='running'").all(),...db.prepare("SELECT id,data FROM draft_requests WHERE state='running'").all()] as any[]).find(row=>JSON.parse(row.data).conversationId===conversation.id);if(busy)throw new ApiError(409,'conversation_busy','此会话已有运行，请等待后继续',{conversationId:conversation.id,requestId:busy.id});
 const userMessage=requestData?.userMessage||put('messages',{id:uid('message'),conversationId:conversation.id,role:'user',content:message,attachments:input.attachmentIds||[],contextIds:input.contextIds||[],requestId});const thread=list('messages').filter(m=>m.conversationId===conversation.id&&m.id!==userMessage.id).reverse();const replyItem=(input.contextIds||[]).map((id:string)=>get('inbox',id)).find(Boolean);const previous=replyItem?replyMessages(replyItem,conversation.id,thread,list('conversations')):thread;const run=beginRun('chat',message.slice(0,90),{requestId,conversationId:conversation.id,mode:input.mode||'chat',retryOf:requestData?.runId,...retryLineage(input)});const intent={conversationId:conversation.id,userMessage,runId:run.id};db.prepare('INSERT INTO chat_requests VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data,updated_at=excluded.updated_at').run(requestId,fingerprint,'running',JSON.stringify(intent),now());
 try{const result=await runAgent(message,{mode:input.mode||'chat',conversationId:conversation.id,history:previous,attachmentIds:input.attachmentIds,contextIds:input.contextIds,readOnly:input.readOnly===true,runId:run.id});const assistantMessage=put('messages',{id:uid('message'),conversationId:conversation.id,role:'assistant',content:result.text,runId:result.run.id,attachments:result.artifacts.map(a=>a.id),contextIds:input.contextIds||[]});put('conversations',{...get('conversations',conversation.id),lastRunId:result.run.id,lastMessageAt:now(),status:'active'});activity('完成 Twin 对话','chat','succeeded',undefined,conversation.id);const output={conversationId:conversation.id,userMessage,assistantMessage,run:result.run,artifacts:result.artifacts,requestId};db.prepare('UPDATE chat_requests SET state=?,data=?,updated_at=? WHERE id=?').run('succeeded',JSON.stringify({...intent,result:output}),now(),requestId);return json(c,output);}catch(e){put('conversations',{...get('conversations',conversation.id),status:'failed',lastError:String(e)});const failedRun=e instanceof ApiError?e.detail?.run:get('runs',run.id);const completedWrites=completedAgentWrites(failedRun);db.prepare('UPDATE chat_requests SET state=?,data=?,updated_at=? WHERE id=?').run(completedWrites.length?'partial':'failed',JSON.stringify({...intent,run:failedRun,completedWrites}),now(),requestId);if(completedWrites.length)throw new ApiError(409,'partial_run_requires_review','原运行已有完成的本地写入，请检查结果后继续',{conversationId:conversation.id,userMessage,requestId,run:failedRun,completedWrites});if(e instanceof ApiError)e.detail={...(e.detail||{}),conversationId:conversation.id,userMessage,requestId};throw e;}
});
app.get('/api/inbox/:id/feedback',c=>json(c,inboxFeedback(need('inbox',c.req.param('id')))));
app.get('/api/inbox-source-rules',c=>json(c,{sources:inboxSources(c.req.query('query')||''),rules:list('inbox_source_rules')}));
app.post('/api/inbox-source-rules',async c=>{const input=await body(c);if(typeof input.sourceKey!=='string'||typeof input.excluded!=='boolean')throw new ApiError(400,'invalid_rule','sourceKey 和 excluded 必填');return json(c,setInboxSourceRule(input.sourceKey,input.excluded));});
app.post('/api/inbox/:id/surface',c=>{const item=need('inbox',c.req.param('id'));const saved=put('inbox',{...item,attentionOverride:true});activity('恢复到收件箱','surfacing','succeeded',undefined,item.id);return json(c,saved);});
app.post('/api/inbox/:id/triage',async c=>{const input=await body(c);return json(c,await analyzeInbox(c.req.param('id'),{force:input.force===true}));});
app.get('/api/inbox/:id/policy',c=>json(c,draftPolicy(need('inbox',c.req.param('id')))));
app.get('/api/connections/:id/working-window',c=>{const input=c.req.query('at');if(input&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input)||!Number.isFinite(Date.parse(input))))throw new ApiError(400,'invalid_preview_time','Use an ISO timestamp with timezone');const at=input?new Date(input):new Date();return json(c,{...workingWindow(need('connections',c.req.param('id')).config,at),evaluatedAt:at.toISOString(),preview:!!input});});
app.post('/api/inbox/:id/draft',async c=>{let input:any={};try{input=await c.req.json();}catch{}return json(c,await generateInboxDraft(c.req.param('id'),input));});
app.post('/api/inbox/:id/draft-candidate/apply',async c=>{
 const item=need('inbox',c.req.param('id')),input=await body(c),candidate=item.draftCandidate;if(!candidate||candidate.requestId!==input.requestId)throw new ApiError(409,'candidate_not_found','This candidate is no longer pending');if(['sending','sent','recalled','send_unknown'].includes(item.status))throw new ApiError(409,'locked_send_state','Cannot replace an outbound reply');if(input.baseUpdatedAt!==item.updatedAt)throw new ApiError(409,'edit_conflict','Reply changed; review the latest version first');if(/^feishu$/i.test(item.channel))connectionPermission('draft');if(item.sensitive&&settings().autonomy.levels.sensitive==='observe')throw new ApiError(403,'sensitive_observe_only','Sensitive items remain observe only');const row=db.prepare('SELECT data FROM draft_requests WHERE id=?').get(candidate.requestId) as any;if(!row)throw new ApiError(409,'candidate_not_found','Candidate request is missing');const previous=JSON.parse(row.data);if(previous.itemId!==item.id)throw new ApiError(409,'candidate_mismatch','Candidate belongs to another reply');const updated=put('inbox',{...item,draft:candidate.text,editedByUser:false,attachments:[...new Set([...(item.attachments||[]),...candidate.artifactIds])],artifactIds:candidate.artifactIds,draftCandidate:undefined,draftError:undefined,approved:false,sensitiveApproved:false});const output={...previous.result,item:updated};db.prepare('UPDATE draft_requests SET state=?,data=?,updated_at=? WHERE id=?').run('succeeded',JSON.stringify({...previous,result:output}),now(),candidate.requestId);activity('Applied reviewed candidate draft','draft','succeeded',undefined,item.id,{previousDraft:item.draft,previousAttachments:item.attachments||[],runId:candidate.runId});return json(c,output);
});
// Retired route stays explicit for stale clients, without creating any files.
app.post('/api/inbox/:id/automatic-files/retry',()=>{throw new ApiError(410,'automatic_files_removed','回复自动文件生成已移除');});
app.post('/api/ideas/think',async c=>{
 const input=await body(c);const prompt=String(input.prompt||'').trim();if(!prompt)throw new ApiError(400,'prompt_required','请输入要思考的问题');if(input.mode&&!['chat','deep'].includes(input.mode))throw new ApiError(400,'invalid_mode','模式无效');const mode=input.mode||'deep';const lineage=retryLineage({...input,mode});const conversationId=input.conversationId||meta('primaryConversationId',undefined);const conversation=conversationId?need('conversations',conversationId):put('conversations',{title:'Ideas',mode,status:'active'});setMeta('primaryConversationId',conversation.id);const run=beginRun('ideas','发现 Ideas',{conversationId:conversation.id,mode,...lineage});const userMessage=put('messages',{conversationId:conversation.id,role:'user',content:prompt,runId:run.id});
 const result=await runAgent(`基于用户目标和数据库实际上下文，提出 3–5 个可执行的改进建议。先用只读 tools 了解事实。用户目标：${prompt}\n只输出 JSON 对象 {"ideas":[{"title":"标题","description":"事实依据与建议","category":"productivity|automation|communication|insight","action":"task|automation|draft|file"}]}。不能虚构客户、任务、数据、连接状态。`,{mode,kind:'ideas',conversationId:conversation.id,readOnly:true,runId:run.id});const assistantMessage=put('messages',{conversationId:conversation.id,role:'assistant',content:result.text,runId:result.run.id});let values:any[];
 try{const text=result.text.replace(/```(?:json)?/g,'');const match=text.match(/\{[\s\S]*\}/);values=JSON.parse(match?.[0]||text).ideas;if(!Array.isArray(values)||!values.length)throw new Error('No ideas');}catch{throw new ApiError(502,'invalid_ideas_output','AI 输出不是有效建议列表；原运行与候选结果已保留',{run:result.run,conversationId:conversation.id,userMessage,assistantMessage});}
 const prepared=values.slice(0,8).map(value=>validate('ideas',{...value,id:uid('idea'),status:'new',runId:result.run.id,conversationId:conversation.id}));const ideas=prepared.map(value=>put('ideas',value));put('conversations',{...get('conversations',conversation.id),status:'active',lastRunId:result.run.id,lastMessageAt:now()});return json(c,{ideas,run:result.run,conversationId:conversation.id,userMessage,assistantMessage});
});
app.post('/api/ideas/:id/execute',async c=>{const idea=need('ideas',c.req.param('id'));let input:any={};try{input=await c.req.json();}catch{}if(idea.status==='executed')return json(c,{idea,replayed:true,...(idea.result||{})});const action=input.action||idea.action||'task';let result:any={};if(action==='automation'){result.automation=put('automations',validate('automations',{title:idea.title,prompt:idea.description,schedule:input.schedule||'daily 09:00',enabled:input.enabled??false,ideaId:idea.id}));}else if(['draft','send','reply'].includes(action)){result.inbox=put('inbox',{title:idea.title,body:idea.description,draft:idea.description,sender:'OpsTwin',origin:'ai',channel:'Internal',status:'pending',approved:false,ideaId:idea.id});}else if(['file','pdf','docx','chart','timeline','diagram','xlsx','markdown'].includes(action)){result.artifact=await generateArtifact({kind:action==='file'?(input.kind||'markdown'):action,title:idea.title,content:idea.description,sourceIds:input.sourceIds});}else if(action==='task'){result.task=put('tasks',validate('tasks',{title:idea.title,notes:idea.description,dueDate:input.dueDate||'',projectId:input.projectId,ideaId:idea.id,status:'active'}));}else throw new ApiError(400,'invalid_action','建议操作无效');const updated=put('ideas',{...idea,status:'executed',executedAt:now(),result});activity(`执行建议：${idea.title}`,'idea','succeeded',action,idea.id);return json(c,{idea:updated,...result});});

app.post('/api/files',async c=>{const data=await c.req.parseBody();const file=data.file;if(typeof file==='string'||!file)throw new ApiError(400,'missing_file','请选择要上传的文件');return json(c,await upload(file as File,typeof data.conversationId==='string'?data.conversationId:undefined),201);});
app.post('/api/artifacts/generate',async c=>json(c,await generateArtifact(await body(c)),201));
app.get('/api/artifacts/:id/preview',async c=>{const a=need('artifacts',c.req.param('id'));if(!a.diskPath?.startsWith(DATA+'/files/')||!existsSync(a.diskPath))throw new ApiError(404,'file_not_found','文件内容不存在');return json(c,{text:/^(image\/|audio\/|video\/|application\/pdf)/.test(a.mime)?'':await artifactText(a.id)});});
app.get('/files/:id',c=>{const artifact=need('artifacts',c.req.param('id'));if(!artifact.diskPath?.startsWith(DATA+'/files/')||!existsSync(artifact.diskPath))throw new ApiError(404,'file_not_found','文件内容不存在');const bytes=readFileSync(artifact.diskPath);const mime=artifact.mime||'application/octet-stream';c.header('Content-Type',mime);c.header('X-Content-Type-Options','nosniff');const inline=/^(image\/|application\/pdf|text\/plain|text\/markdown)/.test(mime);c.header('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(artifact.name)}`);c.header('Content-Security-Policy',"default-src 'none'; sandbox");return c.body(bytes as any);});
app.get('/api/activity/export',c=>{const values=publicValue(list('activities'));if(c.req.query('format')==='csv'){const cell=(v:any)=>{let s=String(v??'');if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const text=['id,createdAt,title,kind,status,detail',...values.map(v=>[v.id,v.createdAt,v.title,v.kind,v.status,v.detail].map(cell).join(','))].join('\r\n');c.header('Content-Disposition','attachment; filename="opstwin-activity.csv"');c.header('Content-Type','text/csv; charset=utf-8');return c.body('\uFEFF'+text);}c.header('Content-Disposition','attachment; filename="opstwin-activity.json"');return json(c,{exportedAt:now(),revision:revision(),activities:values});});
app.post('/api/automations/:id/run',async c=>json(c,await runAutomation(c.req.param('id'))));
// Semantic checks collect evidence; they do not approve or send the original draft.
app.post('/api/inbox/:id/semantic-check',async c=>{
 const input=await body(c);if(Object.keys(input).length)throw new ApiError(400,'semantic_input_not_allowed','Semantic evidence is collected by the server');
 const item=need('inbox',c.req.param('id'));if(!item.sourceProcessing?.jobId)throw new ApiError(409,'source_job_required','Process the selected source first');
 const job=get('source_jobs',item.sourceProcessing.jobId),bound=job?.semanticAuthorizationId?getSemanticAuthorization(job.semanticAuthorizationId):undefined;
 const plan=list('autonomous_dispatches').find(p=>p.itemId===item.id&&p.jobId===job?.id);
 const activePlan=plan&&['waiting','sending','unknown'].includes(plan.state);
 let record:any,previewOnly=false;
 if(bound?.itemId===item.id&&bound.jobId===job?.id&&(bound.state==='verified'||activePlan)){
  record=bound.state==='verified'?await revalidateSemanticAuthorization(bound.id,item.id,job.id):bound;
 }else{
  previewOnly=true;const preview=item.semanticAuthorizationId?getSemanticAuthorization(item.semanticAuthorizationId):undefined;
  if(preview?.id!==bound?.id&&preview?.state==='verified'&&preview.itemId===item.id&&preview.jobId===job?.id){try{record=await revalidateSemanticAuthorization(preview.id,item.id,job.id)}catch(e){if(getSemanticAuthorization(preview.id)?.state!=='invalidated')throw e;}}
  if(!record)record=await prepareSemanticAuthorization(item.id,item.sourceProcessing.jobId);
 }
 const latest=need('inbox',item.id);if(latest.sourceProcessing?.jobId===record.jobId)put('inbox',{...latest,semanticAuthorizationId:record.id,semanticAuthorization:{id:record.id,state:record.state,effectiveCategory:record.effectiveCategory,authorizedText:record.authorizedText,renderMode:record.renderMode,reason:record.reason,previewOnly}});
 return json(c,{...record,previewOnly});
});
app.get('/api/inbox/:id/semantic-check',c=>{const item=need('inbox',c.req.param('id')),record=item.semanticAuthorizationId?getSemanticAuthorization(item.semanticAuthorizationId):undefined;if(!record||record.itemId!==item.id)throw new ApiError(404,'semantic_record_not_found','No semantic evidence has been collected');const job=item.sourceProcessing?.jobId?get('source_jobs',item.sourceProcessing.jobId):undefined;return json(c,{...record,previewOnly:record.id!==job?.semanticAuthorizationId});});
app.post('/api/inbox/:id/semantic-check/revalidate',async c=>{const input=await body(c);if(Object.keys(input).length)throw new ApiError(400,'semantic_input_not_allowed','Revalidation uses the current server record');const item=need('inbox',c.req.param('id'));if(!item.semanticAuthorizationId||!item.sourceProcessing?.jobId)throw new ApiError(409,'semantic_record_required','Collect evidence first');const record=await revalidateSemanticAuthorization(item.semanticAuthorizationId,item.id,item.sourceProcessing.jobId);return json(c,{...record,previewOnly:record.id!==get('source_jobs',item.sourceProcessing.jobId)?.semanticAuthorizationId});});


installSideChats(app);
for(const type of TYPES){
 app.get(`/api/${type}`,c=>{
   const deleted=c.req.query('deleted')==='true';
   const values=c.req.query('includeDeleted')==='true'
     ? [...list(type).map(v=>({...v,deleted:false})),...list(type,true).map(v=>({...v,deleted:true}))]
     : list(type,deleted).map(v=>({...v,deleted}));
   return json(c,listResponse(c,values));
 });
 app.get(`/api/${type}/:id`,c=>{const includeDeleted=c.req.query('includeDeleted')==='true';const item=need(type,c.req.param('id'),includeDeleted);const result=type==='tasks'&&includeDeleted?{...item,deleted:db.prepare('SELECT deleted FROM entities WHERE type=? AND id=?').get(type,item.id)?.deleted===1}:item;return json(c,type==='inbox'?presentInbox(result):result);});
 app.post(`/api/${type}`,async c=>{const input=await body(c);if(input.id&&get(type,input.id,true))throw new ApiError(409,'already_exists','此 ID 已存在');const validated=validate(type,{...input,id:input.id||uid(type.slice(0,-1))});const saved=type==='connections'?putConnection(validated):put(type,validated);if(type==='conversations')setMeta('primaryConversationId',saved.id);activity(`创建${type}：${saved.title}`,'create','succeeded',undefined,saved.id);return json(c,saved,201);});
 app.patch(`/api/${type}/:id`,async c=>{const old=need(type,c.req.param('id'));const input=await body(c);if(input.baseUpdatedAt&&input.baseUpdatedAt!==old.updatedAt)throw new ApiError(409,'edit_conflict','该对象已在其他页面更新，请刷新后再保存',{updatedAt:old.updatedAt,entity:old});if(input.id&&input.id!==old.id)throw new ApiError(400,'immutable_id','对象 ID 不能修改');const validated=validate(type,{...input,id:old.id},old);if(type==='inbox'&&['body','messages','sender','senderId','channel','sensitive'].some(key=>input[key]!==undefined&&JSON.stringify(input[key])!==JSON.stringify(old[key])))validated.attentionOverride=false;if(type==='inbox'&&input.status==='pending'&&old.status!==input.status)validated.attentionOverride=true;const saved=type==='connections'?putConnection(validated,old):put(type,validated);if(type==='inbox')recordInboxFeedback(old,saved);const materialFields=type==='inbox'?['title','body','sender','senderId','messages','context','sourceId','sourceScope','attachments','sourceAttachments','draft','draftCandidate','editedByUser','approved','sensitive','sensitiveApproved','category','recipientId','isSelfTest','testMarker','sourceSystem','followup','dueDate','externalRecipient','channel','status']:type==='memories'?['title','body','content','summary','transcript','kind','entityId','contextIds','createdByRunId']:[];if(materialFields.some(key=>JSON.stringify(saved[key])!==JSON.stringify(old[key])))invalidateSemanticAuthorizationsForEntity(old.id);activity(`更新${type}：${saved.title}`,'update','succeeded',undefined,saved.id);return json(c,saved);});
 app.delete(`/api/${type}/:id`,c=>{const old=need(type,c.req.param('id'));if(type==='inbox'&&['sending','send_unknown'].includes(old.status))throw new ApiError(409,'active_outbound','正在发送或结果未知的审批项需要回读或撤回，不能隐藏');if(type==='projects'&&list('tasks').some(t=>t.projectId===old.id))throw new ApiError(409,'project_in_use','请先移动关联任务再删除项目');invalidateSemanticAuthorizationsForEntity(old.id,'Entity deleted');remove(type,old.id);activity(`删除${type}：${old.title}`,'delete','succeeded',undefined,old.id);return json(c,{ok:true,id:old.id,deleted:true});});
 app.post(`/api/${type}/:id/restore`,c=>{need(type,c.req.param('id'),true);invalidateSemanticAuthorizationsForEntity(c.req.param('id'),'Entity restored; collect fresh evidence');const saved=restore(type,c.req.param('id'));activity(`恢复${type}：${saved?.title}`,'restore','succeeded',undefined,saved?.id);return json(c,saved);});
}

// Tools dispatch through the same Hono handlers as the UI, without a server URL or index import cycle.
installAgentOperations(async(path,method,input)=>{
 const response=await app.request(path,{method,headers:{'Content-Type':'application/json'},...(method!=='GET'?{body:JSON.stringify(input||{})}:{})});
 const isJson=response.headers.get('content-type')?.includes('application/json');
 const result:any=isJson?await response.json():{url:path,mime:response.headers.get('content-type'),bytes:Buffer.byteLength(await response.text())};
 if(!response.ok)throw new ApiError(response.status,result.error||'application_operation_failed',result.message||'Application operation failed',result.detail);
 return publicValue(result);
});

// Import only once at first start. Subsequent refreshes are explicitly user-triggered.
if(!meta('initialized',false)){importSibling();db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('initialized','true');}
// Interrupted work must stay reviewable; never retry an outbound or completed write on startup.
for(const operation of list('agent_operations').filter(o=>['running','unknown'].includes(o.status))){
 put('agent_operations',{...operation,status:'unknown',recoveryReason:'server_interrupted',recoveredAt:now()});
 const run=get('runs',operation.runId);if(run&&!run.tools?.some((t:any)=>t.input?.operationId===operation.id&&t.effect==='write'))toolEvidence(run.id,'application_operation_recovered',{operationId:operation.id,action:operation.action},{requiresReadback:true},'pending',{effect:'write',commitState:'unknown'});
}
for(const batch of list('inbox_batches').filter(b=>b.status==='running')){
 put('inbox_batches',{...batch,status:'interrupted',recoveryReason:'server_interrupted',recoveredAt:now()});
 const run=get('runs',batch.runId);if(run)toolEvidence(run.id,'inbox_batch_recovered',{operationId:batch.id,previewId:batch.previewId},{committedItems:batch.results?.filter((r:any)=>r.status==='changed').length||0,resumeWithOriginalIds:true},'pending',{effect:'write',commitState:'unknown'});
}
for(const row of db.prepare("SELECT * FROM chat_requests WHERE state='running'").all() as any[]){
 const intent=JSON.parse(row.data);const run=get('runs',intent.runId);const completedWrites=completedAgentWrites(run);const recoveredRun=run?put('runs',{...run,status:'failed',completedAt:now(),error:'server_interrupted',events:[...(run.events||[]),{type:'server_interrupted',at:now()}]}):undefined;
 db.prepare('UPDATE chat_requests SET state=?,data=?,updated_at=? WHERE id=?').run(completedWrites.length?'partial':'failed',JSON.stringify({...intent,run:recoveredRun,completedWrites}),now(),row.id);const conversation=get('conversations',intent.conversationId);if(conversation)put('conversations',{...get('conversations',conversation.id),status:'failed',lastError:'server_interrupted',lastRunId:intent.runId});
}
for(const row of db.prepare("SELECT * FROM draft_requests WHERE state='running'").all() as any[]){const intent=JSON.parse(row.data);db.prepare('UPDATE draft_requests SET state=?,data=?,updated_at=? WHERE id=?').run('failed',JSON.stringify({...intent,error:'server_interrupted'}),now(),row.id);const item=get('inbox',intent.itemId);if(item)put('inbox',{...item,draftError:'服务重启中断草稿生成；旧草稿保留，可以重试',draftRunId:intent.runId,conversationId:intent.conversationId});const conversation=get('conversations',intent.conversationId);if(conversation)put('conversations',{...conversation,status:'failed',lastError:'server_interrupted',lastRunId:intent.runId});}
for(const row of db.prepare("SELECT * FROM send_intents WHERE state='sending'").all() as any[]){
 const intent=JSON.parse(row.data);intent.error='server_interrupted';db.prepare('UPDATE send_intents SET state=?,data=?,updated_at=? WHERE key=?').run('unknown',JSON.stringify(intent),now(),row.key);const item=get('inbox',row.item_id);if(item)put('inbox',{...item,status:'send_unknown',sendKey:row.key,sendError:'服务重启中断发送，请使用原幂等键回读；不会自动重发',sentAttachments:intent.sentAttachments||[],receipt:intent.messageIds?.length?{messageId:intent.messageIds[0],messageIds:intent.messageIds,receipts:intent.receipts||[],recipientId:intent.recipientId,identity:'user',partial:true,proof:'persisted_cli_receipts'}:item.receipt});
}
for(const row of db.prepare("SELECT * FROM calendar_intents WHERE state='creating'").all() as any[]){const intent=JSON.parse(row.data);db.prepare('UPDATE calendar_intents SET state=?,updated_at=? WHERE key=?').run('unknown',now(),row.key);const item=get('inbox',row.item_id);if(item)put('inbox',{...item,calendarStatus:'unknown',calendarIntentKey:row.key,calendarError:'服务重启中断日历创建，请沿原 key 回读，不会自动重建',calendarRunId:intent.runId});}
for(const automation of list('automations').filter(row=>row.status==='running'))put('automations',{...automation,status:'failed',lastError:'server_interrupted',nextRun:automation.enabled?nextScheduled(automation.schedule):undefined});
for(const run of list('runs').filter(row=>row.status==='running'))put('runs',{...run,status:'failed',completedAt:now(),error:'server_interrupted',events:[...(run.events||[]),{type:'server_interrupted',at:now()}]});
installChatContinuation(app);
if(process.env.OPSTWIN_NO_BACKGROUND!=='1'){
startInboxTriage();
startScheduler();
startConnectionScheduler();
startSourceProcessing();
startNotifications();
startAutonomousDispatch();
}
if(process.env.OPSTWIN_NO_LISTEN!=='1'){const port=Number(process.env.OPSTWIN_API_PORT||46110);if(!Number.isInteger(port)||port<10000||port>65535)throw new Error('Use a five-digit API port');const server=serve({fetch:app.fetch,port,hostname:'127.0.0.1'});console.log(`OpsTwin Advance API http://127.0.0.1:${port}`);process.on('SIGTERM',()=>server.close());}
