// Follow-up status and decisions for one task. Every button calls the real task/revision-bound route;
// a reminder whose revision is no longer current shows the latest state instead of acting on it.
// Nothing here touches the composer or its draft.
import React,{useCallback,useEffect,useState} from 'react';
import type {Ctx} from './App';
import {Hv} from './ui';
import {api,enc} from './store';
import {tomorrowMorning} from './attention';

const chip:React.CSSProperties={minHeight:26,padding:'3px 10px',border:'1px dashed var(--lineStrong)',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text)',font:'inherit',fontSize:12,cursor:'pointer'};
const plain:React.CSSProperties={...chip,border:'none',color:'var(--text2)'};

function stateLine(f:any,zh:boolean){
 const who=f.binding?.personName||(zh?'对方':'them');
 const next=f.schedule?.snoozedUntil&&Date.parse(f.schedule.snoozedUntil)>Date.now()?f.schedule.snoozedUntil:f.schedule?.nextCheckAt;
 const when=next?new Date(next).toLocaleString(zh?'zh-CN':'en-US',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 switch(f.state){
  case 'needs_judgment':return zh?`${who}有新回复，等你判断`:`${who} replied — your call`;
  case 'completed':return (zh?'跟进已完成':'Follow-up done')+(f.evidence?.status==='invalid'?(zh?'（依据的消息已变化，请复核）':' (evidence changed — review)'):'');
  case 'cancelled':return zh?'跟进已取消':'Follow-up cancelled';
  case 'checking':return zh?'正在检查…':'Checking…';
  default:return (zh?`跟进中，等待${who}`:`Following up with ${who}`)+(when?(zh?` · 下次 ${when}`:` · next ${when}`):'');
 }
}

export function FollowUpControls({ctx,taskId,boundRevision}:{ctx:Ctx;taskId:string;boundRevision?:number}){
 const {zh}=ctx,[view,setView]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{try{setView(await api('GET','/api/tasks/'+enc(taskId)+'/follow-up'));}catch{setView(null);}},[taskId]);
 useEffect(()=>{void load();},[load,boundRevision]);
 const f=view?.followUp;if(!f)return null;
 const stale=boundRevision!==undefined&&boundRevision!==f.revision;
 const open=['waiting','checking','needs_judgment'].includes(f.state);
 async function act(kind:'cancel'|'snooze'|'decide',extra:any={}){
  if(busy)return;setBusy(true);setError('');
  // Stable per task+revision+choice: a lost response is replayed by the same id, never duplicated.
  const operationId=`fu-ui-${f.id}-${f.revision}-${kind}${extra.decision?'-'+extra.decision:''}`;
  try{const r=await api('POST','/api/tasks/'+enc(taskId)+'/follow-up/'+kind,{operationId,revision:f.revision,...extra});setView(r);await ctx.refresh();}
  catch(e:any){const code=e?.data?.error;setError(code==='revision_conflict'||code==='candidate_changed'?(zh?'跟进已更新，已显示最新状态。':'Updated — showing the latest state.'):code==='evidence_changed'?(zh?'那条回复已被修改或撤回，未确认完成。':'That reply changed or was withdrawn; not confirmed.'):code==='evidence_unverifiable'?(zh?'暂时无法核对来源，请稍后再确认。':'Cannot verify the source right now.'):(e?.data?.message||e?.message||String(e)));await load();}
  finally{setBusy(false);}
 }
 return <div data-follow-up={f.id} style={{display:'flex',flexDirection:'column',gap:6}}>
  {boundRevision===undefined||stale?<span role="status" style={{fontSize:12,color:'var(--text2)'}}>{stale?(zh?'此提醒已过期 · ':'This reminder is outdated · '):''}{stateLine(f,zh)}</span>:null}
  {open&&!stale?<div data-message-actions style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
   {f.state==='needs_judgment'?<>
    <Hv aria-label={zh?'确认完成':'Confirm done'} disabled={busy} onClick={()=>act('decide',{decision:'confirm',checkId:f.candidate?.checkId})} style={chip} hover={{background:'var(--hover)'}}>{zh?'确认完成':'Confirm done'}</Hv>
    <Hv aria-label={zh?'继续跟进':'Keep following up'} disabled={busy} onClick={()=>act('decide',{decision:'continue',checkId:f.candidate?.checkId})} style={chip} hover={{background:'var(--hover)'}}>{zh?'继续跟进':'Keep following up'}</Hv>
   </>:null}
   <Hv aria-label={zh?'推迟到明早':'Snooze until tomorrow'} disabled={busy} onClick={()=>act('snooze',{until:tomorrowMorning()})} style={chip} hover={{background:'var(--hover)'}}>{zh?'推迟':'Snooze'}</Hv>
   <Hv aria-label={zh?'取消跟进':'Cancel follow-up'} disabled={busy} onClick={()=>act('cancel')} style={plain} hover={{background:'var(--hover)'}}>{zh?'取消跟进':'Cancel'}</Hv>
   {busy?<span style={{fontSize:12,color:'var(--text3)'}}>{zh?'处理中…':'Working…'}</span>:null}
  </div>:null}
  {error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{error}</span>:null}
 </div>;
}
