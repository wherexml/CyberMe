import {needsInboxAttention} from '../../../shared/inbox-surfacing';
import { useI18n, translate } from '../domain/i18n';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUp,Paperclip,Mic,X,FileText,Check,LoaderCircle,ExternalLink,Image,Plus,ChevronRight,Minimize2,Maximize2,Download,Clock3,Copy,History} from 'lucide-react';
import {marked} from 'marked';
import type {Artifact,Message,UIContext} from '../../../shared/types';
import {api,ApiError} from '../domain/api';
import {ChatQueue} from './ChatQueue';
import {sourceContent} from '../domain/source-content';
import {useVoiceInput} from '../domain/use-voice-input';
import {Modal,TwinMark,timeLabel} from '../components';

function safeMarkdown(content:string){
 const html=marked.parse(content.replace(/\r\n?/g,'\n'),{async:false,breaks:true,gfm:true}) as string;
 const doc=new DOMParser().parseFromString(html,'text/html');
 doc.querySelectorAll('script,iframe,object,embed,style,link,form,input,button,svg,math').forEach(n=>n.remove());
 const allowed=new Set(['P','BR','STRONG','EM','DEL','S','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','HR','TABLE','THEAD','TBODY','TR','TH','TD','A']);
 doc.body.querySelectorAll('*').forEach(n=>{
  if(!allowed.has(n.tagName)){n.replaceWith(...n.childNodes);return;}
  [...n.attributes].forEach(a=>{if(!(n.tagName==='A'&&a.name==='href')&&!(n.tagName==='OL'&&a.name==='start'))n.removeAttribute(a.name)});
  if(n.tagName==='A'){const href=n.getAttribute('href')||'';if(!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href))n.removeAttribute('href');n.setAttribute('target','_blank');n.setAttribute('rel','noopener noreferrer');}
 });
 doc.querySelectorAll('table').forEach(table=>{const wrap=doc.createElement('div');wrap.className='chat-table-scroll';wrap.tabIndex=0;table.replaceWith(wrap);wrap.append(table)});
 return doc.body.innerHTML;
}
export function MessageBody({text}:{text:string}){return <div className="markdown" dangerouslySetInnerHTML={{__html:safeMarkdown(text)}}/>}
function artifactBadge(a:Artifact){return a.mime.includes('pdf')?'PDF':a.mime.includes('image')?'PNG':a.name.endsWith('.xlsx')?'XLS':a.name.endsWith('.docx')?'DOC':'MD'}
function ArtifactLink({a}:{a:Artifact}){ const { t, language } = useI18n();const badge=artifactBadge(a);return <div className="artifact-card"><span className={`file-badge ${badge.toLowerCase()}`}>{badge}</span><a className="copy" href={a.url} target="_blank" rel="noreferrer"><strong>{a.name}</strong><small>{(a.size/1024).toFixed(1)} KB · {timeLabel(a.createdAt, language)}</small></a><a className="icon-button" href={a.url} download={a.name} aria-label={t("Download {0}", a.name)} title={t("Download file")}><Download size={16}/></a></div>}

function ThreadMessage({message:m,ctx,floating,onRun}:{message:Message;ctx:UIContext;floating:boolean;onRun:(run:any)=>void}){
 const {t,language}=useI18n();const [copied,setCopied]=useState(false),[loading,setLoading]=useState(false);const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const copyLabel=copied?(language==='zh-CN'?'已复制':'Copied'):(language==='zh-CN'?'复制回复':'Copy reply');
 async function copy(){try{await navigator.clipboard.writeText(m.content);setCopied(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),2000)}catch{ctx.notify(language==='zh-CN'?'复制失败，请重试或选中文字复制':'Copy failed. Retry or select the text to copy.','error')}}
 async function openRun(){setLoading(true);try{onRun(await api.get<any>(`/runs/${m.runId}`))}catch(e){ctx.notify((e as Error).message,'error')}finally{setLoading(false)}}
 return <div className={m.role==='user'?'user-bubble':'assistant-row'} data-message-id={m.id}>{m.role==='user'?<>{m.content}{m.attachments?.map(id=>{const a=ctx.state.artifacts.find(a=>a.id===id);return a?<div key={id}><a href={a.url} target="_blank" rel="noreferrer">📎 {a.name}</a></div>:null})}</>:<><TwinMark size={floating?28:36}/><div className="assistant-content"><MessageBody text={m.content}/>{ctx.state.artifacts.filter(a=>m.attachments?.includes(a.id)).map(a=><ArtifactLink key={a.id} a={a}/>)}<div className="message-actions"><button type="button" className="icon-button message-action" aria-label={copyLabel} data-tooltip={copyLabel} onClick={copy}>{copied?<Check size={16}/>:<Copy size={16}/>}</button>{m.runId&&<button type="button" className="icon-button message-action" aria-label={t('View run')} data-tooltip={t('View run')} disabled={loading} onClick={openRun}>{loading?<LoaderCircle size={16} className="spinner"/>:<History size={16}/>}</button>}<span className="message-copy-status" role="status">{copied?copyLabel:''}</span></div></div></>}</div>
}

export function Conversation({ctx,floating=false,onExpand}:{ctx:UIContext;floating?:boolean;onExpand?:()=>void}){ const { t, language } = useI18n();
 const params=new URLSearchParams(window.location.search), queryConversation=params.get('conversation');
 const primaryConversation=ctx.state.sources?.primaryConversationId;
 const [conversationId,setConversationId]=useState(queryConversation||primaryConversation||ctx.state.conversations[0]?.id||'');
 const [draft,setDraft]=useState(()=>sessionStorage.getItem('opsadv-chat-draft')||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[errorCode,setErrorCode]=useState(''),[pending,setPending]=useState(''),[runView,setRunView]=useState<any>(null);
 const [attachments,setAttachments]=useState<Artifact[]>([]);
 const voice=useVoiceInput(text=>{setDraft(previous=>previous.trim()?`${previous.trim()} ${text}`:text);textRef.current?.focus();});
 const [contextIds,setContextIds]=useState<string[]>(()=>params.get('context')?[params.get('context')!]:[]);
 const [showSources,setShowSources]=useState(false),[contextPreview,setContextPreview]=useState<any>(null);
 const inputRef=useRef<HTMLInputElement>(null),textRef=useRef<HTMLTextAreaElement>(null),scroller=useRef<HTMLDivElement>(null);
 const requestRef=useRef<{id:string;fingerprint:string}|null>(null);
 useEffect(()=>{if(!voice.busy)return;const cancelOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();voice.cancel();textRef.current?.focus();}};window.addEventListener('keydown',cancelOnEscape,true);return()=>window.removeEventListener('keydown',cancelOnEscape,true)},[voice.status]);
 const [continuation,setContinuation]=useState<{running:boolean;items:any[]}>({running:false,items:[]});
 const [submitting,setSubmitting]=useState(false);
 const continuationRequest=useRef<{id:string;fingerprint:string}|null>(null);
 const running=busy||continuation.running||continuation.items.some(item=>['queued','running','inserting'].includes(item.status));
 const continuationSignature=useRef('');
 useEffect(()=>{let alive=true;const poll=async()=>{if(!conversationId)return;try{const value=await api.get<any>(`/chat/continuation/${conversationId}`);if(alive){setContinuation(value);const signature=JSON.stringify(value);if(continuationSignature.current&&continuationSignature.current!==signature)void ctx.refresh().catch(()=>{});continuationSignature.current=signature}}catch{}};void poll();const timer=setInterval(poll,1000);return()=>{alive=false;clearInterval(timer)}},[conversationId]);
 async function continueChat(delivery:'steer'|'queue'){
  if(submitting||voice.busy||!draft.trim())return;
  const text=draft;const fingerprint=JSON.stringify([conversationId,text,delivery,attachments.map(a=>a.id),contextIds]);
  if(!continuationRequest.current){try{continuationRequest.current=JSON.parse(sessionStorage.getItem('opsadv-continuation-request')||'null')}catch{}}
  if(continuationRequest.current?.fingerprint!==fingerprint)continuationRequest.current={id:crypto.randomUUID(),fingerprint};
  sessionStorage.setItem('opsadv-continuation-request',JSON.stringify(continuationRequest.current));
  setSubmitting(true);setError('');setErrorCode('');
  try{const result=await api.post<any>('/chat/continuation',{conversationId,message:text,delivery,requestId:continuationRequest.current.id,attachmentIds:attachments.map(a=>a.id),contextIds});
   if(['cancelled','failed','interrupted'].includes(result.status)){
    if(result.status==='cancelled'){continuationRequest.current=null;sessionStorage.removeItem('opsadv-continuation-request');setErrorCode('continuation_cancelled')}else setErrorCode('partial_run_requires_review');
    setContinuation(await api.get<any>(`/chat/continuation/${conversationId}`));
    throw new Error(result.error||(language==='zh-CN'?'这条消息未重新发送。草稿已保留，请检查已有结果后重试。':'This message was not resent. Your draft is preserved; review existing results before retrying.'));
   }
   setDraft(current=>current===text?'':current);setAttachments(current=>current.filter(a=>!attachments.some(sent=>sent.id===a.id)));continuationRequest.current=null;sessionStorage.removeItem('opsadv-continuation-request');
   setContinuation(await api.get<any>(`/chat/continuation/${conversationId}`));await ctx.refresh();

  }catch(e){setError((e as Error).message)}finally{setSubmitting(false);textRef.current?.focus()}
 }
 async function editQueued(item:any){try{await api.delete(`/chat/continuation/${item.id}`);continuationRequest.current=null;sessionStorage.removeItem('opsadv-continuation-request');setDraft(current=>current.trim()===item.message.trim()?current:current?`${current}\n\n${item.message}`:item.message);setAttachments(current=>[...current,...ctx.state.artifacts.filter(a=>(item.attachmentIds||[]).includes(a.id)&&!current.some(c=>c.id===a.id))]);setContextIds(current=>[...new Set([...current,...(item.contextIds||[])])]);setContinuation(await api.get<any>(`/chat/continuation/${conversationId}`));textRef.current?.focus()}catch(e){setError((e as Error).message)}}

 const messages=ctx.state.messages.filter(m=>m.conversationId===conversationId);
 const savedFiles=ctx.state.artifacts.filter(a=>a.conversationId===conversationId&&!messages.some(m=>m.attachments?.includes(a.id))).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 const threadTimeline=[...messages.map(message=>({kind:'message' as const,message,createdAt:message.createdAt||''})),...savedFiles.map(artifact=>({kind:'file' as const,artifact,createdAt:artifact.createdAt||''}))].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 useEffect(()=>{if(queryConversation&&queryConversation!==conversationId)setConversationId(queryConversation)},[queryConversation]);
 useEffect(()=>{if(!queryConversation&&primaryConversation&&primaryConversation!==conversationId)setConversationId(primaryConversation)},[primaryConversation,queryConversation]);
 const queryContext=params.get('context');
 useEffect(()=>{setContextIds(queryContext?[queryContext]:[])},[queryContext]);
 useEffect(()=>{if(conversationId)sessionStorage.setItem('opsadv-conversation',conversationId)},[conversationId]);
 useEffect(()=>{sessionStorage.setItem('opsadv-chat-draft',draft)},[draft]);
 useEffect(()=>{const textarea=textRef.current;if(!textarea)return;const resize=()=>{textarea.style.height='auto';textarea.style.overflowY='hidden';const height=textarea.scrollHeight;textarea.style.height=`${Math.min(160,Math.max(32,height))}px`;textarea.style.overflowY=height>160?'auto':'hidden';};resize();const observer=new ResizeObserver(()=>{if(textarea.clientWidth)resize()});const form=textarea.closest('form');if(form)observer.observe(form);return()=>observer.disconnect()},[draft,floating]);
 useEffect(()=>{
  const pane=scroller.current;if(!pane)return;let frame=0;
  const align=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const previousSpace=parseFloat(pane.style.getPropertyValue('--thread-extra-space'))||0;
   const bottom=Math.max(0,pane.scrollHeight-previousSpace-pane.clientHeight);
   const padding=parseFloat(getComputedStyle(pane).paddingTop)||0,origin=pane.getBoundingClientRect().top;
   const starts=Array.from(pane.firstElementChild?.children||[]).filter(row=>!row.hasAttribute('data-scroll-space')).map(row=>row.getBoundingClientRect().top-origin+pane.scrollTop-padding);
   const next=starts.find(top=>top>=bottom);
   const extra=next!==undefined&&next-bottom<pane.clientHeight/3?Math.max(0,next-bottom):0;
   pane.style.setProperty('--thread-extra-space',`${extra}px`);
   pane.scrollTo({top:bottom+extra,behavior:'auto'});
  })};
  align();const resize=new ResizeObserver(align);resize.observe(pane);
  return()=>{resize.disconnect();cancelAnimationFrame(frame)};
 },[messages.length,savedFiles.map(a=>a.id).join(','),pending,busy]);
 const sourceRows=Object.entries(ctx.state.sources).flatMap(([kind,rows])=>Array.isArray(rows)?rows.map(row=>({...row,kind})):[]);
 const selectedContext=ctx.state.inbox.find(i=>contextIds.includes(i.id));
 async function readContext(){const id=contextIds[0];if(!id)return;setError('');setErrorCode('context_read');try{const source=sourceRows.find(row=>row.id===id||row.sourceId===id);const full=source?await api.get<any>(`/sources/${source.kind}/${encodeURIComponent(id)}`):selectedContext||ctx.state.tasks.find(t=>t.id===id);if(!full)throw new Error(t("This context is unavailable. Return to Sources to refresh it."));setContextPreview(full);setShowSources(true)}catch(e){setError((e as Error).message)}}
 async function send(event?:FormEvent){event?.preventDefault();if(submitting)return;if(running){await continueChat(attachments.length||contextIds.length?'queue':'steer');return;}if(busy||voice.busy||(!draft.trim()))return;setBusy(true);setError('');setErrorCode('');const submittedDraft=draft;const text=draft.trim();let accepted=false;setPending(text);setDraft('');voice.cancel();setAttachments([]);sessionStorage.setItem('opsadv-chat-draft','');
  try{const payload={conversationId:conversationId||undefined,message:text,attachmentIds:attachments.map(a=>a.id),mode:'chat',contextIds};const fingerprint=JSON.stringify([conversationId,text,payload.attachmentIds,contextIds]);if(!requestRef.current){try{requestRef.current=JSON.parse(sessionStorage.getItem('opsadv-chat-request')||'null')}catch{}}if(requestRef.current?.fingerprint!==fingerprint)requestRef.current={id:crypto.randomUUID(),fingerprint};sessionStorage.setItem('opsadv-chat-request',JSON.stringify(requestRef.current));const result=await api.post<any>('/chat',{...payload,requestId:requestRef.current!.id});accepted=true;setConversationId(result.conversationId);requestRef.current=null;sessionStorage.removeItem('opsadv-chat-request');await ctx.refresh();
  }catch(e){if(!accepted){setDraft(current=>current?`${submittedDraft}\n\n${current}`:submittedDraft);setAttachments(current=>[...attachments,...current])}setError((e as Error).message);if(e instanceof ApiError){setErrorCode(e.data?.error||e.data?.code||'');const detail=e.data?.detail;if(detail?.conversationId)setConversationId(detail.conversationId);if(detail?.run)setRunView(detail.run)}await ctx.refresh().catch(()=>{});}finally{setPending('');setBusy(false);textRef.current?.focus()}}
 async function upload(files:FileList|null){if(!files?.length)return;setError('');setErrorCode('file_upload');setBusy(true);try{for(const file of [...files]){if(file.size>20*1024*1024)throw new Error(t("Choose a file smaller than 20 MB."));const data=new FormData();data.append('file',file);if(conversationId)data.append('conversationId',conversationId);const response=await api.upload<any>('/files',data);setAttachments(p=>[...p,response.artifact||response])}await ctx.refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false);if(inputRef.current)inputRef.current.value=''}}
 const triage=ctx.state.inbox.filter(i=>needsInboxAttention(i)).slice(0,3);
 const approveItem=ctx.state.inbox.find(i=>i.draft&&needsInboxAttention(i));
 const showWelcome=messages.length===0;
 const sourceLabel=contextIds.map(id=>{const source=sourceRows.find(row=>row.id===id||row.sourceId===id);const label=ctx.state.inbox.find(i=>i.id===id)?.title||ctx.state.tasks.find(t=>t.id===id)?.title||source?.title||source?.subject||source?.name||source?.chatName||id;return typeof label==='object'?label['zh-CN']||label.zh||label.en||id:label}).join(', ');
 const zh=language==='zh-CN';
 const activeTasks=ctx.state.tasks.filter(t=>!['done','completed','cancelled'].includes(t.status));
 const draftWork=ctx.state.inbox.filter(i=>i.draft&&needsInboxAttention(i));
 const workingTasks=activeTasks.slice(0,2);
 return <>
  {floating&&<div className="float-working"><div className="float-working-title"><span className="online-dot"/><strong>{t("Working on now")}</strong><span className="small muted">{activeTasks.length} {t("active")}</span></div><div className="progress-track"><span style={{width:`${ctx.state.tasks.length?ctx.state.tasks.filter(t=>['done','completed'].includes(t.status)).length/ctx.state.tasks.length*100:0}%`}}/></div>{draftWork.slice(0,1).map(i=><button className="float-work-row" key={i.id} onClick={()=>ctx.navigate(`/deep-think?item=${i.id}`)}><span className="badge green">{t("Ready")}</span><span>{i.sender}{t("’s reply")}</span></button>)}{workingTasks.map(t=><button className="float-work-row" key={t.id} onClick={()=>ctx.navigate(`/tasks?task=${t.id}`)}><span className="float-work-dot"/><span>{t.title}</span></button>)}{!workingTasks.length&&!draftWork.length&&<span className="small muted">{t("Everything is up to date.")}</span>}<div className="chips"><button className="btn btn-small" onClick={()=>ctx.navigate('/inbox')}>{t("Open Inbox")}</button><button className="btn btn-small" onClick={()=>ctx.navigate('/activity')}>{t("What you handled")}</button></div></div>}
  <div className={floating?'floating-body':'chat-scroll'} ref={scroller}>
   <div className="conversation">
    {showWelcome&&<>
     <div className="chat-time">{zh?'今天':t("Today")} · {ctx.state.settings.identity.name||'许茂林'}</div>
     <div className="assistant-row"><TwinMark size={floating?28:36}/><div className="assistant-content"><span>{zh?'你的任务、消息与上下文已整理在这里。':floating?t("I’m here. What would you like to move forward?"):t("Your tasks, messages and context are here.")}</span>{!floating&&<span className="small muted">{ctx.state.tasks.length} {zh?'个任务':'tasks'} · {ctx.state.sources?.counts?.chats||ctx.state.sources?.chats?.length||0} {zh?'个会话':'conversations'} · {ctx.state.projects.length} {zh?'个项目':'project'}</span>}</div></div>
     {!floating&&<div className="user-bubble">{zh?'今天有哪些事情需要我？':t("What needs me today?")}</div>}
     {!floating&&<div className="assistant-row"><TwinMark size={30}/><div className="assistant-content"><span>{zh?'选择一项查看原文、起草回复或继续推进。':t("Choose an item to read its context, draft a reply or move it forward.")}</span><div className="triage-list">{triage.map(i=><button className="triage-item" key={i.id} onClick={()=>ctx.navigate(`/inbox?item=${encodeURIComponent(i.id)}`)}><span className="avatar">{i.sender.slice(0,2)}</span><span className="item-text"><strong>{i.title}</strong><small>{i.channel} · {i.sensitive?t("Flagged as sensitive"):i.draft?t("reply drafted"):t("needs review")}</small></span><span className="open">{t("Open in Inbox ›")}</span></button>)}{!triage.length&&<div className="empty">{zh?'Inbox 已处理完毕':t("Your inbox is clear")}</div>}</div><button className="btn btn-small" style={{alignSelf:'flex-start'}} onClick={()=>ctx.navigate('/activity')}>{zh?'查看处理记录':t("See Activity")} ›</button></div></div>}
     {approveItem&&!floating&&<div className="assistant-row"><TwinMark/><div className="assistant-content"><div className="approval-card"><span className="badge purple">{t("Needs your OK")}</span><span>{approveItem.sender}{zh?' 的回复草稿已准备好。可以先审阅来源和附件。':t("’s draft is ready. Review its sources and attachments before sending.")}</span><div className="chips"><button className="btn btn-primary" onClick={()=>ctx.navigate(`/inbox?item=${approveItem.id}&approve=1`)}>{t("Approve and send")}</button><button className="btn btn-secondary" onClick={()=>ctx.navigate(`/deep-think?item=${approveItem.id}`)}>{t("Review first")}</button></div></div></div></div>}
    </>}
    {threadTimeline.map(event=>event.kind==='message'?<ThreadMessage key={event.message.id} message={event.message} ctx={ctx} floating={floating} onRun={setRunView}/>:((a:Artifact)=><div className="assistant-row" key={a.id} data-artifact-id={a.id}><TwinMark size={floating?28:36}/><div className="assistant-content"><span className="small muted">{t("Saved file from this conversation")}</span><ArtifactLink a={a}/></div></div>)(event.artifact))}
    {pending&&!messages.some(m=>m.role==='user'&&m.requestId===requestRef.current?.id)&&<div className="user-bubble">{pending}</div>}
    {busy&&<div className="assistant-row"><TwinMark size={floating?28:36}/><span className="muted small" role="status" style={{display:'flex',gap:8,alignItems:'center'}}><LoaderCircle size={16} className="spinner"/>{t("Your twin is working…")}</span></div>}
    <div data-scroll-space aria-hidden="true" style={{height:'var(--thread-extra-space, 0px)',flex:'none',marginTop:-16}}/>
   </div>
  </div>
  <div className={floating?'floating-compose':'chat-composer-wrap'}>
   {error&&<div className="error-inline" role="alert" style={{marginBottom:10}}>{error}{errorCode==='partial_run_requires_review'?<button className="btn btn-small btn-ghost" onClick={()=>ctx.navigate('/activity')}>{t("Review completed actions")}</button>:errorCode==='voice_dictation'?<button className="btn btn-small btn-ghost" onClick={()=>{setError('');setErrorCode('');textRef.current?.focus()}}>{t("Continue typing")}</button>:errorCode==='file_upload'?<button className="btn btn-small btn-ghost" onClick={()=>inputRef.current?.click()}>{t("Choose another file")}</button>:errorCode==='context_read'?<button className="btn btn-small btn-ghost" onClick={()=>void readContext()}>{t("Read context again")}</button>:<button className="btn btn-small btn-ghost" disabled={busy} onClick={()=>void send()}>{t("Retry")}</button>}</div>}
   {contextIds.length>0&&<div className="source-context" style={{marginBottom:8}}><FileText size={15}/><span>{sourceLabel}</span><button type="button" className="source-context-read" aria-label={t("Read selected context")} onClick={()=>void readContext()}>{t("Read")}</button><button aria-label={t("Remove context")} onClick={()=>setContextIds([])}><X size={14}/></button></div>}
   <form className="chat-composer" onSubmit={send} onKeyDown={event=>{if(event.key==='Escape'&&voice.status!=='idle'){event.preventDefault();event.stopPropagation();voice.cancel();textRef.current?.focus()}}}>
    <ChatQueue key={conversationId} items={continuation.items} conversationId={conversationId} zh={zh} onRefresh={async()=>{setContinuation(await api.get<any>(`/chat/continuation/${conversationId}`));await ctx.refresh()}} onRetry={editQueued}/>
    <textarea rows={1} ref={textRef} aria-label={t("Message your twin")} placeholder={zh?'询问或告诉你的分身…':t("Ask or tell your twin anything…")} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(e.altKey&&running)void continueChat('queue');else void send()}}}/>
    {voice.status!=='idle'&&(voice.status!=='ready'||draft.trim())&&<div className={`voice-inline is-${voice.status}`} role={voice.error?'alert':'status'}>
     <div className="voice-inline-info">
      <span className="voice-inline-icon" aria-hidden="true">{voice.status==='ready'?<Check size={14}/>:voice.status==='transcribing'||voice.status==='permission'?<LoaderCircle size={14} className="spinner"/>:<Mic size={14}/>}</span>
      <div className="voice-inline-copy"><span>{voice.error||(voice.status==='recording'?(zh?'正在聆听':t("Listening")):voice.status==='permission'?(zh?'等待麦克风授权…':t("Allow microphone access…")):voice.status==='transcribing'?(zh?'正在转写…':t("Transcribing…")):(zh?'已转写':t("Transcribed")))}</span>
       {voice.status==='recording'&&<span className="voice-device" title={voice.inputDevice}>{voice.inputMuted?(zh?'麦克风已静音':t("Microphone muted")):voice.inputDevice}</span>}
       {voice.status==='ready'&&<span className="voice-provider">{voice.evidence?.provider==='Doubao'?(zh?'豆包语音':'Doubao'):voice.evidence?.provider==='FunASR'?'Paraformer':voice.evidence?.provider}</span>}
      </div>
     </div>
     <div className="voice-inline-actions">
      {voice.status==='recording'&&<><meter className="voice-level" aria-label={t("Microphone input level")} min={0} max={100} value={voice.level}/><button type="button" className="voice-action voice-finish" onClick={voice.stop}>{zh?'完成':t("Done")}</button></>}
      {voice.status==='failed'&&<button type="button" className="voice-action" onClick={()=>void voice.start()}>{zh?'重新录音':t("Record again")}</button>}
      {voice.canRetry&&voice.status==='failed'&&<button type="button" className="voice-action" onClick={voice.retry}>{zh?'重试':t("Retry")}</button>}
      <button type="button" className="voice-dismiss" aria-label={voice.busy?t("Cancel recording"):t("Dismiss voice status")} title={zh?'关闭':t("Dismiss")} onClick={()=>{voice.cancel();textRef.current?.focus()}}><X size={14}/></button>
     </div>
    </div>}
    {!!attachments.length&&<div className="chips">{attachments.map(a=><span className="attachment-chip" key={a.id}><a href={a.url} target="_blank" rel="noreferrer">{a.name}</a><button type="button" aria-label={t("Remove {0}", a.name)} onClick={()=>setAttachments(p=>p.filter(x=>x.id!==a.id))}><X size={12}/></button></span>)}</div>}
    <div className="composer-buttons"><input type="file" multiple hidden ref={inputRef} onChange={e=>void upload(e.target.files)}/><button type="button" className="icon-button" aria-label={t("Attach a file")} disabled={busy||voice.busy} onClick={()=>inputRef.current?.click()}><Paperclip size={17}/></button><span className="spacer"/><button type="button" className={`icon-button ${voice.status==='recording'?'primary':''}`} aria-label={voice.status==='recording'?t("Stop dictation"):t("Speak")} disabled={submitting||voice.status==='permission'||voice.status==='transcribing'} onClick={()=>voice.status==='recording'?voice.stop():void voice.start()}><Mic size={17}/></button>{running&&!attachments.length&&!contextIds.length&&!!draft.trim()&&<button type="button" className="icon-button" aria-label={zh?'完成后发送':'Send after current task'} title={zh?'完成后发送（Alt+Enter）':'Send after current task (Alt+Enter)'} disabled={submitting||voice.busy} onClick={()=>void continueChat('queue')}><Clock3 size={17}/></button>}<button type="submit" className="icon-button primary" title={running?(attachments.length||contextIds.length?(zh?'完成后发送':'Send after current task'):(zh?'插入当前任务（Enter）':'Insert into current task (Enter)')):t("Send")} aria-label={running?(attachments.length||contextIds.length?(zh?'完成后发送':'Send after current task'):(zh?'插入当前任务':'Insert into current task')):t("Send")} disabled={submitting||voice.busy||(!draft.trim())}>{submitting?<LoaderCircle size={17} className="spinner"/>:<ArrowUp size={18}/>}</button></div>
   </form>
  </div>
  {runView&&<Modal title={t("Sources and completed actions")} wide onClose={()=>setRunView(null)}><div className="modal-body"><div className="chips"><span className={`badge ${runView.status==='succeeded'?'green':'orange'}`}>{t(runView.status)}</span><span className="small muted">{runView.model} · {timeLabel(runView.startedAt, language)}</span></div>{runView.error&&<div className="error-inline">{runView.error}</div>}{(runView.tools||[]).map((step:any)=><details className="card" key={step.id}><summary>{step.name.replaceAll('_',' ')} · {step.status}</summary><pre className="run-data">{JSON.stringify({request:step.input,result:step.output},null,2).slice(0,12000)}</pre></details>)}{!runView.tools?.length&&<p className="muted">{t("This reply used the selected conversation context. No additional tools ran.")}</p>}<span className="small muted">{t("Run")} {runView.id}</span></div></Modal>}
  {showSources&&<Modal title={t("Source context")} wide onClose={()=>setShowSources(false)}><div className="modal-body"><span className="small muted">{t("Source ID ·")} {contextPreview?.sourceId||contextPreview?.id}</span>{contextPreview?.coverage&&<p className="small muted">{t("Imported preview ·")} {contextPreview.bodyMessageCount}  {t("recent messages of")} {contextPreview.totalCount}{t(". More history is available in Sources.")}</p>}<MessageBody text={contextPreview?sourceContent(contextPreview)||contextPreview.notes||JSON.stringify(contextPreview,null,2):''}/></div></Modal>}
 </>
}
export default function Chat({ctx}:{ctx:UIContext}){ const { t, language } = useI18n();
 const state=ctx.state;const zh=state.settings.identity.language==='zh-CN';
 const working=state.inbox.filter(i=>i.draft&&needsInboxAttention(i)).slice(0,1);
 const due=state.tasks.filter(t=>t.dueDate&&!['done','completed','cancelled'].includes(t.status)).slice(0,3);
 const upcoming=state.automations.filter(a=>a.enabled).slice(0,3);
 const [taskOpen,setTaskOpen]=useState(false),[automationOpen,setAutomationOpen]=useState(false),[automation,setAutomation]=useState({title:'',prompt:'',schedule:'daily 08:00'}),[creating,setCreating]=useState(false);
 return <div className="chat-page"><div className="chat-center"><header className="working-strip" aria-label={t("Working on")}><span className="working-label"><TwinMark size={24}/>{zh?'正在推进':t("Working on")}</span>{working.map(i=><button className="badge green" key={i.id} onClick={()=>ctx.navigate(`/deep-think?item=${i.id}`)}><Check size={13}/>{i.sender}{t("’s reply · ready")}</button>)}<button className="badge purple" onClick={()=>ctx.navigate('/tasks')}>{state.tasks.filter(t=>!['done','completed','cancelled'].includes(t.status)).length}  {t("active tasks")}</button><button className="badge blue" onClick={()=>ctx.navigate('/activity')}>{state.automations.filter(a=>a.enabled).length}  {t("scheduled actions")}</button></header><Conversation ctx={ctx}/></div>
 <aside className="chat-about" aria-label={t("About your twin")}><div className="about-card"><div style={{display:'flex',alignItems:'center'}}><h2>{zh?'接下来':t("Upcoming")}</h2><button className="icon-button" style={{marginLeft:'auto',width:26,height:26}} aria-label={t("Schedule an action")} onClick={()=>setAutomationOpen(true)}><Plus size={14}/></button></div>{upcoming.map(a=><button className="about-row" key={a.id} onClick={()=>ctx.navigate('/tasks?tab=automations')}><span className="time">{a.schedule}</span><span>{a.title}</span></button>)}{due.map(t=><button className="about-row" key={t.id} onClick={()=>ctx.navigate(`/tasks?task=${t.id}`)}><span className="time">{t.dueDate?.slice(5,10)}</span><span>{t.title}</span></button>)}{!upcoming.length&&!due.length&&<span className="small muted">{zh?'可以安排一个持续推进的行动。':t("Schedule an action to keep things moving.")}</span>}</div>
 <div className="about-card"><h2>{zh?'目标':t("Goals")}</h2>{state.projects.slice(0,3).map(p=>{const tasks=state.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>['done','completed'].includes(t.status)).length;return <button key={p.id} style={{display:'flex',flexDirection:'column',gap:6,padding:0,background:'transparent',textAlign:'left'}} onClick={()=>ctx.navigate(`/tasks?project=${p.id}`)}><div style={{display:'flex',justifyContent:'space-between',gap:8,width:'100%',fontSize:14}}><span>{p.title||p.name}</span><span className="small muted">{done}  {t("of")} {tasks.length}  {t("steps")}</span></div><div className="progress-track" style={{width:'100%'}}><span style={{width:`${tasks.length?done/tasks.length*100:0}%`}}/></div></button>})}<span className="small muted">{zh?'来自你的项目和待办进度。':t("Your twin tracks these from your tasks and projects.")}</span><button className="btn btn-small" style={{alignSelf:'flex-start'}} onClick={()=>ctx.navigate('/tasks')}>{zh?'查看任务':t("View tasks")}</button></div>
 <div className="about-card"><h2>{zh?'分身制作的文件':t("Files your twin made")}</h2>{[...state.artifacts].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5).map(a=><a key={a.id} className="about-file" href={a.url} target="_blank" rel="noreferrer"><span className={`file-badge ${artifactBadge(a).toLowerCase()}`}>{artifactBadge(a)}</span><span className="name">{a.name}</span><span className="small muted">{a.createdAt?.slice(5,10)}</span></a>)}{!state.artifacts.length&&<span className="small muted">{zh?'在对话中制作报告或图表。':t("Make a report or chart in your conversation.")}</span>}</div>
 <div className="about-card"><h2>{zh?'分身记住的事':t("What your twin knows")}</h2>{state.memories.slice(0,3).map(m=><span key={m.id} className="about-memory" title={m.title}>{String(m.content||m.body||m.title).replace(/[#*_`]/g,'').slice(0,170)}</span>)}<button className="btn btn-small" style={{alignSelf:'flex-start'}} onClick={()=>ctx.navigate('/settings/identity?memory=1')}>{zh?'查看与编辑记忆':t("See and edit memory")}</button></div>
 <div className="about-card"><h2>{zh?'来源上下文':t("Your sources")}</h2><button className="about-row" onClick={()=>ctx.navigate('/sources')}><FileText size={16}/><span>{t("Meetings, messages and mail")}</span><ChevronRight size={14}/></button><button className="about-row" onClick={()=>ctx.navigate('/settings/connections')}><span className="online-dot"/><span>{t("Connections")}</span><ChevronRight size={14}/></button></div></aside>
 {automationOpen&&<Modal title={t("Schedule an action")} onClose={()=>setAutomationOpen(false)}><form onSubmit={async e=>{e.preventDefault();setCreating(true);try{await api.post('/automations',{...automation,enabled:true});await ctx.refresh();setAutomationOpen(false);ctx.navigate('/tasks?tab=automations')}catch(error){ctx.notify((error as Error).message,'error')}finally{setCreating(false)}}}><div className="modal-body"><label>{t("Title")}<input className="field" required value={automation.title} onChange={e=>setAutomation({...automation,title:e.target.value})}/></label><label>{t("What should your twin do?")}<textarea className="field" required rows={4} value={automation.prompt} onChange={e=>setAutomation({...automation,prompt:e.target.value})}/></label><label>{t("Schedule")}<select className="field" value={automation.schedule} onChange={e=>setAutomation({...automation,schedule:e.target.value})}><option value="daily 08:00">{t("Daily at 8:00 am")}</option><option value="weekly monday 08:00">{t("Mondays at 8:00 am")}</option><option value="every 60 minutes">{t("Every hour")}</option><option value="every 1 minutes">{t("Every minute")}</option></select></label></div><div className="modal-actions"><button type="button" className="btn" onClick={()=>setAutomationOpen(false)}>{t("Cancel")}</button><button className="btn btn-primary" disabled={creating}>{t("Create schedule")}</button></div></form></Modal>}
 </div>
}
export function FloatingTwin({ctx,onClose}:{ctx:UIContext;onClose:()=>void}){ const { t, language } = useI18n();
 const [size,setSize]=useState(()=>{try{const value=JSON.parse(localStorage.getItem('opsadv-twin-size')||'null');if(Number.isFinite(value?.width)&&Number.isFinite(value?.height))return {width:Math.max(340,value.width),height:Math.max(400,value.height)}}catch{}return {width:420,height:825}});
 const [position,setPosition]=useState({left:232,top:16});
 const drag=useRef<{x:number;y:number;width:number;height:number;left:number;top:number;corner:string}|null>(null);
 useEffect(()=>{try{localStorage.setItem('opsadv-twin-size',JSON.stringify(size))}catch{}},[size]);
 const dialog=useRef<HTMLElement>(null);const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const backgrounds=[...document.querySelectorAll<HTMLElement>('.chat-center .chat-composer-wrap')];const previous=backgrounds.map(node=>node.inert);backgrounds.forEach(node=>node.inert=true);return()=>backgrounds.forEach((node,index)=>node.inert=previous[index]);},[]);
 useEffect(()=>{
  const align=()=>{
   const mobile=innerWidth<=720,anchor=document.querySelector('.twin-entry')?.getBoundingClientRect();
   const left=mobile?12:Math.min((anchor?.right??220)+12,innerWidth-352);
   const bottom=mobile?innerHeight-12:Math.min(anchor?.bottom??innerHeight-20,innerHeight-12);
   setSize(current=>{const next={width:Math.min(current.width,innerWidth-left-12),height:Math.min(current.height,bottom-(mobile?68:12))};setPosition({left,top:bottom-next.height});return next});
  };
  const outside=(event:PointerEvent)=>{const target=event.target as Element;if(!drag.current&&!dialog.current?.contains(target)&&!target.closest('[data-twin-trigger]'))close.current()};
  align();window.addEventListener('resize',align);document.addEventListener('pointerdown',outside);
  return()=>{window.removeEventListener('resize',align);document.removeEventListener('pointerdown',outside)};
 },[]);
 const resize=(d:NonNullable<typeof drag.current>,dx:number,dy:number)=>{
  const west=d.corner.includes('w'),north=d.corner.includes('n');
  const minWidth=Math.min(340,innerWidth-24),minHeight=Math.min(400,innerHeight-80);
  const width=Math.max(minWidth,Math.min(west?d.left+d.width-12:innerWidth-d.left-12,d.width+(west?-dx:dx)));
  const height=Math.max(minHeight,Math.min(north?d.top+d.height-(innerWidth<=720?68:12):innerHeight-d.top-12,d.height+(north?-dy:dy)));
  setSize({width,height});setPosition({left:west?d.left+d.width-width:d.left,top:north?d.top+d.height-height:d.top});
 };
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape')close.current();if(event.key==='Tab'&&!document.body.classList.contains('file-preview-open')){const controls=[...dialog.current!.querySelectorAll<HTMLElement>('button,a,input,textarea,select,[tabindex="0"]')].filter(node=>!node.hasAttribute('disabled')&&node.getClientRects().length);const first=controls[0],last=controls.at(-1);if(!dialog.current?.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first)?.focus()}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}};document.addEventListener('keydown',keyboard);return()=>{document.removeEventListener('keydown',keyboard);previous?.focus()};},[]);
 return <section ref={dialog} className="floating-twin" style={{width:size.width,height:size.height,left:position.left,top:position.top,bottom:'auto',right:'auto'}} role="dialog" aria-label={t("Ask your twin")}>{['nw','ne','sw','se'].map(corner=><button key={corner} className={`twin-resize twin-resize-${corner}`} aria-label={`${t("Resize twin window")} (${corner})`} onPointerDown={e=>{e.preventDefault();const box=dialog.current!.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,width:box.width,height:box.height,left:box.left,top:box.top,corner};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current)resize(drag.current,e.clientX-drag.current.x,e.clientY-drag.current.y)}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onLostPointerCapture={()=>{drag.current=null}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const box=dialog.current!.getBoundingClientRect();resize({x:0,y:0,width:box.width,height:box.height,left:box.left,top:box.top,corner},e.key==='ArrowRight'?20:e.key==='ArrowLeft'?-20:0,e.key==='ArrowDown'?20:e.key==='ArrowUp'?-20:0)}}/>)}<header className="floating-header"><TwinMark size={28}/><strong>{t("Ask your twin")}</strong><button className="icon-button" aria-label={t("Expand twin conversation")} onClick={()=>{onClose();ctx.navigate('/chat')}}><Maximize2 size={16}/></button><button className="icon-button" aria-label={t("Close twin window")} onClick={onClose}><X size={16}/></button></header><Conversation ctx={ctx} floating onExpand={()=>ctx.navigate('/chat')}/></section>
}
