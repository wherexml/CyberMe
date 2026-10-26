/* Window layout is a local preference, independent of conversations and drafts. */
(() => {
 const panel=document.querySelector('#session-panel'),layout=document.querySelector('.chat-layout');
 if(!panel||!layout)return;
 const key='opstwins-window-layout';let preferred=240,drag=null;
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}');if(Number.isFinite(saved.sessionWidth))preferred=Math.max(200,Math.min(480,saved.sessionWidth))}catch{}
 const handle=document.createElement('div');handle.className='desktop-session-resize';handle.tabIndex=0;
 handle.setAttribute('role','separator');handle.setAttribute('aria-label','调整会话侧栏宽度');handle.setAttribute('aria-orientation','vertical');
 panel.append(handle);
 const limit=()=>Math.max(200,Math.min(480,layout.clientWidth-320));
 function apply(){const width=Math.max(200,Math.min(limit(),preferred));layout.style.setProperty('--desktop-session-width',width+'px');handle.setAttribute('aria-valuemin','200');handle.setAttribute('aria-valuemax',String(limit()));handle.setAttribute('aria-valuenow',String(Math.round(width)))}
 function save(){try{localStorage.setItem(key,JSON.stringify({sessionWidth:preferred}));window.OpsTwinsDesktop.durable().catch(e=>window.dispatchEvent(new CustomEvent('desktop-save-error',{detail:e.message})))}catch(e){window.dispatchEvent(new CustomEvent('desktop-save-error',{detail:e.message}))}}
 handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,width:panel.getBoundingClientRect().width,original:preferred};handle.setPointerCapture(e.pointerId);document.documentElement.classList.add('desktop-resizing')});
 handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;preferred=Math.max(200,Math.min(limit(),drag.width+e.clientX-drag.x));apply()});
 function finish(e,cancel=false){if(!drag||drag.id!==e.pointerId)return;if(cancel)preferred=drag.original;drag=null;document.documentElement.classList.remove('desktop-resizing');if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);apply();if(!cancel)save()}
 handle.addEventListener('pointerup',e=>finish(e));handle.addEventListener('pointercancel',e=>finish(e,true));handle.addEventListener('lostpointercapture',e=>finish(e,true));
 handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();preferred=e.key==='Home'?200:e.key==='End'?limit():Math.max(200,Math.min(limit(),panel.getBoundingClientRect().width+(e.key==='ArrowRight'?16:-16)));apply();save()});
 const observer=new ResizeObserver(apply);observer.observe(layout);apply();
})();

// Native window controls are independent of the chat sidebar and page lifetime.
(() => {
 const interactive='button,input,a,select,textarea,label,summary,[role="button"],[role="separator"],[contenteditable]:not([contenteditable="false"])';
 window.OpsTwinsWindowChrome={closeFrontSurface(){
  const dialogs=[...document.querySelectorAll('dialog[open]')];
  const dialog=dialogs.filter(node=>node.matches(':modal')).at(-1)||document.querySelector('#settings-window[open]')||dialogs.at(-1);
  if(!dialog)return false;
  // Honor the same cancellation/draft guards as Escape before closing.
  if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();
  return true;
 }};
 const shell=document.querySelector('.window');
 if(!shell)return;
 const titlebar=document.createElement('div');titlebar.className='desktop-window-drag-strip';titlebar.setAttribute('aria-hidden','true');shell.append(titlebar);
 if(!window.mygo)return;
 function dragRegion(event){
  const target=event.target;
  if(!(target instanceof Element)||target.closest(interactive))return null;
  const settings=target.closest('#settings-window');
  if(settings)return event.clientY<settings.getBoundingClientRect().top+38?settings:null;
  if(target.closest('dialog'))return null;
  const header=target.closest('.desktop-window-drag-strip,.session-chat-header,.lights');
  if(header)return header;
  const page=target.closest('#view-ideas,#view-tasks');
  const heading=page?.querySelector('.ideas-heading,.tasks > h2');
  return heading&&event.clientY<=heading.getBoundingClientRect().bottom?page:null;
 }
 document.addEventListener('dblclick',e=>{if(e.button===0&&dragRegion(e)){e.preventDefault();void window.mygo.window.toggleMaximize()}});
 document.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  const region=dragRegion(e);if(!region)return;
  e.preventDefault();
  const pointer=e.pointerId,start={x:e.screenX,y:e.screenY};let active=true,pending=null,moving=false,origin=null;
  region.setPointerCapture(pointer);
  const flush=async()=>{if(moving||!origin||!active)return;moving=true;try{while(active&&pending){const target=pending;pending=null;await window.mygo.call('WindowChrome.Move',Math.round(origin.x+target.x-start.x),Math.round(origin.y+target.y-start.y))}}catch(error){window.dispatchEvent(new CustomEvent('desktop-save-error',{detail:error.message}))}finally{moving=false}};
  const move=event=>{if(!active||event.pointerId!==pointer)return;pending={x:event.screenX,y:event.screenY};void flush()};
  const end=event=>{if(event.pointerId!==pointer)return;active=false;pending=null;region.removeEventListener('pointermove',move);region.removeEventListener('pointerup',end);region.removeEventListener('pointercancel',end);region.removeEventListener('lostpointercapture',end);if(region.hasPointerCapture(pointer))region.releasePointerCapture(pointer)};
  region.addEventListener('pointermove',move);region.addEventListener('pointerup',end);region.addEventListener('pointercancel',end);region.addEventListener('lostpointercapture',end);
  window.mygo.call('WindowChrome.Position').then(value=>{if(!active)return;origin=value;void flush()}).catch(error=>{end({pointerId:pointer});window.dispatchEvent(new CustomEvent('desktop-save-error',{detail:error.message}))});
 });
})();
