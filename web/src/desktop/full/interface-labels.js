/* Localize interface names only; saved titles and business text remain canonical. */
(()=>{
 const D=window.OpsTwinsDesktop;
 Promise.resolve(D.refinementReady).then(()=>{
  const actionNames=['消息操作','添加表情','添加到对话并追问','引用追问','更多消息操作','移除引用'];
  const actionLabels=()=>{
   for(const el of document.querySelectorAll('#messages .message-actions,#messages .message-actions button,#v17-quotes button'))for(const attr of ['aria-label','title']){
    const current=el.getAttribute(attr);if(!current)continue;
    const source=actionNames.find(s=>s===current||window.OPSTWINS_INTERFACE_STRINGS[s]===current);if(!source)continue;
    const next=D.translate(source);if(next!==current)el.setAttribute(attr,next);
   }
  };
  const localize=D.localizeStatic;D.localizeStatic=()=>{localize();actionLabels()};
  const column=document.querySelector('#view-chat .chat-column');if(column)new MutationObserver(actionLabels).observe(column,{childList:true,subtree:true});
  const previous=D.localizeInbox;
  D.localizeInbox=()=>{
   previous?.();
   const detail=document.querySelector('#view-inbox .detail-scroll');
   detail?.setAttribute('aria-label',D.translate('收件箱正文'));
   const names={reply:'需要回复',review:'需要你决策',deep:'需要深度思考'};
   const descriptions=['待判断','判断失败','规则判定','没有已保存概率'];
   for(const [key,name]of Object.entries(names)){
    const meter=document.getElementById('meter-'+key);if(!meter)continue;
    const raw=meter.getAttribute('aria-label')||'',at=raw.search(/[：:]/u);if(at<0)continue;
    const suffix=raw.slice(at+1).trim(),source=descriptions.find(s=>s===suffix||window.OPSTWINS_INTERFACE_STRINGS[s]===suffix)||suffix;
    const label=D.translate(name)+(document.documentElement.lang==='en'?': ':'：')+D.translate(source);
    if(meter.getAttribute('aria-label')!==label)meter.setAttribute('aria-label',label);
    if(meter.title!==label)meter.title=label;
   }
  };
  D.localizeInbox();
  actionLabels();
 });
})();
