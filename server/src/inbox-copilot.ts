import {createHash} from 'node:crypto';

export const COPILOT_VERSION='feishu-omlx-cooldown-v2-current-turn';
export const isFeishuCopilot=(item:any)=>/^feishu$/i.test(item.channel)&&item.sourceSystem!=='virtual-im';
export function messageTime(value:any):number|undefined {
 const n=typeof value==='number'||/^\d+$/.test(String(value))?Number(value):Date.parse(value);
 return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):undefined;
}
export function copilotEvidence(item:any) {
 const mode=item.chatMode||item.sourceScope?.chatMode;
 const messages=(item.messages||[]).filter((m:any)=>!m.deleted&&!m.recalled).slice().sort((a:any,b:any)=>(messageTime(a.sentAt)||0)-(messageTime(b.sentAt)||0));
 const incoming=messages.filter((m:any)=>m.isMine===false);
 const mentioned=(m:any)=>m.mentionsSelf===true||!!item.selfId&&(m.mentions||[]).some((x:any)=>(typeof x.id==='object'?x.id.open_id:x.id)===item.selfId);
 // A bound first-person commitment is work, not an incoming request. Only the
 // scoped model can resolve it; an unrelated later owner message is not proof.
 const bound=item.requestRoundId?messages.find((m:any)=>m.id===item.requestRoundId):undefined;
 if(bound&&(bound.isMine===true||(bound.isMine!==false&&bound.direction==='outgoing'))){
  const at=messageTime(bound.sentAt);
  return at?{state:'pending',reason:'本人承诺待核对',request:bound,messages,at}:{state:'unknown',reason:'原承诺时间待核实',messages};
 }
 const eligible=mode==='p2p'?incoming:mode==='group'?incoming.filter(mentioned):[];
 // A durable round owns one request. Newer messages are resolution context, never a replacement request.
 const requests=item.requestRoundId?eligible.filter((m:any)=>m.id===item.requestRoundId):eligible;
 if(item.requestRoundId&&!requests.length)return {state:'unknown',reason:'原请求缺失或已撤回，不能改绑其他消息',messages};
 const last=requests.at(-1);
 if(!['p2p','group'].includes(mode))return {state:'unknown',reason:'会话类型待核实',messages};
 if(!last)return {state:mode==='group'?'excluded':'unknown',reason:mode==='group'?'群聊未发现明确 @ 本人':'没有可核实的来信',messages};
 const at=messageTime(last.sentAt);if(!at)return {state:'unknown',reason:'消息时间待核实',messages};
 const related=(m:any)=>mode==='p2p'||m.id===last.id||m.replyToId===last.id||!!last.threadId&&m.threadId===last.threadId||!!last.rootId&&m.rootId===last.rootId;
 // Resolve every outstanding mention, not just the latest one. Unrelated group replies never qualify.
 const replyFor=(q:any)=>messages.find((m:any)=>m.isMine===true&&(messageTime(m.sentAt)||0)>(messageTime(q.sentAt)||Infinity)&&(mode==='p2p'||m.replyToId===q.id||!!q.threadId&&m.threadId===q.threadId||!!q.rootId&&m.rootId===q.rootId));
 const unresolved=requests.filter((q:any)=>!replyFor(q));
 if(!unresolved.length){const reply=replyFor(last);return {state:'replied',reason:'已在来源回复',request:last,reply,messages,at};}
 const relevant=messages.filter(related);
 const latestAt=Math.max(at,...relevant.filter((m:any)=>m.isMine===false).map((m:any)=>messageTime(m.sentAt)||0));
 return {state:'pending',reason:'待回复',request:unresolved.at(-1),messages,at:latestAt};
}
export function stampCopilot(item:any,previous:any,at=Date.now()) {
 if(!isFeishuCopilot(item)){
  if(previous&&JSON.stringify(previous.messages)!==JSON.stringify(item.messages))return {...item,approved:false,sensitiveApproved:false,approvalSourceVersion:undefined,...(previous.draft?{draftStale:true}:{}),...(previous.draftPreparation&&['succeeded','skipped','queued'].includes(previous.draftPreparation.status)?{draftPreparation:undefined}:{})};
  return item;
 }
 const evidence=copilotEvidence(item);
 const signature=createHash('sha256').update(JSON.stringify({mode:item.chatMode||item.sourceScope?.chatMode,selfId:item.selfId,messages:(item.messages||[]).map((m:any)=>({id:m.id,text:m.text,sentAt:m.sentAt,isMine:m.isMine,mentions:m.mentions,mentionsSelf:m.mentionsSelf,replyToId:m.replyToId,rootId:m.rootId,threadId:m.threadId,deleted:m.deleted,recalled:m.recalled}))})).digest('hex');
 const changed=previous?.copilot?.signature!==signature;
 // The first observed version and every changed version get a durable deadline. Metadata refreshes do not reset it.
 const notBefore=changed?new Date(at+180000).toISOString():previous.copilot.notBefore;
 return {...item,copilot:{version:COPILOT_VERSION,signature,notBefore,state:evidence.state,requestId:evidence.request?.id,replyId:evidence.reply?.id},...(changed?{approved:false,sensitiveApproved:false,approvalSourceVersion:undefined}:{}),...(changed&&previous?.draft?{draftStale:true}:{}),...(changed&&previous?.draftPreparation&&['succeeded','skipped','queued'].includes(previous.draftPreparation.status)?{draftPreparation:undefined}: {})};
}
export function copilotGate(item:any,at=Date.now()): {state:string;reason:string;request?:any;reply?:any;notBefore?:string} {
 if(!isFeishuCopilot(item))return {state:'ready',reason:''};
 const e=copilotEvidence(item);if(e.state!=='pending')return e;
 const due=Date.parse(item.copilot?.notBefore||'');
 if(!Number.isFinite(due))return {state:'unknown',reason:'等待消息版本初始化'};
 return at<due?{...e,state:'cooling',reason:'消息冷却中',notBefore:item.copilot.notBefore}: {...e,state:'ready'};
}
