import React,{useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {I} from './icons';
import {ContentArtwork} from './ContentArtwork';
import {Hv,seg,btn,actBtn,unset} from './ui';
import {DecisionVis,Meters,InsightVis,GalleryVis} from './visuals';
import {getUI,setUI,api,enc,uid,inFlight,unsent} from './store';
import {today,sourcesOf,insightOf,attentionLabel,fmtStamp,ideaWhen,ideaDeadline,ideaSchedule,linkedTasksOf,taskStatus,type DecisionModel,type InsightModel,type GalleryModel} from './model';
import {useAttentionAction,useDismissAck,recheckTarget,tomorrowMorning,ideaAttentionCall,ackIdea,clearAck,useEntityAction} from './attention';
import {DELIVERY_STRATEGIES,DELIVERY_LABELS,ideaProvenance,type DeliveryStrategy} from '../../../shared/attention-actions';
import {messageRevision} from '../../../shared/inbox-surfacing';
import {ideaTimeStrip,threadTimeline,type TimeStrip} from './derive';
import {inboxAttention,canOfferReplyDraft,judgmentUnsettled} from '../../../shared/inbox-attention';
import {Md,plain} from './md';
import {InsightVisual} from './InsightVisual';
import {useInsightVisuals,readyVisual,VisualBoundary} from './insight-visuals';

const card:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,overflow:'hidden',animation:'cmIn 250ms ease-out both'};
const tw=(s:React.CSSProperties)=>s as React.CSSProperties;

export default function Brief({ctx,decs,ins,gal}:{ctx:Ctx;decs:DecisionModel[];ins:InsightModel[];gal:GalleryModel[]}){
 const {ui,XL,zh}=ctx;const st=ui.brief;
 useLocalMarkMigration(ctx);
 const state=(d:DecisionModel)=>st[d.id]?.pick?'decided':'pending';
 const open=decs.filter(d=>state(d)==='pending').length+ins.length;
 // One 洞察 feed. Requests that still need you come first; a request you already answered sinks to one line.
 const pending=decs.filter(d=>state(d)==='pending'),decided=decs.filter(d=>state(d)==='decided');
 return <div data-insight-feed style={{display:'flex',flexDirection:'column',gap:14}}>
  <div data-feed-label style={{fontSize:13,fontWeight:600,color:'var(--text2)',padding:'0 4px'}}>{zh?'洞察':'Insights'}</div>
  {ins.filter(i=>i.attention.state==='execution').map(it=><InsightCard key={it.id} ctx={ctx} it={it}/>)}
  {pending.map(d=><DecisionCard key={d.id} ctx={ctx} d={d} state="pending"/>)}
  {ins.filter(i=>i.attention.state!=='execution').map(it=><InsightCard key={it.id} ctx={ctx} it={it}/>)}
  <Inspirations ctx={ctx} gal={gal}/>
  {decided.length?<div data-decided style={{display:'flex',flexDirection:'column',gap:8}}>{decided.map(d=><DecisionCard key={d.id} ctx={ctx} d={d} state="decided"/>)}</div>:null}
  {open===0&&!gal.length?<div style={{padding:'8px 4px 0',display:'flex',gap:8,alignItems:'center',color:'var(--text2)'}}><I n="check-circle" style={{fontSize:16,color:'var(--accent)'}}/><span>{XL.allClear}</span></div>:null}
  <HandledLink ctx={ctx} kind="inbox"/>
  <HandledLink ctx={ctx} kind="idea"/>
 </div>;
}

function DecisionCard({ctx,d,state}:{ctx:Ctx;d:DecisionModel;state:'pending'|'decided'}){
 const {ui,XL,T}=ctx;const v=ui.brief[d.id];
 // Undo drops only this decision's local journal rows; legacy rows without itemId and request/work history stay.
 const undo=()=>setUI(s=>{const brief={...s.brief};delete brief[d.id];return {brief,journal:s.journal.filter(j=>j.itemId!==d.id)}});
 const req=v?.pick?.requestId?ui.requests.find(r=>r.requestId===v.pick!.requestId):undefined;
 const next=!req?XL.pickSent:inFlight(req)?XL.pickPending:req.status==='succeeded'?XL.pickSent:req.status==='failed'||unsent(req)?XL.pickFailed:req.status==='partial'?T.st.partial:XL.pickUnknown;
 const nextTone=req&&['failed'].includes(req.status)?'var(--errText)':req&&['unknown','partial'].includes(req.status)?'var(--warnText)':'var(--text2)';
 const chosenOpt=v?.pick?d.opts[v.pick.index]:undefined;
 const act=useAttentionAction(ctx),typed=useEntityAction(ctx),it:any=d.item;
 const binding={entityKind:'inbox' as const,entityId:d.id,requestMessageId:it.triage?.requestMessageId||it.lastOpenRequest?.requestMessageId,requestRevision:requestRevisionOf(it)};
 return <div data-item={d.id} style={card}>
  {state==='pending'?<div style={{display:'flex',flexDirection:'column',gap:14,padding:'18px 20px 14px'}}>
   <div style={{display:'flex',flexDirection:'column',gap:6}}>
    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'var(--text3)'}}><ContentArtwork iconKey={d.item.iconKey} title={d.q} fallback="compass" size={36}/><span data-kicker>{d.kicker}</span>{d.statusNote?<span>· {d.statusNote}</span>:null}<span style={{flex:1}}/><span style={{color:d.urgent?'var(--warnText)':'var(--text3)',fontWeight:d.urgent?500:400}}>{d.due}</span></div>
    {/* Reference title has no hover styling; the click still opens the record's evidence (production entry to drafts/full Inbox). */}
    <div data-dec-title onClick={()=>ctx.openDetail({type:'dec',id:d.id})} style={tw({fontSize:16,fontWeight:600,lineHeight:1.4,textWrap:'pretty',cursor:'pointer'} as any)}>{d.q}</div>
    {d.ctx?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{d.ctx}</div>:null}
   </div>
   {d.strip?<TimeStripView s={d.strip} zh={ctx.zh}/>:null}
   {d.visual?<DecisionVis v={d.visual} zh={ctx.zh} recs={d.opts.map(o=>o.rec)}/>:null}
   {linkedTasksOf(ctx.ws,d.id).slice(0,1).map(t=><Hv key={t.id} data-linked-task onClick={()=>ctx.openDetail({type:'task',id:t.id})} style={{all:'unset',cursor:'pointer',fontSize:12,color:'var(--text2)'}} hover={{color:'var(--text)'}}>{T.taskLinked+'：'+t.title+' · '+T.ts[taskStatus(t)]}</Hv>)}
   {d.ideas.map(x=><Hv key={x.id} data-attached-idea={x.id} onClick={()=>ctx.openDetail({type:'ins',id:x.id})} style={{all:'unset',cursor:'pointer',fontSize:12,color:'var(--text2)'}} hover={{color:'var(--text)'}}>{(ctx.zh?'相关灵感：':'Related inspiration: ')+x.title}</Hv>)}
   <div style={{display:'flex',flexDirection:'column',borderRadius:12,boxShadow:'0 0 0 0.5px var(--lineStrong)',overflow:'hidden'}}>
    {d.opts.map((o,oi)=>{const sel=ctx.pendPick?.k==='brief'&&ctx.pendPick.id===d.id&&ctx.pendPick.i===oi;
     const isDraft = o.action === 'draft_reply';
     const review = isDraft && !!it.draft?.trim() && !it.draftStale;
     const held = isDraft && !review && judgmentUnsettled(it);
     const recheck = held && d.phase === 'failed';
     if(isDraft && !review && !recheck && !canOfferReplyDraft(it)) return null;
     const label = review ? (ctx.zh?'查看草稿':'View draft')
       : recheck ? (ctx.zh?'重新判断':'Re-evaluate') : held ? d.statusNote : o.label;
     return <Hv key={oi} data-action={recheck?'recheck':o.action} disabled={typed.busy || act.busy || (held && !recheck)} onClick={(e:any)=>{
      if(review){ctx.openDetail({type:'dec',id:d.id});return}
      if(recheck){void act.recheck(d.item,'triage');return}
      if(held)return;
      if(o.action&&binding.requestMessageId)void typed.run(binding,o.action);else ctx.toComposer(e,d.q,o.label,{k:'brief',id:d.id,i:oi,label:o.label})}} style={{all:'unset',boxSizing:'border-box',cursor:'pointer',display:'flex',alignItems:'flex-start',gap:12,padding:'12px 14px',boxShadow:oi<d.opts.length-1?'inset 0 -0.5px 0 var(--line)':'none',transition:'background 150ms ease-out'}} hover={{background:'var(--hover)'}}>
      <span style={{width:16,height:16,flex:'none',marginTop:2,borderRadius:'50%',boxSizing:'border-box',transition:'border 200ms',border:sel?'5px solid var(--accent)':'1.5px solid var(--lineStrong)'}}/>
      <span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:6,textAlign:'left'}}>
       <span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontWeight:500,color:'var(--text)'}}>{label}</span>{o.rec&&!review?<span style={{height:20,padding:'0 8px',display:'inline-flex',alignItems:'center',borderRadius:10,background:'var(--accentSoft)',color:'var(--accentText)',fontSize:11,fontWeight:500}}>{XL.recommended}</span>:null}</span>
       {review?<span data-draft-excerpt style={{fontSize:13,color:'var(--text2)'}}>{plain(it.draft,120)}</span>:null}
       {d.meters?<Meters m={d.meters} index={oi} rec={o.rec} zh={ctx.zh}/>:null}
      </span></Hv>})}
   </div>
   {d.prec?<div style={{display:'flex',gap:10,alignItems:'center',padding:'10px 12px',borderRadius:10,boxShadow:'0 0 0 0.5px var(--line)'}}><span style={{width:26,height:26,flex:'none',borderRadius:8,background:'var(--hover)',color:'var(--text2)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="clock-counter-clockwise" style={{fontSize:14}}/></span><span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={tw({fontSize:13,textWrap:'pretty'} as any)}>{d.prec}</span></span></div>:null}
   <div style={{display:'flex',gap:6,justifyContent:'flex-end',paddingTop:12,borderTop:'0.5px solid var(--line)'}}>
    {typed.error?<span role="alert" style={{flex:1,minWidth:0,alignSelf:'center',fontSize:12,color:'var(--errText)'}}>{typed.error}</span>:null}
    <Hv data-action="snooze" disabled={typed.busy} onClick={()=>void typed.run(binding,'snooze',{until:tomorrowMorning()})} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.decideLater}</Hv>
    {act.error?<span role="alert" style={{flex:1,minWidth:0,alignSelf:'center',fontSize:12,color:'var(--errText)'}}>{act.error}</span>:null}
    <Hv onClick={()=>void act.dismiss(d.item)} disabled={act.busy} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:act.busy?'default':'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{act.busy?(ctx.zh?'处理中…':'Working…'):T.dismiss}</Hv>
    <Hv onClick={(e:any)=>ctx.toComposer(e,d.q+'\n'+d.opts.map(o=>'- '+o.label).join('\n'),XL.discussQ(d.q),{k:'ctx',id:d.id,i:-1,label:''})} style={{height:30,padding:'0 12px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{filter:'brightness(0.96)'}}><I n="arrow-bend-up-left" style={{fontSize:14}}/><span>{XL.talkIt}</span></Hv>
   </div>
  </div>:null}
  {state==='decided'?<div data-decided-item style={{display:'flex',flexDirection:'column',gap:8,padding:'12px 16px'}}>
   <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
    <span style={{width:26,height:26,flex:'none',borderRadius:'50%',background:'var(--accent)',color:'var(--onAccent)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="check" style={{fontSize:14}}/></span>
    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2}}><span style={tw({fontSize:12,color:'var(--text3)',textWrap:'pretty'} as any)}>{d.q}</span><span style={tw({fontWeight:600,textWrap:'pretty'} as any)}>{v!.pick!.label}</span><span style={tw({fontSize:12,color:nextTone,textWrap:'pretty'} as any)}>{chosenOpt?.next?chosenOpt.next+' · ':''}{next}</span></div>
    <Hv onClick={undo} style={{height:26,padding:'0 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.undo}</Hv>
    {/* Clearing a handled request is the existing, undoable server dismissal; it never marks the work done. */}
    <Hv data-action="dismiss" onClick={()=>void act.dismiss(d.item)} disabled={act.busy} style={{height:26,padding:'0 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:act.busy?'default':'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{act.busy?(ctx.zh?'处理中…':'Working…'):T.dismiss}</Hv>
   </div>
   {act.error?<span role="alert" style={{paddingLeft:38,fontSize:12,color:'var(--errText)'}}>{act.error}</span>:null}
  </div>:null}
 </div>;
}

/** Saved suggestions inside the single 洞察 feed. Title and summary are always the saved text; a validated visual is supplemental. */
function Inspirations({ctx,gal}:{ctx:Ctx;gal:GalleryModel[]}){
 const {XL}=ctx;const [busy,setBusy]=useState(false);
 const visuals=useInsightVisuals(ctx.ws.revision);
 async function more(){setBusy(true);try{await api('POST','/api/ideas/refresh',{});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error')}finally{setBusy(false)}}
 // An older local 暂不处理 stays local: hidden here and reversible, with no change to the record until the user decides.
 const local=ctx.ui.gal||{},live=gal.filter(g=>!local[g.id]);
 return <div style={{display:'flex',flexDirection:'column',gap:14}}>
  {live.map((g,idx)=><IdeaCard key={g.id} ctx={ctx} g={g} idx={idx} visual={readyVisual(visuals[g.id],g.idea as any)}/>)}
  <Hv onClick={()=>void more()} disabled={busy} style={{alignSelf:'center',height:30,padding:'0 12px',border:'none',borderRadius:15,background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:busy?'default':'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{busy?XL.refreshing:XL.refresh}</Hv>
 </div>;
}
// A task action records the task directly; it never overwrites or submits the chat draft.
function CreateIdeaTask({ctx,idea}:{ctx:Ctx;idea:GalleryModel['idea']}){
 const action=useEntityAction(ctx),{zh}=ctx;
 if(idea.status!=='new')return null;
 return <>
  {action.error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{action.error}</span>:null}
  <Hv data-action="create_task" disabled={action.busy} onClick={async()=>{
   if(await action.run({entityKind:'idea',entityId:idea.id,provenanceKey:ideaProvenance(idea)},'create_task'))ctx.notify(zh?'已创建任务。':'Task created.');
  }} style={actBtn('primary')} hover={{background:'var(--accentHover)'}}>{action.busy?(zh?'正在创建…':'Creating…'):(zh?'创建任务':'Create task')}</Hv>
 </>;
}
function IdeaCard({ctx,g,idx,visual}:{ctx:Ctx;g:GalleryModel;idx:number;visual:ReturnType<typeof readyVisual>}){
 const {XL,zh}=ctx,[busy,setBusy]=useState(false),[error,setError]=useState('');
 const quiet:React.CSSProperties={flex:'none',height:30,padding:'0 12px',border:'none',borderRadius:15,background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:busy?'default':'pointer',whiteSpace:'nowrap'};
 async function act(action:'dismiss'|'snooze'){
  if(busy)return;setBusy(true);setError('');
  try{const op=await ideaAttentionCall(g.idea,action,undefined,action==='snooze'?tomorrowMorning():undefined);if(action==='dismiss')ackIdea(g.id,op,g.title);await ctx.refresh()}
  catch(e:any){setError(e?.status===409?(zh?'这条灵感有了新证据，未处理。':'New evidence arrived, so nothing changed.'):(zh?'未能保存：':"Couldn't save: ")+(e?.message||''));try{await ctx.refresh()}catch{}}
  finally{setBusy(false)}
 }
 return <Hv as="div" data-idea={g.id} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine), 0 1px 2px rgba(0,0,0,.03)',borderRadius:16,padding:'18px 20px 14px',display:'flex',flexDirection:'column',gap:14,animation:'cmRise 560ms cubic-bezier(.2,.8,.2,1) both',animationDelay:(idx*70)+'ms',transition:'transform 320ms cubic-bezier(.2,.8,.2,1), box-shadow 320ms ease-out'}} hover={{transform:'translateY(-2px)',boxShadow:'0 0 0 0.5px var(--lineStrong), 0 12px 32px rgba(0,0,0,.08)'}}>
  <div style={{display:'flex',alignItems:'center',gap:8}}><ContentArtwork iconKey={g.idea.iconKey} title={g.title} fallback="insight"/><span style={{flex:1}}/><span data-idea-when style={{fontSize:12,color:'var(--text3)',textAlign:'right'}}>{g.when}</span></div>
  <div style={{display:'flex',flexDirection:'column',gap:4}}><div data-idea-title onClick={()=>ctx.openDetail({type:'ins',id:g.id})} style={tw({fontSize:17,fontWeight:600,letterSpacing:'-0.01em',lineHeight:1.35,textWrap:'pretty',cursor:'pointer'} as any)}>{g.title}</div>{/* With a ready graph the saved summary is clamped visually to 3 lines (full text stays in the DOM and opens the same detail view); fallback cards show it in full. */}<div data-idea-body={visual?'visual':'text'} title={visual?g.body:undefined} onClick={visual?()=>ctx.openDetail({type:'ins',id:g.id}):undefined} style={tw(visual?{color:'var(--text2)',textWrap:'pretty',display:'-webkit-box',WebkitBoxOrient:'vertical',WebkitLineClamp:3,overflow:'hidden',cursor:'pointer'}:{color:'var(--text2)',textWrap:'pretty'} as any)}>{g.body}</div>{g.deadline?<div data-idea-deadline style={{fontSize:12,color:'var(--warnText)'}}>{g.deadline}</div>:null}{g.schedule?<div data-idea-schedule style={{fontSize:12,color:'var(--text2)'}}>{g.schedule}</div>:null}</div>
  {g.strip?<TimeStripView s={g.strip} zh={zh}/>:null}
  {/* The visual supplements the saved title/summary above; a render error simply hides it. */}
  {visual?<VisualBoundary fallback={null}><InsightVisual spec={visual} zh={zh}/></VisualBoundary>:g.visual?<GalleryVis v={g.visual} zh={zh}/>:null}
  <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'flex-end',alignItems:'center'}}>
   {error?<span role="alert" style={{flex:1,minWidth:0,fontSize:12,color:'var(--errText)'}}>{error}</span>:null}
   <Hv data-action="dismiss" disabled={busy} onClick={()=>void act('dismiss')} style={quiet} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.notNow}</Hv>
   <Hv data-action="snooze" disabled={busy} onClick={()=>void act('snooze')} style={quiet} hover={{background:'var(--hover)',color:'var(--text)'}}>{zh?'明天再看':'Tomorrow'}</Hv>
   {g.action==='task'?<CreateIdeaTask ctx={ctx} idea={g.idea}/>:<Hv onClick={(e:any)=>ctx.toComposer(e,g.title,g.act,{k:'idea',id:g.id,i:0,label:g.act})} style={tw({minWidth:0,maxWidth:'100%',minHeight:30,padding:'6px 14px',boxSizing:'border-box',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:15,background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:13,fontWeight:500,lineHeight:1.3,textAlign:'left',cursor:'pointer'} as any)} hover={{background:'var(--accentHover)'}}><span style={tw({minWidth:0,textWrap:'pretty'} as any)}>{g.act}</span><I n="arrow-up-right" style={{fontSize:13}}/></Hv>}
  </div>
 </Hv>;
}
function InsightCard({ctx,it}:{ctx:Ctx;it:InsightModel}){
 const {zh}=ctx,dot=(c:string):React.CSSProperties=>({width:6,height:6,borderRadius:'50%',background:`var(${c})`,flex:'none'});
 return <Hv as="div" data-item={it.id} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,padding:'18px 20px 14px',display:'flex',flexDirection:'column',gap:10,animation:'cmIn 250ms ease-out both',transition:'box-shadow 250ms ease-out'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 6px 20px rgba(0,0,0,.06)'}}>
  <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><ContentArtwork iconKey={it.item.iconKey} title={it.title} fallback="insight" size={36}/><span style={dot(it.tone==='warn'?'--warnDot':it.tone==='ok'?'--okDot':it.tone==='muted'?'--text3':'--accent')}/><span style={{color:it.tone==='warn'?'var(--warnText)':it.tone==='ok'?'var(--okText)':it.tone==='muted'?'var(--text2)':'var(--accentText)',flex:1}}>{it.status}</span>{it.sourceAt?<span style={{color:'var(--text3)'}}>{(zh?'来源 ':'From ')+fmtStamp(it.sourceAt,zh)}</span>:null}</div>
  <button type="button" onClick={()=>ctx.openDetail({type:'ins',id:it.id})} style={unset(tw({all:'unset',cursor:'pointer',fontSize:16,fontWeight:600,letterSpacing:'-0.01em',color:'var(--text)',textWrap:'pretty',lineHeight:1.35} as any))}>{it.title}</button>
  {it.summary?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{it.summary}</div>:null}
  {it.visual?<InsightVis v={it.visual} zh={zh}/>:null}
  <InsightActions ctx={ctx} it={it}/>
 </Hv>;
}
const requestRevisionOf=(it:any)=>{const m=(Array.isArray(it.messages)?it.messages:[]).find((x:any)=>x.id===(it.triage?.requestMessageId||it.lastOpenRequest?.requestMessageId));return m?messageRevision(m):undefined};
/** Drawn only from verified times; see `timeStrip`. */
function TimeStripView({s,zh}:{s:TimeStrip;zh:boolean}){
 return <div data-time-strip style={{display:'flex',flexDirection:'column',gap:6}}>
  <div style={{position:'relative',height:2,borderRadius:1,background:'var(--line)'}}><div style={{position:'absolute',left:0,top:0,bottom:0,width:s.pct+'%',borderRadius:1,background:'var(--accent)'}}/></div>
  <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,color:'var(--text3)'}}>{s.points.map(p=><span key={p.label[0]} style={{display:'flex',flexDirection:'column'}}><span>{p.label[zh?1:0]}</span><span>{fmtStamp(new Date(p.at).toISOString(),zh)}</span></span>)}</div>
 </div>;
}
/** Plain way back to what was ignored or snoozed. No count and no banner; opening it is the only cost. */
function HandledLink({ctx,kind}:{ctx:Ctx;kind:'inbox'|'idea'}){
 const {zh,XL}=ctx,[open,setOpen]=useState(false),[error,setError]=useState('');
 const dropLocal=(id:string)=>setUI(st=>{const gal={...st.gal};delete gal[id];return {gal}});
 const local=ctx.ui.gal||{};
 const rows:{id:string;title:string;restore:()=>Promise<unknown>;ignore?:()=>Promise<unknown>}[]=kind==='idea'
  ?(ctx.ws.ideas||[]).flatMap((i:any)=>['dismissed','deferred'].includes(i.status)?[{id:i.id,title:i.title,restore:()=>ideaAttentionCall(i,'restore').then(()=>dropLocal(i.id))}]:i.status==='new'&&local[i.id]?[{id:i.id,title:i.title,restore:async()=>dropLocal(i.id),ignore:()=>ideaAttentionCall(i,'dismiss').then(()=>dropLocal(i.id))}]:[])
  :(ctx.ws.inbox||[]).filter((i:any)=>(i.status==='dismissed'&&i.attentionDismissal&&!i.forwardedRequestId)||i.attentionSnooze).map((i:any)=>({id:i.id,title:i.title,restore:()=>i.status==='dismissed'?api('POST','/api/inbox/'+enc(i.id)+'/attention-dismissal/undo',{dismissalId:i.attentionDismissal.id,baseUpdatedAt:i.updatedAt}):api('POST','/api/inbox/'+enc(i.id)+'/attention-snooze/undo',{operationId:i.attentionSnooze.operationId})}));
 if(!rows.length)return null;
 return <div data-handled={kind} style={{display:'flex',flexDirection:'column',gap:6,alignItems:'center'}}>
  <Hv onClick={()=>setOpen(x=>!x)} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:'pointer'}} hover={{color:'var(--text)'}}>{zh?'已处理':'Handled'}</Hv>
  {open?rows.slice(0,30).map(r=><div key={r.id} style={{alignSelf:'stretch',display:'flex',alignItems:'center',gap:12,padding:'6px 12px',fontSize:13,color:'var(--text2)'}}><span style={{flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.title}</span>{r.ignore?<Hv data-action="dismiss" onClick={()=>{setError('');void r.ignore!().then(()=>ctx.refresh()).catch((e:any)=>setError(e?.message||''))}} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--text2)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)'}}>{ctx.T.dismiss}</Hv>:null}<Hv onClick={()=>{setError('');void r.restore().then(()=>ctx.refresh()).catch((e:any)=>setError(e?.message||''))}} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--accent)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)'}}>{XL.bringBack}</Hv></div>):null}
  {error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{error}</span>:null}
 </div>;
}
/** A dated 稍后决策 mark becomes the same timed, undoable snooze. `ui.gal` is deliberately not migrated: see Inspirations. */
function useLocalMarkMigration(ctx:Ctx){
 const started=useRef(false);
 useEffect(()=>{
  if(started.current)return;started.current=true;
  void (async()=>{
   for(const [id,mark] of Object.entries(ctx.ui.brief||{})){
    if(!(mark as any).later)continue;
    const item:any=ctx.ws.inbox.find(x=>x.id===id),later=String((mark as any).later);
    try{if(item&&later>today())await api('POST','/api/inbox/'+enc(id)+'/attention-snooze',{operationId:'migrate-later-'+id,baseUpdatedAt:item.updatedAt,until:new Date(later+'T09:00:00').toISOString()});}catch(e:any){if(!e?.status)continue}
    setUI(s=>{const brief={...s.brief};const {later:_l,...rest}=brief[id]||{} as any;if(Object.keys(rest).length)brief[id]=rest as any;else delete brief[id];return {brief}});
   }
   await ctx.refresh();
  })().catch(()=>{});
 },[]);// eslint-disable-line react-hooks/exhaustive-deps
}
/** Which interruption this one matter may cause. Existing notification settings still decide macOS. */
function DeliveryChoice({ctx,kind,row}:{ctx:Ctx;kind:'inbox'|'idea';row:any}){
 return <DeliveryChoiceControl key={kind+':'+row.id} ctx={ctx} kind={kind} row={row}/>;
}
function DeliveryChoiceControl({ctx,kind,row}:{ctx:Ctx;kind:'inbox'|'idea';row:any}){
 const {zh}=ctx,current:DeliveryStrategy=row.deliveryStrategy||'auto',[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 const save=async(strategy:DeliveryStrategy)=>{
  if(lock.current||strategy===current)return;
  lock.current=true;setBusy(true);setError('');
  try{await api('POST','/api/attention/strategy',{entityKind:kind,entityId:row.id,strategy});await ctx.refresh()}
  catch(e:any){setError(e?.status===403?(zh?'提醒设置被阻止，请更新应用后重试':'Reminder settings blocked. Update the app and retry'):(zh?'未能确认保存，请刷新后重试':'Could not confirm the change. Refresh and retry'))}
  finally{lock.current=false;setBusy(false)}
 };
 return <div data-delivery-strategy aria-busy={busy} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,fontSize:12,color:'var(--text3)'}}><span>{zh?'主对话提醒':'Chat reminders'}</span><div style={{display:'flex',gap:2,padding:2,borderRadius:'var(--r-btn)',background:'var(--segBg)'}}>{DELIVERY_STRATEGIES.map(s=><button key={s} type="button" disabled={busy} aria-pressed={current===s} onClick={()=>void save(s)} style={seg(current===s)}>{DELIVERY_LABELS[s][zh?1:0]}</button>)}</div>{error?<span role="alert" style={{color:'var(--errText)'}}>{error}</span>:null}</div>;
}

/** One short-lived undo acknowledgement, not a list. Older dismissals can be found through V6 search. */
export function DismissAck({ctx}:{ctx:Ctx}){
 const {zh,XL}=ctx,ack=useDismissAck(),act=useAttentionAction(ctx),[ideaBusy,setIdeaBusy]=useState(false),[ideaError,setIdeaError]=useState('');
 if(!ack)return null;
 const item:any=ack.kind==='idea'?undefined:ctx.ws.inbox.find(x=>x.id===ack.itemId),idea:any=ack.kind==='idea'?ctx.ws.ideas.find(x=>x.id===ack.itemId):undefined;
 if(ack.kind==='idea'?!idea:(item?.attentionDismissal?.id!==ack.dismissalId&&item?.attentionAck?.id!==ack.dismissalId))return null;
 const undoIdea=async()=>{setIdeaBusy(true);setIdeaError('');try{await ideaAttentionCall(idea,'undo',ack.operationId);clearAck();await ctx.refresh()}catch(e:any){setIdeaError(e?.message||'')}finally{setIdeaBusy(false)}};
 const busy=act.busy||ideaBusy,error=act.error||ideaError;
 return <div data-dismiss-ack style={{display:'flex',alignItems:'center',gap:12,padding:'6px 12px',borderRadius:14,background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',flexWrap:'wrap'}}>
  <span style={{flex:1,minWidth:0,fontSize:13,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(zh?'已忽略：':'Dismissed: ')+(item||idea).title}</span>
  {error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{error}</span>:null}
  <Hv onClick={()=>void (idea?undoIdea():act.undo(item))} disabled={busy} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--accent)',font:'inherit',fontSize:12,cursor:busy?'default':'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)'}}>{busy?(zh?'处理中…':'Working…'):XL.undo}</Hv>
 </div>;
}
function InsightActions({ctx,it}:{ctx:Ctx;it:InsightModel}){
 const {T,zh}=ctx,act=useAttentionAction(ctx),a=it.attention;
 return <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:8,paddingTop:12,borderTop:'0.5px solid var(--line)'}}><div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
  {a.canDismiss?<Hv onClick={()=>void act.dismiss(it.item)} disabled={act.busy} style={btn('sec')} hover={{filter:'brightness(0.96)'}}>{act.busy?(zh?'处理中…':'Working…'):T.dismiss}</Hv>:null}
  <Hv onClick={()=>ctx.openDetail({type:'ins',id:it.id})} style={btn(a.canDismiss?'sec':'primary')} hover={{filter:'brightness(0.96)'}}>{zh?'查看详情':'Details'}</Hv>
  {act.error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{act.error}</span>:null}
 </div></div>;
}

/** Each block renders only when its own data exists. */
function ThreadTimeline({item,zh}:{item:any;zh:boolean}){
 const rows=threadTimeline(item);if(!rows)return null;
 return <div data-thread-timeline style={{display:'flex',flexDirection:'column',gap:6}}><div style={{fontSize:12,color:'var(--text3)'}}>{zh?'时间线':'Timeline'}</div>{rows.map(r=><div key={r.id} style={{display:'flex',alignItems:'baseline',gap:8,fontSize:13}}><span style={{width:6,height:6,borderRadius:'50%',background:'var(--lineStrong)',flex:'none',alignSelf:'center'}}/><span style={{flex:'none',color:'var(--text2)'}}>{r.label[zh?1:0]}</span><span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.sender}</span><span style={{flex:'none',fontSize:12,color:'var(--text3)'}}>{fmtStamp(new Date(r.at).toISOString(),zh)}</span></div>)}</div>;
}
function LinkedTasks({ctx,id}:{ctx:Ctx;id:string}){
 const tasks=linkedTasksOf(ctx.ws,id);if(!tasks.length)return null;
 return <div data-linked-task style={{display:'flex',flexDirection:'column',gap:4}}><div style={{fontSize:12,color:'var(--text3)'}}>{ctx.T.taskLinked}</div>{tasks.slice(0,5).map(t=><Hv key={t.id} onClick={()=>ctx.openDetail({type:'task',id:t.id})} style={{all:'unset',cursor:'pointer',display:'flex',gap:8,fontSize:13}} hover={{color:'var(--accentText)'}}><span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</span><span style={{flex:'none',fontSize:12,color:'var(--text3)'}}>{ctx.T.ts[taskStatus(t)]}</span></Hv>)}</div>;
}
/** A live, read-only check against current sources plus the last real rewrite. A failed read shows nothing rather than a guess. */
function IdeaFacts({idea,zh}:{idea:any;zh:boolean}){
 const [facts,setFacts]=useState<any>(null);
 useEffect(()=>{let live=true;setFacts(null);api('GET','/api/ideas/'+enc(idea.id)+'/facts').then(v=>{if(live)setFacts(v)}).catch(()=>{});return()=>{live=false}},[idea.id,idea.updatedAt]);
 const strip=ideaTimeStrip(idea);
 const state=!facts?.sourceCount?'':facts.unreadable?(zh?`${facts.unreadable} 个来源暂不可读`:`${facts.unreadable} unreadable`):facts.changed?(zh?`${facts.changed} 个来源已变化，待重新判断`:`${facts.changed} changed, awaiting a new judgment`):(zh?'来源未变化':'Sources unchanged');
 return <>
  {strip?<TimeStripView s={strip} zh={zh}/>:null}
  {state?<div data-verified style={{fontSize:12,color:'var(--text3)'}}>{[(zh?'核对于 ':'Checked ')+fmtStamp(facts.checkedAt,zh),state,facts.sourceUpdatedAt?(zh?'来源最新 ':'Latest source ')+fmtStamp(facts.sourceUpdatedAt,zh):''].filter(Boolean).join(' · ')}</div>:null}
  {facts?.before?<div data-before-after style={{display:'flex',flexDirection:'column',gap:6}}><div style={{fontSize:12,color:'var(--text3)'}}>{(zh?'更新前':'Before')+(facts.before.at?' · '+fmtStamp(facts.before.at,zh):'')}</div><div style={{fontWeight:500,color:'var(--text2)'}}>{facts.before.title}</div><div style={tw({color:'var(--text3)',textWrap:'pretty'} as any)}>{plain(facts.before.description,220)}</div></div>:null}
 </>;
}
// Evidence view for a decision/insight (Inbox item) or an inspiration (Idea).
export function InsightDetail({ctx,id,discuss}:{ctx:Ctx;id:string;discuss:(id:string)=>void}){
 const {ws,T,zh}=ctx;const item=ws.inbox.find(x=>x.id===id);const idea=ws.ideas.find(x=>x.id===id);
 const [draftReq,setDraftReq]=useState<{id:string;status:string;error?:string}|null>(null);
 const act=useAttentionAction(ctx);
 const box:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'20px 20px 24px',display:'flex',flexDirection:'column',gap:22,animation:'cmSlide 250ms ease-out both'};
 if(!item&&!idea)return <div style={box}><div style={{color:'var(--text2)'}}>{zh?'这条记录已不存在或已被移除。':'This record no longer exists.'}</div></div>;
 async function makeDraft(){if(!item)return;const requestId=uid('cyberme-draft');setDraftReq({id:requestId,status:'running'});
  try{await api('POST','/api/inbox/'+enc(item.id)+'/draft',{requestId,mode:'auto',baseUpdatedAt:item.updatedAt});setDraftReq({id:requestId,status:'succeeded'});await ctx.refresh()}
  catch(e:any){let status='failed';try{const r=await api('GET','/api/inbox/'+enc(item.id)+'/draft-requests/'+enc(requestId));status=r.status||r.state||'unknown'}catch{status=e.status===409?'failed':'unknown'}setDraftReq({id:requestId,status,error:e.message});void ctx.refresh()}}
 // Items that really need a reply open the V6 email proposal; related items are grouped only by the records' own `v6.group`.
 const needsReply=(x:any)=>{try{return canOfferReplyDraft(x)&&!['sent','sending','send_unknown'].includes(String(x.status))}catch{return false}};
 const group=(item as any)?.v6?.group;
 const replyIds=item&&needsReply(item)?[item.id,...(typeof group==='string'?ws.inbox.filter(x=>x.id!==item.id&&(x as any).v6?.group===group&&needsReply(x)).map(x=>x.id):[])]:[];
 const linkedTask=item?ws.tasks.find(t=>(t as any).inboxId===item.id||(t as any).sourceIds?.includes?.(item.id)):undefined;
 const draftText=item?.draft||(item as any)?.draftCandidate?.text||'';
 // Direct operations only. Discussion stays below as the one conversational path.
 const attention=item?inboxAttention(item):null;
 const target=item&&attention?recheckTarget(item,attention):null;
 // An Inbox record listed under Inspirations binds the same grounded projection as its list card (v6 title/summary,
 // status and tone); other records keep the reply/decision status.
 const ins=item?insightOf(item,zh,T):null;
 const quietStatus=item&&attention&&attention.surface==='none'?(attention.state==='system_error'?(zh?'判断失败':'Review failed'):attention.state==='reevaluating'?(zh?'等待判断':'Waiting for review'):(zh?'无需处理':'Nothing needed')):'';
 const status=attention?.reason==='reevaluating_open'?attentionLabel(attention,zh):ins?ins.status:quietStatus||(item?((item as any).status==='send_unknown'?T.st.unknown:draftText?T.st.decide:T.st.reply):T.st.decide);
 const tone=ins?.tone==='warn'?['--warnDot','--warnText']:ins?.tone==='muted'?['--text3','--text2']:['--accent','--accentText'];
 const summary=ins?ins.summary:item&&(item as any).summary?plain((item as any).summary,400):'';
 return <div style={box}>
  <div style={{display:'flex',flexDirection:'column',gap:8}}>
   <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><span style={{width:6,height:6,borderRadius:'50%',background:`var(${tone[0]})`,flex:'none'}}/><span style={{color:`var(${tone[1]})`,flex:1}}>{status}</span>{item?<span style={{color:'var(--text3)'}}>{[item.sender,item.channel].filter(Boolean).join(' · ')}</span>:null}</div>
   <div style={tw({fontSize:20,fontWeight:600,lineHeight:1.3,letterSpacing:'-0.01em',textWrap:'pretty'} as any)}>{ins?.title||item?.title||idea?.title}</div>
   {idea?<div style={{fontSize:12,color:'var(--text3)'}}>{[ideaWhen(idea,zh),ideaDeadline(idea,zh),ideaSchedule(idea,zh)].filter(Boolean).join(' · ')}</div>:null}
   {idea?<div style={{color:'var(--text2)'}}><Md text={idea.description}/></div>:summary?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{summary}</div>:null}
  </div>
  {item?<div style={{display:'flex',flexDirection:'column'}}><div style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>{T.evidenceH}</div>
   {sourcesOf(item).map((s,i)=><div key={i} style={{padding:'10px 0',borderTop:'0.5px solid var(--line)',display:'flex',flexDirection:'column',gap:4}}><div style={{display:'flex',alignItems:'baseline',gap:8}}><span style={{fontWeight:500,flex:1}}>{s.name}</span>{s.at?<span style={{fontSize:12,color:'var(--text3)'}}>{fmtStamp(s.at,zh)}</span>:null}</div><div style={tw({color:'var(--text2)',textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{s.quote}</div></div>)}
  </div>:null}
  {item?<ThreadTimeline item={item} zh={zh}/>:null}
  {idea?<IdeaFacts idea={idea} zh={zh}/>:null}
  <LinkedTasks ctx={ctx} id={id}/>
  {draftText?<div style={{display:'flex',flexDirection:'column',gap:8}}><div style={{fontSize:12,color:'var(--text3)'}}>{T.actionH}</div><div style={tw({textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{draftText}</div><div style={{fontSize:12,color:'var(--text3)'}}>{zh?'草稿不会自动发送。发送前需要确认。':'Drafts are never sent automatically. Sending requires confirmation.'}</div></div>:null}
  {draftReq&&draftReq.status!=='succeeded'?<div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:draftReq.status==='running'?'var(--hover)':draftReq.status==='failed'?'var(--errSoft)':'var(--warnSoft)',color:draftReq.status==='running'?'var(--text2)':draftReq.status==='failed'?'var(--errText)':'var(--warnText)',fontSize:12}}>{draftReq.status==='running'?(zh?'正在起草…':'Drafting…'):draftReq.error||T.ts[draftReq.status as 'failed']||draftReq.status}</div>:null}
  {act.busy||act.error||act.note?<div role="status" style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:act.error?'var(--errSoft)':'var(--hover)',color:act.error?'var(--errText)':'var(--text2)',fontSize:12}}>{act.error||act.note||(zh?'处理中…':'Working…')}</div>:null}
  {item||idea?<DeliveryChoice ctx={ctx} kind={item?'inbox':'idea'} row={item||idea}/>:null}
  <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
   {item&&!judgmentUnsettled(item)&&replyIds.length?<Hv onClick={()=>ctx.propose(replyIds)} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'起草回复':'Draft replies'}</Hv>:item&&canOfferReplyDraft(item)&&item.triage?.requestMessageId&&!draftText?<Hv onClick={()=>void makeDraft()} disabled={draftReq?.status==='running'} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'起草回复':'Draft a reply'}</Hv>:null}
   {idea?((idea.action||'task')==='task'?<CreateIdeaTask ctx={ctx} idea={idea}/>:<Hv onClick={(e:any)=>{const a=({task:zh?'创建任务':'Create a task',draft:zh?'起草草稿':'Draft it',automation:zh?'设置例行任务':'Set up a routine',file:zh?'整理成文件':'Make it a file'} as any)[idea.action||'task'];ctx.toComposer(e,idea.title,a,{k:'idea',id:idea.id,i:0,label:a})}} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'交给 CyberMe':'Hand it to CyberMe'}</Hv>):null}
   {linkedTask?<Hv onClick={()=>ctx.openDetail({type:'task',id:linkedTask.id})} style={{...actBtn('sec'),marginRight:4}} hover={{background:'var(--selected)'}}>{T.viewTask}</Hv>:null}
   {target?<Hv onClick={()=>void act.recheck(item!,target)} disabled={act.busy} style={{height:32,padding:'0 12px',marginRight:4,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:act.busy?'default':'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{zh?'重新判断':'Re-evaluate'}</Hv>:null}
   {attention?.canDismiss?<Hv onClick={()=>void act.dismiss(item!)} disabled={act.busy} style={{height:32,padding:'0 12px',marginRight:4,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:act.busy?'default':'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.dismiss}</Hv>:null}
   <Hv onClick={()=>discuss(id)} style={{height:32,padding:'0 8px',border:'none',borderRadius:'var(--r-btn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.discuss}</Hv>
  </div>
 </div>;
}
