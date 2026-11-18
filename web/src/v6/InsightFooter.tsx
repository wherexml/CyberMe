// One quiet row at the end of the 洞察 feed: 刷新洞察 · 忽略与推迟. Spec and failure cases: docs/public/insight-footer.md.
// Every action calls an existing endpoint once. A lost response is read back, never replayed; restore never completes work.
import React,{useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {Ctx} from './App';
import {Hv} from './ui';
import {api,enc,uid,setUI} from './store';
import {fmtStamp} from './model';
import {ideaAttentionCall} from './attention';
import {inboxAttention,snoozeActive} from '../../../shared/inbox-attention';

// ---------- Module state: survives tab switches and remounts; each action carries its own generation.
type Counts={created?:number;updated?:number;merged?:number;archived?:number};
// `action` keeps the purpose of the row's current or last operation, so a busy label never names another action.
type RowAction='restore'|'ignore'|'check';
type RowState={phase:'busy'|'conflict'|'failed'|'unknown';action:RowAction;detail?:string;gen:number;op:string;started:number};
// failed always means a POST is safe again (nothing sent, or the server reports a finished, non-running failure); anything else uncertain is unknown.
type RefreshState={phase:'idle'|'running'|'checking'|'done'|'failed'|'unknown';gen:number;counts?:Counts;baseline?:string;baselineRunning?:boolean;startedAt?:number;expectRun?:string};
// visual: an explicit retry of withheld insight visuals (docs/public/insight-visuals.md); read back through the workspace, never replayed.
type VisualRetry={phase:'idle'|'running';gen:number;status?:number};
let gen=0,snapshot:{rows:Record<string,RowState>;refresh:RefreshState;visual:VisualRetry}={rows:{},refresh:{phase:'idle',gen:0},visual:{phase:'idle',gen:0}};
let reload:Ctx['refresh']=async()=>{};
const listeners=new Set<()=>void>();
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}};
const commit=(next:Partial<typeof snapshot>)=>{snapshot={...snapshot,...next};listeners.forEach(fn=>fn())};
const setRow=(key:string,value:RowState|null)=>{const rows={...snapshot.rows};if(value)rows[key]=value;else delete rows[key];commit({rows})};
const sync=async()=>{try{await reload(true)}catch{}};

// ---------- History rows from the loaded workspace. Identity is kind:id; nothing is truncated.
type Verify=(op:string,started:number)=>Promise<boolean>;
type Row={key:string;title:string;label:string;state:'snoozed'|'elapsed'|'untimed'|'dismissed'|'local';group:number;order:number;
 restore:(op:string)=>Promise<unknown>;verify?:Verify;ignore?:{run:(op:string)=>Promise<unknown>;verify:Verify}};
const time=(v:unknown)=>{const t=Date.parse(String(v??''));return Number.isFinite(t)?t:undefined};
const dropLocal=(id:string)=>setUI(st=>{const gal={...st.gal};delete gal[id];return {gal}});
const readInbox=(id:string)=>api<any>('GET','/api/inbox/'+enc(id));
const readIdea=(id:string)=>api<any>('GET','/api/ideas/'+enc(id));

export function historyRows(ctx:Ctx,now=Date.now()):Row[]{
 const {ws,ui,XL,zh}=ctx,out:Row[]=[],stamp=(v:unknown)=>fmtStamp(v,zh),join=(...p:string[])=>p.filter(Boolean).join(' · ');
 for(const i of (ws.inbox||[]) as any[]){
  // Only records that are still hidden: a forwarded, expired or re-surfaced record is not a restore candidate.
  let hidden=false;try{hidden=inboxAttention(i).surface==='none'}catch{}
  if(!hidden)continue;
  const base={key:'inbox:'+i.id,title:String(i.title||'')};
  if(i.status==='dismissed'&&i.attentionDismissal?.id&&!i.forwardedRequestId){
   const d=i.attentionDismissal;
   out.push({...base,state:'dismissed',label:join(XL.histDismissed,stamp(d.dismissedAt)),group:2,order:-(time(d.dismissedAt)??0),
    restore:()=>api('POST','/api/inbox/'+enc(i.id)+'/attention-dismissal/undo',{dismissalId:d.id,baseUpdatedAt:i.updatedAt}),
    verify:async()=>{const r=await readInbox(i.id);return r.attentionDismissalUndone?.id===d.id}});
  }else if(i.status!=='dismissed'&&snoozeActive(i,now)){
   const s=i.attentionSnooze;
   out.push({...base,state:'snoozed',label:XL.histSnoozed(stamp(s.until)),group:0,order:time(s.until)!,
    restore:()=>api('POST','/api/inbox/'+enc(i.id)+'/attention-snooze/undo',{operationId:s.operationId}),
    verify:async()=>{const r=await readInbox(i.id);return !r.attentionSnooze}}); // A different, newer snooze is not proof that ours was undone.
  }
 }
 const local=ui.gal||{};
 for(const i of (ws.ideas||[]) as any[]){
  const base={key:'idea:'+i.id,title:String(i.title||'')};
  if(i.status==='dismissed'||i.status==='deferred'){
   const restore=(op:string)=>ideaAttentionCall(i,'restore',op).then(()=>dropLocal(i.id));
   const verify:Verify=async(_op,started)=>{const r=await readIdea(i.id);const ok=!['dismissed','deferred'].includes(r.status)&&(time(r.restoredAt)??0)>=started-5000;if(ok)dropLocal(i.id);return ok};
   if(i.status==='dismissed'){const at=i.attentionAction?.kind==='dismiss'?i.attentionAction.at:undefined;out.push({...base,state:'dismissed',label:join(XL.histDismissed,stamp(at)),group:2,order:-(time(at)??0),restore,verify});continue}
   const until=time(i.deferredUntil);
   // A legacy deferral without a time is labelled as such; no wake date is invented.
   if(until===undefined)out.push({...base,state:'untimed',label:XL.histUntimed,group:1,order:Number.MAX_SAFE_INTEGER,restore,verify});
   else if(until>now)out.push({...base,state:'snoozed',label:XL.histSnoozed(stamp(i.deferredUntil)),group:0,order:until,restore,verify});
   else out.push({...base,state:'elapsed',label:XL.histElapsed(stamp(i.deferredUntil)),group:1,order:until,restore,verify});
  }else if(i.status==='new'&&local[i.id]){
   // Local-only mark: restore removes ui.gal only; an explicit 忽略 alone writes the server dismissal.
   out.push({...base,state:'local',label:XL.histLocal,group:3,order:0,restore:async()=>dropLocal(i.id),
    ignore:{run:op=>ideaAttentionCall(i,'dismiss',op).then(()=>dropLocal(i.id)),verify:async op=>{const r=await readIdea(i.id);const ok=r.attentionAction?.operationId===op&&r.status==='dismissed';if(ok)dropLocal(i.id);return ok}}});
  }
 }
 return out.sort((a,b)=>a.group-b.group||a.order-b.order);
}

async function runRow(key:string,action:'restore'|'ignore',work:(op:string)=>Promise<unknown>,verify?:Verify){
 if(snapshot.rows[key]?.phase==='busy')return;
 const my=++gen,op=uid('footer'),started=Date.now();
 setRow(key,{phase:'busy',action,gen:my,op,started});
 let next:RowState|null=null;
 try{await work(op)}
 catch(e:any){
  if(e?.status===409)next={phase:'conflict',action,gen:my,op,started};
  else if(e?.status)next={phase:'failed',action,detail:e.message,gen:my,op,started};
  else{let ok=false;try{ok=!!verify&&await verify(op,started)}catch{}if(!ok)next={phase:'unknown',action,gen:my,op,started}}
 }
 await sync();
 if(snapshot.rows[key]?.gen===my)setRow(key,next);
}
/** GET only. Not finding our change is not proof the lost request never arrived, so the row stays unconfirmed. */
async function checkRow(key:string,verify?:Verify){
 const cur=snapshot.rows[key];if(!cur||cur.phase!=='unknown'||!verify)return;
 const my=++gen;setRow(key,{...cur,phase:'busy',action:'check',gen:my});
 let next:RowState|null={...cur,phase:'unknown',action:'check',gen:my};
 try{if(await verify(cur.op,cur.started))next=null}catch{}
 await sync();
 if(snapshot.rows[key]?.gen===my)setRow(key,next);
}

// ---------- Refresh: one real model run per click; outcome from the server's own counts and run ID.
const background=()=>api<any>('GET','/api/ideas/background');
async function readback(s:RefreshState):Promise<Partial<RefreshState>>{
 let bg:any;try{bg=await background()}catch{return {phase:'unknown'}}
 // readbackRequired names its run: only that run, succeeded, confirms it.
 if(s.expectRun)return bg.runId===s.expectRun&&bg.status==='succeeded'?{phase:'done',counts:bg.counts}:{phase:'unknown'};
 if(bg.status==='running')return {phase:'unknown'};
 // An unchanged baseline is neither confirmation nor proof that the request never arrived.
 const ours=bg.runId!==s.baseline||s.baselineRunning;
 if(!ours)return {phase:'unknown'};
 if(bg.status==='succeeded'&&(time(bg.completedAt)??0)>=(s.startedAt||0))return {phase:'done',counts:bg.counts};
 if(bg.status==='failed')return {phase:'failed'};
 return {phase:'unknown'};
}
export const canRefresh=(r:RefreshState)=>r.phase==='idle'||r.phase==='done'||r.phase==='failed';
// Canonical background status (bootstrap ideasBackground, refreshed by the existing 15s workspace reload; no extra poll) is read only
// while no local operation owns the footer: local running/checking/unknown keep priority and their readback rules
// (docs/public/insight-reliability.md). Unknown after a restart is retryable but never shown as success.
export function footerView(r:RefreshState,bg:any){
 const after=(v:unknown)=>(time(v)??0)>=(r.startedAt||0),bgRunning=bg?.status==='running';
 let phase:RefreshState['phase']=r.phase,retry=r.phase==='failed',code:string|undefined,source:'local'|'background'='local';
 if((r.phase==='idle'||r.phase==='done')&&bg&&(r.phase==='idle'||after(bg.lastFailedAt)||after(bg.completedAt))){
  if(bg.status==='failed'||bg.status==='unknown'){phase='failed';retry=true;source='background';code=String((bg.status==='unknown'?bg.error:bg.lastError||bg.error)||bg.status)}
  else if(bgRunning&&bg.lastError){phase='failed';retry=false;source='background';code=String(bg.lastError)}
 }else if(r.phase==='failed'){
  if(bg?.status==='succeeded'&&!bg.lastError&&after(bg.lastSuccessAt))phase='idle';
  else{if(bgRunning)retry=false;if(bg?.lastError&&after(bg.lastFailedAt))code=String(bg.lastError)}
 }
 return {phase,retry,code,source,bgRunning};
}
async function startRefresh(){
 if(!canRefresh(snapshot.refresh))return;
 const my=++gen;let s:RefreshState={phase:'running',gen:my,startedAt:Date.now()};commit({refresh:s});
 // Without a baseline a lost response could never be resolved, so a failed preflight read stops before any POST.
 try{const b=await background();s={...s,baseline:b?.runId,baselineRunning:b?.status==='running'}}
 catch{if(snapshot.refresh.gen===my)commit({refresh:{...s,phase:'failed',gen:my}});return}
 let out:Partial<RefreshState>;
 try{
  const r:any=await api('POST','/api/ideas/refresh',{});
  if(r?.readbackRequired){s={...s,expectRun:String(r.run?.id||'')};out=await readback(s)}
  else out={phase:'done',counts:r?.counts||{}};
 }catch(e:any){
  // A refusal is final only once the server shows nothing running; otherwise check again, never re-POST.
  if(e?.status){let bg:any;try{bg=await background()}catch{}out=bg&&bg.status!=='running'?{phase:'failed'}:{phase:'unknown'}}
  else out=await readback(s);
 }
 await sync();
 if(snapshot.refresh.gen===my)commit({refresh:{...s,...out,gen:my}});
}
async function checkRefresh(){
 const cur=snapshot.refresh;if(cur.phase!=='unknown')return;
 const my=++gen;commit({refresh:{...cur,phase:'checking',gen:my}});
 const out=await readback(cur);
 await sync();
 if(snapshot.refresh.gen===my)commit({refresh:{...cur,...out,gen:my}});
}

/** One bounded POST for the withheld ids (≤6, retry:true). The server keeps attempt limits; the outcome is read back via the workspace. */
async function retryVisuals(ids:string[]){
 if(snapshot.visual.phase==='running'||!ids.length)return;
 const my=++gen;commit({visual:{phase:'running',gen:my}});
 let status:number|undefined;
 try{await api('POST','/api/ideas/visuals/generate',{ids:ids.slice(0,6),retry:true})}catch(e:any){status=e?.status||0}
 await sync();
 if(snapshot.visual.gen===my)commit({visual:{phase:'idle',gen:my,status}});
}
// Every withheld new-cohort insight keeps one visible line (the server limits publication to that cohort). Retry is offered only for
// rows the server marks retryable and none is running; terminal rows stay visible without an action.
export function withheldVisuals(ws:any):{held:boolean;ids:string[];running:boolean;cause?:string}{
 const items=Object.entries((ws?.insightVisuals||{}) as Record<string,any>).filter(([,v])=>!!v?.publication).sort(([a],[b])=>a.localeCompare(b));
 const running=items.some(([,v])=>v.publication.running);
 return {held:items.length>0,ids:running?[]:items.filter(([,v])=>v.publication.retryable).map(([id])=>id),running,cause:items[0]?.[1]?.publication?.cause||undefined};
}

// ---------- View
// Approved compact footer metrics: 12px text, 8px horizontal padding; scoped to this footer.
const quiet:React.CSSProperties={height:28,padding:'0 8px',border:'none',borderRadius:14,background:'transparent',color:'var(--text2)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',flex:'none'};
const small:React.CSSProperties={...quiet,height:26,padding:'0 10px',borderRadius:13};

export function InsightFooter({ctx}:{ctx:Ctx}){
 const {XL,T}=ctx;reload=ctx.refresh;
 const state=useSyncExternalStore(subscribe,()=>snapshot);
 const rows=historyRows(ctx);
 const [open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null),refreshBtn=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null),had=useRef(rows.length);
 // Reveal the first complete row with the least scroll of the right panel only; the chat column never moves.
 useLayoutEffect(()=>{
  if(!open)return;const row=list.current?.firstElementChild as HTMLElement|null,scroll=root.current?.closest<HTMLElement>('.cm-scroll');
  if(!row||!scroll)return;const r=row.getBoundingClientRect(),v=scroll.getBoundingClientRect();
  if(r.bottom>v.bottom)scroll.scrollTop+=Math.min(r.bottom-v.bottom+8,Math.max(0,r.top-v.top));
 },[open]);
 // Last row restored: collapse, hide the entry and keep keyboard focus in the footer unless it is elsewhere (e.g. composer).
 useEffect(()=>{
  if(had.current>0&&rows.length===0){
   if(open)setOpen(false);
   const a=document.activeElement;if(!a||a===document.body||root.current?.contains(a))refreshBtn.current?.focus({preventScroll:true});
  }
  had.current=rows.length;
 },[rows.length,open]);
 const r=state.refresh,v=footerView(r,(ctx.ws as any).ideasBackground),running=r.phase==='running'||r.phase==='checking'||v.bgRunning;
 // Counts decide the copy only; the product shows no statistics.
 const changed=(['created','updated','merged','archived'] as const).some(k=>(r.counts?.[k]||0)>0);
 const status=v.phase==='done'?(changed?XL.insightsUpdated:XL.noNewInsights):v.phase==='failed'?XL.refreshFailed:v.phase==='unknown'?XL.unconfirmed:'';
 const tone=v.phase==='failed'?'var(--errText)':v.phase==='unknown'?'var(--warnText)':'var(--text3)';
 // Insight-refresh status keeps priority; otherwise a withheld new insight with a retryable visual failure gets one concise line.
 // Main-operation states that must stay in front: running/checking (incl. background running), unknown and failed. A positive
 // done result never masks a later withheld new-cohort insight (docs/public/insight-visuals.md case 11); idle shows nothing anyway.
 const mainFirst=running||v.phase==='failed'||v.phase==='unknown';
 const held=mainFirst?{held:false,ids:[] as string[],running:false,cause:undefined}:withheldVisuals(ctx.ws),visualBusy=!mainFirst&&state.visual.phase==='running';
 const visualLine=held.held||visualBusy,mainLine=!!status&&(mainFirst||!visualLine);
 return <div ref={root} data-insight-footer style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
  <div data-footer-row style={{display:'flex',alignItems:'center',justifyContent:'center',flexWrap:'nowrap',gap:2,maxWidth:'100%'}}>
   <Hv ref={refreshBtn} data-footer-refresh aria-busy={running||undefined} disabled={!canRefresh(r)||v.bgRunning} onClick={()=>void startRefresh()} style={quiet} hover={{background:'var(--hover)',color:'var(--text)'}}>{running?XL.refreshing:XL.refresh}</Hv>
   {rows.length?<><span aria-hidden="true" style={{color:'var(--text3)',fontSize:12,flex:'none'}}>·</span>
    <Hv data-footer-history aria-expanded={open} aria-controls="cm-insight-history" onClick={()=>setOpen(x=>!x)} style={quiet} hover={{background:'var(--hover)',color:'var(--text)'}}>{XL.history}</Hv></>:null}
  </div>
  {mainLine?<div data-footer-status={v.phase} data-footer-source={v.source} data-footer-error={v.code} role={v.phase==='failed'?'alert':'status'} style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'center',fontSize:12,color:tone,textAlign:'center'}}>
   <span>{status}</span>
   {v.phase==='failed'&&v.retry?<Hv data-footer-retry onClick={()=>void startRefresh()} style={small} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.retry}</Hv>:null}
   {v.phase==='unknown'?<Hv data-footer-check onClick={()=>void checkRefresh()} style={small} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.checkAgain}</Hv>:null}
  </div>:null}
  {!mainLine&&visualLine?<div data-footer-status={visualBusy?'running':'failed'} data-footer-source="visual" data-footer-error={held.cause} data-footer-retrying={held.running||undefined} role={visualBusy?'status':'alert'} style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'center',fontSize:12,color:visualBusy?'var(--text3)':'var(--errText)',textAlign:'center'}}>
   <span>{visualBusy?XL.refreshing:XL.visualIncomplete}</span>
   {!visualBusy&&held.ids.length?<Hv data-footer-visual-retry onClick={()=>void retryVisuals(held.ids)} style={small} hover={{background:'var(--hover)',color:'var(--text)'}}>{T.retry}</Hv>:null}
  </div>:null}
  {open&&rows.length?<div ref={list} id="cm-insight-history" role="list" data-insight-history style={{alignSelf:'stretch',display:'flex',flexDirection:'column'}}>
   {rows.map(row=><HistoryRow key={row.key} ctx={ctx} row={row} st={state.rows[row.key]}/>)}
  </div>:null}
 </div>;
}

function HistoryRow({ctx,row,st}:{ctx:Ctx;row:Row;st?:RowState}){
 const {XL,T,zh}=ctx,busy=st?.phase==='busy',unknown=st?.phase==='unknown',doing=busy?st!.action:undefined;
 // An unconfirmed row, or one being re-checked, offers only the GET-only check.
 const checking=unknown||doing==='check';
 // Server refusal text is Chinese; show it only in the Chinese UI.
 // Error copy follows the action that failed: an ignore is never reported as a restore.
 const ignored=st?.action==='ignore';
 const message=st?.phase==='conflict'?(ignored?XL.ignoreConflict:XL.restoreConflict):st?.phase==='failed'?(ignored?XL.ignoreFailed:XL.restoreFailed)+(zh&&st.detail?'：'+st.detail:''):unknown?XL.unconfirmed:'';
 // Local restore cannot be lost in transit; only its explicit 忽略 can be unconfirmed.
 const verify=row.ignore?row.ignore.verify:row.verify;
 const main=doing==='restore'?XL.restoring:doing==='check'?T.checking:checking?T.checkAgain:XL.bringBack;
 return <div role="listitem" data-history-row={row.key} data-history-state={row.state} data-history-busy={doing} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',fontSize:13,color:'var(--text2)',flexWrap:'wrap'}}>
  <span style={{flex:'1 1 160px',minWidth:0,display:'flex',flexDirection:'column',gap:2}}>
   <span style={{color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.title}</span>
   <span data-history-label style={{fontSize:12,color:'var(--text3)'}}>{row.label}</span>
   {message?<span role="alert" style={{fontSize:12,color:unknown?'var(--warnText)':'var(--errText)'}}>{message}</span>:null}
  </span>
  {row.ignore&&!checking?<Hv data-action="dismiss" disabled={busy} aria-busy={doing==='ignore'||undefined} onClick={()=>void runRow(row.key,'ignore',row.ignore!.run,row.ignore!.verify)} style={small} hover={{background:'var(--hover)',color:'var(--text)'}}>{doing==='ignore'?XL.ignoring:T.dismiss}</Hv>:null}
  <Hv data-action={checking?'check':'restore'} disabled={busy} aria-busy={(doing==='restore'||doing==='check')||undefined} onClick={()=>void (checking?checkRow(row.key,verify):runRow(row.key,'restore',row.restore,row.verify))} style={{...small,color:'var(--accent)'}} hover={{background:'var(--hover)'}}>{main}</Hv>
 </div>;
}
