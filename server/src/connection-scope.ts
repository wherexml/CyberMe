/** Resolve saved scopes against actual provider chat identity before message reads. */
export function selectedChatScope(chat:any,chats:any[],config:any):any|undefined {
 if(!Array.isArray(config?.scopes))return {id:'legacy-all',mode:'draft'};
 const id=String(chat.chat_id||chat.id||'');
 return config.scopes.filter((scope:any)=>scope.enabled===true).find((scope:any)=>{
  if(scope.id==='all')return true;
  if(scope.id==='dm')return chat.chat_mode==='p2p';
  const target=String(scope.chatId||scope.sourceId||scope.name||'').trim();
  if(target===id)return true;
  return !!target&&target===chat.name&&chats.filter(c=>c.name===target).length===1;
 });
}
export function unresolvedScopes(chats:any[],config:any){
 return (Array.isArray(config?.scopes)?config.scopes:[]).filter((s:any)=>s.enabled===true&&!['all','dm'].includes(s.id)&&!chats.some(chat=>selectedChatScope(chat,chats,{scopes:[s]}))).map((s:any)=>({id:s.id,name:s.name,reason:'No unique matching chat in fetched conversation list'}));
}
export function matchesConnectionFilter(chat:any,message:any,filter:unknown){
 const query=typeof filter==='string'?filter.trim().toLocaleLowerCase():'';
 return !query||[chat.name,message.senderName,message.senderId,message.text].some(value=>String(value||'').toLocaleLowerCase().includes(query));
}
