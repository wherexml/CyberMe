import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { InboxItem } from '../../../shared/types';
import { api } from '../domain/api';
import { useI18n } from '../domain/i18n';
import { Avatar, dateText } from './Inbox';

type SourceMessage = { id: string; text?: string; sentAt?: string; senderName?: string; senderId?: string; avatarUrl?: string; isMine?: boolean; type?: string; attachments?: {name:string;mimeType:string;url:string;sizeBytes:number}[]; error?: string };
// Same URL boundary rules as opstwin/FeishuMessageContent. React escapes all text.
export function MessageText({text}: {text: string}) {
 const parts: ReactNode[] = []; let cursor = 0;
 for (const match of text.matchAll(/https?:\/\/[^\s<]+/gi)) {
  const index = match.index!; parts.push(text.slice(cursor,index));
  const url = match[0].replace(/[),.;:!?\]}>，。；：！？）】》]+$/u,'');
  parts.push(<a key={index} href={url} target="_blank" rel="noopener noreferrer">{url}</a>,match[0].slice(url.length)); cursor=index+match[0].length;
 }
 parts.push(text.slice(cursor)); return <>{parts}</>;
}
function SourceImage({url,name}:{url:string;name:string}) {
 const {language}=useI18n();const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 return failed?<div role="status">{language==='zh-CN'?'图片暂不可用':'Image unavailable'} <button className="op-btn op-btn-secondary op-btn-sm" onClick={()=>{setFailed(false);setAttempt(n=>n+1);}}>{language==='zh-CN'?'重试':'Retry'}</button></div>:<a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${language==='zh-CN'?'查看图片':'View image'}: ${name}`}><img key={attempt} src={url} alt={name} loading="lazy" onError={()=>setFailed(true)}/></a>;
}
const visible = (m: SourceMessage) => m.type !== 'recalled' && !/^(this message was recalled|此消息已撤回|消息已撤回|该消息已撤回)[.!。]?$/i.test(m.text?.trim() || '') && !(m.type === 'system' && !m.text?.trim());
export function inboxExcerpt(item: InboxItem) {
 const m = (item.messages as SourceMessage[] || []).filter(visible).at(-1);
 if (!m) return item.body;
 const text = m.text || `[${m.type || 'message'}]`;
 const personal = item.chatMode === 'p2p' || (item.id.startsWith('chat-') && item.category === '沟通' && item.chatMode !== 'group');
 return personal ? text : `${m.senderName || item.sender}: ${text}`;
}
export function InboxMessages({item, full = false}: {item: InboxItem; full?: boolean}) {
 const {language} = useI18n(), zh = language === 'zh-CN';
 const [history,setHistory] = useState<SourceMessage[] | null>(null), [offset,setOffset] = useState(0), [more,setMore] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
 const [retry,setRetry] = useState(0);
 const scroller = useRef<HTMLDivElement>(null);
 const paging = useRef<AbortController | null>(null);
 useEffect(()=>()=>{paging.current?.abort();paging.current=null;},[item.id]);
 const imported = item.id.startsWith('chat-') && item.sourceId;
 useEffect(() => {
  setHistory(null);setOffset(0);setMore(false);setError('');
  if (!imported) return;
  const controller = new AbortController(); setBusy(true);
  api.get<any>(`/api/sources/chats/${encodeURIComponent(item.sourceId!)}/messages?limit=${full?80:20}`,{signal:controller.signal}).then(result=>{
   if(controller.signal.aborted)return;setHistory(result.messages.slice().reverse());setOffset(result.nextOffset);setMore(result.hasMore);
  }).catch(e=>{if(!controller.signal.aborted)setError(String(e.message||e));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return ()=>controller.abort();
 },[item.id,imported,full,retry]);
 const messages: SourceMessage[] = history || item.messages || [];
 const shown = messages.filter(visible);
 useEffect(()=>{if(scroller.current && !full)scroller.current.scrollTop=scroller.current.scrollHeight;},[item.id,item.updatedAt,full,history]);
 async function older() {
  if(busy||paging.current)return;const controller=new AbortController();paging.current=controller;setBusy(true);setError('');
  try {const result=await api.get<any>(`/api/sources/chats/${encodeURIComponent(item.sourceId!)}/messages?limit=80&offset=${offset}`,{signal:controller.signal});if(controller.signal.aborted)return;setHistory(current=>{const byId=new Map<string,SourceMessage>();for(const m of [...result.messages.slice().reverse(),...(current||[])])byId.set(m.id,m);return [...byId.values()];});setOffset(result.nextOffset);setMore(result.hasMore);}
  catch(e){if(!controller.signal.aborted)setError(String(e instanceof Error?e.message:e));}finally{if(paging.current===controller)paging.current=null;if(!controller.signal.aborted)setBusy(false);}
 }
 return <div className={`op-source-thread${full?' is-full':''}`} ref={scroller} tabIndex={0} aria-label={zh?'会话消息':'Conversation messages'}>
  {full && <div className="op-history-status">{busy?<span role="status">{zh?'正在读取消息…':'Loading messages…'}</span>:more?<button className="op-btn op-btn-secondary op-btn-sm" onClick={older}>{zh?'加载更早消息':'Load earlier messages'}</button>:history?<span>{zh?'已显示全部已同步消息':'All synced messages loaded'}</span>:<span>{zh?'已保存的消息记录':'Saved message history'}</span>}</div>}
  {error&&<div role="alert" className="op-error">{zh?'读取失败，已保存内容仍可查看。':'Could not load history. Saved messages remain available.'}<button className="op-btn op-btn-secondary" onClick={()=>history?older():setRetry(n=>n+1)}>{zh?'重试':'Retry'}</button><details><summary>{zh?'错误详情':'Error details'}</summary>{error}</details></div>}
  {!messages.length?<div className="op-source-plain"><MessageText text={item.body}/></div>:!shown.length?<p className="op-footnote">{zh?'没有可显示的消息':'No visible messages'}</p>:shown.map((m,i)=>{
   const name=m.senderName||m.senderId||(m.isMine?(zh?'我':'Me'):item.sender);
   const imageOnly = m.attachments?.some(a=>a.mimeType.startsWith('image/')) && !m.error && (!m.text?.trim() || /^\[(image|图片)\]$/i.test(m.text.trim()));
   return <div key={m.id || i} className={`op-source-message${m.isMine?' is-mine':''}${m.type==='system'?' is-system':''}`} data-message-id={m.id}>
    {m.type!=='system'&&<Avatar name={name} avatarUrl={m.avatarUrl}/>}
    <div className="op-source-message-main"><div className="op-source-message-meta"><span>{m.isMine?(zh?'我':'Me'):name}</span>{m.sentAt&&<time>{dateText(m.sentAt,false,language)}</time>}</div>{!imageOnly&&<div className="op-source-bubble"><MessageText text={m.error?(zh?'此消息读取失败':'Message could not be read'):m.text || (zh?`[${m.type||'消息'}]`:`[${m.type||'message'}]`)}/></div>}{m.attachments?.map(a=><div className="op-message-attachment" key={a.url}>{a.mimeType.startsWith('image/')?<SourceImage key={a.url} url={a.url} name={a.name}/>:<><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a><small>{a.sizeBytes?` · ${Math.ceil(a.sizeBytes/1024)} KB`:''}</small></>}</div>)}</div>
   </div>;
  })}
 </div>;
}
