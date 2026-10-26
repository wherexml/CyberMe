/* Only static interface nodes are registered before business data is rendered. */
(() => {
 const D=window.OpsTwinsDesktop, originals=[];let uiLanguage;
 D.translate=text=>(uiLanguage||window.OPSTWINS_DESIGN_DATA?.settings?.identity?.language)==='en'?(window.OPSTWINS_INTERFACE_STRINGS[text]||text):text;
 D.installLocale=()=>{
  const seen=new WeakSet();
  for(const el of document.querySelectorAll('button,label,h1,h2,h3,.settings-nav,.original-heading,.draft-heading,.jev-heading,.judgment,.filterbar')){
   const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let child;
   while(child=walker.nextNode())if(!seen.has(child)&&window.OPSTWINS_INTERFACE_STRINGS[child.textContent.trim()]){seen.add(child);originals.push([child,child.textContent])}
  }
  for(const el of document.querySelectorAll('[aria-label],[placeholder],[title]'))for(const attr of ['aria-label','placeholder','title'])if(window.OPSTWINS_INTERFACE_STRINGS[el.getAttribute(attr)])originals.push([el,el.getAttribute(attr),attr]);
  D.localizeStatic();
 };
 // Interface nodes rendered after boot were translated once at creation; re-derive their source
 // string on every switch. Business containers are skipped and only dictionary matches change,
 // so drafts, inputs and message/document text keep their DOM nodes and values.
 const GENERAL='#settings-content[data-v17-section="general"]';
 const IDEA_STATIC='#ideas-categories>button[data-interface-category="true"],.idea-section-label,.idea-meta,.idea-actions>button';
 const INBOX_STATIC='.jev-heading strong,.jev-warning,.inline-note,.inline-note>span,.inline-note>button,#inbox-back,#inbox-items>.data-empty,#inbox-items>button:not(.inbox-item),.v17-source-actions>button,.detail .actions>button,#retry-draft';
 const CHROME=INBOX_STATIC+','+IDEA_STATIC+',#settings-window-title,#ideas-think,#session-toggle,#desktop-memory-open,#desktop-memory-notice button,'+GENERAL+' h1,'+GENERAL+' h2,'+GENERAL+' .ss-row-copy strong,'+GENERAL+' .ss-select-value,'+GENERAL+' button,'+GENERAL+' option';
 const ATTR='.muse-rail,.muse-rail>.nav,#ideas-prompt,#settings-window,'+CHROME+',#input,#send,#attachment-info';
 const BUSINESS='.timeline,.message,.md,.bubble,.settings-markdown,.source-thread,.draft,.inbox-item,.idea-copy,.taskrow,.task-copy,.search-result,.session-row,.session-current,.knowledge-path-row,.record-text,.task-agent-output,.v17-task-document,.desktop-identity details,.memory-row,textarea,[contenteditable]';
 // Icon controls inside messages keep interface labels; these hosts carry business titles in attributes.
 const NAMED='.session-row,.session-current,.md,.settings-markdown,.search-result,.inbox-item,.idea-copy,.task-copy,.knowledge-path-row>span';
 const sources=new WeakMap();let reverse=null;
 function source(current,stored){const strings=window.OPSTWINS_INTERFACE_STRINGS||{};if(strings[current])return current;if(stored&&strings[stored]===current)return stored;if(!reverse){reverse=new Map();for(const [zh,en] of Object.entries(strings))reverse.set(en,reverse.has(en)&&reverse.get(en)!==zh?null:zh)}return reverse.get(current)||null}
 function relocalize(ideasOnly=false,inboxOnly=false){
  const fixed=new Set(originals.map(([node])=>node));
  for(const el of document.querySelectorAll(inboxOnly?INBOX_STATIC:ideasOnly?IDEA_STATIC:CHROME)){if(el.closest(BUSINESS)&&!el.matches(IDEA_STATIC))continue;for(const child of el.childNodes){if(child.nodeType!==Node.TEXT_NODE||fixed.has(child))continue;const raw=child.data,text=raw.trim();if(!text)continue;const zh=source(text,sources.get(child));if(!zh)continue;sources.set(child,zh);const next=D.translate(zh);if(next!==text)child.data=raw.replace(text,next)}}
  for(const el of document.querySelectorAll('#idea-items .idea-open,#idea-items .idea-discuss')){const zh=el.matches('.idea-open')?'查看建议':'深入聊聊',en=window.OPSTWINS_INTERFACE_STRINGS[zh],raw=el.getAttribute('aria-label')||'',known=[zh+'：',en+': '].find(p=>raw.startsWith(p));if(known){const next=D.translate(zh)+(document.documentElement.lang==='en'?': ':'：')+raw.slice(known.length);if(next!==raw)el.setAttribute('aria-label',next)}}
  if(!ideasOnly&&!inboxOnly)for(const el of document.querySelectorAll(ATTR)){if(el.closest(NAMED))continue;const stored=sources.get(el)||{};for(const attr of ['aria-label','placeholder','title']){const text=el.getAttribute(attr);if(!text)continue;const zh=source(text,stored[attr]);if(!zh)continue;stored[attr]=zh;const next=D.translate(zh);if(next!==text)el.setAttribute(attr,next)}sources.set(el,stored)}
 }
 D.localizeStatic=()=>{
  uiLanguage=(typeof prefs!=='undefined'?prefs.language:null)||uiLanguage||window.OPSTWINS_DESIGN_DATA?.settings?.identity?.language||'zh-CN';document.documentElement.lang=uiLanguage;
  for(const [el,text,attr] of originals){if(!el.isConnected)continue;const value=D.translate(text.trim());if(attr)el.setAttribute(attr,value);else el.textContent=value}
  relocalize();D.localizeInbox?.();
 };
 D.localizeInboxStatic=()=>relocalize(false,true);
 const inboxObserver=new MutationObserver(()=>D.localizeInbox?.());for(const root of ['#inbox-items','#detail-meta','.jev-card'].map(q=>document.querySelector(q)).filter(Boolean))inboxObserver.observe(root,{childList:true,subtree:true,characterData:true});
 const ideasRoots=['#idea-items','#ideas-categories'].map(q=>document.querySelector(q)).filter(Boolean);
 const ideasObserver=new MutationObserver(()=>relocalize(true));for(const root of ideasRoots)ideasObserver.observe(root,{childList:true,subtree:true});
})();
