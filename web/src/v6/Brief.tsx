import React,{useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {I} from './icons';
import {ContentArtwork} from './ContentArtwork';
import {Hv,btn,actBtn,unset} from './ui';
import {DecisionVis,Meters,InsightVis,GalleryVis} from './visuals';
import {getUI,setUI,api,enc,inFlight,unsent} from './store';
import {today,sourcesOf,insightOf,attentionLabel,fmtStamp,ideaWhen,ideaDeadline,ideaSchedule,ideaRecommendation,linkedTasksOf,taskStatus,type DecisionModel,type InsightModel,type GalleryModel} from './model';
import {useAttentionAction,useDismissAck,recheckTarget,tomorrowMorning,ideaAttentionCall,clearAck,useDraftCooling} from './attention';
import {useTypedActions,pendingLabel,type ActionView} from './attention-action-state';
import {messageRevision} from '../../../shared/inbox-surfacing';
import {ideaTimeStrip,threadTimeline,type TimeStrip} from './derive';
import {inboxAttention,canOfferReplyDraft,judgmentUnsettled} from '../../../shared/inbox-attention';
import {Md,plain} from './md';
import {InsightVisual} from './InsightVisual';
import {readyVisual,VisualBoundary} from './insight-visuals';
import {InsightFooter} from './InsightFooter';

const card:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,overflow:'hidden'};
const tw=(s:React.CSSProperties)=>s as React.CSSProperties;

type FeedPosition={scroll:HTMLElement;visible:{node:HTMLElement;top:number}[]};
class FeedViewport extends React.Component<React.PropsWithChildren,{},FeedPosition|null>{
 private feed=React.createRef<HTMLDivElement>();

 getSnapshotBeforeUpdate():FeedPosition|null{
  const scroll=this.feed.current?.closest<HTMLElement>('.cm-scroll');
  if(!scroll||scroll.scrollTop<=0)return null;
  const viewport=scroll.getBoundingClientRect(),visible:FeedPosition['visible']=[];
  for(const node of this.feed.current!.querySelectorAll<HTMLElement>('[data-idea], [data-item]')){
   const bounds=node.getBoundingClientRect();
   if(bounds.bottom>viewport.top&&bounds.top<viewport.bottom)visible.push({node,top:bounds.top});
  }
  return {scroll,visible};
 }

 componentDidUpdate(_props:React.PropsWithChildren,_state:{},position:FeedPosition|null){
  // Preserve the first visible card still in the feed, even when cards above it gain a graph.
  const anchor=position?.visible.find(({node})=>this.feed.current?.contains(node));
  if(position&&anchor){
   const delta=anchor.node.getBoundingClientRect().top-anchor.top;
   if(Math.abs(delta)>0.5)position.scroll.scrollTop+=delta;
  }
 }

 render(){return <div ref={this.feed} data-insight-feed style={{display:'flex',flexDirection:'column',gap:14}}>{this.props.children}</div>}
}

export default function Brief({ctx,decs,ins,gal}:{ctx:Ctx;decs:DecisionModel[];ins:InsightModel[];gal:GalleryModel[]}){
 const {ui}=ctx;const st=ui.brief;
 useLocalMarkMigration(ctx);
 const state=(d:DecisionModel)=>st[d.id]?.pick?'decided':'pending';
 // One 洞察 feed. Requests that still need you come first; a request you already answered sinks to one line.
 const pending=decs.filter(d=>state(d)==='pending'),decided=decs.filter(d=>state(d)==='decided');
 return <FeedViewport>
  {ins.filter(i=>i.attention.state==='execution').map(it=><InsightCard key={it.id} ctx={ctx} it={it}/>)}
  {pending.map(d=><DecisionCard key={d.id} ctx={ctx} d={d} state="pending"/>)}
  {ins.filter(i=>i.attention.state!=='execution').map(it=><InsightCard key={it.id} ctx={ctx} it={it}/>)}
  <Inspirations ctx={ctx} gal={gal}/>
  {decided.length?<div data-decided style={{display:'flex',flexDirection:'column',gap:8}}>{decided.map(d=><DecisionCard key={d.id} ctx={ctx} d={d} state="decided"/>)}</div>:null}
  {/* An empty feed shows only the quiet footer: ignoring or snoozing is not completion. */}
  {/* One footer at the true end of the feed replaces 再找找 and both 已处理 links. */}
  <InsightFooter ctx={ctx}/>
 </FeedViewport>;
}

function DecisionCard({ctx,d,state}:{ctx:Ctx;d:DecisionModel;state:'pending'|'decided'}){
 const {ui,XL,T,zh}=ctx;const v=ui.brief[d.id];
 // Undo drops only this decision's local journal rows; legacy rows without itemId and request/work history stay.
 const undo=()=>setUI(s=>{const brief={...s.brief};delete brief[d.id];return {brief,journal:s.journal.filter(j=>j.itemId!==d.id)}});
 const req=v?.pick?.requestId?ui.requests.find(r=>r.requestId===v.pick!.requestId):undefined;
 const next=!req?XL.pickSent:inFlight(req)?XL.pickPending:req.status==='succeeded'?XL.pickSent:req.status==='failed'||unsent(req)?XL.pickFailed:req.status==='partial'?T.st.partial:XL.pickUnknown;
 const nextTone=req&&['failed'].includes(req.status)?'var(--errText)':req&&['unknown','partial'].includes(req.status)?'var(--warnText)':'var(--text2)';
 const chosenOpt=v?.pick?d.opts[v.pick.index]:undefined;
 const act=useAttentionAction(ctx),it:any=d.item,cooling=useDraftCooling(ctx,d.item);
 const waitLabel=zh?'等待消息稳定':'Waiting for messages to settle';
 const binding=inboxBinding(it);
 // Shared with the derived message and the detail view; survives remounts and reloads.
 const ta=useTypedActions(ctx,binding,['draft_reply','create_task','snooze']);
 const feedback=(['draft_reply','create_task','snooze'] as const).map(t=>ta.view(t)).find(x=>x.error);
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
     const typed=!!o.action&&!!binding.requestMessageId,view:ActionView|undefined=typed?ta.view(o.action as any):undefined;
     const running=view?.phase==='pending',unresolved=!!view&&['unknown','missing','not_saved'].includes(view.phase||'');
     const reviewing=o.action==='draft_reply'&&!!d.item.draft?.trim()&&!it.draftStale;
     // View task only for the exact create_task receipt of this request; the task keeps its own status.
     const task=o.action==='create_task'&&typed?ta.task():undefined;
     // Cooling locks only starting a new draft; an unresolved operation can still be checked.
     // An unsettled judgment never starts a draft: receipts and a current draft come first, then a neutral status or a manual re-judgment.
     const held=o.action==='draft_reply'&&!reviewing&&!running&&!unresolved&&judgmentUnsettled(it),rejudge=held&&d.phase==='failed';
     if (o.action==='draft_reply' && !reviewing && !running && !unresolved && !rejudge && !canOfferReplyDraft(it)) return null;
     const waiting=o.action==='draft_reply'&&!held&&!reviewing&&!running&&!unresolved&&cooling.waiting;
     const label=held?(rejudge?(zh?'重新判断':'Re-evaluate'):d.statusNote||(zh?'等待判断':'Waiting for review')):running?(o.action==='draft_reply'?(zh?'正在起草…':'Drafting…'):o.action==='create_task'?(zh?'正在创建任务…':'Creating task…'):(zh?'处理中…':'Working…'))
      :unresolved?pendingLabel(view!,zh,o.label):reviewing?(zh?'查看草稿':'View draft'):task?(zh?'查看任务 · ':'View task · ')+T.ts[taskStatus(task)]:waiting?waitLabel:o.label;
     return <Hv key={oi} data-action={rejudge?'recheck':o.action} data-held={held?d.phase||'pending':undefined} data-phase={view?.phase} data-waiting={waiting?'cooling':undefined} disabled={(ta.anyBusy&&!unresolved)||running||waiting||(held&&(!rejudge||act.busy))} aria-busy={running||undefined} onClick={(e:any)=>{
      if(waiting||running||(held&&!rejudge))return;
      if(rejudge)void act.recheck(it,'triage');
      else if(unresolved)ta.act(o.action as any);
      else if(reviewing)ctx.openDetail({type:'dec',id:d.id});
      else if(task)ctx.openDetail({type:'task',id:task.id});
      else if(typed)ta.act(o.action as any);
      else ctx.toComposer(e,d.q,o.label,{k:'brief',id:d.id,i:oi,label:o.label});
     }} style={{all:'unset',boxSizing:'border-box',cursor:ta.anyBusy?'default':'pointer',display:'flex',alignItems:'flex-start',gap:12,padding:'12px 14px',boxShadow:oi<d.opts.length-1?'inset 0 -0.5px 0 var(--line)':'none',transition:'background 150ms ease-out'}} hover={{background:'var(--hover)'}}>
      {reviewing&&!running&&!unresolved?<I n="check" style={{width:16,flex:'none',marginTop:2,color:'var(--accentText)'}}/>:<span style={{width:16,height:16,flex:'none',marginTop:2,borderRadius:'50%',boxSizing:'border-box',transition:'border 200ms',border:sel||running?'5px solid var(--accent)':'1.5px solid var(--lineStrong)'}}/>}
      <span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:6,textAlign:'left'}}>
       <span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span aria-live="polite" style={{fontWeight:500,color:'var(--text)'}}>{label}</span>{o.rec&&!running&&!reviewing&&!waiting&&!unresolved&&!task?<span style={{height:20,padding:'0 8px',display:'inline-flex',alignItems:'center',borderRadius:10,background:'var(--accentSoft)',color:'var(--accentText)',fontSize:11,fontWeight:500}}>{XL.recommended}</span>:null}</span>
       {reviewing&&!running&&!unresolved?<span data-draft-excerpt style={tw({fontSize:13,color:'var(--text2)',textWrap:'pretty'} as any)}>{plain(d.item.draft||'',120)}</span>:null}
       {d.meters?<Meters m={d.meters} index={oi} rec={o.rec} zh={ctx.zh}/>:null}
      </span></Hv>})}
   </div>
   {feedback?<div role="alert" data-action-feedback={feedback.phase} style={{fontSize:12,color:feedback.tone==='warn'?'var(--warnText)':'var(--errText)'}}>{feedback.error}</div>:null}
   {d.prec?<div style={{display:'flex',gap:10,alignItems:'center',padding:'10px 12px',borderRadius:10,boxShadow:'0 0 0 0.5px var(--line)'}}><span style={{width:26,height:26,flex:'none',borderRadius:8,background:'var(--hover)',color:'var(--text2)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="clock-counter-clockwise" style={{fontSize:14}}/></span><span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={tw({fontSize:13,textWrap:'pretty'} as any)}>{d.prec}</span></span></div>:null}
   <div style={{display:'flex',gap:6,justifyContent:'flex-end',paddingTop:12,borderTop:'0.5px solid var(--line)'}}>
    {(()=>{const sv=ta.view('snooze'),open=['unknown','missing','not_saved'].includes(sv.phase||'');return <Hv data-action="snooze" data-phase={sv.phase} disabled={(ta.anyBusy&&!open)||sv.phase==='pending'||!binding.requestMessageId} onClick={()=>ta.act('snooze',{until:tomorrowMorning()})} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{pendingLabel(sv,zh,XL.decideLater)}</Hv>})()}
    {act.error?<span role="alert" style={{flex:1,minWidth:0,alignSelf:'center',fontSize:12,color:'var(--errText)'}}>{act.error}</span>:act.note?<span role="status" style={{flex:1,minWidth:0,alignSelf:'center',fontSize:12,color:'var(--text2)'}}>{act.note}</span>:null}
    <Hv onClick={()=>void act.dismiss(d.item)} disabled={act.busy} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:act.busy?'default':'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{act.busy?(ctx.zh?'处理中…':'Working…'):T.dismiss}</Hv>
    <Hv onClick={(e:any)=>ctx.toComposer(e,d.q+'\n'+d.opts.map(o=>'- '+o.label).join('\n'),XL.discussQ(d.q),{k:'ctx',id:d.id,i:-1,label:''})} style={{height:30,padding:'0 12px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{filter:'brightness(0.96)'}}><I n="arrow-bend-up-left" style={{fontSize:14}}/><span>{ctx.zh?'问问CyberMe':'Ask CyberMe'}</span></Hv>
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
 const visuals=ctx.ws.insightVisuals;
 // An older local 暂不处理 stays local: hidden here and reversible, with no change to the record until the user decides.
 const local=ctx.ui.gal||{},live=gal.filter(g=>!local[g.id]);
 if(!live.length)return null;
 return <div style={{display:'flex',flexDirection:'column',gap:14}}>
  {live.map(g=><IdeaCard key={g.id} ctx={ctx} g={g} visual={readyVisual(visuals?.[g.id],g.idea as any)}/>)}
 </div>;
}
/** Both entry points prepare a normal chat draft; no business mutation happens here. */
function IdeaActions({ctx,idea}:{ctx:Ctx;idea:GalleryModel['idea']}){
 const {zh}=ctx,recommendation=ideaRecommendation(idea,zh);
 const quote=[idea.title,idea.description].filter(Boolean).join('\n\n');
 const ask=zh?'请结合这条洞察的完整内容和来源，帮我分析判断与下一步。':'Help me assess this insight and its next steps using the full context and sources.';
 const prepare=(e:any,text:string)=>ctx.toComposer(e,quote,text,{k:'ctx',id:idea.id,i:-1,label:text});
 const style=(kind:'primary'|'sec'):React.CSSProperties=>({...actBtn(kind),height:'auto',minHeight:34,padding:'7px 14px',borderRadius:10,whiteSpace:'normal',textAlign:'left',maxWidth:'100%',overflowWrap:'anywhere'});
 return <div data-idea-actions style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',justifyContent:'flex-start'}}>
  <Hv data-action="recommend" onClick={(e:any)=>prepare(e,recommendation.prompt)} style={style('primary')} hover={{background:'var(--accentHover)'}}>{recommendation.label}</Hv>
  <Hv data-action="ask-cyberme" onClick={(e:any)=>prepare(e,ask)} style={style('sec')} hover={{background:'var(--selected)'}}>{zh?'问问CyberMe':'Ask CyberMe'}</Hv>
 </div>;
}
function IdeaCard({ctx,g,visual}:{ctx:Ctx;g:GalleryModel;visual:ReturnType<typeof readyVisual>}){
 const {zh}=ctx;
 return <Hv as="div" data-idea={g.id} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine), 0 1px 2px rgba(0,0,0,.03)',borderRadius:16,padding:'18px 20px 14px',display:'flex',flexDirection:'column',gap:14,transition:'box-shadow 320ms ease-out'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 12px 32px rgba(0,0,0,.08)'}}>
  <div style={{display:'flex',alignItems:'center',gap:8}}><ContentArtwork iconKey={g.idea.iconKey} title={g.title} fallback="insight"/><span style={{flex:1}}/><span data-idea-when style={{fontSize:12,color:'var(--text3)',textAlign:'right'}}>{g.when}</span></div>
  <div style={{display:'flex',flexDirection:'column',gap:4}}><div data-idea-title onClick={()=>ctx.openDetail({type:'ins',id:g.id})} style={tw({fontSize:17,fontWeight:600,letterSpacing:'-0.01em',lineHeight:1.35,textWrap:'pretty',cursor:'pointer'} as any)}>{g.title}</div>{/* With a ready graph the saved summary is clamped visually to 3 lines (full text stays in the DOM and opens the same detail view); fallback cards show it in full. */}<div data-idea-body={visual?'visual':'text'} title={visual?g.body:undefined} onClick={visual?()=>ctx.openDetail({type:'ins',id:g.id}):undefined} style={tw(visual?{color:'var(--text2)',textWrap:'pretty',display:'-webkit-box',WebkitBoxOrient:'vertical',WebkitLineClamp:3,overflow:'hidden',cursor:'pointer'}:{color:'var(--text2)',textWrap:'pretty'} as any)}>{g.body}</div>{g.deadline?<div data-idea-deadline style={{fontSize:12,color:'var(--warnText)'}}>{g.deadline}</div>:null}{g.schedule?<div data-idea-schedule style={{fontSize:12,color:'var(--text2)'}}>{g.schedule}</div>:null}</div>
  {g.strip?<TimeStripView s={g.strip} zh={zh}/>:null}
  {/* The visual supplements the saved title/summary above; a render error simply hides it. */}
  {visual?<VisualBoundary fallback={null}><InsightVisual spec={visual} zh={zh}/></VisualBoundary>:g.visual?<GalleryVis v={g.visual} zh={zh}/>:null}
  <IdeaActions ctx={ctx} idea={g.idea}/>
 </Hv>;
}
function InsightCard({ctx,it}:{ctx:Ctx;it:InsightModel}){
 const {zh}=ctx,dot=(c:string):React.CSSProperties=>({width:6,height:6,borderRadius:'50%',background:`var(${c})`,flex:'none'});
 return <Hv as="div" data-item={it.id} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,padding:'18px 20px 14px',display:'flex',flexDirection:'column',gap:10,transition:'box-shadow 250ms ease-out'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 6px 20px rgba(0,0,0,.06)'}}>
  <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><ContentArtwork iconKey={it.item.iconKey} title={it.title} fallback="insight" size={36}/><span style={dot(it.tone==='warn'?'--warnDot':it.tone==='ok'?'--okDot':it.tone==='muted'?'--text3':'--accent')}/><span style={{color:it.tone==='warn'?'var(--warnText)':it.tone==='ok'?'var(--okText)':it.tone==='muted'?'var(--text2)':'var(--accentText)',flex:1}}>{it.status}</span>{it.sourceAt?<span style={{color:'var(--text3)'}}>{(zh?'来源 ':'From ')+fmtStamp(it.sourceAt,zh)}</span>:null}</div>
  <button type="button" onClick={()=>ctx.openDetail({type:'ins',id:it.id})} style={unset(tw({all:'unset',cursor:'pointer',fontSize:16,fontWeight:600,letterSpacing:'-0.01em',color:'var(--text)',textWrap:'pretty',lineHeight:1.35} as any))}>{it.title}</button>
  {it.summary?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{it.summary}</div>:null}
  {/* An existing draft stays reviewable; its words are shown, never implied. */}
  {it.item.draft?.trim()?<div data-draft-excerpt style={tw({fontSize:13,color:'var(--text2)',textWrap:'pretty'} as any)}><span style={{color:'var(--text3)'}}>{(it.item as any).draftStale?(zh?'旧草稿：':'Old draft: '):(zh?'已有草稿：':'Draft: ')}</span>{plain(it.item.draft,120)}</div>:null}
  {it.visual?<InsightVis v={it.visual} zh={zh}/>:null}
  <InsightActions ctx={ctx} it={it}/>
 </Hv>;
}
/** The exact request binding a card, its derived message and its detail share. */
export const inboxBinding=(it:any)=>{const requestMessageId=it?.triage?.status==='succeeded'?it.triage.requestMessageId:it?.lastOpenRequest?.requestMessageId;return {entityKind:'inbox' as const,entityId:String(it?.id||''),requestMessageId,requestRevision:requestRevisionOf(it,requestMessageId)}};
const requestRevisionOf=(it:any,id?:string)=>{const m=id&&(Array.isArray(it.messages)?it.messages:[]).find((x:any)=>x.id===id);return m?messageRevision(m):undefined};
/** Drawn only from verified times; see `timeStrip`. */
function TimeStripView({s,zh}:{s:TimeStrip;zh:boolean}){
 return <div data-time-strip style={{display:'flex',flexDirection:'column',gap:6}}>
  <div style={{position:'relative',height:2,borderRadius:1,background:'var(--line)'}}><div style={{position:'absolute',left:0,top:0,bottom:0,width:s.pct+'%',borderRadius:1,background:'var(--accent)'}}/></div>
  <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,color:'var(--text3)'}}>{s.points.map(p=><span key={p.label[0]} style={{display:'flex',flexDirection:'column'}}><span>{p.label[zh?1:0]}</span><span>{fmtStamp(new Date(p.at).toISOString(),zh)}</span></span>)}</div>
 </div>;
}
/** A dated 稍后决策 mark becomes the same timed, undoable snooze. `ui.gal` is deliberately not migrated: see Inspirations and InsightFooter. */
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
/** One short-lived undo acknowledgement, not a list. Older dismissals can be found through V6 search. */
export function DismissAck({ctx}:{ctx:Ctx}){
 const {zh,XL}=ctx,ack=useDismissAck(),act=useAttentionAction(ctx),[ideaBusy,setIdeaBusy]=useState(false),[ideaError,setIdeaError]=useState('');
 if(!ack)return null;
 const item:any=ack.kind==='idea'?undefined:ctx.ws.inbox.find(x=>x.id===ack.itemId),idea:any=ack.kind==='idea'?ctx.ws.ideas.find(x=>x.id===ack.itemId):undefined;
 if(ack.kind==='idea'?!idea:(item?.attentionDismissal?.id!==ack.dismissalId&&item?.attentionAck?.id!==ack.dismissalId))return null;
 const undoIdea=async()=>{setIdeaBusy(true);setIdeaError('');try{await ideaAttentionCall(idea,'undo',ack.operationId);clearAck();await ctx.refresh()}catch(e:any){setIdeaError(e?.data?.error==='undo_expired'?XL.undoExpired:e?.message||'')}finally{setIdeaBusy(false)}};
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
  {act.error?<span role="alert" style={{fontSize:12,color:'var(--errText)'}}>{act.error}</span>:act.note?<span role="status" style={{fontSize:12,color:'var(--text2)'}}>{act.note}</span>:null}
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
export function InsightDetail({ctx,id}:{ctx:Ctx;id:string}){
 const {ws,T,zh}=ctx;const item=ws.inbox.find(x=>x.id===id);const idea=ws.ideas.find(x=>x.id===id);
 const act=useAttentionAction(ctx),cooling=useDraftCooling(ctx,item);
 // A bound request drafts through the same typed operation as its card and derived message (one shared receipt).
 const dBinding=inboxBinding(item),ta=useTypedActions(ctx,dBinding,['draft_reply']),dView=ta.view('draft_reply');
 const box:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'20px 20px 24px',display:'flex',flexDirection:'column',gap:22,animation:'cmSlide 250ms ease-out both'};
 if(!item&&!idea)return <div style={box}><div style={{color:'var(--text2)'}}>{zh?'这条记录已不存在或已被移除。':'This record no longer exists.'}</div></div>;
 // Items that really need a reply open the V6 email proposal; related items are grouped only by the records' own `v6.group`.
 const needsReply=(x:any)=>{try{return canOfferReplyDraft(x)&&!['sent','sending','send_unknown'].includes(String(x.status))}catch{return false}};
 const group=(item as any)?.v6?.group;
 const replyIds=item&&needsReply(item)?[item.id,...(typeof group==='string'?ws.inbox.filter(x=>x.id!==item.id&&(x as any).v6?.group===group&&needsReply(x)).map(x=>x.id):[])]:[];
 const linkedTask=item?ws.tasks.find(t=>(t as any).inboxId===item.id||(t as any).sourceIds?.includes?.(item.id)):undefined;
 const draftText=item?.draft||(item as any)?.draftCandidate?.text||'';
 const savedDraft=item?.draft||'',candidateDraft=(item as any)?.draftCandidate?.text||'';
 // Concise, exact labels: a stale draft or an unreviewed candidate is not the current reply draft.
 const dUnresolved=['unknown','missing','not_saved'].includes(dView.phase||''),dRunning=dView.phase==='pending';
 const draftIdle=!item?.draft||!!(item as any)?.draftStale;
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
  {/* Saved (or old) draft and an unreviewed candidate are shown separately when both exist. */}
  {savedDraft?<div data-draft-section="saved" style={{display:'flex',flexDirection:'column',gap:8}}><div data-draft-label style={{fontSize:12,color:'var(--text3)'}}>{(item as any).draftStale?(zh?'旧草稿':'Old draft'):(zh?'回复草稿':'Reply draft')}</div><div style={tw({textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{savedDraft}</div></div>:null}
  {candidateDraft?<div data-draft-section="candidate" style={{display:'flex',flexDirection:'column',gap:8}}><div data-draft-label style={{fontSize:12,color:'var(--text3)'}}>{zh?'候选草稿':'Candidate draft'}</div><div style={tw({textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{candidateDraft}</div></div>:null}
  {item?<div style={{display:'flex',flexDirection:'column'}}><div style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>{T.evidenceH}</div>
   {sourcesOf(item).map((s,i)=><div key={i} style={{padding:'10px 0',borderTop:'0.5px solid var(--line)',display:'flex',flexDirection:'column',gap:4}}><div style={{display:'flex',alignItems:'baseline',gap:8}}><span style={{fontWeight:500,flex:1}}>{s.name}</span>{s.at?<span style={{fontSize:12,color:'var(--text3)'}}>{fmtStamp(s.at,zh)}</span>:null}</div><div style={tw({color:'var(--text2)',textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{s.quote}</div></div>)}
  </div>:null}
  {item?<ThreadTimeline item={item} zh={zh}/>:null}
  {idea?<IdeaFacts idea={idea} zh={zh}/>:null}
  <LinkedTasks ctx={ctx} id={id}/>
  {dView.error?<div role="alert" data-action-feedback={dView.phase} style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:dView.tone==='warn'?'var(--warnSoft)':'var(--errSoft)',color:dView.tone==='warn'?'var(--warnText)':'var(--errText)',fontSize:12}}>{dView.error}</div>:null}
  {act.busy||act.error||act.note?<div role="status" style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:act.error?'var(--errSoft)':'var(--hover)',color:act.error?'var(--errText)':'var(--text2)',fontSize:12}}>{act.error||act.note||(zh?'处理中…':'Working…')}</div>:null}
  {idea?<IdeaActions ctx={ctx} idea={idea}/>:<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
   {/* A shared pending or unconfirmed draft operation takes precedence over opening a new Proposal. */}
   {item&&replyIds.length&&!dRunning&&!dUnresolved?<Hv onClick={()=>ctx.propose(replyIds)} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'起草回复':'Draft replies'}</Hv>:item&&dBinding.requestMessageId&&(draftIdle&&!(item as any).draftCandidate&&canOfferReplyDraft(item)||dRunning||dUnresolved)?(()=>{const wait=cooling.waiting&&!dRunning&&!dUnresolved;
     return <Hv data-detail-draft data-phase={dView.phase} data-waiting={wait?'cooling':undefined} onClick={()=>{if(!wait&&!dRunning)ta.act('draft_reply')}} disabled={wait||dRunning} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{dRunning?(zh?'正在起草…':'Drafting…'):dUnresolved?pendingLabel(dView,zh,''):wait?(zh?'等待消息稳定':'Waiting for messages to settle'):(zh?'起草回复':'Draft a reply')}</Hv>})()
   :null}
   {linkedTask?<Hv onClick={()=>ctx.openDetail({type:'task',id:linkedTask.id})} style={{...actBtn('sec'),marginRight:4}} hover={{background:'var(--selected)'}}>{T.viewTask}</Hv>:null}
   {target?<Hv onClick={()=>void act.recheck(item!,target)} disabled={act.busy} style={{height:32,padding:'0 12px',marginRight:4,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:act.busy?'default':'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{zh?'重新判断':'Re-evaluate'}</Hv>:null}
   {attention?.canDismiss?<Hv onClick={()=>void act.dismiss(item!)} disabled={act.busy} style={{height:32,padding:'0 12px',marginRight:4,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:act.busy?'default':'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.dismiss}</Hv>:null}
   <Hv onClick={(e:any)=>ctx.toComposer(e,[item?.title,item?.body].filter(Boolean).join('\n\n'),zh?'请结合这件事的完整上下文，帮我分析下一步。':'Help me assess the next step with the full context.',{k:'ctx',id,i:-1,label:''})} style={{...actBtn('sec'),borderRadius:10}} hover={{background:'var(--selected)'}}>{zh?'问问CyberMe':'Ask CyberMe'}</Hv>
  </div>}
 </div>;
}
