/* Merge durable local requests and canonical history before rendering time separators.
 * A receipt changing state must never move its original turn to the tail.
 */
(() => {
 function arrange(root,messages,records,appendTime){
  const byId=new Map(messages.map(m=>[m.id,m]));
  const byRequest=new Map(records.map(r=>[r.requestId,r]));
  const ordinal=new Map(records.map((r,i)=>['request:'+r.requestId,i]));
  const byResult=new Map(),byRun=new Map();
  for(const r of records){
   for(const m of [r.result?.userMessage,r.result?.assistantMessage])if(m?.id)byResult.set(m.id,r);
   if(r.runId)byRun.set(r.runId,r);
  }
  const cards=new Map([...root.querySelectorAll(':scope > [data-chat-request]')].map(n=>[n.dataset.chatRequest,n]));
  const groups=new Map();
  const time=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:0};
  function add(key,at,element,rank){
   let group=groups.get(key);if(!group){group={key,at,nodes:[]};groups.set(key,group)}
   group.nodes.push({element,rank});
  }
  for(const element of root.querySelectorAll(':scope > [data-message-id]')){
   const m=byId.get(element.dataset.messageId);if(!m)continue;
   const r=byRequest.get(m.requestId)||byResult.get(m.id)||byRun.get(m.runId);
   // The local card already contains the same user bubble and its recovery UI.
   if(r&&cards.has(r.requestId)&&m.role==='user')continue;
   add(r?'request:'+r.requestId:'message:'+m.id,r?.createdAt||m.createdAt,element,m.role==='user'?0:1);
  }
  for(const [id,element] of cards){const r=byRequest.get(id);add('request:'+id,r?.createdAt,element,0)}
  root.replaceChildren();let previous=null;
  for(const group of [...groups.values()].sort((a,b)=>time(a.at)-time(b.at)||((ordinal.get(a.key)??0)-(ordinal.get(b.key)??0))||a.key.localeCompare(b.key))){
   appendTime(root,group.at,previous);previous=group.at;
   for(const {element} of group.nodes.sort((a,b)=>a.rank-b.rank))root.append(element);
  }
 }
 window.OpsTwinsChatTimeline=Object.freeze({arrange});
})();
