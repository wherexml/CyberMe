import {get,list,put,meta,setMeta,hash,now,uid} from './store';
import {ApiError} from './integrations';
import {wechatChats,wechatMessages,wechatConnectionLease} from './wechat-sync';
import {WECHAT_GROUP_POLICY} from './wechat-attention';

let running=false;
export function wechatSyncSettings(){const saved=meta<any>('wechatSyncSettings',{});const value={enabled:saved.enabled===true,intervalMinutes:5,lookbackDays:7,chatLimit:100,messagesPerChat:50,groupPolicy:WECHAT_GROUP_POLICY,categoryPolicy:'wesync-three-categories-v1'};return {...value,version:hash(value)};}
export function wechatSyncOverview(){return {settings:wechatSyncSettings(),running,nextAt:meta('wechatSyncNextAt',null),history:list('wechat_sync_runs').slice(0,20)};}
export function saveWechatSyncSettings(input:any){
 if(!input||Object.keys(input).some(k=>!['enabled','baseVersion'].includes(k))||typeof input.enabled!=='boolean')throw new ApiError(400,'invalid_sync_setting','微信同步设置无效');
 if(input.baseVersion!==wechatSyncSettings().version)throw new ApiError(409,'sync_settings_changed','同步设置已变化，请刷新后重试');
 if(input.enabled)wechatConnectionLease();
 setMeta('wechatSyncSettings',{enabled:input.enabled});setMeta('wechatSyncNextAt',input.enabled?new Date(Date.now()+300000).toISOString():null);return wechatSyncOverview();
}
export function startWechatSync(trigger='manual'){
 if(running)throw new ApiError(409,'sync_in_progress','微信同步正在进行');
 wechatConnectionLease();const config=wechatSyncSettings();if(trigger==='schedule'&&!config.enabled)throw new ApiError(409,'sync_disabled','自动同步已关闭');
 const id=uid('wechat-sync');put('wechat_sync_runs',{id,status:'running',trigger,startedAt:now(),counts:{chats:0,messages:0,changed:0,unchanged:0},failureCount:0});running=true;void collect(id,config).catch(()=>{});return {runId:id,status:'running'};
}
async function collect(id:string,config:ReturnType<typeof wechatSyncSettings>){
 const connectionVersion=wechatConnectionLease(),deadline=Date.now()+60000,counts={chats:0,messages:0,changed:0,unchanged:0},failures:{sourceHash?:string;code:string}[]=[],seen=new Set<string>(),cursorSet=new Set<string>();
 let limited=false,windowLimited=false,sourceHash='',cursor:string|undefined,scanned=0,changedRead=0;
 const guard=()=>{if(wechatConnectionLease()!==connectionVersion||wechatSyncSettings().version!==config.version)throw new ApiError(409,'wechat_sync_changed','连接或同步设置已变化，旧同步已停止');};
 const checkpoint=meta<Record<string,string>>('wechatSyncCheckpoints',{}),updates:Record<string,string>={};
 const progress=()=>put('wechat_sync_runs',{...get('wechat_sync_runs',id),counts:{...counts},scanned,failureCount:failures.length,windowLimited});
 try{
  do{
   guard();if(Date.now()>deadline||scanned>=1000){limited=true;break;}
   const page=await wechatChats(cursor,100);guard();if(page.hasWarnings)limited=true;if(page.sourceHash!==get('connections','wechat-sync-local')?.evidence?.sourceHash)throw new ApiError(409,'wechat_source_changed','微信账号已变化，请重新连接');if(!sourceHash)sourceHash=page.sourceHash;else if(sourceHash!==page.sourceHash)throw new ApiError(409,'wechat_source_changed','微信来源已变化，请重新同步');
   for(const chat of page.items){
    guard();if(seen.has(chat.id))continue;seen.add(chat.id);scanned++;
    if(chat.id.startsWith('@placeholder')||chat.id==='chatroom_session_box'||(chat.id.startsWith('@')&&!chat.id.endsWith('@chatroom')))continue;
    if(!Number.isFinite(Number(chat.lastAt))||Number(chat.lastAt)<=0){failures.push({sourceHash:hash([sourceHash,chat.id]),code:'wechat_time_unknown'});continue;}
    const sourceKey=hash([sourceHash,chat.id]),existingId='wechat-'+sourceKey.slice(0,32),existing=get('inbox',existingId,true);
    if(existing&&(existing.wechatOfficialAccount!==chat.isOfficialAccount||existing.wechatCategory!==chat.category))put('inbox',{...existing,wechatOfficialAccount:chat.isOfficialAccount,wechatCategory:chat.category});
    if(!chat.category){failures.push({sourceHash:sourceKey,code:'wechat_category_unknown'});continue;}
    if(chat.category!=='personal'&&chat.category!=='group')continue;
    const group=chat.category==='group';
    if(Number(chat.lastAt)<Date.now()/1000-(group?86400:config.lookbackDays*86400))continue;
    const key=hash([sourceHash,chat.id]),fingerprint=hash({source:chat.syncFingerprint,policy:config.groupPolicy,categoryPolicy:config.categoryPolicy,category:chat.category});
    if(checkpoint[key]===fingerprint){counts.unchanged++;continue;}
    if(changedRead>=config.chatLimit||Date.now()>deadline){limited=true;continue;}
    changedRead++;
    try{
     const page=await wechatMessages(chat.id,undefined,config.messagesPerChat);guard();if(page.sourceHash!==sourceHash)throw new ApiError(409,'wechat_source_changed','微信来源已变化');
     windowLimited ||= page.hasMore||!page.coverageComplete||page.hasWarnings;
     let messages:any[]=page.items.slice().reverse().sort((a:any,b:any)=>a.at-b.at).map((m:any)=>({id:m.id,text:m.text,senderId:m.senderId,senderName:m.sender,isMine:m.self,...(m.self!==null?{direction:m.self?'outgoing':'incoming'}:{}),sentAt:new Date(m.at*1000).toISOString(),type:m.messageType,contentTruncated:m.contentTruncated,mentionsOwner:m.mentionsOwner,mentionEvidence:m.mentionEvidence}));
     const itemId='wechat-'+key.slice(0,32),prior=get('inbox',itemId,true);
     let groupAttention:any;
     if(group){
      const mention=messages.filter(m=>m.mentionsOwner===true&&m.isMine===false&&Date.parse(m.sentAt)>=Date.now()-86400000&&Date.parse(m.sentAt)<=Date.now()).at(-1);
      if(!mention){
       if(prior?.groupAttention?.mentionMessageId)put('inbox',{...prior,groupAttention:{policy:WECHAT_GROUP_POLICY,reason:'no_recent_mention'}});
       updates[key]=fingerprint;continue;
      }
      groupAttention={policy:WECHAT_GROUP_POLICY,mentionMessageId:mention.id,expiresAt:new Date(Date.parse(mention.sentAt)+86400000).toISOString()};
      messages=messages.filter(m=>m.id===mention.id||(m.isMine===true&&Date.parse(m.sentAt)>Date.parse(mention.sentAt)));
     }
     if(!messages.length){if(!page.hasMore&&!page.hasWarnings)updates[key]=fingerprint;continue;}
     const body=messages.map((m:any)=>`${m.senderName}: ${m.text}`).join('\n');
     const sourceCoverage={hasMore:page.hasMore,coverageComplete:page.coverageComplete,hasWarnings:page.hasWarnings,accountHolderKnown:page.accountHolderKnown,window:'recent-messages',lookbackDays:config.lookbackDays,...(group?{groupPolicy:WECHAT_GROUP_POLICY,scope:'latest-mention-and-owner-replies',otherMessagesExcluded:true,mentionMessageId:groupAttention.mentionMessageId}: {})};
     const sourceDigest=hash({messages,title:chat.name,sourceCoverage,groupAttention});
     guard();
     // Soft-deleted items stay deleted. Existing drafts, candidates and receipts
     // survive collection; only a changed source invalidates prior approval.
     if(prior?.sourceDigest!==sourceDigest){
      put('inbox',{...prior,id:itemId,title:chat.name,sender:chat.name,channel:'WeChat',origin:'human',body,messages,groupAttention,sourceSystem:'wechat-sync',sourceConnectionId:'wechat-sync-local',sourceId:chat.id,sourceAccountHash:sourceHash,wechatCategory:chat.category,wechatOfficialAccount:chat.isOfficialAccount,sourceDigest,sourceCoverage,sourceScope:{id:'wechat-sync-local',mode:'read',explicit:true,chatMode:group?'group':'p2p'},status:prior?.status||'pending',sourceUpdatedAt:now(),...(prior?{approved:false,sensitiveApproved:false,sourceChangedAt:now()}:{}),recipientId:prior?.recipientId||''});counts.changed++;
     }
     updates[key]=fingerprint;counts.chats++;counts.messages+=messages.length;
    }catch(error){if(error instanceof ApiError&&['wechat_sync_changed','wechat_not_connected','wechat_source_changed','connection_changed','wechat_runtime_selection_invalid'].includes(error.code))throw error;failures.push({sourceHash:key,code:error instanceof ApiError?error.code:'wechat_read_failed'});}
    progress();
   }
   if(!page.hasMore)break;
   if(!page.nextCursor||cursorSet.has(page.nextCursor)){failures.push({code:'wechat_cursor_repeated'});limited=true;break;}
   cursorSet.add(page.nextCursor);cursor=page.nextCursor;
  }while(true);
  guard();setMeta('wechatSyncCheckpoints',{...checkpoint,...updates});
  put('wechat_sync_runs',{...get('wechat_sync_runs',id),status:failures.length||limited?'partial':'succeeded',completedAt:now(),counts,scanned,limited,windowLimited,failureCount:failures.length,failures,coverage:'recent-7-days-bounded-pages'});
 }catch(error){put('wechat_sync_runs',{...get('wechat_sync_runs',id),status:'failed',completedAt:now(),counts,scanned,failureCount:failures.length,errorCode:error instanceof ApiError?error.code:'wechat_sync_failed',error:'微信同步未完成，已有资料和草稿保留'});}
 finally{running=false;setMeta('wechatSyncNextAt',wechatSyncSettings().enabled?new Date(Date.now()+300000).toISOString():null);}
}
export function startWechatScheduler(){
 const interrupted=list('wechat_sync_runs').filter(r=>r.status==='running');
 for(const run of interrupted)put('wechat_sync_runs',{...run,status:'interrupted',completedAt:now(),error:'服务重启中断同步；请明确重试'});
 if(wechatSyncSettings().enabled&&(interrupted.length||!meta('wechatSyncNextAt',null)))setMeta('wechatSyncNextAt',new Date(Date.now()+300000).toISOString());
 const timer=setInterval(()=>{if(running||!wechatSyncSettings().enabled)return;const next=meta<string|null>('wechatSyncNextAt',null);if(next&&Date.parse(next)<=Date.now())try{startWechatSync('schedule')}catch{}},2000);timer.unref();return timer;
}
