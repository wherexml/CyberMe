import {enqueueSourceProcessing} from './source-processing';
import {ApiError,connectionPermission,feishuConnection} from './integrations';
import {get,put,now,list,uid,meta,setMeta} from './store';
import {collectFeishu,syncSettings,syncStorage,syncScopes,type SyncScope} from './feishu-sync-data';

let running=false;
export function syncOverview(offset=0){const runs=list('feishu_sync_runs');return {settings:syncSettings(),storage:syncStorage(),running,nextRuns:meta('feishuNextRuns',{}),history:{total:runs.length,offset,items:runs.slice(offset,offset+20)}};}
function mark(patch:any){const c=feishuConnection();if(c)put('connections',{...c,sync:{...c.sync,...patch}});}
function schedules(){const s=syncSettings();let allowed=!!feishuConnection();try{connectionPermission('read')}catch{allowed=false;}return {chats:allowed?s.chatIntervalMinutes:0,minutes:allowed&&s.meetingEnabled?s.meetingIntervalMinutes:0,mail:allowed&&s.mailEnabled?s.mailIntervalMinutes:0};}
export function rescheduleSync(){const intervals=schedules(),next:any={};for(const [scope,minutes]of Object.entries(intervals))next[scope]=minutes?new Date(Date.now()+Number(minutes)*60000).toISOString():null;setMeta('feishuNextRuns',next);setMeta('feishuScheduleIntervals',intervals);mark({interval:feishuConnection()?.config?.syncInterval||'manual',nextAt:next.chats});return next;}
export async function syncFeishu(trigger='manual',scope:SyncScope='chats',reservedId?:string){
 if(!syncScopes.includes(scope))throw new ApiError(400,'invalid_scope','同步范围无效');
 if(running&&!reservedId)throw new ApiError(409,'sync_in_progress','飞书同步正在进行');
 if(!feishuConnection())throw new ApiError(404,'connection_not_found','请先配置飞书连接');connectionPermission('read');running=true;
 const startedAt=now(),id=reservedId||uid('feishu-sync');const run=put('feishu_sync_runs',{id,status:'running',trigger,scope,startedAt,counts:{chats:0,messages:0,minutes:0,mail:0,attachments:0}});
 mark({status:'running',trigger,startedAt,error:null,runId:id});
 try{
  const result=await collectFeishu(scope,patch=>put('feishu_sync_runs',{...get('feishu_sync_runs',id),...patch}));
  const processing=enqueueSourceProcessing(result.itemIds,syncSettings().analysisDelayMinutes);const completedAt=now(),status=result.ok?'succeeded':result.failures.length&&!Object.values(result.counts).some(v=>Number(v)>0)?'failed':'partial';
  const {itemIds,...summary}=result;put('feishu_sync_runs',{...get('feishu_sync_runs',id),...summary,status,completedAt,durationMs:Date.parse(completedAt)-Date.parse(startedAt),storage:syncStorage(),processingCount:processing.length});
  mark({status,completedAt,imported:result.imported,selected:result.selected,skipped:result.skipped,filtered:result.filtered,unresolved:result.unresolved,failures:result.failures,error:null});return {...result,processing,trigger,startedAt,completedAt,runId:id};
 }catch(error){const completedAt=now();const failure={code:error instanceof ApiError?error.code:'sync_failed',message:'同步未完成，请检查连接和授权后重试'};put('feishu_sync_runs',{...get('feishu_sync_runs',id)||run,status:'failed',completedAt,durationMs:Date.parse(completedAt)-Date.parse(startedAt),error:failure});mark({status:'failed',completedAt,error:failure.message});throw error;
 }finally{running=false;const next:any=meta('feishuNextRuns',{}),intervals=schedules();for(const [key,minutes]of Object.entries(intervals))if(scope==='all'||scope===key)next[key]=minutes?new Date(Date.now()+Number(minutes)*60000).toISOString():null;setMeta('feishuNextRuns',next);mark({nextAt:next.chats});}
}
export function startSync(scope:SyncScope){if(!syncScopes.includes(scope))throw new ApiError(400,'invalid_scope','同步范围无效');if(running)throw new ApiError(409,'sync_in_progress','飞书同步正在进行');if(!feishuConnection())throw new ApiError(404,'connection_not_found','请先配置飞书连接');connectionPermission('read');const id=uid('feishu-sync');void syncFeishu('manual',scope,id).catch(()=>{});return {runId:id,status:'running'};}
export function startConnectionScheduler(){
 const interrupted=list('feishu_sync_runs').filter(r=>r.status==='running');
 for(const run of interrupted)put('feishu_sync_runs',{...run,status:'interrupted',completedAt:now(),error:{code:'server_interrupted',message:'服务重启中断了同步，可以重新执行'}});
 if(feishuConnection()?.sync?.status==='running')mark({status:'interrupted',completedAt:now(),error:'server_interrupted'});
 const intervals=schedules(),saved=meta<any>('feishuScheduleIntervals',{}),next=meta<any>('feishuNextRuns',{});
 if(interrupted.length||JSON.stringify(intervals)!==JSON.stringify(saved)||Object.entries(intervals).some(([scope,minutes])=>minutes?typeof next[scope]!=='string'||!Number.isFinite(Date.parse(next[scope])):next[scope]!=null))rescheduleSync();
 else mark({interval:feishuConnection()?.config?.syncInterval||'manual',nextAt:next.chats||null});
 const tick=()=>{const intervals=schedules();if(JSON.stringify(intervals)!==JSON.stringify(meta('feishuScheduleIntervals',{})))rescheduleSync();if(running)return;const next:any=meta('feishuNextRuns',{});for(const scope of ['chats','minutes','mail'] as SyncScope[]){if(next[scope]&&Date.parse(next[scope])<=Date.now()){void syncFeishu('schedule',scope).catch(()=>{});break;}}};
 const timer=setInterval(tick,2000);timer.unref();return timer;
}
