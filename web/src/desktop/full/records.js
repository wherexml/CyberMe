/* Read-only presentation of the server's saved execution evidence. */
(() => {
 const D=window.OpsTwinsDesktop;
 const labels={input:'请求参数',output:'执行结果',query:'查询',action:'操作',kind:'类型',id:'标识',items:'结果列表',content:'正文',text:'内容',title:'标题',summary:'摘要',message:'说明',error:'错误',status:'状态',total:'总数',count:'数量',hasMore:'还有更多',sourceId:'来源',contextIds:'所选上下文',operation:'操作',path:'路径',result:'结果',data:'数据'};
 const names={load_user_context:'读取用户上下文',load_context:'读取所选资料',get_app_capabilities:'查看应用能力',app_read:'读取应用资料',app_write:'更新应用资料',search:'搜索资料'};
 function valueView(value){
  if(value===null||value===undefined)return node('p','record-empty','未保存此项内容');
  if(typeof value!=='object')return node('div','record-text',typeof value==='boolean'?(value?'是':'否'):String(value));
  if(Array.isArray(value)){const list=node('ol','record-values');if(!value.length)return node('p','record-empty','无条目');for(const item of value){const row=node('li');row.append(valueView(item));list.append(row)}return list}
  const list=node('dl','record-fields');for(const [key,value0] of Object.entries(value)){const row=node('div','record-field');row.append(node('dt','',labels[key]||key));const body=node('dd');body.append(/^(authorization|cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(key)?node('span','','已隐藏'):valueView(value0));row.append(body);list.append(row)}return list.children.length?list:node('p','record-empty','无已保存字段');
 }
 D.renderRecord=(box,record,run)=>{
  box.replaceChildren();const state=record.status||run.status||'unknown';const head=node('div','record-overview');head.append(node('span','record-status',status(state)),node('span','record-count',`${(run.tools||[]).length} 个执行步骤`));box.append(head);
  const outcome=run.taskOutcome||record.taskOutcome;const summary=outcome?.summary||outcome?.message||run.summary||record.summary;
  if(typeof summary==='string')box.append(node('p','record-summary',summary));
  if(run.error||record.error)box.append(node('p','desktop-error',String(run.error||record.error)));
  if(state==='partial')box.append(node('p','record-summary','部分操作已完成，不能重新执行原请求'));
  for(const [index,tool] of (run.tools||[]).entries()){
   const details=node('details','record-step'),heading=node('summary');heading.append(node('span','record-step-number',String(index+1)),node('span','record-step-title',tool.title||names[tool.name]||tool.name||'执行步骤'),node('span','record-step-status',status(tool.status)||'未知'));details.append(heading);
   const content=node('div','record-step-body');content.append(node('p','record-tool-name',tool.name||''));
   for(const [key,label] of [['input','请求参数'],['output','执行结果']]){const section=node('section','record-section');section.append(node('h4','',label),valueView(tool[key]));content.append(section)}
   if(tool.error)content.append(node('p','desktop-error',String(tool.error)));details.append(content);box.append(details);
  }
  if(record.messageIds)box.append(node('p','record-summary','已确认 '+record.messageIds.length+' 条消息回执'));
  if(!summary&&!run.tools?.length&&!record.messageIds)box.append(node('p','record-empty','没有已保存的操作摘要'));
 };
 D.alignChatActions=()=>requestAnimationFrame(()=>{
  for(const article of document.querySelectorAll('#messages .message')){
   const bubble=article.querySelector('.bubble'),actions=article.querySelector('.msg-actions'),button=actions?.querySelector('button');
   if(!bubble||!actions||!button||!bubble.getClientRects().length)continue;
   const style=getComputedStyle(bubble),textLeft=bubble.getBoundingClientRect().left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);
   // Position the glyph itself at this message's body inset, including right-aligned bubbles.
   const glyph=button.querySelector('svg,span')||button;
   const inset=glyph.getBoundingClientRect().left-actions.getBoundingClientRect().left;
   actions.style.right='auto';
   actions.style.left=(textLeft-article.getBoundingClientRect().left-inset)+'px';
  }
 });
 const observer=new ResizeObserver(()=>D.alignChatActions());for(const s of ['.composer','.reading']){const el=document.querySelector(s);if(el)observer.observe(el)}
})();
