/* Canonical background generation, reversible history and recovery. */
(() => {
 const D=window.OpsTwinsDesktop,T=s=>D.translate(s),api=(...a)=>D.api(...a);
 const historyStatuses=['deferred','dismissed','archived','merged','executed','completed'];
 let history=false,background=null,reading=false,submitting=false;
 const originalRender=renderIdeas;
 ideaIsIgnored=idea=>history?!historyStatuses.includes(idea.status):historyStatuses.includes(idea.status);
 ignoreIdea=async idea=>{try{await api('PATCH','/api/ideas/'+encodeURIComponent(idea.id),{status:historyStatuses.includes(idea.status)?'new':'deferred',baseUpdatedAt:idea.updatedAt});await D.refresh();if($('#detail-dialog').open)$('#detail-dialog').close()}catch(e){toast(e.message)}};
 renderIdeas=()=>{
  originalRender();
  const root=$('#ideas-categories'),toggle=btn(T(history?'当前':'历史'),()=>{history=!history;renderIdeas()});toggle.id='ideas-history';toggle.setAttribute('aria-pressed',String(history));root.append(toggle);
  const cards=$$('#idea-items .idea-card'),shown=data.ideas.filter(i=>!ideaIsIgnored(i)&&(ideaCategory==='all'||ideaCategoryKey(i.category)===ideaCategory));
  for(let i=0;i<cards.length;i++){const idea=shown[i];if(!idea)continue;cards[i].dataset.ideaId=idea.id;const button=cards[i].querySelector('.idea-ignore');if(button)button.textContent=T(history?'恢复':'忽略');const label=cards[i].querySelector('.idea-meta');if(label&&history){const reason={merged:'已合并',resolved:'已解决',superseded:'已被新安排替代',stale:'已过时',source_unavailable:'来源不可用'};label.textContent=T(reason[idea.retirementReason]||'已收起')}}
  const section=$('#idea-items .idea-section-label');if(section)section.textContent=T(history?'历史':'工作区建议');
  const empty=$('#idea-items .data-empty');if(empty)empty.textContent=T(history?'暂无历史建议':'暂无新建议');
  const button=$('#ideas-think');button.disabled=submitting||background?.status==='running';button.textContent=T(background?.status==='running'?'正在更新…':'生成建议');
  if(background&&['failed','unknown'].includes(background.status)){const retry=btn(T(background.status==='unknown'?'更新中断 · 重试':'更新失败 · 重试'),()=>void generate());retry.id='ideas-retry';root.append(retry)}
 };
 async function read(){if(reading||document.hidden||current!=='ideas')return;reading=true;try{background=await api('GET','/api/ideas/background');renderIdeas()}catch{/* Existing workspace error handling remains authoritative. */}finally{reading=false}}
 async function generate(){if(submitting)return;submitting=true;renderIdeas();try{await api('POST','/api/ideas/refresh',{prompt:$('#ideas-prompt').value||''});history=false;await D.refresh()}catch(e){toast(e.message)}finally{submitting=false;await read();renderIdeas()}}
 $('#ideas-think').onclick=()=>void generate();
 const previousGo=go;go=page=>{previousGo(page);if(page==='ideas')void read()};
 setInterval(()=>void read(),5000);renderIdeas();void read();
})();
