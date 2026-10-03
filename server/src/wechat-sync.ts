import {ApiError,command} from './integrations';
import {get,list,put,activity,now} from './store';
const ID='wechat-sync-local';
const binary=process.env.OPSTWIN_WECHAT_CLI||'/opt/homebrew/bin/greenbubbles';
async function query(args:string[]){
  let result;
  try{result=await command(binary,args,20000);}catch{throw new ApiError(503,'wechat_cli_unavailable','无法启动 wechat-sync，请确认本机 GreenBubbles 已安装。');}
  if(result.timedOut)throw new ApiError(504,'wechat_timeout','微信读取超时，请稍后重试。');
  let value;try{value=JSON.parse(result.stdout);}catch{throw new ApiError(502,'wechat_invalid_response','微信同步返回格式异常，请检查 GreenBubbles。');}
  if(result.exitCode!==0||value.ok!==true)throw new ApiError(503,'wechat_source_unavailable','本机微信数据暂不可读，请在 GreenBubbles 确认连接后重试。');
  if(value.schema!=='greenbubbles.query.v1')throw new ApiError(502,'wechat_invalid_response','GreenBubbles 协议不兼容。');
  return value;
}
export async function connectWechat(){
  const old=get('connections',ID);let status='error',message='',evidence:any={readOnly:true};
  try{
    const source=await query(['source','status']);
    if(!(source.databaseCount>0))throw new ApiError(503,'wechat_source_empty','尚未发现可读取的微信数据库。');
    const sample=await query(['chats','--limit','1']);
    status='connected';message='已连接本机个人微信（wechat-sync），仅支持读取。';
    evidence={readOnly:true,databaseCount:source.databaseCount,coverageComplete:sample.consistency?.coverageComplete===true,verifiedAt:now()};
  }catch(error){message=error instanceof ApiError?error.message:'微信连接检测失败，请重试。';}
  if(get('connections',ID)?.updatedAt!==old?.updatedAt)throw new ApiError(409,'connection_changed','连接状态已变更，请刷新后重试。');
  const connection=put('connections',{...old,id:ID,name:'微信',provider:'wechat',type:'CLI',status,permissions:['read'],capabilities:status==='connected'?['wechat.chats.read','wechat.messages.read']:[],config:{adapter:'wechat-sync',readOnly:true},message,evidence,lastTestAt:now()});
  // Retire only earlier personal-WeChat placeholders; WeCom is a different product.
  for(const duplicate of list('connections').filter(c=>c.id!==ID&&/^(wechat|wechat-sync)$/i.test(c.provider||'')))put('connections',{...duplicate,status:'disconnected',supersededBy:ID});
  activity('连接个人微信','connection',status==='connected'?'succeeded':'failed',message,ID);
  return {ok:status==='connected',connection,message,capabilities:connection.capabilities};
}
function requireConnection(){const c=get('connections',ID);if(c?.status!=='connected'||!c.permissions?.includes('read'))throw new ApiError(409,'wechat_not_connected','请先连接本机微信。');return c;}
function cursorArgs(cursor?:string){if(!cursor)return [];if(cursor.length>8192||/[\x00-\x1f]/.test(cursor))throw new ApiError(400,'invalid_cursor','分页参数无效，请刷新会话。');return ['--cursor',cursor];}
function pageInfo(value:any){return {hasMore:value.page?.hasMore===true,nextCursor:typeof value.page?.nextCursor==='string'?value.page.nextCursor:undefined,coverageComplete:value.consistency?.coverageComplete===true,hasWarnings:Array.isArray(value.warnings)&&value.warnings.length>0};}
async function read(args:string[]){const before=requireConnection();const value=await query(args);if(requireConnection().updatedAt!==before.updatedAt)throw new ApiError(409,'connection_changed','连接已变更，请重新读取。');return value;}
export async function wechatChats(cursor?:string){const value=await read(['chats','--limit','20',...cursorArgs(cursor)]);return {...pageInfo(value),items:(value.items||[]).map((c:any)=>({id:c.id,name:c.displayName||c.id,lastAt:c.sortTimestamp}))};}
export async function wechatMessages(conversation:string,cursor?:string){
  if(!conversation||conversation.length>512||/[\x00-\x1f]/.test(conversation))throw new ApiError(400,'invalid_conversation','请选择有效会话。');
  const value=await read(['messages','list','--conversation',conversation,'--limit','50','--json',...cursorArgs(cursor)]);
  return {...pageInfo(value),items:(value.items||[]).map((m:any)=>({id:m.id,sender:m.senderDisplayName||m.sender||'微信联系人',at:m.createdAtUnix,text:typeof m.content?.Text==='string'?m.content.Text.slice(0,16000):`[${m.messageTypeLabel||'非文本消息'}]`}))};
}
