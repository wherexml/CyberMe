/* The message stays ordinary Markdown; only its exact canonical Inbox link navigates. */
(()=>{
 const D=window.OpsTwinsDesktop;
 const previous=renderChat;renderChat=target=>{previous(target);document.querySelectorAll('#messages .inbox-chat-source').forEach(n=>n.remove());for(const message of data.messages){
  if(message.inboxAnalysis?.kind!=='inbox-analysis-v1'||message.inboxAnalysis.state==='unavailable')continue;
  const article=[...document.querySelectorAll('#messages [data-message-id]')].find(n=>n.dataset.messageId===message.id);if(!article)continue;
  const p=document.createElement('p'),a=document.createElement('a');a.href='/inbox?item='+encodeURIComponent(message.inboxAnalysis.itemId);a.textContent=D.translate('打开收件事项');p.className='inbox-chat-source';p.append(a);article.querySelector('.bubble')?.append(p);
 }};if(current==='chat')renderChat();
 document.addEventListener('click',e=>{
  const link=e.target.closest('#messages a');if(!link)return;
  let url;try{url=new URL(link.getAttribute('href'),location.href)}catch{return}
  if(url.origin!==location.origin||url.pathname!=='/inbox'||!url.searchParams.get('item'))return;
  const message=data.messages.find(m=>m.id===link.closest('[data-message-id]')?.dataset.messageId),id=url.searchParams.get('item');
  if(message?.inboxAnalysis?.kind!=='inbox-analysis-v1'||message.inboxAnalysis.itemId!==id)return;
  e.preventDefault();e.stopImmediatePropagation();void openSearchResult({type:'inbox',item:{id}});
 },true);
})();
