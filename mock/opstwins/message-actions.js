import {esc,icon,ib,button} from './ui.js';
const reactions=['👍','❤️','😄','😮','🎉'],copied=new Map();
let api=null,menu=null,opener=null,owner=null;
const key=(sid,id)=>sid+'\n'+id;
export function messageActionsMarkup(message,sessionId){
 const attrs=`data-message-id="${esc(message.id)}" data-session-id="${esc(sessionId)}"`;
 const control=(label,action,glyph)=>`<button type="button" class="icon-button ${action==='more'&&copied.has(key(sessionId,message.id))?'copied':''}" data-message-action="${action}" ${attrs} aria-label="${label}" title="${label}" aria-haspopup="menu" aria-expanded="false">${icon(glyph)}</button>`;
 return `<div class="message-actions" role="toolbar" aria-label="消息操作">${control('添加表情','reactions','smile')}<button type="button" class="icon-button" data-action="quote-source:message:${encodeURIComponent(message.id)}:${encodeURIComponent(sessionId)}" aria-label="添加到对话并追问" title="引用追问">${icon('reply')}</button>${control('更多消息操作','more',copied.has(key(sessionId,message.id))?'check':'more')}</div>`;
}
export function messageReactionMarkup(message,sessionId){return reactions.includes(message.reaction)?`<button type="button" class="message-reaction" data-message-action="reactions" data-message-id="${esc(message.id)}" data-session-id="${esc(sessionId)}" aria-label="修改消息表情">${message.reaction}</button>`:''}
function findMessage(sid,id){return api?.getState().sessions.find(x=>x.id===sid)?.messages.find(x=>x.id===id)}
function current(){return owner&&api?.getUI().page==='chat'&&!api.getUI().setting&&api.getUI().session===owner.sid&&findMessage(owner.sid,owner.id)}
function close(focus=false){const old=opener;menu?.remove();menu=null;if(old?.isConnected){old.setAttribute('aria-expanded','false');if(focus)old.focus({preventScroll:true})}opener=null;owner=null}
function position(){if(!menu||!opener?.isConnected||!current()){close();return}const host=menu.parentElement,bounds=host.getBoundingClientRect(),a=opener.getBoundingClientRect(),sx=bounds.width/host.offsetWidth,sy=bounds.height/host.offsetHeight,w=menu.offsetWidth,h=menu.offsetHeight;
 const x=(a.right-bounds.left)/sx-w,y=(a.bottom-bounds.top)/sy+7,above=(a.top-bounds.top)/sy-h-7;menu.style.left=Math.max(10,Math.min(host.offsetWidth-w-10,x))+'px';menu.style.top=Math.max(10,Math.min(host.offsetHeight-h-10,y+h<=host.offsetHeight-10?y:above))+'px';}
function open(button,kind){if(opener===button){close(true);return}close();const sid=button.dataset.sessionId,id=button.dataset.messageId,m=findMessage(sid,id);if(!m)return;owner={sid,id};opener=button;
 const host=button.closest('.prototype-canvas')||button.closest('.desktop-window')||document.body;menu=document.createElement('div');menu.className='message-context-menu'+(kind==='reactions'?' reaction-menu':'');menu.setAttribute('role','menu');menu.setAttribute('aria-label',kind==='reactions'?'消息表情':'消息操作');
 const action=(label,name,glyph,extra='')=>`<button type="button" role="menuitem" data-message-menu-action="${name}" ${extra}>${icon(glyph)}<span>${label}</span></button>`;
 menu.innerHTML=kind==='reactions'?reactions.map(emoji=>`<button type="button" role="menuitemradio" data-message-menu-action="reaction" data-reaction="${emoji}" aria-label="${emoji}" aria-checked="${m.reaction===emoji}">${emoji}</button>`).join(''):action('复制','copy','copy')+action('复制请求 ID','copy-id','copy',m.requestId?'':'disabled title="此消息没有请求 ID"')+(m.requestId?action('查看请求状态','record','record'):'');
 button.setAttribute('aria-expanded','true');host.append(menu);position();menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});}
function feedback(sid,id){const idKey=key(sid,id),previous=copied.get(idKey);clearTimeout(previous?.timer);const entry={};copied.set(idKey,entry);
 const update=()=>{const root=document.querySelector('.reading');if(root?.dataset.sessionId!==sid)return;const row=[...root.querySelectorAll('.message')].find(x=>x.dataset.messageId===id),b=row?.querySelector('[data-message-action=more]');if(b){b.innerHTML=icon(copied.has(idKey)?'check':'more');b.classList.toggle('copied',copied.has(idKey))}};update();entry.timer=setTimeout(()=>{if(copied.get(idKey)!==entry)return;copied.delete(idKey);update()},2000);}
export function configureMessageActions(callbacks){if(api)return;api=callbacks;
 document.addEventListener('click',async event=>{
  const selected=event.target.closest('[data-message-menu-action]');if(selected&&menu?.contains(selected)){
   event.preventDefault();event.stopImmediatePropagation();if(selected.disabled)return;const m=current(),scope=owner;if(!m||!scope){close();return}const action=selected.dataset.messageMenuAction;
   if(action==='reaction'){const value=selected.dataset.reaction;if(!reactions.includes(value))return;const before=m.reaction;m.reaction=before===value?undefined:value;if(!api.save()){m.reaction=before;return}close();api.render();return}
   if(action==='record'){const requestId=m.requestId;close(true);if(requestId)api.record(requestId);return}
   const text=action==='copy-id'?m.requestId:m.text;if(!text)return;const copyingMenu=menu;
   try{await navigator.clipboard.writeText(String(text));if(menu===copyingMenu&&owner===scope)close(true);feedback(scope.sid,scope.id)}catch{api.toast('浏览器未允许复制，请选择正文复制')}return;
  }
  const button=event.target.closest('[data-message-action]');if(button){event.preventDefault();event.stopImmediatePropagation();open(button,button.dataset.messageAction);return}
  if(menu&&!menu.contains(event.target))close();
 },true);
 document.addEventListener('keydown',event=>{if(!menu)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);return}if(event.key==='Tab'){close(true);return}
  if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();const options=[...menu.querySelectorAll('button:not(:disabled)')],i=options.indexOf(document.activeElement);options[event.key==='Home'?0:event.key==='End'?options.length-1:(i+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+options.length)%options.length]?.focus()}
 },true);
 document.addEventListener('scroll',event=>{if(menu&&!menu.contains(event.target))close()},true);window.addEventListener('resize',()=>close());
 new MutationObserver(()=>{if(menu&&!opener?.isConnected)close()}).observe(document.querySelector('#app'),{childList:true,subtree:true});
}
