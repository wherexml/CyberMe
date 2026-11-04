import React,{useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {I} from './icons';
import {Hv,seg,btn,actBtn,unset} from './ui';
import {DecisionVis,Meters,InsightVis,GalleryVis} from './visuals';
import {getUI,setUI,api,enc,uid,inFlight,unsent} from './store';
import {today,tomorrow,sourcesOf,insightOf,thinEvidence,type DecisionModel,type InsightModel,type GalleryModel} from './model';
import {Md,plain} from './md';
import {dispositionOf} from '../../../shared/inbox-surfacing';

const card:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,overflow:'hidden',animation:'cmIn 250ms ease-out both'};
const tw=(s:React.CSSProperties)=>s as React.CSSProperties;

export default function Brief({ctx,decs,ins,gal}:{ctx:Ctx;decs:DecisionModel[];ins:InsightModel[];gal:GalleryModel[]}){
 const {ui,XL,zh}=ctx;const st=ui.brief;
 const state=(d:DecisionModel)=>{const v=st[d.id];if(!v)return 'pending';if(v.pick)return 'decided';if(v.later&&v.later>today())return 'later';return 'pending'};
 const open=decs.filter(d=>state(d)==='pending').length;const allDecided=decs.every(d=>{const v=st[d.id];return v&&((v.later&&v.later>today())||v.why)});
 // Reference R1519: with no sub-tab chosen yet (briefTab null) the view is derived live, so completing the brief shows
 // Inspirations at once and undoing it shows Decisions again. An explicit 'dec' only switches via the 1400ms timer below.
 const bt=ui.briefTab||(allDecided&&decs.length>0?'ins':'dec');const onDec=bt==='dec';
 const wasDone=useRef(allDecided);
 const doneNow=useRef(allDecided);doneNow.current=allDecided;
 // Reference R1493: 1400ms after the last decision, re-checked when the timer fires (cancelled if completion is undone);
 // it sets briefTab 'ins', which moves an explicit 'dec'. Not started for a brief that was already complete on mount.
 useEffect(()=>{if(allDecided&&!wasDone.current&&decs.length){const t=setTimeout(()=>{if(doneNow.current&&getUI().briefTab!=='ins')setUI({briefTab:'ins'})},1400);wasDone.current=true;return()=>clearTimeout(t)}wasDone.current=allDecided},[allDecided,decs.length]);
 return <div style={{display:'flex',flexDirection:'column',gap:14}}>
  <div style={{display:'flex',justifyContent:'center',margin:'-6px 0 -6px'}}><div style={{display:'flex',gap:2,padding:2,borderRadius:'var(--r-btn)',background:'var(--segBg)'}}>{([['dec',XL.subDec],['ins',XL.subIns]] as const).map(([k,l])=><button key={k} type="button" onClick={()=>setUI({briefTab:k})} style={seg(bt===k)}>{l}</button>)}</div></div>
  {onDec?<div style={{display:'flex',flexDirection:'column',gap:14}}>
   {decs.map((d,i)=><DecisionCard key={d.id} ctx={ctx} d={d} num={XL.briefNum(i+1,decs.length)} state={state(d)}/>)}
   {open===0?<div style={{padding:'8px 4px 0',display:'flex',gap:8,alignItems:'center',color:'var(--text2)'}}><I n="check-circle" style={{fontSize:16,color:'var(--accent)'}}/><span>{XL.allClear}</span></div>:null}
   <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:14}}><div style={card}>
    <div style={{display:'flex',gap:12,alignItems:'flex-start',padding:'14px 16px',background:'var(--accentSoft)',color:'var(--accentText)'}}><I n="lightbulb" style={{fontSize:16,marginTop:2}}/><div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:12,fontWeight:600}}>{XL.patternL}</span><span style={tw({textWrap:'pretty'} as any)}>{typeof (ctx.ws.settings as any).v6?.pattern==='string'?(ctx.ws.settings as any).v6.pattern:XL.noPattern}</span></div></div>
    {ui.journal.map((j,i,a)=><div key={j.at+i} style={{display:'flex',gap:12,padding:'0 16px'}}><span style={{width:52,flex:'none',paddingTop:12,fontSize:12,color:'var(--text3)'}}>{j.at.slice(0,10)===today()?XL.todayJ:(zh?`${Number(j.at.slice(5,7))}/${Number(j.at.slice(8,10))}`:new Date(j.at).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</span>
     <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2,padding:'12px 0',boxShadow:i<a.length-1?'inset 0 -0.5px 0 var(--line)':'none'}}><span style={tw({fontSize:12,color:'var(--text3)',textWrap:'pretty'} as any)}>{j.title}</span><span style={tw({fontWeight:500,textWrap:'pretty'} as any)}>{j.choice}</span><span style={tw({fontSize:12,color:'var(--text2)',textWrap:'pretty'} as any)}>{j.why}</span></div></div>)}
   </div></div>
  </div>:<Inspirations ctx={ctx} ins={ins} gal={gal}/>}
 </div>;
}

function DecisionCard({ctx,d,num,state}:{ctx:Ctx;d:DecisionModel;num:string;state:'pending'|'decided'|'later'}){
 const {ui,XL,T}=ctx;const v=ui.brief[d.id];
 const set=(val:any)=>setUI(s=>{const brief={...s.brief};if(val)brief[d.id]=val;else delete brief[d.id];return {brief}});
 // Undo drops only this decision's local journal rows; legacy rows without itemId and request/work history stay.
 const undo=()=>setUI(s=>{const brief={...s.brief};delete brief[d.id];return {brief,journal:s.journal.filter(j=>j.itemId!==d.id)}});
 const req=v?.pick?.requestId?ui.requests.find(r=>r.requestId===v.pick!.requestId):undefined;
 const next=!req?XL.pickSent:inFlight(req)?XL.pickPending:req.status==='succeeded'?XL.pickSent:req.status==='failed'||unsent(req)?XL.pickFailed:req.status==='partial'?T.st.partial:XL.pickUnknown;
 const nextTone=req&&['failed'].includes(req.status)?'var(--errText)':req&&['unknown','partial'].includes(req.status)?'var(--warnText)':'var(--text2)';
 const chosenOpt=v?.pick?d.opts[v.pick.index]:undefined;
 return <div style={card}>
  {state==='pending'?<div style={{display:'flex',flexDirection:'column',gap:14,padding:'18px 20px 14px'}}>
   <div style={{display:'flex',flexDirection:'column',gap:6}}>
    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'var(--text3)'}}><span>{num}</span><span style={{flex:1}}/><span style={{color:d.urgent?'var(--warnText)':'var(--text3)',fontWeight:d.urgent?500:400}}>{d.due}</span></div>
    {/* Reference title has no hover styling; the click still opens the record's evidence (production entry to drafts/full Inbox). */}
    <div onClick={()=>ctx.openDetail({type:'dec',id:d.id})} style={tw({fontSize:16,fontWeight:600,lineHeight:1.4,textWrap:'pretty',cursor:'pointer'} as any)}>{d.q}</div>
    {d.ctx?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{d.ctx}</div>:null}
   </div>
   {d.visual?<DecisionVis v={d.visual} zh={ctx.zh} recs={d.opts.map(o=>o.rec)}/>:null}
   <div style={{display:'flex',flexDirection:'column',borderRadius:12,boxShadow:'0 0 0 0.5px var(--lineStrong)',overflow:'hidden'}}>
    {d.opts.map((o,oi)=>{const sel=ctx.pendPick?.k==='brief'&&ctx.pendPick.id===d.id&&ctx.pendPick.i===oi;
     return <Hv key={oi} onClick={(e:any)=>ctx.toComposer(e,d.q,o.label,{k:'brief',id:d.id,i:oi,label:o.label})} style={{all:'unset',boxSizing:'border-box',cursor:'pointer',display:'flex',alignItems:'flex-start',gap:12,padding:'12px 14px',boxShadow:oi<d.opts.length-1?'inset 0 -0.5px 0 var(--line)':'none',transition:'background 150ms ease-out'}} hover={{background:'var(--hover)'}}>
      <span style={{width:16,height:16,flex:'none',marginTop:2,borderRadius:'50%',boxSizing:'border-box',transition:'border 200ms',border:sel?'5px solid var(--accent)':'1.5px solid var(--lineStrong)'}}/>
      <span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:6,textAlign:'left'}}>
       <span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontWeight:500,color:'var(--text)'}}>{o.label}</span>{o.rec?<span style={{height:20,padding:'0 8px',display:'inline-flex',alignItems:'center',borderRadius:10,background:'var(--accentSoft)',color:'var(--accentText)',fontSize:11,fontWeight:500}}>{XL.recommended}</span>:null}</span>
       {d.meters?<Meters m={d.meters} index={oi} rec={o.rec} zh={ctx.zh}/>:null}
      </span></Hv>})}
   </div>
   {d.prec?<div style={{display:'flex',gap:10,alignItems:'center',padding:'10px 12px',borderRadius:10,boxShadow:'0 0 0 0.5px var(--line)'}}><span style={{width:26,height:26,flex:'none',borderRadius:8,background:'var(--hover)',color:'var(--text2)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="clock-counter-clockwise" style={{fontSize:14}}/></span><span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={tw({fontSize:13,textWrap:'pretty'} as any)}>{d.prec}</span></span></div>:null}
   <div style={{display:'flex',gap:6,justifyContent:'flex-end',paddingTop:12,borderTop:'0.5px solid var(--line)'}}>
    <Hv onClick={()=>set({later:tomorrow()})} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.decideLater}</Hv>
    <Hv onClick={(e:any)=>ctx.toComposer(e,d.q+'\n'+d.opts.map(o=>'- '+o.label).join('\n'),XL.discussQ(d.q),{k:'ctx',id:d.id,i:-1,label:''})} style={{height:30,padding:'0 12px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{filter:'brightness(0.96)'}}><I n="arrow-bend-up-left" style={{fontSize:14}}/><span>{XL.talkIt}</span></Hv>
   </div>
  </div>:null}
  {state==='decided'?<div style={{display:'flex',flexDirection:'column',gap:12,padding:'16px 20px'}}>
   <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
    <span style={{width:26,height:26,flex:'none',borderRadius:'50%',background:'var(--accent)',color:'var(--onAccent)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="check" style={{fontSize:14}}/></span>
    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2}}><span style={tw({fontSize:12,color:'var(--text3)',textWrap:'pretty'} as any)}>{d.q}</span><span style={tw({fontWeight:600,textWrap:'pretty'} as any)}>{v!.pick!.label}</span><span style={tw({fontSize:12,color:nextTone,textWrap:'pretty'} as any)}>{chosenOpt?.next?chosenOpt.next+' · ':''}{next}</span></div>
    <Hv onClick={undo} style={{height:26,padding:'0 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.undo}</Hv>
   </div>
   {!v!.why?<div style={{display:'flex',flexDirection:'column',gap:8,paddingLeft:38}}><span style={{fontSize:12,color:'var(--text3)'}}>{XL.whyQ}</span><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{d.why.map(r=><Hv key={r} onClick={()=>setUI(s=>({brief:{...s.brief,[d.id]:{...s.brief[d.id],why:r}},journal:[{at:new Date().toISOString(),title:d.q,choice:v!.pick!.label,why:r,itemId:d.id},...s.journal.filter(j=>j.itemId!==d.id)].slice(0,200)}))} style={{height:28,padding:'0 12px',border:'none',borderRadius:14,background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:13,cursor:'pointer'}} hover={{background:'var(--accentSoft)',color:'var(--accentText)'}}>{r}</Hv>)}</div></div>
   :<div style={{paddingLeft:38,display:'flex',gap:6,alignItems:'center',fontSize:12,color:'var(--text2)'}}><I n="notebook" style={{fontSize:14,color:'var(--text3)'}}/><span>{XL.savedWhy(v!.why)}</span></div>}
  </div>:null}
  {state==='later'?<div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px 12px 20px'}}><I n="moon" style={{fontSize:16,color:'var(--text3)'}}/><div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}><span style={tw({fontSize:13,textWrap:'pretty'} as any)}>{d.q}</span><span style={{fontSize:12,color:'var(--text3)'}}>{XL.movedTomorrow}</span></div><Hv onClick={()=>set(null)} style={{height:26,padding:'0 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--accent)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)'}}>{XL.bringBack}</Hv></div>:null}
 </div>;
}

function Inspirations({ctx,ins,gal}:{ctx:Ctx;ins:InsightModel[];gal:GalleryModel[]}){
 const {ui,XL,zh}=ctx;const [busy,setBusy]=useState(false);
 let vis=0;const hidden=ui.gal;
 async function more(){setBusy(true);try{await api('POST','/api/ideas/refresh',{});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error')}finally{setBusy(false)}}
 const dot=(c:string):React.CSSProperties=>({width:6,height:6,borderRadius:'50%',background:`var(${c})`,flex:'none'});
 return <div style={{display:'flex',flexDirection:'column',gap:12}}>
  {!ins.length&&!gal.length?<div style={{padding:'40px 4px',color:'var(--text2)',textAlign:'center'}}>{XL.galleryEmpty}</div>:null}
  {ins.map(it=><Hv as="div" key={it.id} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,padding:'20px 20px 14px',display:'flex',flexDirection:'column',gap:10,animation:'cmIn 250ms ease-out both',transition:'box-shadow 250ms ease-out'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 6px 20px rgba(0,0,0,.06)'}}>
   <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><span style={dot(it.tone==='warn'?'--warnDot':it.tone==='ok'?'--okDot':it.tone==='muted'?'--text3':'--accent')}/><span style={{color:it.tone==='warn'?'var(--warnText)':it.tone==='ok'?'var(--okText)':it.tone==='muted'?'var(--text2)':'var(--accentText)',flex:1}}>{it.status}</span></div>
   <button type="button" onClick={()=>ctx.openDetail({type:'ins',id:it.id})} style={unset(tw({all:'unset',cursor:'pointer',fontSize:17,fontWeight:600,letterSpacing:'-0.01em',color:'var(--text)',textWrap:'pretty',lineHeight:1.35} as any))}>{it.title}</button>
   {it.summary?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{it.summary}</div>:null}
   {it.visual?<InsightVis v={it.visual} zh={zh}/>:null}
   <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:8,paddingTop:12,borderTop:'0.5px solid var(--line)'}}><div style={{display:'flex',flexWrap:'wrap',gap:6}}>{it.actions.map(a=><Hv key={a.label} onClick={(e:any)=>ctx.prompt(e,it.id,a.prompt)} style={btn(a.primary?'primary':'sec')} hover={{filter:'brightness(0.96)'}}>{a.label}</Hv>)}</div></div>
  </Hv>)}
  {gal.map(g=>{const gone=!!hidden[g.id];const idx=gone?0:vis++;
   const chip:React.CSSProperties={width:22,height:22,borderRadius:6,background:g.color,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flex:'none'};
   if(gone)return <div key={g.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 16px',borderRadius:14,background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',animation:'cmIn 250ms ease-out both'}}><span style={chip}><I n={g.icon}/></span><span style={{flex:1,minWidth:0,fontSize:13,color:'var(--text2)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{g.title}</span><Hv onClick={()=>setUI(s=>{const gal={...s.gal};delete gal[g.id];return {gal}})} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--accent)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)'}}>{XL.bringBack}</Hv></div>;
   return <Hv as="div" key={g.id} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine), 0 1px 2px rgba(0,0,0,.03)',borderRadius:16,padding:'18px 20px 14px',display:'flex',flexDirection:'column',gap:14,animation:'cmRise 560ms cubic-bezier(.2,.8,.2,1) both',animationDelay:(idx*70)+'ms',transition:'transform 320ms cubic-bezier(.2,.8,.2,1), box-shadow 320ms ease-out'}} hover={{transform:'translateY(-2px)',boxShadow:'0 0 0 0.5px var(--lineStrong), 0 12px 32px rgba(0,0,0,.08)'}}>
    <div style={{display:'flex',alignItems:'center',gap:8}}><span style={chip}><I n={g.icon}/></span><span style={{fontSize:12,fontWeight:500,color:'var(--text2)'}}>{g.kind}</span><span style={{flex:1}}/><span style={{fontSize:12,color:'var(--text3)'}}>{g.when}</span></div>
    <div style={{display:'flex',flexDirection:'column',gap:4}}><div onClick={()=>ctx.openDetail({type:'ins',id:g.id})} style={tw({fontSize:17,fontWeight:600,letterSpacing:'-0.01em',lineHeight:1.35,textWrap:'pretty',cursor:'pointer'} as any)}>{g.title}</div><div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{g.body}</div></div>
    {g.visual?<GalleryVis v={g.visual} zh={zh}/>:null}
    <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'flex-end',alignItems:'center'}}>
     <Hv onClick={()=>setUI(s=>({gal:{...s.gal,[g.id]:true}}))} style={{flex:'none',height:30,padding:'0 12px',border:'none',borderRadius:15,background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.notNow}</Hv>
     <Hv onClick={(e:any)=>ctx.toComposer(e,g.title,g.act,{k:'idea',id:g.id,i:0,label:g.act})} style={tw({minWidth:0,maxWidth:'100%',minHeight:30,padding:'6px 14px',boxSizing:'border-box',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:15,background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:13,fontWeight:500,lineHeight:1.3,textAlign:'left',cursor:'pointer'} as any)} hover={{background:'var(--accentHover)'}}><span style={tw({minWidth:0,textWrap:'pretty'} as any)}>{g.act}</span><I n="arrow-up-right" style={{fontSize:13}}/></Hv>
    </div>
   </Hv>})}
  <Hv onClick={()=>void more()} disabled={busy} style={{alignSelf:'center',height:30,padding:'0 12px',border:'none',borderRadius:15,background:'transparent',color:'var(--text2)',font:'inherit',fontSize:13,cursor:busy?'default':'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{busy?XL.refreshing:XL.refresh}</Hv>
 </div>;
}

// Evidence view for a decision/insight (Inbox item) or an inspiration (Idea).
export function InsightDetail({ctx,id,discuss}:{ctx:Ctx;id:string;discuss:(id:string)=>void}){
 const {ws,T,zh}=ctx;const item=ws.inbox.find(x=>x.id===id);const idea=ws.ideas.find(x=>x.id===id);
 const [draftReq,setDraftReq]=useState<{id:string;status:string;error?:string}|null>(null);
 const box:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'20px 20px 24px',display:'flex',flexDirection:'column',gap:22,animation:'cmSlide 250ms ease-out both'};
 if(!item&&!idea)return <div style={box}><div style={{color:'var(--text2)'}}>{zh?'这条记录已不存在或已被移除。':'This record no longer exists.'}</div></div>;
 async function makeDraft(){if(!item)return;const requestId=uid('cyberme-draft');setDraftReq({id:requestId,status:'running'});
  try{await api('POST','/api/inbox/'+enc(item.id)+'/draft',{requestId,mode:'auto',baseUpdatedAt:item.updatedAt});setDraftReq({id:requestId,status:'succeeded'});await ctx.refresh()}
  catch(e:any){let status='failed';try{const r=await api('GET','/api/inbox/'+enc(item.id)+'/draft-requests/'+enc(requestId));status=r.status||r.state||'unknown'}catch{status=e.status===409?'failed':'unknown'}setDraftReq({id:requestId,status,error:e.message});void ctx.refresh()}}
 // Items that really need a reply open the V6 email proposal; related items are grouped only by the records' own `v6.group`.
 const needsReply=(x:any)=>{try{const d=dispositionOf(x);return d.placement==='pending'&&d.actionType==='reply'&&!['sent','sending','send_unknown'].includes(String(x.status))}catch{return false}};
 const group=(item as any)?.v6?.group;
 const replyIds=item&&needsReply(item)?[item.id,...(typeof group==='string'?ws.inbox.filter(x=>x.id!==item.id&&(x as any).v6?.group===group&&needsReply(x)).map(x=>x.id):[])]:[];
 const linkedTask=item?ws.tasks.find(t=>(t as any).inboxId===item.id||(t as any).sourceIds?.includes?.(item.id)):undefined;
 const draftText=item?.draft||(item as any)?.draftCandidate?.text||'';
 // An Inbox record listed under Inspirations binds the same grounded projection as its list card (v6 title/summary,
 // status and tone); other records keep the reply/decision status.
 const ins=item?insightOf(item,zh,T):null;
 const status=ins?ins.status:item?((item as any).status==='send_unknown'?T.st.unknown:draftText?T.st.decide:T.st.reply):T.st.decide;
 const tone=ins?.tone==='warn'?['--warnDot','--warnText']:ins?.tone==='muted'?['--text3','--text2']:['--accent','--accentText'];
 const summary=ins?ins.summary:item&&(item as any).summary?plain((item as any).summary,400):'';
 // Reference Quiet (R:855, final override R:1954-1955): it never acts directly; it fills the composer with the record attached
 // (prompt). Only genuine insufficient-signal evidence (thinEvidence) gets "Watch for more" (pWatch); other verify cases
 // (sensitive, failed, unknown time/source, changed context) get none (R:1681). It is prompt-only: no watching state is
 // saved, so the label never flips to "Stop watching". The reference's resolved-item Dismiss (pDismiss2) has no production
 // counterpart: the surfacing policy has no resolved verify placement.
 const quiet=item&&ins&&thinEvidence(item)?{label:T.watch,text:zh?'继续关注，有更多再告诉我。':'Keep watching and tell me if more come in.'}:null;
 return <div style={box}>
  <div style={{display:'flex',flexDirection:'column',gap:8}}>
   <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}><span style={{width:6,height:6,borderRadius:'50%',background:`var(${tone[0]})`,flex:'none'}}/><span style={{color:`var(${tone[1]})`,flex:1}}>{status}</span>{item?<span style={{color:'var(--text3)'}}>{[item.sender,item.channel].filter(Boolean).join(' · ')}</span>:null}</div>
   <div style={tw({fontSize:20,fontWeight:600,lineHeight:1.3,letterSpacing:'-0.01em',textWrap:'pretty'} as any)}>{ins?.title||item?.title||idea?.title}</div>
   {idea?<div style={{color:'var(--text2)'}}><Md text={idea.description}/></div>:summary?<div style={tw({color:'var(--text2)',textWrap:'pretty'} as any)}>{summary}</div>:null}
  </div>
  {item?<div style={{display:'flex',flexDirection:'column'}}><div style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>{T.evidenceH}</div>
   {sourcesOf(item).map((s,i)=><div key={i} style={{padding:'10px 0',borderTop:'0.5px solid var(--line)',display:'flex',flexDirection:'column',gap:4}}><div style={{display:'flex',alignItems:'baseline',gap:8}}><span style={{fontWeight:500,flex:1}}>{s.name}</span></div><div style={tw({color:'var(--text2)',textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{s.quote}</div></div>)}
  </div>:null}
  {draftText?<div style={{display:'flex',flexDirection:'column',gap:8}}><div style={{fontSize:12,color:'var(--text3)'}}>{T.actionH}</div><div style={tw({textWrap:'pretty',whiteSpace:'pre-wrap'} as any)}>{draftText}</div><div style={{fontSize:12,color:'var(--text3)'}}>{zh?'草稿不会自动发送。审批与发送沿用当前策略，在完整收件箱中完成。':'Drafts are never sent automatically. Approval and sending follow your current policy in the full Inbox.'}</div></div>:null}
  {draftReq&&draftReq.status!=='succeeded'?<div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:draftReq.status==='running'?'var(--hover)':draftReq.status==='failed'?'var(--errSoft)':'var(--warnSoft)',color:draftReq.status==='running'?'var(--text2)':draftReq.status==='failed'?'var(--errText)':'var(--warnText)',fontSize:12}}>{draftReq.status==='running'?(zh?'正在起草…':'Drafting…'):draftReq.error||T.ts[draftReq.status as 'failed']||draftReq.status}</div>:null}
  <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
   {item&&replyIds.length?<Hv onClick={()=>ctx.propose(replyIds)} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'起草回复':'Draft replies'}</Hv>:item&&!draftText?<Hv onClick={()=>void makeDraft()} disabled={draftReq?.status==='running'} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'起草回复':'Draft a reply'}</Hv>:null}
   {idea?<Hv onClick={(e:any)=>{const a=({task:zh?'创建任务':'Create a task',draft:zh?'起草草稿':'Draft it',automation:zh?'设置例行任务':'Set up a routine',file:zh?'整理成文件':'Make it a file'} as any)[idea.action||'task'];ctx.toComposer(e,idea.title,a,{k:'idea',id:idea.id,i:0,label:a})}} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'交给 CyberMe':'Hand it to CyberMe'}</Hv>:null}
   {linkedTask?<Hv onClick={()=>ctx.openDetail({type:'task',id:linkedTask.id})} style={{...actBtn('sec'),marginRight:4}} hover={{background:'var(--selected)'}}>{T.viewTask}</Hv>:null}
   {quiet?<Hv onClick={()=>ctx.prompt(null,item!.id,quiet.text)} style={{height:32,padding:'0 12px',marginRight:4,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{quiet.label}</Hv>:null}
   {/* Production secondary entry (approval/sending in the full workspace); it no longer takes the Quiet slot. */}
   {item?<Hv onClick={()=>openClassic('inbox',item.id)} style={{height:32,padding:'0 8px',border:'none',borderRadius:'var(--r-btn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{zh?'在完整收件箱中打开':'Open in full Inbox'}</Hv>:null}
   <Hv onClick={()=>discuss(id)} style={{height:32,padding:'0 8px',border:'none',borderRadius:'var(--r-btn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.discuss}</Hv>
  </div>
 </div>;
}
/** Secondary entry to the full classic workspace for flows not yet re-homed in V6. */
export function openClassic(view:string,id?:string){location.href='desktop.html#'+view+(id?'/'+encodeURIComponent(id):'');}
