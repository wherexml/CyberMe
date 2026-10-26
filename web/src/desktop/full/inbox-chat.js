/* Reminders are ordinary conversation; source/task associations stay server-side. */
(()=>{
 const D=window.OpsTwinsDesktop;
 const projectionLinks=()=>{document.querySelectorAll('#messages .inbox-chat-source,#messages .idea-chat-source').forEach(n=>n.remove());for(const message of data.messages){
  const inbox=message.inboxAnalysis?.kind==='inbox-analysis-v1'&&message.inboxAnalysis.state!=='unavailable',idea=message.ideaAnalysis?.kind==='idea-insight-v1'&&message.ideaAnalysis.currentIdeaId;
  if(!inbox&&!idea)continue;
  const article=[...document.querySelectorAll('#messages [data-message-id]')].find(n=>n.dataset.messageId===message.id);if(!article)continue;
  // Legacy projection labels are presentation only; retain the saved message verbatim.
  if(idea&&/^(灵感提醒|Idea reminder)$/.test(String(message.content||'').split(/\n\s*\n/)[1]?.trim()||'')){
   const label=[...article.querySelectorAll('.bubble p')].find(p=>/^(灵感提醒|Idea reminder)$/.test(p.textContent.trim()));label?.remove();
  }

 }};
 const previous=renderChat;renderChat=target=>{previous(target);projectionLinks()};if(current==='chat')renderChat();
 // Idea reminders are withdrawn server-side; drop cached copies, including ones outside the loaded page.
 const request=D.api;D.api=async(...args)=>{
  const result=await request(...args);
  try{
   const match=args[0]==='GET'&&/^\/api\/conversations\/([^/?]+)\/messages(?:\?|$)/.exec(String(args[1]||''));
   if(match&&Array.isArray(result?.ideaAnalysisIds)){
    const id=decodeURIComponent(match[1]),live=new Set(result.ideaAnalysisIds),count=data.messages.length;
    data.messages=data.messages.filter(m=>m.conversationId!==id||m.ideaAnalysis?.kind!=='idea-insight-v1'||live.has(m.id));
    // Re-render keeps the composer draft; the timeline restores the reading position.
    if(data.messages.length!==count)setTimeout(()=>{if(current==='chat'&&window.OpsTwinsChatSessions?.selected?.()===id)renderChat()},0);
   }
  }catch{}
  return result;
 };
})();
