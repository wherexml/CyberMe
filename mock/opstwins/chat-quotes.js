import {esc,icon,button,ib} from './ui.js';
import {resolveWorkspaceSource,workspaceSourceBody} from './workspace-demo.js';
function fingerprint(text){let h=2166136261;for(const char of text)h=Math.imul(h^char.codePointAt(0),16777619);return text.length+':'+(h>>>0).toString(16)}
export function sourceAttrs(type,id,session=''){return `data-quote-type="${esc(type)}" data-quote-id="${esc(id)}" data-quote-session="${esc(session)}"`}
export function sourceLinks(refs=[]){return refs.length?`<div class="workspace-links">${refs.map(r=>button(r.label,'source:'+r.type+':'+encodeURIComponent(r.id),'subtle','right')).join('')}</div>`:''}
export function quoteButton(type,id,session=''){return ib('添加到对话并追问','quote-source:'+type+':'+encodeURIComponent(id)+':'+encodeURIComponent(session),'message')}
export function composerQuotes(session,error=''){return (session.draftQuotes||[]).length?`<div class="composer-quotes">${session.draftQuotes.map(q=>`<div class="composer-quote">${icon('message')}<button type="button" class="quote-preview" data-action="quote-preview:${q.id}" title="${esc(q.text)}">${esc(q.text)}</button>${ib('移除引用','quote-remove:'+q.id,'close')}</div>`).join('')}${error?`<div class="quote-save-error" role="status">引用尚未保存 ${button('重试保存','quote-save','subtle')}</div>`:''}</div>`:''}
export function messageQuotes(m){return (m.quotes||[]).length?`<div class="message-quotes">${m.quotes.map(q=>`<blockquote><p>${esc(q.text)}</p>${button(q.sourceTitle,'quote-origin:'+q.id,'subtle','right')}</blockquote>`).join('')}</div>`:''}
export function hydrateMessageIds(state){for(const s of state.sessions)for(const m of s.messages)if(!m.id)m.id=crypto.randomUUID()}
export function createQuoteController({getState,getUI,save,render,toast,info,openSource}){
 let captured=null,popup=null,raf=0;
 function current(){return getState().sessions.find(x=>x.id===getUI().session)||getState().sessions[0]}
 function hide(){captured=null;popup?.remove();popup=null}
 function selection(){
  const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount||getUI().setting||getUI().notes)return null;
  const r=s.getRangeAt(0),element=n=>n.nodeType===1?n:n.parentElement;
  const a=element(r.startContainer),b=element(r.endContainer),root=a?.closest('[data-quote-type]');
  if(!root||root!==b?.closest('[data-quote-type]')||a.closest('input,textarea,button,[contenteditable]')||b.closest('input,textarea,button,[contenteditable]'))return null;
  const text=s.toString().trim();if(!text)return null;
  return {root,body:root.textContent,text,type:root.dataset.quoteType,sourceId:root.dataset.quoteId,sessionId:root.dataset.quoteSession,rect:r.getBoundingClientRect()};
 }
 function readSource(type,id,sessionId){
  if(type==='message'){const sess=getState().sessions.find(x=>x.id===sessionId),m=sess?.messages.find(x=>x.id===id);return m?{title:sess.title,body:m.text}:null}
  const row=resolveWorkspaceSource(getState(),type,id);return row?{title:row.title,body:workspaceSourceBody(type,row)}:null;
 }
 function attach(data){
  const source=readSource(data.type,data.sourceId,data.sessionId);if(!source){toast('原内容已不存在，引用未添加');return}
  if(data.root&&(!data.root.isConnected||data.root.textContent!==data.body)){toast('原内容已变化，请重新选择');hide();return}
  if([...data.text].length>6000){toast('每段最多引用 6000 字，请缩小选区');return}
  const sess=current();if(!sess){toast('没有可用对话');return}
  const list=sess.draftQuotes||[];
  if(list.some(q=>q.text===data.text&&q.type===data.type&&q.sourceId===data.sourceId&&q.sessionId===data.sessionId)){toast('这段内容已在引用中');return}
  if(list.length>=4){toast('最多添加四段引用，请先移除一段');return}
  sess.draftQuotes=[...list,{id:crypto.randomUUID(),text:data.text,type:data.type,sourceId:data.sourceId,sessionId:data.sessionId||'',sourceTitle:source.title,sourceFingerprint:fingerprint(source.body)}];
  save();hide();getSelection()?.removeAllRanges();Object.assign(getUI(),{page:'chat',setting:null,overlay:null,overview:false});render();
  requestAnimationFrame(()=>document.querySelector('[name=message]')?.focus());
 }
 function update(){
  const data=selection();if(!data){hide();return}
  if(captured?.root===data.root&&captured.text===data.text){data.body=captured.body}
  captured=data;
  if(!popup){popup=document.createElement('div');popup.className='selection-quote-toolbar';popup.innerHTML='<button type="button">添加到对话 <kbd>⌘L</kbd></button>';popup.setAttribute('role','toolbar');popup.setAttribute('aria-label','选中文本操作');document.body.append(popup);popup.addEventListener('pointerdown',e=>e.preventDefault());popup.querySelector('button').addEventListener('click',()=>{if(captured)attach(captured)})}
  const r=data.rect,w=popup.offsetWidth,h=popup.offsetHeight;popup.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))+'px';popup.style.top=Math.max(8,r.top>h+12?r.top-h-8:Math.min(innerHeight-h-8,r.bottom+8))+'px';
 }
 document.addEventListener('selectionchange',()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(update)});
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
 document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='l'){const data=selection();if(data){e.preventDefault();e.stopImmediatePropagation();attach(data)}}if(e.key==='Escape'&&popup){e.preventDefault();e.stopImmediatePropagation();hide();getSelection()?.removeAllRanges()}},true);
 return {hide,actions:{
  'quote-source':v=>{const [type,raw,session='']=v.split(':');const id=decodeURIComponent(raw),sessionId=decodeURIComponent(session),source=readSource(type,id,sessionId);if(source)attach({type,sourceId:id,sessionId,text:source.body});else toast('原内容已不存在')},
  'quote-remove':id=>{const sess=current(),before=sess.draftQuotes;sess.draftQuotes=before.filter(q=>q.id!==id);if(!save())sess.draftQuotes=before;render()},
  'quote-save':()=>{save();render()},
  'quote-preview':id=>{const q=current()?.draftQuotes?.find(x=>x.id===id);if(q)info(q.sourceTitle,q.text,['查看来源','quote-origin:'+q.id])},
  'quote-origin':id=>{const q=getState().sessions.flatMap(s=>[...(s.draftQuotes||[]),...s.messages.flatMap(m=>m.quotes||[])]).find(x=>x.id===id);if(!q)return;const source=readSource(q.type,q.sourceId,q.sessionId);if(!source){toast('原内容已不存在，引用原文仍保留');return}if(fingerprint(source.body)!==q.sourceFingerprint)toast('来源已有变化，引用保留添加时的原文');openSource(q.type,q.sourceId,q.sessionId)},
 }};
}
