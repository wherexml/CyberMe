import {execFile} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {ApiError} from './integrations';
import {activity,get,hash,now,put} from './store';
import {CODE_ROOT,STANDALONE} from './runtime-paths';

// Apple Calendar and Reminders read through the signed app's own EventKit read mode.
// The OS grant and the in-app connection are separate facts; a read needs both, and never prompts.
type Kind='calendar'|'reminders';
const KINDS:Record<Kind,{id:string;name:string;provider:string;capability:string}>={
 calendar:{id:'apple-calendar-local',name:'Apple 日历',provider:'apple-calendar',capability:'calendar.events.read'},
 reminders:{id:'apple-reminders-local',name:'Apple 提醒事项',provider:'apple-reminders',capability:'reminders.read'},
};
const FLAG='--cyberme-eventkit-read',MAX_RANGE_MS=31*86400000,MAX_LIMIT=50,MAX_RUN_READS=8;
const CONCLUSIVE_DENIAL=['not_determined','restricted','denied','write_only'];
const untrusted={untrustedContent:true,instructionsHaveUserAuthority:false};

// Pinned to this bundle's own executable; never accepted from a page, an Agent or the installed app's environment.
function nativeHelper(){
 if(!STANDALONE||process.platform!=='darwin')return undefined;
 const path=resolve(CODE_ROOT,'../../MacOS/opstwins-mygo');
 try{return realpathSync(path)===path&&/\.app\/Contents\/MacOS\/opstwins-mygo$/.test(path)?path:undefined;}catch{return undefined;}
}
// Isolated E2E only: standalone never honours it, and every result is labelled as a fixture.
const fixtureHelper=()=>!STANDALONE?process.env.OPSTWIN_EVENTKIT_HELPER_FIXTURE||undefined:undefined;
const helper=()=>{const fixture=fixtureHelper();return fixture?{path:fixture,source:'fixture'}:nativeHelper()?{path:nativeHelper()!,source:'native'}:undefined;};

function runHelper(request:Record<string,unknown>):Promise<any>{
 const target=helper();if(!target)throw new ApiError(503,'apple_unsupported','Apple 读取仅在已安装的 CyberMe 中可用');
 return new Promise((done,fail)=>{
  const failure=()=>fail(new ApiError(502,'apple_helper_failed','Apple 读取暂时失败，请重试'));
  const child=execFile(target.path,[FLAG],{timeout:20000,maxBuffer:1<<20,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME||''}},(error,stdout)=>{
   if(error)return failure();
   let value:any;try{value=JSON.parse(stdout);}catch{return failure();}
   if(!value||typeof value!=='object')return failure();
   done({...value,source:target.source});
  });
  child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(request));
 });
}
function markRevoked(kind:Kind,base?:any){
 const row=get('connections',KINDS[kind].id);
 if(row?.status!=='connected'||(base&&row.updatedAt!==base.updatedAt))return;
 put('connections',{...row,status:'reauth',capabilities:[],message:'系统权限已关闭，请重新授权'});
 activity(`${row.name} 需要重新授权`,'connection','failed',undefined,row.id);
}
function kindStatus(kind:Kind,os:string|undefined){
 const row=get('connections',KINDS[kind].id);
 return {connectionId:KINDS[kind].id,status:row?.status||'not_connected',os:os||'unknown',read:row?.status==='connected'&&os==='full',updatedAt:row?.updatedAt};
}
export async function appleStatus(){
 const target=helper();
 if(!target)return {supported:false,source:'none',calendar:kindStatus('calendar',undefined),reminders:kindStatus('reminders',undefined)};
 const value=await runHelper({op:'status'}).catch(()=>({ok:false}));
 for(const kind of Object.keys(KINDS) as Kind[])if(value.ok&&CONCLUSIVE_DENIAL.includes(value[kind]))markRevoked(kind);
 return {supported:value.ok===true,source:target.source,calendar:kindStatus('calendar',value.calendar),reminders:kindStatus('reminders',value.reminders)};
}
function parseKind(value:string):Kind{if(value!=='calendar'&&value!=='reminders')throw new ApiError(404,'not_found','未知的 Apple 连接');return value;}
// The OS prompt happens in the app before this call. Here the OS answer is verified, not assumed.
export async function authorizeApple(rawKind:string,input:any){
 const kind=parseKind(rawKind),meta=KINDS[kind],prior=get('connections',meta.id);
 if(Object.keys(input).some(k=>k!=='baseUpdatedAt')||(input.baseUpdatedAt!==undefined&&input.baseUpdatedAt!==prior?.updatedAt))throw new ApiError(409,'connection_changed','连接已变更，请刷新后重试');
 const value=await runHelper({op:'status'});
 if(value.ok!==true)throw new ApiError(502,'apple_helper_failed','Apple 读取暂时失败，请重试');
 if(value[kind]!=='full')throw new ApiError(403,'apple_permission_denied','系统尚未授予完整读取权限',{os:value[kind]});
 if(get('connections',meta.id)?.updatedAt!==prior?.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请刷新后重试');
 const saved=put('connections',{...prior,id:meta.id,name:meta.name,provider:meta.provider,type:'native',status:'connected',permissions:['read'],capabilities:[meta.capability],config:{adapter:'eventkit',readOnly:true},disconnectedAt:undefined,lastTestAt:now(),message:'系统已授权，可按请求只读读取'});
 activity(`连接：${meta.name}`,'connection','succeeded',undefined,meta.id);
 return {...kindStatus(kind,value[kind]),source:value.source,connection:saved};
}

const POLITE='请你?|麻烦你?|帮我|帮忙|替我|给我|please|kindly|help\\s+me|(?:can|could|would|will)\\s+you|(?:能否|能不能|能|可以|可否)\\s*(?:帮我|帮忙|替我|给我)';
const ACT='(?:查|搜|找|读|看看|看一下|看下|列出|显示|(?:search|find|look\\s*up|read|check|show|list|fetch|retrieve|get)\\b)';
const OBJECT:Record<Kind,string>={calendar:'(?:日历|日程|会议|calendar|schedule|events?\\b|meetings?\\b)',reminders:'(?:提醒事项|待办|reminders?\\b|to-?dos?\\b)'};
const WHEN='(?:我|今天|明天|后天|本周|这周|下周|这个月|下个月|上午|下午|晚上|\\s)*';
function requested(direct:string,kind:Kind){
 const object=OBJECT[kind];
 const asked=new RegExp(`^\\s*(?:(?:${POLITE})\\s*)*${ACT}.*${object}`,'i');
 const question=new RegExp(`^\\s*(?:${WHEN}(?:有什么|有哪些|有没有).{0,12}${object}|(?:what(?:'s|\\s+is|\\s+are)?|which|any)\\b.{0,30}${object})`,'i');
 const setting=new RegExp(`${object}\\s*(?:的\\s*)?(?:授权|权限|配置|设置|连接|连通|状态|access\\b|permissions?\\b|settings?\\b|status\\b|authori[sz]|connect)`,'i');
 const indirect=new RegExp(`${ACT}\\s*(?:一下\\s*)?(?:me\\s+)?(?:how\\b|why\\b|whether\\b|if\\b|是否|怎么|如何|怎样|为什么)`,'i');
 return direct.split(/[。.!！；;\n]+/).some(s=>(asked.test(s)||question.test(s))&&!setting.test(s)&&!indirect.test(s));
}
const runReads=new Map<string,number>();
function gate(runId:string,direct:string,kind:Kind){
 const run=get('runs',runId);
 if(run?.kind!=='chat'||run.status!=='running')throw new ApiError(403,'apple_direct_chat_only','Apple 数据只能在直接对话中按请求读取');
 if(!requested(direct,kind))throw new ApiError(403,'apple_not_requested','当前请求没有明确要求查看这项 Apple 数据');
 if(!helper())throw new ApiError(503,'apple_unsupported','Apple 读取仅在已安装的 CyberMe 中可用');
}
function connected(kind:Kind){
 const row=get('connections',KINDS[kind].id);
 if(row?.status!=='connected')throw new ApiError(403,'apple_not_connected','尚未在设置中连接这项 Apple 数据');
 return row;
}
function countRead(runId:string){
 const used=(runReads.get(runId)||0)+1;
 if(used>MAX_RUN_READS)throw new ApiError(429,'apple_read_scope_limit','本轮 Apple 读取次数已到上限，请缩小范围');
 runReads.set(runId,used);
 if(runReads.size>256)runReads.delete(runReads.keys().next().value as string);
}
async function read(kind:Kind,runId:string,request:Record<string,unknown>){
 const base=connected(kind);countRead(runId);
 const value=await runHelper(request);
 // A disconnect during the read discards its result.
 if(connected(kind).updatedAt!==base.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，本次结果已丢弃');
 if(value.ok===true)return value;
 if(value.code==='apple_permission_denied'){if(CONCLUSIVE_DENIAL.includes(value.status))markRevoked(kind,base);throw new ApiError(403,'apple_permission_denied','系统权限未授予，已停止读取');}
 if(value.code==='apple_list_not_found'||value.code==='apple_list_ambiguous')throw new ApiError(409,value.code,'提醒事项列表无法唯一确定',{lists:value.lists});
 throw new ApiError(502,typeof value.code==='string'?value.code:'apple_helper_failed','Apple 读取失败');
}
function boundedLimit(value:unknown){if(value===undefined)return 20;if(!Number.isInteger(value)||(value as number)<1||(value as number)>MAX_LIMIT)throw new ApiError(400,'invalid_limit',`limit 需为 1–${MAX_LIMIT}`);return value as number;}
const ZONED=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const proof=(source:string)=>source==='fixture'?'fixture_eventkit':'actual_eventkit';

export async function appleCalendarEvents(runId:string,direct:string,input:any){
 gate(runId,direct,'calendar');
 const start=input.start,end=input.end;
 if(typeof start!=='string'||typeof end!=='string'||!ZONED.test(start)||!ZONED.test(end))throw new ApiError(400,'invalid_range','start/end 需为带时区的 ISO 时间');
 const from=Date.parse(start),to=Date.parse(end);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>MAX_RANGE_MS)throw new ApiError(400,'invalid_range','时间范围需大于 0 且不超过 31 天');
 const limit=boundedLimit(input.limit);
 const value=await read('calendar',runId,{op:'events',start:new Date(from).toISOString().replace(/\.\d{3}Z$/,'Z'),end:new Date(to).toISOString().replace(/\.\d{3}Z$/,'Z'),limit});
 return {start,end,items:value.items,hasMore:value.hasMore===true,proof:proof(value.source),...untrusted};
}
export async function appleReminders(runId:string,direct:string,input:any){
 gate(runId,direct,'reminders');
 const list=input.list===undefined?'':input.list;
 if(typeof list!=='string'||list.length>200||/[\u0000-\u001f]/.test(list))throw new ApiError(400,'invalid_list','list 需为提醒事项列表名称或 ID');
 const limit=boundedLimit(input.limit);
 const value=await read('reminders',runId,{op:'reminders',list,limit});
 return {items:value.items,hasMore:value.hasMore===true,lists:value.lists,incompleteOnly:true,proof:proof(value.source),...untrusted};
}

export const isAppleRead=(name:string,params:any)=>name==='app_read'&&/^apple_/.test(String(params?.action||''));
// Receipts keep call and outcome only; titles and schedule stay out of durable records.
export function appleToolAudit(params:any,result?:any,errorCode?:string){
 return {input:{action:params?.action,scopeHash:hash(params?.input??{}),privacy:'apple_query_omitted'},output:{privacy:'apple_content_omitted',count:Array.isArray(result?.items)?result.items.length:0,hasMore:result?.hasMore===true,...(errorCode||result?.code?{code:errorCode||result.code}:{})}};
}
