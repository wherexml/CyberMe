import React,{useMemo,useState} from 'react';
import type {Ctx,Pend} from './App';
import {I} from './icons';
import {Hv,pill,btn,actBtn,unset,type PillStatus} from './ui';
import {WorkVis} from './visuals';
import {setUI,api,enc,uid} from './store';
import {workCards,taskList,taskStatus,relTime,type WorkModel} from './model';
import {Md} from './md';
import {ProposalTaskDetail} from './Proposal';
import {proposalForTask} from './proposal-state';
import {FollowUpControls} from './FollowUp';

const tw=(s:any)=>s as React.CSSProperties;
const ERR:[string,string,string]=['var(--errDot)','var(--errSoft)','var(--errText)'],WARN:[string,string,string]=['var(--warnDot)','var(--warnSoft)','var(--warnText)'],MUTE:[string,string,string]=['var(--text3)','var(--hover)','var(--text2)'];
const COL:Record<WorkModel['state'],[string,string,string]>={review:['var(--accent)','var(--accentSoft)','var(--accentText)'],running:['#ff9f0a','color-mix(in oklch, #ff9f0a 16%, transparent)','#b25e00'],done:['var(--okDot)','var(--okSoft)','var(--okText)'],failed:ERR,file_failed:ERR,unknown:WARN,partial:WARN,interrupted:WARN,cancelled:MUTE,chosen:MUTE,stale:WARN,closed:MUTE};

export default function Tasks({ctx}:{ctx:Ctx}){
 const {ws,zh,T}=ctx;
 const work=useMemo(()=>workCards(ws,zh),[ws,zh]);const list=useMemo(()=>taskList(ws,zh,ctx.ui.proposals),[ws,zh,ctx.ui.proposals]);
 // As the reference seed (workOpen:'w1'), the first card awaiting review starts expanded until the user toggles any card;
 // after that the saved choice (including all collapsed) is kept.
 const openId=ctx.ui.workOpenSet?ctx.ui.workOpen:ctx.ui.workOpen??work.find(w=>w.state==='review')?.id??null;
 return <div style={{display:'flex',flexDirection:'column',gap:12}}>
  {work.map((w,wi)=><WorkCard key={w.id} ctx={ctx} w={w} wi={wi} openId={openId}/>)}
  {/* Reference R701-702: the spacer and the empty text depend only on the task list (hasConvTasks / taskEmpty). */}
  {list.length?<div style={{height:6}}/>:null}
  {!list.length?<div style={{padding:'40px 4px',color:'var(--text2)',textAlign:'center'}}>{T.taskEmpty}</div>:null}
  {list.map(tk=>{const live=['queued','running','sending'].includes(tk.status);const n=tk.steps.length;const pct=tk.status==='done'?100:Math.max(6,((tk.step+(tk.status==='queued'?0:.5))/n)*100);
   return <Hv key={tk.id} onClick={()=>ctx.openDetail({type:'task',id:tk.id})} style={{all:'unset',boxSizing:'border-box',cursor:'pointer',background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'16px 18px',display:'flex',flexDirection:'column',gap:8,animation:'cmIn 250ms ease-out both',transition:'box-shadow 250ms ease-out'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong)'}}>
    <span style={tw({fontWeight:500,color:'var(--text)',textWrap:'pretty'})}>{tk.title}</span>
    <span style={{display:'flex',alignItems:'center',gap:8}}><span style={pill(tk.status)}>{T.ts[tk.status]}</span><span style={{fontSize:12,color:'var(--text3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tk.meta}</span></span>
    {live||tk.status==='confirm'?<span style={{display:'block',height:2,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:pct+'%',background:tk.status==='confirm'?'var(--warnDot)':'var(--accent)',transition:'width 250ms ease-out'}}/></span>:null}
   </Hv>})}
 </div>;
}

function WorkCard({ctx,w,wi,openId}:{ctx:Ctx;w:WorkModel;wi:number;openId:string|null}){
 const {ui,XL,zh}=ctx;const open=openId===w.id;// A resolved accepted selection uses the reference success colours of a picked card (R:1593); the label stays "Already chosen".
 // Strict reference (R:1603, user-approved 2026-10-29): outside `running` every step shows checked and none spins. Applied to
 // the review card only, in both collapsed and expanded views; the model, `w.state` and other states' steps stay as recorded.
 const steps=w.state==='review'?w.steps.map(st=>({...st,done:true,run:false})):w.steps;
 const [c1,c2,c3]=w.state==='chosen'&&w.chosen?(['var(--okDot)','var(--okSoft)','var(--okText)'] as [string,string,string]):COL[w.state];const [busy,setBusy]=useState('');
 const status={review:XL.wNeeds,running:XL.wRun,done:XL.wDone,failed:XL.wFailed,unknown:XL.wUnknown,file_failed:XL.wFileFailed,cancelled:ctx.T.ts.cancelled,interrupted:XL.wInterrupted,partial:ctx.T.ts.partial,chosen:XL.wChosen,stale:ctx.T.st.changed,closed:XL.wClosed}[w.state];
 const approval=w.work?.native?.receipt?.approval;
 // Same template for open panel options (executed only by an explicit Send through the choice endpoint) and for a completed
 // work item's record-provided follow-ups (R:679-681). A follow-up binds the associated task (or the work record) as hidden
 // conversation context ('ctx' pick): choosing only prefills the composer and Send posts an ordinary chat message.
 const ctxId=w.taskId||w.id;
 const opts:{key:string;label:string;rec:boolean;pend:Pend}[]=w.choices.length
  ?w.choices.map((c,ci)=>({key:c.optionId,label:c.label,rec:c.rec,pend:{k:'work',id:w.id,i:ci,label:c.label,optionId:c.optionId,revision:w.panel?.revision}}))
  :w.followups.map((f,fi)=>({key:'f'+fi,label:f.label,rec:f.rec,pend:{k:'ctx',id:ctxId,i:fi,label:f.label}}));
 async function act(path:string,body:any={}){setBusy(path);try{await api('POST',path,body);await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error');void ctx.refresh()}finally{setBusy('')}}
 const smallBtn:React.CSSProperties={height:30,padding:'0 12px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:15,background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:13,cursor:'pointer'};
 return <Hv as="div" style={{background:'var(--card)',boxShadow:open?'0 0 0 0.5px var(--lineStrong), 0 10px 28px rgba(0,0,0,.07)':'0 0 0 0.5px var(--cardLine)',borderRadius:16,overflow:'hidden',animation:'cmRise 500ms cubic-bezier(.2,.8,.2,1) both',animationDelay:(wi*60)+'ms',transition:'box-shadow 300ms ease-out'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 10px 28px rgba(0,0,0,.07)'}}>
  <button type="button" onClick={()=>setUI({workOpen:open?null:w.id,workOpenSet:true})} style={unset({all:'unset',boxSizing:'border-box',cursor:'pointer',display:'flex',flexDirection:'column',gap:10,padding:'16px 18px 14px',width:'100%'})}>
   <span style={{display:'flex',alignItems:'center',gap:8}}>
    <span style={{display:'inline-flex',alignItems:'center',gap:6,height:22,padding:'0 9px',borderRadius:11,background:c2,color:c3,fontSize:12,fontWeight:500}}><span style={{width:6,height:6,borderRadius:'50%',background:c1,animation:w.state==='running'?'cmPulse 1.4s ease-in-out infinite':'none'}}/>{status}</span>
    <span style={{flex:1}}/><span style={{fontSize:12,color:'var(--text3)'}}>{w.when}</span>
    <I n="caret-down" style={{fontSize:14,color:'var(--text3)',transform:open?'rotate(180deg)':'none',transition:'transform 300ms cubic-bezier(.2,.8,.2,1)'}}/>
   </span>
   <span style={{display:'flex',flexDirection:'column',gap:4}}><span style={tw({fontSize:16,fontWeight:600,letterSpacing:'-0.01em',lineHeight:1.35,color:'var(--text)',textWrap:'pretty'})}>{w.title}</span>{w.summary?<span style={tw({color:'var(--text2)',textWrap:'pretty'})}>{w.summary}</span>:null}</span>
   {!open?<span style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>{steps.map((st,i)=><span key={i} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12,color:'var(--text3)'}}><I n={st.run?'circle-notch':st.done?'check':'circle'} style={{fontSize:12,color:st.run?'#ff9f0a':st.done?'var(--okText)':'var(--text3)',animation:st.run?'cmSpin 1s linear infinite':'none'}}/><span>{st.short}</span></span>)}</span>:null}
   {w.state==='running'?<span style={{display:'block',height:4,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={w.pct!==undefined?{display:'block',height:'100%',width:w.pct+'%',borderRadius:2,background:'#ff9f0a',transition:'width 600ms ease-out'}:{display:'block',height:'100%',width:'35%',borderRadius:2,background:'#ff9f0a',animation:'cmPulse 1.4s ease-in-out infinite'}}/></span>:null}
  </button>
  {open?<div style={{display:'flex',flexDirection:'column',gap:14,padding:'0 18px 16px',animation:'cmIn 300ms cubic-bezier(.2,.8,.2,1) both'}}>
   <div style={{display:'flex',flexDirection:'column'}}>{steps.map((st,i,a)=><div key={i} style={{display:'grid',gridTemplateColumns:'22px minmax(0,1fr)',gap:10}}>
    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><span style={{width:20,height:20,borderRadius:'50%',flex:'none',display:'flex',alignItems:'center',justifyContent:'center',background:st.run?'color-mix(in oklch, #ff9f0a 18%, transparent)':st.done?'var(--okSoft)':'var(--hover)',color:st.run?'#ff9f0a':st.done?'var(--okText)':'var(--text3)'}}><I n={st.run?'circle-notch':st.done?'check':'circle'} style={{fontSize:12}}/></span><span style={{flex:1,width:1.5,minHeight:8,background:i<a.length-1?'var(--line)':'transparent',margin:'2px 0'}}/></div>
    <div style={{display:'flex',flexDirection:'column',gap:1,padding:'1px 0 12px'}}><span style={{fontSize:13,fontWeight:500}}>{st.label}</span>{st.detail?<span style={tw({fontSize:12,color:'var(--text3)',textWrap:'pretty'})}>{st.detail}</span>:null}</div></div>)}</div>
   {w.visual?<WorkVis v={w.visual} zh={zh}/>:null}
   {w.error&&w.state!=='done'?<div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:w.state==='failed'||w.state==='file_failed'?'var(--errSoft)':'var(--warnSoft)',color:w.state==='failed'||w.state==='file_failed'?'var(--errText)':'var(--warnText)',fontSize:12}}>{w.error}</div>:null}
   {approval?<div style={{display:'flex',flexDirection:'column',gap:8,padding:'12px 14px',borderRadius:12,background:'var(--warnSoft)'}}>
    <span style={{fontSize:12,color:'var(--warnText)',fontWeight:500}}>{zh?'等待你批准这一步':'Waiting for your approval'}</span><span style={{fontSize:13,fontWeight:500}}>{approval.tool}</span>
    <pre style={{margin:0,fontSize:11,maxHeight:140,overflow:'auto',whiteSpace:'pre-wrap',color:'var(--text2)'}}>{JSON.stringify(approval.detail,null,2)}</pre>
    <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}><Hv disabled={!!busy} onClick={()=>void act('/api/chat/work/items/'+enc(w.id)+'/approvals/'+enc(approval.id),{decision:'deny'})} style={{...smallBtn,background:'transparent',color:'var(--text2)'}} hover={{background:'var(--hover)'}}>{zh?'拒绝':'Deny'}</Hv><Hv disabled={!!busy} onClick={()=>void act('/api/chat/work/items/'+enc(w.id)+'/approvals/'+enc(approval.id),{decision:'allow'})} style={{...smallBtn,background:'var(--accent)',color:'var(--onAccent)'}} hover={{background:'var(--accentHover)'}}>{zh?'允许本次':'Allow once'}</Hv></div>
   </div>:null}
   {/* Reference chosen block (R:688-690) for a consumed panel's actual selected option; no Undo (F5-3). */}
   {w.state==='chosen'&&w.chosen?<div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:12,background:'var(--okSoft)',animation:'cmPop 300ms cubic-bezier(.2,.8,.2,1) both'}}>
    <span style={{width:26,height:26,flex:'none',borderRadius:'50%',background:'var(--okDot)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="check" style={{fontSize:14}}/></span>
    <span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={tw({fontWeight:500,color:'var(--text)',textWrap:'pretty'})}>{w.chosen.label}</span>{w.chosen.summary?<span style={tw({fontSize:12,color:'var(--okText)',textWrap:'pretty'})}>{w.chosen.summary}</span>:null}</span>
   </div>:null}
   {opts.length?<div style={{display:'flex',flexDirection:'column',gap:6}}>
    {opts.map((c,ci)=>{const sel=ctx.pendPick?.k===c.pend.k&&ctx.pendPick.id===c.pend.id&&ctx.pendPick.i===ci;
     return <Hv key={c.key} onClick={(e:any)=>ctx.toComposer(e,w.title,c.label,c.pend)} style={{all:'unset',boxSizing:'border-box',cursor:'pointer',display:'flex',alignItems:'center',gap:10,minHeight:40,padding:'9px 14px',borderRadius:12,fontSize:14,fontWeight:sel?500:400,background:sel?'var(--accentSoft)':'var(--hover)',color:sel?'var(--accentText)':'var(--text)',boxShadow:sel?'inset 0 0 0 1.5px var(--accent)':'none',transition:'background 200ms, box-shadow 200ms, transform 200ms cubic-bezier(.2,.8,.2,1)'}} hover={{filter:'brightness(0.97)'}}>
      <span style={tw({flex:1,minWidth:0,textAlign:'left',textWrap:'pretty'})}>{c.label}</span>{c.rec?<span style={{height:20,padding:'0 8px',display:'inline-flex',alignItems:'center',borderRadius:10,background:'var(--card)',color:'var(--accentText)',fontSize:11,fontWeight:500,whiteSpace:'nowrap',boxShadow:'0 0 0 0.5px var(--line)'}}>{XL.recommended}</span>:null}<I n={sel?'check-circle':'arrow-up-right'} style={{fontSize:14,opacity:.7}}/></Hv>})}
    <div style={{display:'flex',gap:6,justifyContent:'flex-end',paddingTop:2}}><Hv onClick={(e:any)=>ctx.toComposer(e,w.title+'\n'+w.summary,XL.chatAbout(w.title))} style={{...smallBtn,background:'transparent',color:'var(--text2)'}} hover={{background:'var(--hover)',color:'var(--text)'}}><I n="chat-circle" style={{fontSize:14}}/><span>{XL.chatIt}</span></Hv></div>
   </div>:null}
   {/* The choice group (opts) carries the reference footer; this actions row is for work states without choices. */}
   {w.work&&!opts.length?<div style={{display:'flex',justifyContent:'flex-end',gap:6}}>
    {w.state==='running'?<Hv disabled={!!busy} onClick={()=>void act('/api/chat/work/items/'+enc(w.id)+'/stop')} style={{...smallBtn,background:'transparent',color:'var(--text2)'}} hover={{background:'var(--hover)'}}>{zh?'停止':'Stop'}</Hv>:null}
    {w.work.native&&w.state!=='done'?<Hv disabled={!!busy} onClick={()=>void act('/api/chat/work/items/'+enc(w.id)+'/recheck')} style={smallBtn} hover={{filter:'brightness(0.96)'}}>{ctx.T.checkAgain}</Hv>:null}
    {['failed','cancelled','interrupted'].includes(w.state)&&!w.work.native?<Hv disabled={!!busy} onClick={()=>void act('/api/chat/work/items/'+enc(w.id)+'/resume',{operationId:uid('resume')})} style={smallBtn} hover={{filter:'brightness(0.96)'}}>{w.state==='interrupted'?XL.wResume:ctx.T.retry}</Hv>:null}
    <Hv onClick={(e:any)=>ctx.toComposer(e,w.title+'\n'+w.summary,XL.chatAbout(w.title))} style={smallBtn} hover={{filter:'brightness(0.96)'}}><I n="chat-circle" style={{fontSize:14}}/><span>{XL.chatIt}</span></Hv>
   </div>:null}
  </div>:null}
 </Hv>;
}

/** Chat work status as a pill; unrecognised statuses are unknown, never shown as running. */
export function workPill(st:string):PillStatus{return ['completed','succeeded'].includes(st)?'done':['failed','file_failed'].includes(st)?'failed':st==='cancelled'?'cancelled':st==='interrupted'?'interrupted':st==='partial'?'partial':['queued','preparing'].includes(st)?'queued':['running','in_progress','writing_file','cancelling'].includes(st)?'running':'unknown'}
// Chat timeline card for a chat work item (V6 "Task created" event).
export function WorkEvent({ctx,work,label,onOpen}:{ctx:Ctx;work:any;label:string;onOpen:()=>void}){
 const {T}=ctx;const st=work.status;
 const s:PillStatus=workPill(st);
 const live=['queued','running'].includes(s);
 return <div style={{display:'flex',gap:10,alignItems:'flex-start'}}><div style={{flex:1,minWidth:0,maxWidth:'85%',background:'var(--aiBubble)',boxShadow:'0 0 0 0.5px var(--aiLine)',borderRadius:'var(--r-bubble)',padding:'12px 12px 12px 14px',display:'flex',flexDirection:'column',gap:10}}>
  <div style={{display:'flex',alignItems:'center',gap:12}}>
   <button type="button" onClick={onOpen} style={unset({all:'unset',cursor:'pointer',flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2})}><span style={{fontSize:12,color:'var(--text3)'}}>{label}</span><span style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{work.title}</span></button>
   <span style={pill(s)}>{T.ts[s]}</span>
   {work.native?.receipt?.approval?<Hv onClick={onOpen} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:14,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--accentHover)'}}>{T.review}</Hv>:null}
   {s==='failed'?<Hv onClick={async()=>{try{await api('POST','/api/chat/work/items/'+enc(work.id)+'/resume',{operationId:uid('resume')});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error')}}} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.retry}</Hv>:null}
  </div>
  {live&&ctx.ui.cfg.progress?<div style={{height:2,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><div style={{height:'100%',width:s==='queued'?'6%':'50%',background:'var(--accent)',transition:'width 250ms ease-out'}}/></div>:null}
 </div></div>;
}

export function TaskDetail({ctx,id,discuss}:{ctx:Ctx;id:string;discuss:(id:string)=>void}){
 const {ws,T,zh}=ctx;const [busy,setBusy]=useState(false);
 // The canonical email task of a V6 proposal (exact p.task.taskId, never its follow-up) opens the reference email task
 // detail with drafts, sends and result; a deleted task record stays a truthful unavailable state there.
 const prop=proposalForTask(ctx.ui.proposals,id);
 if(prop)return <ProposalTaskDetail ctx={ctx} p={prop} task={ws.tasks.find(t=>t.id===id)} discuss={discuss}/>;
 const work=(ws.work?.works||[]).find((w:any)=>w.id===id);const task=ws.tasks.find(t=>t.id===id)||(work?.task?.id?ws.tasks.find(t=>t.id===work.task.id):undefined);const auto=ws.automations.find(a=>a.id===id);
 const box:React.CSSProperties={background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'20px 20px 24px',display:'flex',flexDirection:'column',gap:22,animation:'cmSlide 250ms ease-out both'};
 if(!work&&!task&&!auto)return <div style={box}><div style={{color:'var(--text2)'}}>{zh?'这项任务已不存在或已被移除。':'This task no longer exists.'}</div></div>;
 const status:PillStatus=auto?'scheduled':work?workPill(String(work.status)):taskStatus(task);
 const steps=auto?(zh?['等待时间','执行','提醒你']:['Wait for schedule','Run','Tell you']):(zh?['已记录','进行中','完成']:['Captured','In progress','Done']);
 const step=status==='done'?3:['running','confirm','sending'].includes(status)?1:0;const live=['queued','running','sending'].includes(status);
 const ring=status==='failed'?'var(--errDot)':status==='confirm'?'var(--warnDot)':'var(--accent)';
 async function toggleDone(){if(!task)return;setBusy(true);const done=status!=='done';try{await api('PATCH','/api/tasks/'+enc(task.id),{status:done?'done':'in_progress',completed:done,baseUpdatedAt:task.updatedAt});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error');void ctx.refresh()}finally{setBusy(false)}}
 async function runNow(){if(!auto)return;setBusy(true);try{await api('POST','/api/automations/'+enc(auto.id)+'/run',{requestId:uid('automation')});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error')}finally{setBusy(false)}}
 const conv=(task as any)?.conversationId||work?.conversationId;
 const approval=work?.native?.receipt?.approval;
 // Reference onEdit attaches the task's source record; fall back to the task/work id itself.
 const srcIds:string[]=Array.isArray((task as any)?.sourceIds)?(task as any).sourceIds:[];
 const editRef=String((task as any)?.inboxId||srcIds[0]||task?.id||id);
 // Reference R897 always shows failure feedback when failed; use the first nonblank recorded error, else a neutral fallback.
 const failMsg=[work?.error,(task as any)?.error].map(e=>typeof e==='string'?e.trim():'').find(Boolean)||(zh?'执行失败，未返回具体原因。':'Failed. No reason was returned.');
 return <div style={box}>
  <div style={{display:'flex',flexDirection:'column',gap:10,alignItems:'flex-start'}}><span style={pill(status)}>{T.ts[status]}</span><div style={tw({fontSize:20,fontWeight:600,lineHeight:1.3,letterSpacing:'-0.01em',textWrap:'pretty'})}>{work?.title||task?.title||auto?.title}</div></div>
  <div style={{display:'flex',flexDirection:'column',gap:12}}><div style={{fontSize:12,color:'var(--text3)'}}>{T.stepsH}</div>
   {steps.map((label,i)=>{const done=status==='done'||i<step;const cur=!done&&i===step&&status!=='scheduled'&&status!=='queued';
    const mark:React.CSSProperties={width:16,height:16,borderRadius:'50%',flex:'none',display:'flex',alignItems:'center',justifyContent:'center',boxSizing:'border-box',transition:'all 250ms ease-out',...(done?{background:'var(--accent)',color:'var(--onAccent)'}:cur?{border:`1.5px solid ${ring}`,animation:live?'cmPulse 1.4s ease-in-out infinite':'none'}:{border:'1px solid var(--lineStrong)'})};
    return <div key={i} style={{display:'flex',alignItems:'center',gap:12}}><span style={mark}>{done?<I n="check" style={{fontSize:12}}/>:null}</span><span style={{color:done?'var(--text2)':cur?'var(--text)':'var(--text3)',fontWeight:cur?500:400}}>{label}</span></div>})}
  </div>
  {(task as any)?.followUp?<FollowUpControls ctx={ctx} taskId={task!.id}/>:null}
  {task?.notes?<div style={{display:'flex',flexDirection:'column',gap:6}}><div style={{fontSize:12,color:'var(--text3)'}}>{zh?'说明':'Notes'}</div><div style={{color:'var(--text2)'}}><Md text={task.notes}/></div></div>:null}
  {auto?<div style={{color:'var(--text2)'}}>{auto.schedule}{auto.nextRun?' · '+(zh?'下次 ':'Next ')+new Date(auto.nextRun).toLocaleString():''}{auto.lastRun?' · '+(zh?'上次 ':'Last ')+relTime(auto.lastRun,zh):''}</div>:null}
  {status==='failed'?<div style={{display:'flex',flexDirection:'column',gap:12}}><div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:'var(--errSoft)',color:'var(--errText)',fontSize:12}}>{failMsg}</div>{work?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}><Hv onClick={async()=>{try{await api('POST','/api/chat/work/items/'+enc(work.id)+'/resume',{operationId:uid('resume')});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error')}}} style={btn('primary')}>{T.retry}</Hv></div>:null}</div>:null}
  {/* Reference confirm block (R:887-892): Confirm plus "Edit in conversation" (onEdit = discuss of the source record, R:1468).
      Confirm exists only where a real approval exists (same allow-once API as the work card); Edit only attaches the
      record to the current composer owner and focuses it — nothing executes before an explicit Send. */}
  {status==='confirm'||approval?<div style={{display:'flex',gap:4,alignItems:'center',animation:'cmIn 250ms ease-out both'}}>
   {approval&&work?<Hv disabled={busy} onClick={async()=>{setBusy(true);try{await api('POST','/api/chat/work/items/'+enc(work.id)+'/approvals/'+enc(approval.id),{decision:'allow'});await ctx.refresh()}catch(e:any){ctx.notify(e.message,'error');void ctx.refresh()}finally{setBusy(false)}}} style={{...actBtn('primary'),marginRight:4}} hover={{background:'var(--accentHover)'}}>{zh?'允许本次':'Allow once'}</Hv>:null}
   <Hv onClick={()=>discuss(editRef)} style={{height:32,padding:'0 8px',border:'none',borderRadius:'var(--r-btn)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.editInConv}</Hv>
  </div>:null}
  {['unknown','partial'].includes(status)?<div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:'var(--warnSoft)',color:'var(--warnText)',fontSize:12}}>{status==='partial'?T.partialReply:T.unknownReply}</div>:null}
  {status==='done'&&work?.artifacts?.length?<div style={{display:'flex',flexDirection:'column',gap:6,animation:'cmIn 250ms ease-out both'}}><div style={{fontSize:12,color:'var(--okText)'}}>{T.resultH}</div>{work.artifacts.filter((a:any)=>!a.missing).map((a:any)=><a key={a.id} href={a.url||('/files/'+enc(a.id))} target="_blank" rel="noreferrer" style={{color:'var(--text2)'}}>{a.name}</a>)}</div>:null}
  <div style={{display:'flex',justifyContent:'flex-end',gap:6,flexWrap:'wrap'}}>
   {task&&!work&&!task.followUp?<Hv disabled={busy} onClick={()=>void toggleDone()} style={actBtn('sec')} hover={{background:'var(--selected)'}}>{status==='done'?(zh?'重新打开':'Reopen'):(zh?'标记完成':'Mark done')}</Hv>:null}
   {auto?<Hv disabled={busy} onClick={()=>void runNow()} style={actBtn('sec')} hover={{background:'var(--selected)'}}>{zh?'现在运行一次':'Run once now'}</Hv>:null}
   <Hv onClick={()=>{if(conv&&conv!==ctx.conversationId)ctx.setConversation(conv);ctx.jumpTo(m=>(m as any).chatWork?.workId===id||(m as any).contextIds?.includes?.(id));if(!conv)discuss(task?.id||id)}} style={{height:32,padding:'0 14px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}><I n="chat-circle" style={{fontSize:16}}/><span>{T.jumpConv}</span></Hv>
  </div>
 </div>;
}
