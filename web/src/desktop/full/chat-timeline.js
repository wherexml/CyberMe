/* Merge durable local requests and canonical history before rendering time separators.
 * A receipt changing state must never move its original turn to the tail.
 */
(() => {
 if(window.OpsTwinsChatTimeline)return;
 let epoch=0,pending=null,following=false,owner='',observed=false;
 function selected(id){return window.OpsTwinsChatSessions?.selected()===id&&document.querySelector('#view-chat')?.classList.contains('active')}
 function cancelFollow(){epoch++;pending=null;following=false}
 function observe(){
  if(observed)return;observed=true;
  const timeline=document.querySelector('#timeline');
  timeline.addEventListener('wheel',cancelFollow,{passive:true});
  timeline.addEventListener('touchstart',cancelFollow,{passive:true});
  timeline.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))cancelFollow()});
  new ResizeObserver(()=>{if(following&&!pending&&selected(owner))timeline.scrollTop=timeline.scrollHeight}).observe(document.querySelector('#messages'));
 }
 function follow(id){observe();owner=id;following=true;pending={id,mode:'bottom',epoch:++epoch}}
 function capture(id,target){
  observe();const timeline=document.querySelector('#timeline'),selection=getSelection();
  const interacting=document.querySelector('#messages').contains(document.activeElement)||!!(selection&&!selection.isCollapsed&&document.querySelector('#messages').contains(selection.anchorNode));
  const prior=pending?.id===id?pending:null;
  const mode=target?'target':prior?.mode||(owner!==id||timeline.scrollHeight-timeline.clientHeight-timeline.scrollTop<48&&!interacting?'bottom':'position');
  owner=id;following=mode==='bottom';
  return pending={id,mode,target:target||prior?.target,top:prior?.top??timeline.scrollTop,epoch:++epoch};
 }
 function commit(state){requestAnimationFrame(()=>{
  if(state.epoch!==epoch||!selected(state.id))return;
  const timeline=document.querySelector('#timeline');
  const target=state.mode==='target'?[...document.querySelectorAll('#messages .message')].find(n=>n.dataset.messageId===state.target):null;
  if(target)timeline.scrollTop+=target.getBoundingClientRect().top-timeline.getBoundingClientRect().top-35;
  else timeline.scrollTop=state.mode==='position'?state.top:timeline.scrollHeight;
  pending=null;
 })}
 function arrange(root,messages,records,appendTime){
  const byId=new Map(messages.map(m=>[m.id,m]));
  const byRequest=new Map(records.map(r=>[r.requestId,r]));
  const ordinal=new Map(records.map((r,i)=>['request:'+r.requestId,i]));
  const canonicalOrder=new Map(messages.map((m,i)=>['message:'+m.id,i]));
  const byResult=new Map(),byRun=new Map();
  for(const r of records){
   for(const m of [r.result?.userMessage,r.result?.assistantMessage])if(m?.id)byResult.set(m.id,r);
   if(r.runId)byRun.set(r.runId,r);
  }
  const cards=new Map([...root.querySelectorAll(':scope > [data-chat-request]')].map(n=>[n.dataset.chatRequest,n]));
  const cardUserIds=new Set([...cards.values()].map(card=>card.querySelector('.message.user')?.dataset.messageId).filter(Boolean));
  const groups=new Map();
  const time=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:0};
  function add(key,at,element,rank){
   let group=groups.get(key);if(!group){group={key,at,nodes:[]};groups.set(key,group)}
   group.nodes.push({element,rank});
  }
  for(const element of root.querySelectorAll(':scope > [data-message-id]')){
   const m=byId.get(element.dataset.messageId);if(!m)continue;
   const r=m.requestId?byRequest.get(m.requestId):byResult.get(m.id)||byRun.get(m.runId);
   // The local card already contains the same user bubble and its recovery UI.
   if(m.role==='user'&&cardUserIds.has(m.id))continue;
   add(r?'request:'+r.requestId:'message:'+m.id,r?.createdAt||m.createdAt,element,m.role==='user'?0:1);
  }
  for(const [id,element] of cards){const r=byRequest.get(id);add('request:'+id,r?.createdAt,element,0)}
  root.replaceChildren();let previous=null;
  for(const group of [...groups.values()].sort((a,b)=>time(a.at)-time(b.at)||((ordinal.get(a.key)??0)-(ordinal.get(b.key)??0))||((canonicalOrder.get(a.key)??0)-(canonicalOrder.get(b.key)??0))||a.key.localeCompare(b.key))){
   appendTime(root,group.at,previous);previous=group.at;
   for(const {element} of group.nodes.sort((a,b)=>a.rank-b.rank))root.append(element);
  }
 }
 window.OpsTwinsChatTimeline=Object.freeze({arrange,capture,commit,follow});
})();
