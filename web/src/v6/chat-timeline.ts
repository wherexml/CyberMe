import type {Message} from '../../../shared/types';
import type {ChatRecord} from './store';

export type ChatTimelineEntry =
 | {kind:'message';message:Message;request?:ChatRecord;at:string}
 | {kind:'request';request:ChatRecord;at:string};

// The digest is delivered later than its evidence. Keep delivery time for
// paging, but place the card with its sources in the rendered conversation.
function timelineAt(message:Message){
 const a=(message as Message&{inboxAnalysis?:{digest?:boolean;entries?:{occurredAt?:string}[]}}).inboxAnalysis;
 if(a?.digest&&Array.isArray(a.entries)){
  let latest=-Infinity;
  for(const e of a.entries){const at=Date.parse(e?.occurredAt||'');if(Number.isFinite(at)&&at>latest)latest=at}
  if(Number.isFinite(latest))return new Date(latest).toISOString();
 }
 return message.createdAt||'';
}

/** Merge before rendering separators: a saved receipt owns its original turn,
 * including a late canonical answer. Never infer identity from message text. */
export function chatTimeline(messages:Message[],records:ChatRecord[]):ChatTimelineEntry[]{
 const byRequest=new Map(records.map(r=>[r.requestId,r]));
 const byRun=new Map(records.filter(r=>r.runId).map(r=>[r.runId!,r]));
 const ordinal=new Map(records.map((r,i)=>[r.requestId,i]));
 type Group={at:string;request?:ChatRecord;messages:Message[];order:number};
 const groups=new Map<string,Group>();
 const seen=new Set<string>();
 for(const message of messages){
  if(seen.has(message.id))continue;seen.add(message.id);
  const requestId=(message as Message&{requestId?:string}).requestId;
  const request=requestId?byRequest.get(requestId):message.runId?byRun.get(message.runId):undefined;
  const key=request?'request:'+request.requestId:'message:'+message.id;
  let group=groups.get(key);
  if(!group){group={at:request?.createdAt||timelineAt(message),request,messages:[],order:groups.size};groups.set(key,group)}
  group.messages.push(message);
 }
 for(const request of records){
  const key='request:'+request.requestId;
  if(request.status!=='succeeded'&&!groups.has(key))groups.set(key,{at:request.createdAt,request,messages:[],order:groups.size});
 }
 const time=(value:string)=>{const n=Date.parse(value);return Number.isFinite(n)?n:0};
 const result:ChatTimelineEntry[]=[];
 const position=(group:Group)=>group.request?ordinal.get(group.request.requestId)!:records.length+group.order;
 for(const group of [...groups.values()].sort((a,b)=>time(a.at)-time(b.at)||position(a)-position(b))){
  const {request,at}=group;
  // A canonical user bubble replaces the local receipt bubble, but retains its
  // recovery card. Assistant-only history must not hide an unresolved request.
  if(request&&request.status!=='succeeded'&&!group.messages.some(m=>m.role==='user'))result.push({kind:'request',request,at});
  const ordered=group.messages.map((message,index)=>({message,index})).sort((a,b)=>
   Number(b.message.role==='user')-Number(a.message.role==='user')||a.index-b.index);
  for(const {message} of ordered)result.push({kind:'message',message,request,at});
 }
 return result;
}
