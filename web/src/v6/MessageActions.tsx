// Actions under a derived chat message and digest lines. Each action is typed and version-bound on the server;
// doing nothing is always safe, and a draft is never a send.
import React,{useState} from 'react';
import type {Ctx} from './App';
import {Hv} from './ui';
import {attentionActionLabel,ideaProvenance,type AttentionActionType,type AttentionBinding} from '../../../shared/attention-actions';
import {useEntityAction,tomorrowMorning} from './attention';
import {fmtStamp} from './model';

const chip:React.CSSProperties={minHeight:26,padding:'3px 10px',border:'1px dashed var(--lineStrong)',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text)',font:'inherit',fontSize:12,cursor:'pointer',textAlign:'left'};
const plainBtn:React.CSSProperties={...chip,border:'none',color:'var(--text2)'};

export function ActionRow({ctx,binding,types}:{ctx:Ctx;binding:AttentionBinding;types:AttentionActionType[]}){
 const {zh}=ctx,act=useEntityAction(ctx),[done,setDone]=useState<AttentionActionType|null>(null);
 if(done)return <div data-action-result style={{fontSize:12,color:'var(--text2)'}}>{done==='draft_reply'?(zh?'草稿已生成，未发送。':'Draft ready. Nothing was sent.'):done==='create_task'?(zh?'已创建任务。':'Task created.'):''}</div>;
 return <div data-message-actions style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6}}>
  {types.map(type=><Hv key={type} data-action={type} disabled={act.busy} onClick={async()=>{const ok=await act.run(binding,type,type==='snooze'?{until:tomorrowMorning()}:undefined);if(ok&&(type==='draft_reply'||type==='create_task'))setDone(type)}} style={type==='dismiss'?plainBtn:chip} hover={{background:'var(--hover)'}}>{attentionActionLabel(type,zh)}</Hv>)}
  {act.busy?<span style={{fontSize:12,color:'var(--text3)'}}>{zh?'处理中…':'Working…'}</span>:null}
  {act.error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{act.error}</span>:null}
 </div>;
}

/** Binding from the record's own metadata for Inbox, or the Idea's current source versions. Nothing shown for a closed Idea. */
export function MessageActions({ctx,message}:{ctx:Ctx;message:any}){
 const a=message.inboxAnalysis,idea=message.ideaAnalysis;
 if(a&&!a.digest&&Array.isArray(a.actions)&&a.actions.length&&a.deliveryId)return <ActionRow ctx={ctx} types={a.actions} binding={{entityKind:'inbox',entityId:a.itemId,requestMessageId:a.requestMessageId,requestRevision:a.requestRevision}}/>;
 if(idea){const row:any=ctx.ws.ideas.find(x=>x.id===(idea.currentIdeaId||idea.ideaId));if(row?.status==='new')return <ActionRow ctx={ctx} types={['create_task','snooze','dismiss']} binding={{entityKind:'idea',entityId:row.id,provenanceKey:ideaProvenance(row)}}/>}
 return null;
}

export function DigestBody({ctx,message}:{ctx:Ctx;message:any}){
 const {zh}=ctx,a=message.inboxAnalysis,entries:any[]=a.entries||[],total=entries.length+(a.more||0);
 return <div data-digest style={{display:'flex',flexDirection:'column',gap:6}}>
  <span>{zh?`有 ${total} 件事等你看：`:`${total} item${total===1?'':'s'} waiting for you:`}</span>
  {entries.map(e=><Hv key={e.matterKey+e.revision} onClick={()=>ctx.openDetail({type:e.kind==='idea'?'ins':'dec',id:e.entityId})} style={{all:'unset',cursor:'pointer',display:'flex',alignItems:'baseline',gap:8,minWidth:0}} hover={{color:'var(--accentText)'}}><span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{String(e.line).replace(/\\(.)/g,'$1')}</span>{e.occurredAt?<span style={{flex:'none',fontSize:12,color:'var(--text3)'}}>{fmtStamp(e.occurredAt,zh)}</span>:null}</Hv>)}
  {a.more?<span style={{fontSize:12,color:'var(--text3)'}}>{zh?`另有 ${a.more} 件在决策里。`:`${a.more} more in Decisions.`}</span>:null}
 </div>;
}
