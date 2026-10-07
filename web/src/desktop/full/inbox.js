/* Canonical Inbox presentation. Design previews never stand in for production progress. */
(() => {
 const B=window.OpsTwinsBusinessUI,D=window.OpsTwinsDesktop,enc=encodeURIComponent;
 const analyzing=new Set(),manualReplies=new Set(),resolvedPreparations=new Map();
 const terminal=new Set(['done','dismissed','sent','delivered','recalled','cancelled']);
 function project(){for(const item of data.inbox){item.quiet=B.isQuietInbox(item);item.attention=B.needsInboxAttention(item)||Object.hasOwn(local.drafts,item.id)}}
 const previousRender=renderInbox;
 renderInbox=()=>{
  project();previousRender();const item=data.inbox.find(x=>x.id===selected);if(!item)return;
  const noReply=B.hasNoReplyDecision(item)&&!manualReplies.has(item.id)&&!item.editedByUser&&!item.draftCandidate&&!Object.hasOwn(local.drafts,item.id),closed=terminal.has(item.status),locked=['sending','send_unknown','sent','delivered','recalled'].includes(item.status);
  const draft=$('#draft');draft.hidden=noReply||closed;draft.contentEditable=String(!locked&&!noReply&&!closed);
  $('.draft-heading').hidden=noReply||closed;
  $('#retry-draft').disabled=locked||noReply||closed||$('#retry-draft').disabled;
  $('#send-reply').disabled=locked||noReply||closed||!(local.drafts[item.id]??item.draft??'').trim();
  if(locked){$('#send-reply').disabled=false;$('#send-reply').textContent=['sent','delivered'].includes(item.status)?'查看回执':'查看发送状态';}
  $('#ignore').disabled=locked;$('#mark-done').disabled=locked;
  let notice=$('#desktop-reply-status');if(!notice){notice=node('p','inline-note');notice.id='desktop-reply-status';notice.setAttribute('role','status');draft.after(notice)}
  const prep=item.draftPreparation;
  const resolved=resolvedPreparations.get(prep?.requestId);
  if(['unknown','running'].includes(prep?.status)&&prep.requestId&&!resolved){$('#retry-draft').disabled=false;$('#retry-draft').textContent='回查原生成';$('#retry-draft').onclick=async()=>{try{const receipt=await D.api('GET','/api/inbox/'+enc(item.id)+'/draft-requests/'+enc(prep.requestId));if(['succeeded','review','failed'].includes(receipt.status))resolvedPreparations.set(prep.requestId,receipt.status);toast('原生成：'+status(receipt.status));await D.refresh()}catch(e){toast(e.status===404?'原生成尚未查到，保留原请求，未重新生成':e.message)}}}
  if(resolved==='failed'){$('#retry-draft').textContent='重试原生成';$('#retry-draft').onclick=async()=>{await D.retryInboxDraft(item.id,prep.requestId);try{const receipt=await D.api('GET','/api/inbox/'+enc(item.id)+'/draft-requests/'+enc(prep.requestId));resolvedPreparations.set(prep.requestId,receipt.status);await D.refresh()}catch(e){toast(e.message)}}}
  notice.textContent=noReply?(item.quiet?'无需回复，已保留在安静记录中':'无需回复，此事项仍保留供你查看判断依据'):closed?'此事项已结束，无需准备回复':item.draftError?'草稿生成失败：'+item.draftError:prep?.status==='queued'?'回复正在排队':prep?.status==='running'?'正在生成回复…':prep?.status==='unknown'&&!resolved?'上次生成结果未确认，请回查原请求':(prep?.status==='failed'||resolved==='failed')?'草稿生成失败，可重新生成':prep?.status==='review'?'需要先检查回复判断或生成候选':draft.textContent.trim()?'':'暂无回复草稿';
  if(noReply&&!closed&&!locked)notice.append(btn('手动回复',()=>{manualReplies.add(item.id);local.drafts[item.id]='';save();renderInbox();$('#draft').focus()}));
  let judgment=$('#desktop-judgment-status');if(!judgment){judgment=node('div','inline-note');judgment.id='desktop-judgment-status';$('#jev-warning').after(judgment)}
  judgment.replaceChildren();const t=item.triage;
  judgment.append(node('span','',analyzing.has(item.id)||t?.status==='running'?'正在判断是否需要回复…':t?.status==='failed'?(t.error||'判断失败，请重试'):t?.status!=='succeeded'?'尚未判断是否需要回复':t.route==='no_reply'?'无需回复':t.route==='review'?'需要你查看判断依据':'已完成回复判断'));
  if(t?.status!=='running')judgment.append(btn(analyzing.has(item.id)?'分析中…':t?.status==='succeeded'?'重新分析':'分析回复需要',()=>void analyze(item.id),'desktop-triage-retry'));
  judgment.querySelector('button')?.toggleAttribute('disabled',analyzing.has(item.id));
  if(item.quiet)judgment.append(btn('恢复到待处理',async()=>{try{const row=await D.api('POST','/api/inbox/'+enc(item.id)+'/surface',{});data.inbox[data.inbox.findIndex(x=>x.id===item.id)]=row;renderInbox()}catch(e){toast(e.message)}}));
  const oninput=draft.oninput;draft.oninput=e=>{oninput?.(e);draft.classList.toggle('empty',!draft.innerText.trim());$('#send-reply').disabled=!draft.innerText.trim()||locked};
 };
 renderReply=item=>{
  const draft=$('#draft');if(draft.dataset.itemId===item.id&&draft.contains(document.activeElement))return;
  draft.dataset.itemId=item.id;draft.textContent=local.drafts[item.id]??item.draft??'';
  draft.classList.toggle('empty',!draft.textContent.trim());draft.dataset.placeholder='输入回复内容';
 };
 async function analyze(id){if(analyzing.has(id))return;analyzing.add(id);renderInbox();try{await D.api('POST','/api/inbox/'+enc(id)+'/triage',{force:true});await D.refresh()}catch(e){toast(e.message)}finally{analyzing.delete(id);renderInbox()}}
 $('#view-reply-analysis').onclick=async()=>{
  const item=data.inbox.find(x=>x.id===selected);if(!item)return;
  const box=node('div','reply-analysis');box.append(node('p','',item.triage?.status==='succeeded'?(triageReasons[item.triage.reason]||'已保存回复判断'):item.triage?.error||'尚无已保存判断'));box.append(btn('重新分析',()=>void analyze(item.id)));openDialog('回复分析','实际判断与生成记录',box);
  const runId=item.draftRunId;const prep=item.draftPreparation;
  if(prep)box.append(node('p','','草稿状态：'+({queued:'排队中',running:'生成中',succeeded:'已完成',failed:'失败',unknown:'结果未知',review:'待检查',skipped:'无需起草'}[prep.status]||'待确认')));
  if(runId)try{const run=await D.api('GET','/api/runs/'+enc(runId));if(!box.isConnected)return;box.append(node('p','','执行状态：'+status(run.status)));if(run.model)box.append(node('p','','生成模型：'+run.model));if(run.error)box.append(node('p','',run.error));for(const tool of run.tools||[])box.append(node('p','',(tool.title||tool.name)+' · '+status(tool.status)))}catch(e){if(box.isConnected)box.append(node('p','',e.message))}
 };
 $('#inspire').onclick=async()=>{
  const item=data.inbox.find(x=>x.id===selected);if(!item)return;const button=$('#inspire');button.disabled=true;
  try{const id='ui-side-'+crypto.randomUUID();await D.createSession(id,'讨论：'+(item.title||item.sender));window.OpsTwinsChatSessions.switchTo(id);go('chat');window.OpsTwinsDesignChat.start({conversationId:id,readOnly:true,contextIds:[...new Set([item.id,...(item.context||[]),...(item.contextIds||[])])],message:'请基于这条收件箱事项核对最新对话是否已结束、是否需要回复，并提出有依据的建议。先读取关联资料，不发送消息或执行外部操作。'});renderChat()}catch(e){toast(e.message)}finally{button.disabled=false}
 };
 renderInbox();
})();
