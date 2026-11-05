import React,{useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {Message} from '../../../shared/types';
import {THEMES} from './theme';
import {L,X,type Lang} from './strings';
import {I} from './icons';
import {Hv} from './ui';
import {Buddy,BUDDY} from './Buddy';
import {Md} from './md';
import {api,enc,uid,getUI,setUI,subscribeUI,loadWorkspace,loadWork,loadMessages,startChat,retryChat,recover,resumeChats,inFlight,unsent,uiError,type DraftPick,type DraftState,type Workspace,type ChatRecord,type UIState} from './store';
import {decisions,insights,gallery,mood,relTime} from './model';
import {installWindowChrome,isNative} from './native';
import Brief,{InsightDetail} from './Brief';
import Tasks,{TaskDetail,WorkEvent} from './Tasks';
import Memory from './Memory';
import Settings from './Settings';
import {ProposalBlocks,propose} from './Proposal';

export type Pend=DraftPick
export type Detail={type:'ins'|'task'|'dec';id:string}|null;
export interface Ctx{ws:Workspace;ui:UIState;zh:boolean;lang:Lang;T:typeof L.en;XL:typeof X.en;refresh:()=>Promise<void>;notify:(m:string,tone?:'error'|'ok')=>void;
 toComposer:(e:any,quote:string,draft:string,pend?:Pend|null,refs?:string[])=>void;prompt:(e:any,ref:string,text:string)=>void;
 openTab:(t:UIState['tab'])=>void;goSet:(page:string|null,sub?:any)=>void;openDetail:(d:Detail)=>void;jumpTo:(match:(m:Message)=>boolean)=>void;
 /** Reference hover quote control (R:1946-1952) for timeline rows rendered outside App (proposal/result). */
 quoteRow:(id:string,text:string)=>{row:{onMouseEnter:()=>void;onMouseLeave:()=>void};btn:React.ReactElement};
 /** Exact jump to a proposal's timeline block (reference jumpTo flash), switching conversation first when needed. */
 jumpToProposal:(pid:string,conversationId?:string|null)=>void;
 pendPick:Pend|null;conversationId:string|null;propose:(itemIds:string[])=>void;setConversation:(id:string|null)=>void;setPage:string|null;setSub:any;buddy:BuddyApi;setLanguage:(l:Lang)=>Promise<void>}
export interface BuddyApi{k:string;hop:number;happy:boolean;pick:boolean;poke:(e?:any)=>void;togglePick:(e?:any)=>void;choose:(k:string,e?:any)=>void}

const QUOTE_RE=/^((?:> ?.*(?:\n|$))+)\n?/;
export function splitQuote(content:string){const m=String(content||'').match(QUOTE_RE);if(!m)return {quote:'',text:content};return {quote:m[1].split('\n').map(l=>l.replace(/^> ?/,'')).join('\n').trim(),text:content.slice(m[0].length)};}
const dayKey=(v?:string)=>v?new Date(v).toDateString():'';
const hhmm=(v?:string)=>v?new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}):'';

export default function App(){
 const ui=useSyncExternalStore(subscribeUI,getUI);
 const [ws,setWs]=useState<Workspace|null>(null),[offline,setOffline]=useState('');
 const [vw,setVw]=useState(window.innerWidth);
 const [toast,setToast]=useState<{m:string;tone:string}|null>(null);
 const latestRevision=useRef(0);
 const refresh=useCallback(async()=>{
  try{const data=await loadWorkspace();if(Number(data.revision)<latestRevision.current)return;latestRevision.current=Number(data.revision)||latestRevision.current;
   const cid=getUI().conversationId||data.primaryConversationId;if(cid){try{data.work=await loadWork(cid)}catch{data.work={panels:[],works:[]}}}
   setWs(data);setOffline('')}catch(e:any){setOffline(e.message||'offline')}
 },[]);
 useEffect(()=>{void refresh();resumeChats();const t=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},15000);const r=()=>setVw(window.innerWidth);addEventListener('resize',r);return()=>{clearInterval(t);removeEventListener('resize',r)}},[refresh]);
 const zh=(ws?.settings.identity.language||document.documentElement.lang)==='zh-CN';const lang:Lang=zh?'zh':'en';const T=L[lang],XL=X[lang];
 useEffect(()=>{document.documentElement.lang=zh?'zh-CN':'en';document.title='CyberMe'},[zh]);
 const notify=useCallback((m:string,tone:'error'|'ok'='ok')=>{setToast({m,tone});setTimeout(()=>setToast(t=>t?.m===m?null:t),tone==='error'?4200:2200)},[]);
 if(!ws)return <Frame theme={ui.theme}><div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,color:'var(--text2)'}}>
  <Buddy k={ui.buddy} S={52} hop={0} curHop={0} happy={false}/>{offline?<><span>{T.offline}</span><span style={{fontSize:12,color:'var(--text3)'}}>{offline}</span><Hv onClick={()=>void refresh()} style={{height:32,padding:'0 14px',border:'none',borderRadius:'var(--r-btn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:14,fontWeight:500,cursor:'pointer'}} hover={{background:'var(--accentHover)'}}>{T.reconnect}</Hv></>:<span>{T.loading}</span>}</div></Frame>;
 return <Shell ws={ws} ui={ui} zh={zh} lang={lang} T={T} XL={XL} vw={vw} refresh={refresh} notify={notify} toast={toast} offline={offline}/>;
}

function Frame({theme,children,winRef}:{theme:keyof typeof THEMES;children:React.ReactNode;winRef?:React.Ref<HTMLDivElement>}){
 const native=isNative();
 const root:React.CSSProperties={...THEMES[theme] as any,minHeight:'100vh',height:native?'100vh':undefined,boxSizing:'border-box',padding:native?0:'16px 24px 24px',display:'flex',flexDirection:'column',gap:14,background:'var(--desk)',fontFamily:'var(--font)',color:'var(--text)',fontSize:14,lineHeight:1.5,WebkitFontSmoothing:'antialiased',transition:'background 250ms ease-out, color 250ms ease-out'};
 const win:React.CSSProperties=native?{width:'100%',height:'100%',display:'flex',overflow:'hidden',background:'var(--convBg)',transition:'background 250ms ease-out'}
  :{width:'100%',maxWidth:1360,margin:'0 auto',height:'min(860px, calc(100vh - 40px))',minHeight:620,display:'flex',borderRadius:'var(--r-win)',overflow:'hidden',background:'var(--convBg)',boxShadow:'var(--winShadow)',transition:'background 250ms ease-out'};
 return <div id="cyberme-v6-root" data-theme={theme} style={root}><div data-screen-label="CyberMe window" ref={winRef} style={win}>{children}</div></div>;
}

function Shell({ws,ui,zh,lang,T,XL,vw,refresh,notify,toast,offline}:{ws:Workspace;ui:UIState;zh:boolean;lang:Lang;T:typeof L.en;XL:typeof X.en;vw:number;refresh:()=>Promise<void>;notify:Ctx['notify'];toast:{m:string;tone:string}|null;offline:string}){
 const native=isNative();
 const winRef=useRef<HTMLDivElement>(null),scrollRef=useRef<HTMLDivElement>(null),taRef=useRef<HTMLTextAreaElement>(null),fileRef=useRef<HTMLInputElement>(null);
 const conversationId=ui.conversationId||ws.primaryConversationId||null;
 // ----- conversation -----
 // History is owned by one visit of one conversation: a conversation change starts a new visit, so the previous thread neither renders nor merges into the next one.
 const visit=useRef({cid:conversationId,n:0});if(visit.current.cid!==conversationId)visit.current={cid:conversationId,n:visit.current.n+1};
 const [thread,setThread]=useState<{visit:number;items:Message[]}>({visit:-1,items:[]}),[hasMore,setHasMore]=useState(false),[loadingOlder,setLoadingOlder]=useState(false);
 const threadRef=useRef(thread);threadRef.current=thread;
 const msgs=thread.visit===visit.current.n?thread.items:[];
 // Every request gets a sequence number; within a visit a response is dropped only if a later-started one was already accepted, so overlapping slow polls cannot starve history.
 const msgGen=useRef(0),accepted=useRef({visit:-1,g:0});
 const convRef=useRef(conversationId);convRef.current=conversationId;
 // Cached older pages keep ordinary messages, but Inbox/Ideas analysis projections the server has withdrawn are dropped.
 const loadThread=useCallback(async(keep=false)=>{const v=visit.current.n;if(!conversationId){setThread({visit:v,items:[]});setHasMore(false);return}const g=++msgGen.current;try{const page=await loadMessages(conversationId);if(convRef.current!==conversationId||visit.current.n!==v||(accepted.current.visit===v&&g<accepted.current.g))return;accepted.current={visit:v,g};const owned=threadRef.current.visit===v;
  const known=Array.isArray(page.inboxAnalysisIds)&&Array.isArray(page.ideaAnalysisIds)?new Set([...page.inboxAnalysisIds!,...page.ideaAnalysisIds!]):null;
  const withdrawn=(m:any)=>!!known&&(m.inboxAnalysis?.kind==='inbox-analysis-v1'||m.ideaAnalysis?.kind==='idea-insight-v1')&&!known.has(m.id);
  setThread(t=>{const prev=t.visit===v?t.items:[];if(!keep||t.visit!==v)return {visit:v,items:page.items};const ids=new Set(page.items.map(m=>m.id));const older=prev.filter(m=>!ids.has(m.id)&&!withdrawn(m)&&(!page.items[0]||String(m.createdAt)<String(page.items[0].createdAt)));return {visit:v,items:[...older,...page.items]}});if(!keep||!owned)setHasMore(page.hasMore)}catch{}},[conversationId]);
 useEffect(()=>{void loadThread(false);const t=setInterval(()=>{if(document.visibilityState==='visible')void loadThread(true)},15000);return()=>clearInterval(t)},[loadThread]);
 const reqKey=ui.requests.filter(r=>r.conversationId===conversationId||!r.conversationId).map(r=>r.requestId+r.status).join();
 useEffect(()=>{void loadThread(true);void refresh()},[reqKey]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const live=ui.requests.some(r=>(r.conversationId===conversationId||!r.conversationId)&&inFlight(r))||(ws.work?.works||[]).some((w:any)=>['queued','preparing','running','in_progress','writing_file'].includes(w.status));if(!live)return;const t=setInterval(()=>{void loadThread(true);void refresh()},4000);return()=>clearInterval(t)},[reqKey,ws.work,conversationId,loadThread,refresh]);// eslint-disable-line react-hooks/exhaustive-deps
 async function older(){if(!conversationId||!msgs[0]||loadingOlder)return;const cid=conversationId,v=visit.current.n;setLoadingOlder(true);const el=scrollRef.current,h=el?.scrollHeight||0;try{const page=await loadMessages(cid,msgs[0].id);if(convRef.current!==cid||visit.current.n!==v)return;setThread(t=>t.visit!==v?t:{visit:v,items:[...page.items.filter(m=>!t.items.some(x=>x.id===m.id)),...t.items]});setHasMore(page.hasMore);requestAnimationFrame(()=>{if(el)el.scrollTop=el.scrollHeight-h})}catch{}finally{setLoadingOlder(false)}}

 // ----- composer (draft per conversation, persisted debounced) -----
 const dkey=conversationId||'_new';const saved:DraftState=ui.drafts[dkey]||{text:'',quote:null,refs:[]};
 const [draft,setDraft]=useState(saved.text),[quote,setQuote]=useState<string|null>(saved.quote),[refs,setRefs]=useState<string[]>(saved.refs),[attachments,setAttachments]=useState<{id:string;name:string}[]>([]);
 // The hidden pick binding and the automatic fragment are saved with the draft of their owner, so a reload or a
 // conversation switch keeps the record context of an unsent choice without showing it as a chip.
 const autoFill=useRef<string|null>(saved.auto||null);
 const [pendPick,setPendPick]=useState<Pend|null>(saved.pick||null);
 type Snap={draft:string;quote:string|null;refs:string[];pick:Pend|null;auto:string|null};
 const owner=useRef(dkey);const latest=useRef<Snap>({draft,quote,refs,pick:saved.pick||null,auto:autoFill.current});
 const saveDraft=(k:string,v:Snap)=>{const cur=getUI().drafts[k];const next:DraftState={text:v.draft,quote:v.quote,refs:v.refs,pick:v.pick,auto:v.draft?v.auto:null};
  if(cur&&JSON.stringify({...cur,pick:cur.pick||null,auto:cur.auto||null})===JSON.stringify(next))return;if(!cur&&!v.draft&&!v.quote&&!v.refs.length&&!v.pick)return;setUI(s=>({drafts:{...s.drafts,[k]:next}}))};
 useEffect(()=>{const k=dkey;return()=>saveDraft(k,latest.current)},[dkey]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{owner.current=dkey;const s:DraftState=getUI().drafts[dkey]||{text:'',quote:null,refs:[]};setDraft(s.text);setQuote(s.quote);setRefs(s.refs);setPendPick(s.pick||null);autoFill.current=s.auto||null;setAttachments([])},[dkey]);
 useEffect(()=>{const k=dkey;const t=setTimeout(()=>{if(owner.current===k)saveDraft(k,{draft,quote,refs,pick:pendPick,auto:autoFill.current})},400);return()=>clearTimeout(t)},[draft,quote,refs,pendPick,dkey]);// eslint-disable-line react-hooks/exhaustive-deps
 const [menu,setMenu]=useState(false),[cFlash,setCFlash]=useState(false),[showDown,setShowDown]=useState(false),[hoverMid,setHoverMid]=useState<string|null>(null),[sel,setSel]=useState<{text:string;x:number;y:number}|null>(null),[flash,setFlash]=useState<string|null>(null),[uploading,setUploading]=useState(false);
 latest.current={draft,quote,refs,pick:pendPick,auto:autoFill.current};
 const focus=()=>setTimeout(()=>taRef.current?.focus(),30);
 // ----- panel -----
 const [detail,setDetail]=useState<Detail>(null),[setPage,setSetPage]=useState<string|null>(null),[setSub,setSetSub]=useState<any>(null),[drag,setDrag]=useState(false),[hHover,setHHover]=useState(false);
 // Panel width (user correction 2026-10-26): up to two thirds of the actual app frame (browser: the constrained
 // ≤1360 window; native: the window itself, CSS px), with the 380 minimum while it fits. One bounds function serves
 // display clamping, pointer drag, keyboard and accessibility. The stored width is the preference, kept for re-enlarging.
 const [frameW,setFrameW]=useState(()=>native?vw:Math.min(1360,vw-48));
 useEffect(()=>{const el=winRef.current;if(!el)return;const set=()=>{const w=Math.round(el.getBoundingClientRect().width);if(w>0)setFrameW(w)};set();
  if(typeof ResizeObserver==='undefined'){addEventListener('resize',set);return()=>removeEventListener('resize',set)}const ro=new ResizeObserver(set);ro.observe(el);return()=>ro.disconnect()},[]);
 const bounds=(fw:number)=>{const max=Math.max(0,Math.floor(fw*2/3));return {min:Math.min(380,max),max}};
 const {min:minW,max:maxW}=bounds(frameW);
 const W=Math.round(Math.max(minW,Math.min(ui.panelW||(vw<1180?400:460),maxW)));const tab=ui.tab;
 const lastFrame=useRef(frameW);const resizing=lastFrame.current!==frameW;lastFrame.current=frameW;
 const openTab=(t:UIState['tab'])=>{setDetail(null);setSetPage(null);setSetSub(null);setUI({panel:true,tab:t})};
 const goSet=(page:string|null,sub?:any)=>{setDetail(null);setSetPage(page);setSetSub(sub||null);setUI({panel:true,tab:'settings'})};
 const openDetail=(d:Detail)=>{setDetail(d);if(d)setUI({panel:true,tab:d.type==='task'?'tasks':'today'})};
 const backAny=()=>{if(detail)setDetail(null);else if(setSub)setSetSub(null);else setSetPage(null)};
 useEffect(()=>installWindowChrome(()=>{if(detail||setSub||setPage){backAny();return true}if(menu){setMenu(false);return true}return false}),[detail,setSub,setPage,menu]);// eslint-disable-line react-hooks/exhaustive-deps
 function startDrag(e:React.MouseEvent){e.preventDefault();const win=winRef.current;if(!win)return;const rect=win.getBoundingClientRect();let last=W;
  const b=bounds(rect.width);const move=(ev:MouseEvent)=>{last=Math.round(Math.max(b.min,Math.min(b.max,rect.right-ev.clientX)));setUI({panelW:last})};
  const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);document.body.style.cursor='';document.body.style.userSelect='';setDrag(false)};
  addEventListener('mousemove',move);addEventListener('mouseup',up);document.body.style.cursor='col-resize';document.body.style.userSelect='none';setDrag(true)}
 function keyResize(e:React.KeyboardEvent){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const b=bounds(winRef.current?.getBoundingClientRect().width||frameW);const next=e.key==='Home'?b.min:e.key==='End'?b.max:Math.max(b.min,Math.min(b.max,W+(e.key==='ArrowLeft'?16:-16)));setUI({panelW:next})}

 // ----- buddy -----
 const [buddyHop,setBuddyHop]=useState(0),[buddyHappy,setBuddyHappy]=useState(false),[buddyPick,setBuddyPick]=useState(false),[happy,setHappy]=useState(false);
 const timers=useRef<number[]>([]);useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
 const later=(ms:number,fn:()=>void)=>{timers.current.push(window.setTimeout(fn,ms))};
 const bk=BUDDY[ui.buddy]?ui.buddy:'classic';
 const buddy:BuddyApi={k:bk,hop:buddyHop,happy:buddyHappy,pick:buddyPick,
  poke:e=>{e?.stopPropagation?.();setBuddyHop(n=>n+1);setBuddyHappy(true);later(900,()=>setBuddyHappy(false))},
  togglePick:e=>{e?.stopPropagation?.();setBuddyHop(n=>n+1);setBuddyHappy(true);later(900,()=>setBuddyHappy(false));setBuddyPick(x=>!x)},
  choose:(k,e)=>{e?.stopPropagation?.();setUI({buddy:k});setBuddyHop(n=>n+1);setBuddyHappy(true);later(900,()=>{setBuddyHappy(false);setBuddyPick(false)})}};
 const poke=()=>{if(happy)return;setHappy(true);later(1600,()=>setHappy(false))};

 // ----- fly-to-composer -----
 function fly(e:any,text:string){try{const b=e?.currentTarget as HTMLElement|undefined,ta=taRef.current;if(!b||!ta||!b.getBoundingClientRect)return;const a=b.getBoundingClientRect(),c=ta.getBoundingClientRect(),cs=getComputedStyle(ta);
  const g=document.createElement('div');g.textContent=text;Object.assign(g.style,{position:'fixed',left:a.left+'px',top:a.top+'px',width:a.width+'px',height:Math.max(32,a.height)+'px',zIndex:'9999',pointerEvents:'none',borderRadius:'16px',background:cs.getPropertyValue('--accent').trim()||'#0a84ff',color:'#fff',font:'500 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, sans-serif',display:'flex',alignItems:'center',padding:'0 14px',boxSizing:'border-box',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',boxShadow:'0 12px 32px rgba(0,0,0,.22)',transformOrigin:'left center'});
  document.body.appendChild(g);const dx=c.left+14-a.left,dy=c.top+c.height/2-(a.top+a.height/2),sc=Math.min(1,220/a.width);
  const an=g.animate([{transform:'translate(0,0) scale(1)',opacity:1},{offset:.15,transform:'translate(0,-6px) scale(1.04)',opacity:1},{offset:.6,transform:'translate('+dx*.62+'px,'+(dy*.62-60)+'px) scale('+sc+')',opacity:1},{transform:'translate('+dx+'px,'+dy+'px) scale('+sc*.7+')',opacity:0}],{duration:720,easing:'cubic-bezier(.45,0,.2,1)'});an.onfinish=()=>g.remove()}catch{}}
 // A fill whose conversation changed meanwhile is dropped. As in the reference, picking option B after A replaces
 // A's automatic fragment while it is still unedited; any text the user typed stays, and other fills append on a new line.
 const merge=(cur:string,add:string,auto:string|null)=>{if(!cur.trim()||cur.trim()===add.trim())return add;
  const at=auto?cur.lastIndexOf(auto):-1;if(auto&&at>=0)return cur.slice(0,at)+add+cur.slice(at+auto.length);return cur.replace(/\s+$/,'')+'\n'+add};
 const caretEnd=()=>requestAnimationFrame(()=>{const el=taRef.current;if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length)}});
 const toComposer:Ctx['toComposer']=(e,q,d,pend,addRefs)=>{fly(e,d);const k=owner.current;later(560,()=>{if(owner.current!==k)return;if(q)setQuote(q);const prev=autoFill.current;autoFill.current=d;setDraft(cur=>merge(cur,d,prev));setCFlash(true);setPendPick(pend?{...pend,quote:q||null}:null);setMenu(false);if(addRefs?.length)setRefs(r=>[...new Set([...r,...addRefs])]);later(900,()=>setCFlash(false));caretEnd()})};
 const prompt:Ctx['prompt']=(e,ref,text)=>{if(e)fly(e,text);const k=owner.current;later(e?560:40,()=>{if(owner.current!==k)return;const prev=autoFill.current;autoFill.current=text;setDraft(cur=>merge(cur,text,prev));setRefs(r=>r.includes(ref)?r:[...r,ref]);setMenu(false);setCFlash(true);later(700,()=>setCFlash(false));caretEnd()})};
 const discuss=(id:string)=>{setRefs(r=>r.includes(id)?r:[...r,id]);setMenu(false);focus()};

 // ----- send -----
 const typing=ui.requests.some(r=>(r.conversationId===conversationId||!r.conversationId)&&inFlight(r));
 const titleOf=useCallback((id:string)=>ws.inbox.find(x=>x.id===id)?.title||ws.ideas.find(x=>x.id===id)?.title||ws.tasks.find(x=>x.id===id)?.title||id,[ws]);
 const submitting=useRef(false);
 // Reference canSend/send (R2047, R1392): no new send while CyberMe is replying in this conversation; the draft stays editable.
 // Id-less requests go to the primary conversation (server), so they block only there; other conversations stay free.
 const replying=ui.requests.some(r=>inFlight(r)&&(r.conversationId?r.conversationId===conversationId:(!conversationId||conversationId===ws.primaryConversationId)));
 async function send(){
  if(replying)return;
  const text=draft.trim();if(!text&&!refs.length&&!quote&&!attachments.length)return;
  const pk=pendPick;const clear=()=>{autoFill.current=null;setDraft('');setRefs([]);setQuote(null);setPendPick(null);setMenu(false);setSel(null);setAttachments([])};
  const k0=dkey,sent=draft;const clearIfUnchanged=()=>{if(owner.current===k0&&taRef.current?.value===sent)clear();setUI(s=>s.drafts[k0]?.text===sent?{drafts:{...s.drafts,[k0]:{text:'',quote:null,refs:[],pick:null,auto:null}}}:{})};
  // A work option runs only when the composer still holds exactly that option (its automatic quote allowed); edited or combined text is sent as a conversation message.
  if(pk?.k==='work'&&pk.optionId&&text===pk.label&&(!quote||quote===pk.quote)){if(submitting.current)return;submitting.current=true;const panel=(ws.work?.panels||[]).find((p:any)=>p.id===pk.id);
   try{await api('POST','/api/chat/choices/'+enc(pk.id)+'/select',{operationId:uid('select'),revision:panel?.revision??pk.revision,optionId:pk.optionId,conversationId:panel?.conversationId||conversationId});clearIfUnchanged();await refresh();void loadThread(true)}catch(e:any){notify(e.message,'error');void refresh()}finally{submitting.current=false}return}
  if(pk?.k==='idea'&&text===pk.label){if(submitting.current)return;submitting.current=true;try{const r=await api('POST','/api/ideas/'+enc(pk.id)+'/execute',{action:ws.ideas.find(i=>i.id===pk.id)?.action||'task'});clearIfUnchanged();await refresh();if(r?.task?.id)openDetail({type:'task',id:r.task.id})}catch(e:any){notify(e.message,'error')}finally{submitting.current=false}return}
  const body=[quote?quote.split('\n').map(l=>'> '+l).join('\n'):'',text||(refs.length?XL.chatAbout(refs.map(titleOf).join('、')):'')].filter(Boolean).join('\n\n');
  // Brief options and "talk it through" bind their record internally (the reference shows only the quote, no chip).
  const contextIds=[...new Set([...refs,...(pk&&['idea','brief','ctx'].includes(pk.k)?[pk.id]:[])])];
  // The composer stays editable until the request receipt is durably saved; a failed save posts nothing and keeps the input.
  if(submitting.current)return;submitting.current=true;
  try{const rec=await startChat({conversationId:conversationId||'',message:body,contextIds,attachmentIds:attachments.map(a=>a.id),quote:quote||undefined,refs:[...refs],pick:pk&&pk.k==='brief'?{kind:'brief',id:pk.id,index:pk.i,label:pk.label}:undefined});
   if(pk?.k==='brief')setUI(s=>({brief:{...s.brief,[pk.id]:{pick:{label:pk.label,index:pk.i,requestId:rec.requestId},at:new Date().toISOString()}}}));
   clearIfUnchanged()}
  catch{notify(zh?'未发送：本地保存失败，输入已保留，可直接重试。':'Not sent: saving locally failed. Your input is kept; try again.','error')}
  finally{submitting.current=false}
 }
 async function upload(files:FileList|null){if(!files?.length)return;const k0=owner.current;setUploading(true);try{for(const f of Array.from(files)){const form=new FormData();form.append('file',f);const r=await api('POST','/api/files',form);const a=r?.artifact||r;if(!a?.id)continue;if(owner.current!==k0){notify(zh?`“${a.name||f.name}”已上传，但对话已切换，未附加。`:`“${a.name||f.name}” was uploaded but not attached because the conversation changed.`,'error');continue}setAttachments(x=>[...x,{id:a.id,name:a.name||f.name}])}}catch(e:any){notify(e.message,'error')}finally{setUploading(false);if(fileRef.current)fileRef.current.value=''}}

 // ----- selection quote -----
 function checkSel(){const clear=()=>{if(sel)setSel(null)};const s=window.getSelection();const el=scrollRef.current;if(!s||s.isCollapsed||!el||!s.rangeCount)return clear();const txt=s.toString().trim();const nd=(n:Node|null)=>n&&(n.nodeType===3?n.parentElement:n as Element);const a=nd(s.anchorNode),fo=nd(s.focusNode);const ai=a&&(a as Element).closest?.('[data-ai-text]');if(!txt||!ai||!fo||!ai.contains(fo))return clear();const r=s.getRangeAt(0).getBoundingClientRect();const col=el.parentElement!.getBoundingClientRect();setSel({text:txt.slice(0,400),x:Math.round(r.left+r.width/2-col.left),y:Math.round(Math.max(4,r.top-col.top-40))})}
 // ----- scrolling -----
 const lastLen=useRef<number|null>(null);
 const pending=ui.requests.filter(r=>(r.conversationId===conversationId||!r.conversationId)&&!msgs.some(m=>(m as any).requestId===r.requestId)&&r.status!=='succeeded');
 const shown=msgs.length+pending.length+(typing?1:0)+ui.proposals.filter(x=>x.conversationId===conversationId).length;
 // An explicit proposal jump outranks default bottom-scrolling until it settles; a newer jump, conversation change or user scroll cancels it.
 const nav=useRef<{align:()=>void}|null>(null);
 // Initial bottom-scroll timers belong to the visit that scheduled them; a conversation change, jump or user scroll clears them.
 const initScroll=useRef<number[]>([]);const stopInit=()=>{initScroll.current.forEach(clearTimeout);initScroll.current=[]};
 const cancelNav=()=>{nav.current=null;stopInit()};
 useEffect(()=>stopInit,[conversationId]);
 useEffect(()=>{const el=scrollRef.current;if(nav.current){if(msgs.length||pending.length)lastLen.current=shown;nav.current.align();return}if(el&&lastLen.current!==null&&shown!==lastLen.current&&!showDown)el.scrollTo({top:el.scrollHeight,behavior:'smooth'});if(el&&lastLen.current===null&&msgs.length){const v=visit.current.n;stopInit();initScroll.current=[60,300,900].map(ms=>window.setTimeout(()=>{const x=scrollRef.current;if(x&&!showDown&&!nav.current&&visit.current.n===v)x.scrollTop=x.scrollHeight},ms))}if(msgs.length||pending.length)lastLen.current=shown},[shown]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{nav.current?.align()},[thread]);
 // Each highlight has its own generation: only the newest one's 1400ms timer clears it, and cancelling navigation never cancels a running highlight.
 const flashGen=useRef(0);const showFlash=(key:string)=>{const g=++flashGen.current;setFlash(key);later(1400,()=>{if(flashGen.current===g)setFlash(null)})};
 const jumpTo:Ctx['jumpTo']=match=>{cancelNav();const m=msgs.find(match);const el=scrollRef.current;if(!m||!el)return;const node=el.querySelector(`[data-mid="${m.id}"]`) as HTMLElement|null;if(!node)return;el.scrollTo({top:Math.max(0,node.offsetTop-100),behavior:'smooth'});showFlash(m.id)};
 // The panel detail stays open; the target conversation loads, then the exact [data-pid] anchor is scrolled to and flashed (1400ms).
 const jumpToProposal:Ctx['jumpToProposal']=(pid,conv)=>{stopInit();const key='prop:'+pid;const target=conv||conversationId;const switching=!!conv&&conv!==conversationId;
  // The intent waits for the target conversation's history so late messages cannot shift or override the anchor, then holds for the 1400ms flash.
  let flashed=false;const t0=Date.now();const token={align:()=>{if(nav.current!==token)return;const el=scrollRef.current;const node=el?.querySelector(`[data-pid="${CSS.escape(pid)}"]`) as HTMLElement|null;
   if(!el||!node||convRef.current!==target||threadRef.current.visit!==visit.current.n)return;el.scrollTo({top:Math.max(0,node.offsetTop-100),behavior:'smooth'});
   if(!flashed){flashed=true;showFlash(key);later(1400,()=>{if(nav.current===token)nav.current=null})}}};
  nav.current=token;
  if(switching){setUI({conversationId:conv});lastLen.current=null;void refresh()}
  const attempt=()=>{if(nav.current!==token||flashed)return;token.align();if(flashed)return;if(Date.now()-t0<15000)later(150,attempt);else nav.current=null};later(switching?200:0,attempt)};

 const ctx:Ctx={ws,ui,zh,lang,T,XL,refresh,notify,toComposer,prompt,openTab,goSet,openDetail,jumpTo,jumpToProposal,pendPick,conversationId,
  quoteRow:(id,text)=>({row:hoverProps(id),btn:<button type="button" onClick={()=>quoteFrom(text)} aria-label="Quote reply" title={XL.quoteReply} style={quoteBtn(hoverMid===id)}><I n="arrow-bend-up-left" style={{fontSize:14}}/></button>}),
  propose:ids=>{if(!conversationId||!ids.length)return;propose(conversationId,ids);setDetail(null)},
  setConversation:id=>{cancelNav();setUI({conversationId:id});setDetail(null);lastLen.current=null;void refresh()},setPage,setSub,buddy,
  setLanguage:async l=>{const identity=ws.settings.identity;try{await api('PATCH','/api/settings',{identity:{language:l==='zh'?'zh-CN':'en'},baseSettings:{identity}});await refresh()}catch(e:any){notify(e.message,'error');void refresh()}}};

 // ----- derived -----
 const decs=useMemo(()=>decisions(ws,ui,zh),[ws,ui,zh]);const ins=useMemo(()=>insights(ws,zh,T),[ws,zh,T]);const gal=useMemo(()=>gallery(ws,zh),[ws,zh]);
 const m=mood(ui,ws,conversationId);const capsuleShow=happy||m.mode!=='idle';
 const sideTitle=conversationId&&ws.primaryConversationId&&conversationId!==ws.primaryConversationId?(ws.conversations.find(c=>c.id===conversationId)?.title||''):'';
 const capsuleText=happy?XL.hi:{think:XL.capThink,work:XL.capWork(m.running),wait:XL.capWait,idle:XL.capIdle}[m.mode];
 const canSend=!!(draft.trim()||refs.length||quote||attachments.length)&&!replying;
 const circle:React.CSSProperties={width:32,height:32,flex:'none',display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'50%',transition:'background 250ms ease-out, color 250ms ease-out, transform 250ms ease-out'};
 const menuItems=[...decs.map(d=>({id:d.id,title:d.q,status:T.st.decide})),...ins.map(i=>({id:i.id,title:i.title,status:i.status})),...gal.map(g=>({id:g.id,title:g.title,status:g.kind}))];
 const lastRef=refs[refs.length-1];const sugg=lastRef?(decs.find(d=>d.id===lastRef)?.opts.map(o=>o.label)||[]):[];
 const keys:UIState['tab'][]=['today','tasks','memory','settings'];const TW=zh?56:78;
 const lab={today:T.today,tasks:T.tasks,memory:T.memory,settings:XL.settings};
 const quoteBtn=(on:boolean):React.CSSProperties=>({width:28,height:28,flex:'none',alignSelf:'center',display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'50%',background:'var(--card)',boxShadow:'0 0 0 0.5px var(--lineStrong)',color:'var(--text2)',cursor:'pointer',opacity:on?1:0,transform:on?'none':'translateX(-4px)',pointerEvents:on?'auto':'none',transition:'opacity 250ms ease-out, transform 250ms ease-out'});
 const wrap=(id:string):React.CSSProperties=>({margin:-6,padding:6,borderRadius:'var(--r-card)',background:flash===id?'var(--accentSoft)':'transparent',transition:'background 250ms ease-out',animation:'cmIn 250ms ease-out both'});
 const bubble:React.CSSProperties={background:'var(--aiBubble)',boxShadow:'0 0 0 0.5px var(--aiLine)',borderRadius:'var(--r-bubble)'};
 const hoverProps=(id:string)=>({onMouseEnter:()=>{if(hoverMid!==id)setHoverMid(id)},onMouseLeave:()=>setHoverMid(x=>x===id?null:x)});
 const quoteFrom=(text:string)=>{setQuote(text.slice(0,800));setHoverMid(null);focus()};
 const userBubble=(id:string,content:string,ctxIds:string[]|undefined,stamp?:string)=>{const {quote:q,text}=splitQuote(content);return <div key={'u'+id} data-mid={id} style={wrap(id)} title={stamp}><div style={{display:'flex',justifyContent:'flex-end'}}><div style={{maxWidth:'78%',background:'var(--userBubble)',padding:'10px 14px',borderRadius:'var(--r-bubble)',display:'flex',flexDirection:'column',gap:4}}>
  {q?<div style={{display:'flex',gap:6,fontSize:12,color:'var(--text2)',padding:'6px 10px',margin:'-4px -8px 2px',borderRadius:10,background:'var(--hover)'}}><I n="quotes" style={{fontSize:12,flex:'none',marginTop:3}}/><span style={{display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'} as React.CSSProperties}>{q}</span></div>:null}
  {(ctxIds||[]).map(r=><Hv key={r} onClick={()=>{const d=ws.inbox.some(x=>x.id===r);const t=ws.tasks.some(x=>x.id===r);openDetail({type:t?'task':d?'ins':'ins',id:r})}} style={{all:'unset',cursor:'pointer',display:'flex',gap:8,fontSize:12,color:'var(--text2)',minWidth:0}} hover={{color:'var(--text)'}}><span style={{color:'var(--text3)',flex:'none'}}>{T.insightRef}</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titleOf(r)}</span></Hv>)}
  {text?<span style={{whiteSpace:'pre-wrap',textWrap:'pretty'} as React.CSSProperties}>{text}</span>:null}</div></div></div>};

 const rows:React.ReactNode[]=[];let prev:string|undefined;
 // Email proposals are placed in the timeline at their creation time, among the server messages.
 const props=ui.proposals.filter(x=>x.conversationId===conversationId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));let pi=0;
 const flush=(until?:string)=>{while(pi<props.length&&(!until||props[pi].createdAt<=until)){const x=props[pi++];rows.push(<div key={'p'+x.id} data-pid={x.id} style={{...wrap('prop:'+x.id),animation:'none',display:'flex',flexDirection:'column',gap:16}}><ProposalBlocks ctx={ctx} p={x}/></div>)}};
 const dayLabel=(v?:string)=>{if(!v)return '';const d=new Date(v),n=new Date();const y=new Date();y.setDate(n.getDate()-1);const name=d.toDateString()===n.toDateString()?T.todayL:d.toDateString()===y.toDateString()?T.yesterday:(zh?`${d.getMonth()+1} 月 ${d.getDate()} 日`:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}));return `${name} ${hhmm(v)}`};
 for(const msg of msgs){const at=msg.createdAt;flush(at);if(at&&(dayKey(at)!==dayKey(prev)||(prev&&Date.parse(at)-Date.parse(prev)>3*3600e3)))rows.push(<div key={'d'+msg.id} style={{textAlign:'center',fontSize:12,color:'var(--text3)',padding:'10px 0 2px'}}>{dayLabel(at)}</div>);prev=at||prev;
  const anyMsg=msg as any;
  if(msg.role==='user'){const rec=anyMsg.requestId?ui.requests.find(r=>r.requestId===anyMsg.requestId):undefined;rows.push(userBubble(msg.id,msg.content,rec?rec.refs:anyMsg.contextIds,hhmm(at)));if(rec&&['failed','unknown','partial','cancelled'].includes(rec.status))rows.push(<RequestCard key={'r'+rec.requestId} ctx={ctx} r={rec}/>);continue}
  if(msg.role!=='assistant')continue;
  const workId=anyMsg.chatWork?.workId;const work=workId?(ws.work?.works||[]).find((w:any)=>w.id===workId):null;
  if(work){rows.push(<div key={msg.id} data-mid={msg.id} style={wrap(msg.id)}><WorkEvent ctx={ctx} work={work} label={T.taskCreated} onOpen={()=>openDetail({type:'task',id:work.id})}/></div>);continue}
  const panel=(ws.work?.panels||[]).find((p:any)=>p.messageId===msg.id);
  const text=msg.content||'';if(!text.trim()&&!panel)continue;
  rows.push(<div key={msg.id} data-mid={msg.id} style={wrap(msg.id)}><div {...hoverProps(msg.id)} style={{display:'flex',gap:10,alignItems:'flex-start'}}><div style={{minWidth:0,maxWidth:'calc(100% - 38px)',display:'flex',flexDirection:'column',gap:8}}>
   {text.trim()?<div data-ai-text="1" style={{maxWidth:'100%',...bubble,padding:'10px 14px',textWrap:'wrap',overflowWrap:'anywhere',lineHeight:1.6} as React.CSSProperties}><Md text={text}/></div>:null}
   {panel?<PanelCard ctx={ctx} panel={panel}/>:null}
  </div><button type="button" onClick={()=>quoteFrom(text)} aria-label="Quote reply" title={XL.quoteReply} style={quoteBtn(hoverMid===msg.id)}><I n="arrow-bend-up-left" style={{fontSize:14}}/></button></div></div>);
 }
 flush();
 for(const r of pending){rows.push(userBubble(r.requestId,r.message,r.refs));if(inFlight(r))continue;rows.push(<RequestCard key={'r'+r.requestId} ctx={ctx} r={r}/>)}

 const panelStyle:React.CSSProperties={width:ui.panel?W:0,flex:'none',overflow:'hidden',background:'var(--panel)',boxShadow:ui.panel?'inset 0.5px 0 0 var(--line)':'none',transition:drag||resizing?'none':'width 250ms ease-out'};
 const hasAdd=tab==='settings'&&!detail&&!setSub&&(setPage==='connections'||setPage==='skills');
 return <Frame theme={ui.theme} winRef={winRef}>
  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',position:'relative'}}>
   <div data-drag-region="" style={{height:100,flex:'none',display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'start',padding:'18px 16px 0 18px'}}>
    <div style={{display:'flex',gap:8,paddingTop:2}}>{native?null:<><span style={{width:12,height:12,borderRadius:'50%',background:'#ff5f57',boxShadow:'inset 0 0 0 0.5px rgba(0,0,0,.15)'}}/><span style={{width:12,height:12,borderRadius:'50%',background:'#febc2e',boxShadow:'inset 0 0 0 0.5px rgba(0,0,0,.15)'}}/><span style={{width:12,height:12,borderRadius:'50%',background:'#28c840',boxShadow:'inset 0 0 0 0.5px rgba(0,0,0,.15)'}}/></>}</div>
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,paddingBottom:12}}>
     {bk==='classic'?<Hv onClick={poke} aria-label="CyberMe" style={{width:48,height:48,padding:0,border:'none',borderRadius:'50%',background:'var(--accent)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,cursor:'pointer',boxShadow:'0 8px 20px -8px var(--accent)',transition:'transform 250ms ease-out'}} hover={{transform:'scale(1.06)'}} press={{transform:'scale(0.94)'}}>
      <span style={{display:'flex',alignItems:'center',gap:7,height:10,transform:m.mode==='think'?'translate(3px,-2px)':'none',transition:'transform 250ms ease-out'}}>{[0,1].map(i=><span key={i} style={happy?{width:8,height:5,borderRadius:'8px 8px 0 0',border:'2px solid #fff',borderBottom:'none',boxSizing:'border-box'}:{width:6,height:10,borderRadius:3,background:'#fff',animation:'cmBlink 4.5s ease-out infinite'}}/>)}</span>
      <span style={m.mode==='think'?{width:6,height:2,borderRadius:2,background:'#fff',opacity:.9,transition:'all 250ms ease-out'}:{width:happy?12:10,height:happy?6:5,borderRadius:'0 0 6px 6px',background:'#fff',opacity:.9,transition:'all 250ms ease-out'}}/>
     </Hv>:<button type="button" onClick={buddy.poke} aria-label="CyberMe" style={{width:56,height:56,padding:0,border:'none',background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Buddy k={bk} S={52} hop={buddyHop} curHop={buddyHop} happy={buddyHappy}/></button>}
     {capsuleShow||sideTitle?<Hv as={sideTitle?'button':'div'} onClick={sideTitle?()=>ctx.setConversation(null):undefined} title={sideTitle?(zh?'回到主对话':'Back to main conversation'):undefined} style={{display:'flex',alignItems:'center',gap:6,height:24,padding:'0 10px',borderRadius:12,background:'var(--card)',boxShadow:'0 0 0 0.5px var(--lineStrong)',border:'none',font:'inherit',fontSize:12,color:'var(--text2)',whiteSpace:'nowrap',maxWidth:320,overflow:'hidden',textOverflow:'ellipsis',cursor:sideTitle?'pointer':'default',animation:'cmPop 300ms cubic-bezier(.2,.8,.2,1) both'}}>
      <span style={{width:6,height:6,borderRadius:'50%',flex:'none',background:m.mode==='wait'?'var(--warnDot)':m.mode==='idle'?'var(--okDot)':'var(--accent)',animation:(m.mode==='think'||m.mode==='work')?'cmPulse 1.4s ease-in-out infinite':'none',transition:'background 250ms ease-out'}}/>
      <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{capsuleShow?capsuleText:sideTitle}{capsuleShow&&sideTitle?' · '+sideTitle:''}</span></Hv>:null}
    </div>
    <div style={{display:'flex',justifyContent:'flex-end'}}>{!ui.panel?<Hv onClick={()=>setUI({panel:true})} aria-label="Show panel" style={{height:30,padding:'0 10px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-sm)',background:'transparent',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap',animation:'cmIn 250ms ease-out both'}} hover={{background:'var(--hover)',color:'var(--text)'}}><span>{T.today}</span><I n="sidebar-simple" style={{fontSize:16,transform:'scaleX(-1)'}}/></Hv>:null}</div>
   </div>

   <div ref={scrollRef} className="cm-scroll" onScroll={e=>{const el=e.currentTarget;const far=el.scrollHeight-el.scrollTop-el.clientHeight>240;if(far!==showDown)setShowDown(far);if(sel)setSel(null);if(el.scrollTop<40&&hasMore)void older()}} onWheel={cancelNav} onTouchMove={cancelNav} onKeyDown={cancelNav} onMouseUp={()=>setTimeout(checkSel,0)} onMouseDown={()=>{cancelNav();if(sel)setSel(null)}} style={{flex:1,minHeight:0,overflowY:'auto',position:'relative'}}>
    <div className="cm-chat-column" style={{padding:'8px 0 28px',display:'flex',flexDirection:'column',gap:14}}>
     {hasMore?<Hv onClick={()=>void older()} style={{alignSelf:'center',height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{loadingOlder?'…':T.loadOlder}</Hv>:null}
     {!rows.length&&!typing?<div style={{paddingTop:'24vh',display:'flex',flexDirection:'column',alignItems:'center',gap:6,textAlign:'center',animation:'cmIn 250ms ease-out both'}}><div style={{fontSize:20,fontWeight:600,letterSpacing:'-0.01em'}}>{T.greeting(ws.settings.identity.name||'')}</div><div style={{color:'var(--text2)'}}>{T.greetSub}</div></div>:null}
     {rows}
     {typing?<div style={{display:'flex',gap:10,alignItems:'flex-start',animation:'cmIn 250ms ease-out both'}}><div style={{width:'fit-content',...bubble,padding:'0 14px',display:'flex',gap:4,height:40,alignItems:'center',animation:'cmIn 250ms ease-out both'}}>{[0,.15,.3].map(d=><span key={d} style={{width:6,height:6,borderRadius:'50%',background:'var(--text3)',animation:`cmDot 1.2s ease-out ${d}s infinite`}}/>)}</div></div>:null}
    </div>
   </div>

   {sel?<button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{const q=sel.text;window.getSelection()?.removeAllRanges();setQuote(q);setSel(null);focus()}} style={{position:'absolute',zIndex:5,left:sel.x,top:sel.y,transform:'translateX(-50%)',height:30,padding:'0 12px',display:'flex',alignItems:'center',gap:6,border:'none',borderRadius:'var(--r-btn)',background:'var(--text)',color:'var(--convBg)',font:'inherit',fontSize:12,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap',boxShadow:'0 6px 16px -6px rgba(0,0,0,.35)',animation:'cmPop 250ms ease-out both'}}><I n="arrow-bend-up-left" style={{fontSize:14}}/><span>{XL.quoteReply}</span></button>:null}
   <div style={{flex:'none',padding:'0 0 20px',position:'relative'}}>
    {showDown?<Hv onClick={()=>{cancelNav();scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'})}} aria-label="Scroll to latest" style={{position:'absolute',left:'50%',top:-46,marginLeft:-17,width:34,height:34,borderRadius:'50%',border:'none',background:'var(--composer)',boxShadow:'0 0 0 0.5px var(--lineStrong), 0 4px 12px -4px rgba(0,0,40,.18)',color:'var(--text2)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',animation:'cmIn 250ms ease-out both'}} hover={{color:'var(--text)'}}><I n="arrow-down" style={{fontSize:16}}/></Hv>:null}
    <div className="cm-chat-column cm-composer-column" style={{display:'flex',flexDirection:'column',gap:10,position:'relative'}}>
     {menu?<div style={{position:'absolute',left:0,bottom:'calc(100% + 8px)',width:'min(420px, 100%)',maxHeight:360,overflowY:'auto',background:'var(--composer)',borderRadius:'var(--r-menu)',boxShadow:'0 0 0 0.5px var(--lineStrong), 0 12px 32px -8px rgba(0,0,40,.22)',padding:6,display:'flex',flexDirection:'column',gap:2,transformOrigin:'bottom left',animation:'cmPop 250ms ease-out both',zIndex:3}}>
      <div style={{padding:'6px 10px 4px',fontSize:12,color:'var(--text3)'}}>{T.attachH}</div>
      {!menuItems.length?<div style={{padding:'6px 10px 10px',color:'var(--text2)'}}>{T.insEmpty}</div>:null}
      {menuItems.map(mi=><Hv key={mi.id} onClick={()=>discuss(mi.id)} style={{all:'unset',boxSizing:'border-box',cursor:'pointer',padding:'8px 10px',borderRadius:'var(--r-menuItem)',display:'flex',flexDirection:'column',gap:2}} hover={{background:'var(--hover)'}}><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{mi.title}</span><span style={{fontSize:12,color:'var(--text3)'}}>{mi.status}</span></Hv>)}
      <div style={{height:1,margin:'4px 6px',background:'var(--line)'}}/>
      <Hv onClick={()=>{setMenu(false);fileRef.current?.click()}} style={{all:'unset',boxSizing:'border-box',cursor:'pointer',padding:'8px 10px',borderRadius:'var(--r-menuItem)',display:'flex',alignItems:'center',gap:8,color:'var(--text2)'}} hover={{background:'var(--hover)',color:'var(--text)'}}><I n="paperclip" style={{fontSize:14}}/><span>{uploading?T.uploading:T.attachFile}</span></Hv>
     </div>:null}
     {sugg.length>0&&!draft?<div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'flex-end',animation:'cmIn 250ms ease-out both'}}>{sugg.map(l=><Hv key={l} onClick={()=>{setDraft(l);focus()}} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-pill)',background:'var(--composer)',boxShadow:'0 0 0 0.5px var(--lineStrong)',color:'var(--text2)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{color:'var(--text)'}}>{l}</Hv>)}</div>:null}
     <div style={{background:'var(--composer)',borderRadius:'var(--r-pill)',boxShadow:(cFlash?'0 0 0 2px var(--accent)':'0 0 0 0.5px var(--lineStrong)')+', var(--composerShadow)',padding:6,display:'flex',flexDirection:'column',gap:4,transition:'box-shadow 250ms ease-out'}}>
      {quote?<div style={{display:'flex',alignItems:'center',gap:8,margin:'2px 2px 0',padding:'4px 4px 4px 12px',borderRadius:16,background:'var(--hover)',fontSize:12,color:'var(--text2)',animation:'cmIn 250ms ease-out both'}}><I n="arrow-bend-up-left" style={{fontSize:14,flex:'none'}}/><span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{quote}</span><Hv onClick={()=>{setQuote(null);setPendPick(null)}} aria-label="Remove quote" style={{width:22,height:22,flex:'none',display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'50%',background:'transparent',color:'inherit',cursor:'pointer'}} hover={{background:'var(--selected)'}}><I n="x" style={{fontSize:12}}/></Hv></div>:null}
      {refs.length||attachments.length?<div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'2px 2px 0'}}>
       {refs.map(r=><div key={r} style={{display:'inline-flex',alignItems:'center',gap:6,maxWidth:'100%',height:28,padding:'0 4px 0 12px',borderRadius:'var(--r-chip)',background:'var(--accentSoft)',color:'var(--accentText)',fontSize:12,animation:'cmIn 250ms ease-out both'}}><span style={{opacity:.8,flex:'none'}}>{T.insightRef}</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:360}}>{titleOf(r)}</span><Hv onClick={()=>setRefs(x=>x.filter(y=>y!==r))} aria-label="Remove" style={{width:20,height:20,flex:'none',display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'50%',background:'transparent',color:'inherit',cursor:'pointer'}} hover={{background:'var(--hover)'}}><I n="x" style={{fontSize:12}}/></Hv></div>)}
       {attachments.map(a=><div key={a.id} style={{display:'inline-flex',alignItems:'center',gap:6,maxWidth:'100%',height:28,padding:'0 4px 0 10px',borderRadius:'var(--r-chip)',background:'var(--hover)',color:'var(--text2)',fontSize:12,animation:'cmIn 250ms ease-out both'}}><I n="paperclip" style={{fontSize:12,flex:'none'}}/><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:300}}>{a.name}</span><Hv onClick={()=>setAttachments(x=>x.filter(y=>y.id!==a.id))} aria-label="Remove" style={{width:20,height:20,flex:'none',display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'50%',background:'transparent',color:'inherit',cursor:'pointer'}} hover={{background:'var(--selected)'}}><I n="x" style={{fontSize:12}}/></Hv></div>)}
      </div>:null}
      <div style={{display:'flex',alignItems:'flex-end',gap:6}}>
       <button type="button" onClick={()=>setMenu(x=>!x)} aria-label="Attach insight" style={{...circle,cursor:'pointer',background:menu?'var(--selected)':'var(--hover)',color:'var(--text2)',transform:menu?'rotate(45deg)':'none'}}><I n="plus" style={{fontSize:16}}/></button>
       <textarea ref={taRef} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setMenu(false);if(e.key!=='Enter'||e.nativeEvent.isComposing)return;const go=ui.cfg.enterSend?!e.shiftKey:(e.metaKey||e.ctrlKey);if(go){e.preventDefault();void send()}}} placeholder={T.placeholder} rows={1} style={{flex:1,minWidth:0,boxSizing:'border-box',resize:'none',border:'none',background:'transparent',color:'var(--text)',font:'inherit',fontSize:14,lineHeight:'20px',padding:'6px 4px',maxHeight:120,fieldSizing:'content'} as React.CSSProperties}/>
       <button type="button" onClick={()=>{if(canSend)void send()}} aria-label="Send" aria-disabled={!canSend} style={{...circle,cursor:canSend?'pointer':'default',background:canSend?'var(--accent)':'var(--hover)',color:canSend?'var(--onAccent)':'var(--text3)'}}><I n="arrow-up" style={{fontSize:16}}/></button>
      </div>
     </div>
     <input ref={fileRef} type="file" multiple hidden onChange={e=>void upload(e.target.files)}/>
    </div>
   </div>
   {toast||offline||uiError()?<div role="status" style={{position:'absolute',left:'50%',bottom:96,transform:'translateX(-50%)',maxWidth:'80%',padding:'8px 14px',borderRadius:'var(--r-btn)',background:toast?.tone==='error'||offline||uiError()?'var(--errSoft)':'var(--card)',color:toast?.tone==='error'||offline||uiError()?'var(--errText)':'var(--text)',boxShadow:'0 0 0 0.5px var(--lineStrong), 0 8px 24px -8px rgba(0,0,40,.2)',fontSize:12,animation:'cmPop 250ms ease-out both',zIndex:6}}>{toast?.m||(offline?T.offline:T.saveFailed)}</div>:null}
  </div>

  {ui.panel?<div onMouseDown={startDrag} onDoubleClick={()=>setUI({panelW:null})} onMouseEnter={()=>setHHover(true)} onMouseLeave={()=>setHHover(false)} onKeyDown={keyResize} role="separator" aria-orientation="vertical" aria-valuenow={W} aria-valuemin={minW} aria-valuemax={maxW} tabIndex={0} title="Drag to resize" style={{width:10,margin:'0 -5px',flex:'none',cursor:'col-resize',position:'relative',zIndex:4,outline:'none'}}><span style={{position:'absolute',top:'50%',left:3,width:4,height:drag?56:36,marginTop:drag?-28:-18,borderRadius:2,background:drag?'var(--accent)':hHover?'var(--lineStrong)':'transparent',transition:'all 250ms ease-out'}}/></div>:null}
  <div style={panelStyle}>
   <div style={{width:'100%',minWidth:W,height:'100%',display:'flex',flexDirection:'column'}}>
    <div data-drag-region="" style={{height:56,flex:'none',display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',padding:'0 12px'}}>
     <div>{detail||(tab==='settings'&&setPage)?<Hv onClick={backAny} aria-label="Back" style={{height:30,padding:'0 8px',display:'flex',alignItems:'center',border:'none',borderRadius:'var(--r-sm)',background:'transparent',color:'var(--text2)',cursor:'pointer',animation:'cmIn 250ms ease-out both'}} hover={{background:'var(--hover)',color:'var(--text)'}}><I n="caret-left" style={{fontSize:16}}/></Hv>:null}</div>
     <div style={{position:'relative',display:'flex',padding:3,borderRadius:'var(--r-seg)',background:'var(--segBg)'}}>
      <div style={{position:'absolute',top:3,left:3,width:TW,height:28,borderRadius:'var(--r-segOn)',background:'var(--segOn)',boxShadow:'var(--segShadow)',transform:`translateX(${keys.indexOf(tab)*TW}px)`,transition:'transform 250ms ease-out'}}/>
      {keys.map(k=><button key={k} type="button" onClick={()=>openTab(k)} style={{position:'relative',zIndex:1,width:TW,height:28,display:'flex',alignItems:'center',justifyContent:'center',gap:6,border:'none',borderRadius:'var(--r-segOn)',background:'transparent',font:'inherit',fontSize:14,color:tab===k?'var(--text)':'var(--text2)',fontWeight:tab===k?500:400,cursor:'pointer',whiteSpace:'nowrap',transition:'color 250ms ease-out'}}><span>{lab[k]}</span></button>)}
     </div>
     <div style={{display:'flex',justifyContent:'flex-end',gap:2}}>
      {hasAdd?<Hv onClick={()=>setPage==='skills'?goSet('skills',{type:'new'}):goSet('connections',{type:'add'})} aria-label="Add" style={{width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'var(--r-sm)',background:'transparent',color:'var(--text2)',cursor:'pointer',animation:'cmIn 250ms ease-out both'}} hover={{background:'var(--hover)',color:'var(--text)'}}><I n="plus" style={{fontSize:16}}/></Hv>:null}
      <Hv onClick={()=>setUI({panel:false})} aria-label="Hide panel" style={{width:30,height:30,display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:'var(--r-sm)',background:'transparent',color:'var(--text2)',cursor:'pointer'}} hover={{background:'var(--hover)',color:'var(--text)'}}><I n="sidebar-simple" style={{fontSize:16,transform:'scaleX(-1)'}}/></Hv>
     </div>
    </div>
    <div className="cm-scroll" style={{flex:1,minHeight:0,overflowY:'auto',padding:'8px 20px 32px',boxSizing:'border-box'}}>
     {/* Shared reading width for every tab and detail: at most 720 (the former 760 panel minus its 20px gutters), centered so extra panel width becomes equal side whitespace; the scroll bar stays at the panel edge. */}
     <div style={{display:'flex',flexDirection:'column',gap:12,width:'100%',maxWidth:720,margin:'0 auto'}}>
      {detail?.type==='ins'||detail?.type==='dec'?<InsightDetail ctx={ctx} id={detail.id} discuss={discuss}/>:null}
      {detail?.type==='task'?<TaskDetail ctx={ctx} id={detail.id} discuss={discuss}/>:null}
      {!detail&&tab==='today'?<Brief ctx={ctx} decs={decs} ins={ins} gal={gal}/>:null}
      {!detail&&tab==='tasks'?<Tasks ctx={ctx}/>:null}
      {!detail&&tab==='memory'?<Memory ctx={ctx}/>:null}
      {!detail&&tab==='settings'?<Settings ctx={ctx} page={setPage} sub={setSub}/>:null}
     </div>
    </div>
   </div>
  </div>
 </Frame>;
}

// Chat request outcome card: failed / unknown / partial / stopped are kept visible and truthful.
function RequestCard({ctx,r}:{ctx:Ctx;r:ChatRecord}){
 const {T}=ctx;const notSent=unsent(r);const status=r.status==='cancelled'?'cancelled':r.status==='partial'?'partial':r.status==='failed'||notSent?'failed':'unknown';
 const text=notSent?(ctx.zh?'未发送：本地保存失败，内容已保留。':'Not sent: saving locally failed. Your message is kept.'):r.status==='failed'?(r.failureCode==='model_quota_exceeded'?T.quotaReply:T.failedReply):r.status==='partial'?T.partialReply:r.status==='cancelled'?T.stoppedReply:T.unknownReply;
 const tone={failed:['--errSoft','--errText'],unknown:['--warnSoft','--warnText'],partial:['--warnSoft','--warnText'],cancelled:['--hover','--text2']}[status]!;
 return <div style={{display:'flex',gap:10,alignItems:'flex-start',animation:'cmIn 250ms ease-out both'}}><div style={{flex:1,minWidth:0,maxWidth:'85%',background:'var(--aiBubble)',boxShadow:'0 0 0 0.5px var(--aiLine)',borderRadius:'var(--r-bubble)',padding:'12px 12px 12px 14px',display:'flex',flexDirection:'column',gap:10}}>
  <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'8px 12px'}}>
   <div style={{flex:'1 1 200px',minWidth:0,display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:12,color:'var(--text3)'}}>{relTime(r.createdAt,ctx.zh)}</span><span style={{fontWeight:500,textWrap:'pretty',overflowWrap:'anywhere'} as React.CSSProperties}>{text}</span></div>
   <div style={{flex:'none',maxWidth:'100%',marginLeft:'auto',display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'flex-end',gap:12}}>
   <span style={{display:'inline-flex',alignItems:'center',height:22,padding:'0 8px',borderRadius:'var(--r-innerBtn)',background:`var(${tone[0]})`,color:`var(${tone[1]})`,fontSize:12,whiteSpace:'nowrap',flex:'none'}}>{T.ts[status]}</span>
   {r.status==='failed'||r.missing||notSent?<Hv onClick={()=>void retryChat(r.requestId)} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.retry}</Hv>
   :r.status==='unknown'?<Hv onClick={()=>void recover(r.requestId)} style={{height:30,padding:'0 12px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.checkAgain}</Hv>:null}
   </div>
  </div></div></div>;
}

// Chat work choices rendered in the V6 proposal card style. Choosing routes through the composer.
function PanelCard({ctx,panel}:{ctx:Ctx;panel:any}){
 const {T,XL}=ctx;const ready=panel.status==='ready';const sel=ctx.pendPick?.k==='work'&&ctx.pendPick.id===panel.id?ctx.pendPick.i:-1;
 const chip=(on:boolean,dis:boolean):React.CSSProperties=>({minHeight:28,padding:'4px 12px',border:'none',boxShadow:on?'none':'0 0 0 0.5px var(--lineStrong)',borderRadius:'var(--r-innerBtn)',font:'inherit',fontSize:14,cursor:dis?'default':'pointer',background:on?'var(--accentSoft)':'transparent',color:on?'var(--accentText)':dis?'var(--text3)':'var(--text)',textAlign:'left',transition:'all 250ms ease-out'});
 const chosen=(panel.options||[]).find((o:any)=>o.id===panel.selectedOptionId);
 const stateText=panel.status==='consumed'?T.taskExists:panel.status==='stale'?(panel.error||(ctx.zh?'资料已变化，这组选项已失效':'Sources changed; these options expired')):panel.status==='retired'?(ctx.zh?'已被新消息取代':'Replaced by a newer message'):'';
 return <div style={{background:'var(--aiBubble)',boxShadow:'0 0 0 0.5px var(--aiLine)',borderRadius:'var(--r-bubble)',padding:16,display:'flex',flexDirection:'column',gap:14}}>
  <div style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:12,color:'var(--accentText)'}}>{T.actionH}</span><span style={{fontSize:16,fontWeight:600}}>{panel.prompt?String(panel.prompt).slice(0,140):''}</span></div>
  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{(panel.options||[]).map((o:any,i:number)=><button key={o.id} type="button" disabled={!ready} title={o.summary||''} onClick={e=>ready&&ctx.toComposer(e,String(panel.prompt||'').slice(0,200),o.label,{k:'work',id:panel.id,i,label:o.label,optionId:o.id,revision:panel.revision})} style={chip(sel===i||chosen?.id===o.id,!ready)}>{o.label}{o.recommended?<span style={{marginLeft:6,fontSize:11,color:'var(--accentText)'}}>· {XL.recommended}</span>:null}</button>)}</div>
  <div style={{display:'flex',alignItems:'center',gap:8}}>
   {stateText?<span style={{fontSize:12,color:'var(--text3)'}}>{chosen?chosen.label+' · ':''}{stateText}</span>:<span style={{fontSize:12,color:'var(--text3)'}}>{ctx.zh?'选择后由你发送，才会开始执行':'Nothing runs until you send your choice'}</span>}
   <div style={{flex:1}}/>
   {panel.workId?<Hv onClick={()=>ctx.openDetail({type:'task',id:panel.workId})} style={{height:32,padding:'0 14px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--selected)'}}>{T.viewTask}</Hv>:null}
  </div></div>;
}
