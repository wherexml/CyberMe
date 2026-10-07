/* Only static interface nodes are registered before business data is rendered. */
(() => {
 const D=window.OpsTwinsDesktop, originals=[];
 D.translate=text=>window.OPSTWINS_DESIGN_DATA?.settings?.identity?.language==='en'?(window.OPSTWINS_INTERFACE_STRINGS[text]||text):text;
 D.installLocale=()=>{
  const seen=new WeakSet();
  for(const el of document.querySelectorAll('button,label,h1,h2,h3,.settings-nav,.original-heading,.draft-heading,.jev-heading,.judgment,.filterbar')){
   const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let child;
   while(child=walker.nextNode())if(!seen.has(child)&&window.OPSTWINS_INTERFACE_STRINGS[child.textContent.trim()]){seen.add(child);originals.push([child,child.textContent])}
  }
  for(const el of document.querySelectorAll('[aria-label],[placeholder]'))for(const attr of ['aria-label','placeholder'])if(window.OPSTWINS_INTERFACE_STRINGS[el.getAttribute(attr)])originals.push([el,el.getAttribute(attr),attr]);
  D.localizeStatic();
 };
 D.localizeStatic=()=>{
  document.documentElement.lang=window.OPSTWINS_DESIGN_DATA?.settings?.identity?.language||'zh-CN';
  for(const [el,text,attr] of originals){if(!el.isConnected)continue;const value=D.translate(text.trim());if(attr)el.setAttribute(attr,value);else el.textContent=value}
 };
})();
