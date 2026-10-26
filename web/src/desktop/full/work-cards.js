/* Chat work cards: explicit source selection, server choice panels, task and artifact cards.
 * The server owns panels, works, tasks and files; this file only renders canonical projections
 * and keeps durable operation IDs so lost responses are recovered by GET, never re-posted blindly.
 */
(() => {
 const D=window.OpsTwinsDesktop,api=(...a)=>D.api(...a),enc=encodeURIComponent,KEY='opstwins-chat-work-ops-v1';
 const panels=new Map(),works=new Map(),selections=new Map(),busy=new Set(),SOURCE_KEY=KEY+'-sources';
 try{for(const [id,values] of JSON.parse(localStorage.getItem(SOURCE_KEY)||'[]'))if(typeof id==='string'&&Array.isArray(values))selections.set(id,values.filter(s=>typeof s?.id==='string'&&typeof s.title==='string').slice(0,8))}catch{}
 function selectSources(id,values){const next=new Map(selections);if(values.length)next.set(id,values);else next.delete(id);try{localStorage.setItem(SOURCE_KEY,JSON.stringify([...next]));selections.clear();for(const [k,v] of next)selections.set(k,v);return true}catch{toast('资料选择保存失败，当前选择保留');return false}}
 let ops=[],generation=0,timer=0,loadedFor='';
 try{ops=JSON.parse(localStorage.getItem(KEY)||'[]').filter(o=>o?.operationId&&o.kind)}catch{}
 const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(ops.slice(-50)));return true}catch{return false}};
 const settle=op=>{ops=ops.filter(o=>o.operationId!==op.operationId);persist()};
 const EXEC_KEY=KEY+'-executors';let executionSelections={};try{executionSelections=JSON.parse(localStorage.getItem(EXEC_KEY)||'{}')}catch{}
 function execution(){return executionSelections[chatConversation]||{engine:'business'}}
 function saveExecution(id,value){try{const next={...executionSelections,[id]:value};localStorage.setItem(EXEC_KEY,JSON.stringify(next));executionSelections=next;return true}catch{toast('执行选择保存失败，未提交');return false}}
 const LIVE_WORK=['queued','running','cancelling','writing_file','awaiting_approval'];
 const WORK_LABEL={unknown:'结果未确认',partial:'部分完成',awaiting_approval:'待批准',queued:'准备中',running:'整理中',cancelling:'正在停止',writing_file:'保存中',succeeded:'已完成',failed:'失败',file_failed:'文件未通过校验',cancelled:'已停止',interrupted:'已中断'};
 const WORK_ICON={succeeded:'check',failed:'info',file_failed:'info',cancelled:'close',interrupted:'info'};
 const FILE_REASON={not_registered:'文件未登记',file_missing:'文件不存在',file_empty:'文件为空',digest_mismatch:'文件摘要不一致'};

 function absorb(value){if(value?.panel)panels.set(value.panel.id,value.panel);if(value?.work)works.set(value.work.id,value.work)}
 function live(){return [...panels.values()].some(p=>p.conversationId===chatConversation&&p.status==='preparing')||[...works.values()].some(w=>w.conversationId===chatConversation&&LIVE_WORK.includes(w.status))}
 async function load(id=chatConversation){
  if(!id)return;const g=++generation;loadedFor=id;
  try{const before=JSON.stringify([...panels.values(),...works.values()].filter(x=>x.conversationId===id).map(x=>[x.id,x.status,x.updatedAt]));const r=await api('GET','/api/chat/work/conversations/'+enc(id));if(g!==generation||id!==chatConversation)return;for(const p of r.panels)panels.set(p.id,p);for(const w of r.works)works.set(w.id,w);const after=JSON.stringify([...r.panels,...r.works].map(x=>[x.id,x.status,x.updatedAt]));if(before!==after)await D.loadChat?.();paint()}catch{}
  schedule();
 }
 function schedule(){clearTimeout(timer);if(live())timer=setTimeout(()=>void load(),1600)}

 // Lost responses are resolved by the original operation ID only.
 async function reconcile(op){
  try{const r=await api('GET','/api/chat/work/operations/'+enc(op.operationId));absorb(r);settle(op);return r}
  catch(e){op.unregistered=e.status===404;persist();return undefined}
 }

 function sourceTitle(p,id){return p?.sources?.find(s=>s.id===id)?.title||id}
 async function showSource(id){try{const item=await api('GET','/api/memories/'+enc(id));const box=node('div');window.OpsTwinsMarkdown.render(box,item.body||item.content||item.summary||'');openDialog(item.title||'资料','',box)}catch(e){toast(e.message)}}
 function choices(p){
  const box=node('section','work-choices');box.setAttribute('aria-label','整理方向');
  const head=node('div','work-choice-heading'),title=p.status==='preparing'?'正在根据所选资料生成方向…':p.status==='failed'?'未能生成方向':'选择整理方向';
  const jev=p.jev?.status==='succeeded'?'Jev':p.jev?'Jev 未判断':'';
  const tag=node('small','',p.status==='consumed'?'已选择':p.status==='retired'?'已失效':p.status==='stale'?'资料已变化':p.status==='ready'?jev:'');
  if(p.jev&&p.jev.status!=='succeeded')tag.title=p.jev.error||'';
  const heading=node('span','',title);if(p.status==='preparing')heading.setAttribute('role','status');head.append(heading,tag);box.append(head);
  if(p.error&&['failed','stale'].includes(p.status)){const err=node('div','work-resume',p.error);err.setAttribute('role','alert');box.append(err)}
  for(const o of p.options||[]){
   const row=node('div','work-choice'+(p.selectedOptionId===o.id?' selected':'')),pick=node('button','work-choice-pick');pick.type='button';
   pick.disabled=p.status!=='ready'||busy.has(p.id);pick.setAttribute('aria-pressed',String(p.selectedOptionId===o.id));
   const mark=node('span','work-choice-mark');if(p.selectedOptionId===o.id)mark.append(icon('check'));
   const text=node('span');text.append(node('strong','',o.label+(o.recommended?' · 推荐':'')),node('small','',o.summary));
   pick.append(mark,text);pick.onclick=()=>void select(p,o);row.append(pick);
   for(const id of o.sourceIds||[]){const src=node('button','work-source');src.type='button';src.append(icon('link'),document.createTextNode(sourceTitle(p,id)));src.setAttribute('aria-label','查看来源：'+sourceTitle(p,id));src.onclick=()=>void showSource(id);row.append(src)}
   box.append(row);
  }
  return box;
 }
 async function saveFile(a){try{if(window.mygo){await window.mygo.call('DesktopFiles.SaveVerified',a.url,a.name,a.sha256)}else{const r=await fetch(a.url);if(!r.ok)throw Error('文件读取失败');const bytes=await r.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>64*1024*1024)throw Error('文件大小无效');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==a.sha256)throw Error('文件摘要不一致，请重新读取');const link=node('a'),url=URL.createObjectURL(new Blob([bytes],{type:a.mime}));link.href=url;link.download=a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}}catch(e){toast(e.message)}}
 function card(w){
  const s=node('section','work-card');s.setAttribute('aria-label','任务：'+w.title);
  const line=node('button','work-task-line');line.type='button';line.onclick=()=>void openTask(w);
  const state=node('span','',w.native&&w.status==='running'?'执行中':WORK_LABEL[w.status]||'结果未确认');state.setAttribute('role','status');
  line.append(icon(WORK_ICON[w.status]||'tasks'),node('strong','',w.title),state,icon('chevron'));s.append(line);
  for(const a of w.artifacts||[]){
   if(!a.verified){const bad=node('div','work-resume',(a.name||'文件')+'：'+(FILE_REASON[a.reason]||'不可打开'));bad.setAttribute('role','alert');s.append(bad);continue}
   const row=node('div','work-artifact'),open=node('button');open.type='button';open.onclick=()=>void D.previewFile(a.id);
   const label=node('span');label.append(node('strong','',a.name),node('small','',/markdown/.test(a.mime||'')?'Markdown':a.mime||'文件'));
   open.append(icon('file'),label,icon('chevron'));
   const download=node('button','work-download');download.type='button';download.setAttribute('aria-label','下载 '+a.name);const arrow=icon('up');arrow.style.transform='rotate(180deg)';download.append(arrow);download.onclick=()=>void saveFile(a);
   row.append(open,download);s.append(row);
  }
  if(w.error&&w.status!=='succeeded'){const err=node('div','work-resume',w.error);err.setAttribute('role','alert');s.append(err)}
  if(w.native){const controls=node('div','work-resume');controls.append(node('span','work-engine',w.native.engine==='codex'?'Codex':'Claude'),btn('回查执行',()=>void recheckNative(w),'subtle'));if(w.native.receipt?.approval){const a=w.native.receipt.approval;controls.append(btn('查看待批准操作',()=>showNativeApproval(w,a),'subtle'));}s.append(controls);}
  if(['queued','running','awaiting_approval'].includes(w.status)){const box=node('div','work-resume');box.append(btn('停止',()=>void stop(w),'subtle'));s.append(box)}
  if(!w.native&&['interrupted','cancelled','failed'].includes(w.status)&&!(w.artifacts||[]).length){const box=node('div','work-resume');box.append(btn('继续整理',()=>void resume(w),'subtle'));s.append(box)}
  return s;
 }
 async function recheckNative(w){try{absorb(await api('POST','/api/chat/work/items/'+enc(w.id)+'/recheck',{}));await D.loadChat?.();await load()}catch(e){toast(e.message)}}
 function showNativeApproval(w,a){const box=node('div');box.append(node('strong','',a.tool),node('pre','native-approval-detail',JSON.stringify(a.detail,null,2)));for(const [decision,label]of [['deny','拒绝'],['allow','允许本次']])box.append(btn(label,async()=>{try{absorb(await api('POST','/api/chat/work/items/'+enc(w.id)+'/approvals/'+enc(a.id),{decision}));$('#detail-dialog').close();await load()}catch(e){toast(e.message)}}));openDialog('执行审批','',box)}
 async function openTask(w){
  const box=node('div');box.append(node('p','',`状态：${WORK_LABEL[w.status]||'结果未确认'}；任务：${w.task?.missing?'已不存在':w.task?.completed?'已完成':'未完成'}`));
  if(w.error)box.append(node('p','',w.error));
  if(w.native?.receipt)box.append(node('pre','native-approval-detail',JSON.stringify(w.native.receipt,null,2)));
  if(w.runId&&D.showRecord)box.append(btn('查看执行记录',async()=>{try{D.showRecord(await api('GET','/api/runs/'+enc(w.runId)))}catch(e){toast(e.message)}}));
  openDialog(w.title,'',box);
 }
 function pending(text){const n=node('div','work-choices',text);n.setAttribute('role','status');return n}
 function paint(){
  for(const article of $$('#messages [data-message-id]')){
   const m=data.messages.find(x=>x.id===article.dataset.messageId),bubble=article.querySelector('.bubble');if(!bubble)continue;
   bubble.querySelectorAll(':scope > .work-card, :scope > .work-choices').forEach(n=>n.remove());
   const ref=m?.role==='assistant'?m.chatWork:undefined;if(!ref)continue;
   if(ref.panelId){const p=panels.get(ref.panelId);bubble.append(p?choices(p):pending('正在读取选项状态'))}
   if(ref.workId){const w=works.get(ref.workId);bubble.append(w?card(w):pending('正在读取任务状态'))}
  }
  drawRecovery();
 }

 function drawRecovery(){
  $('#chat-work-recovery')?.remove();const pending=ops.filter(o=>o.conversationId===chatConversation);if(!pending.length)return;
  const box=node('div','desktop-recovery');box.id='chat-work-recovery';box.setAttribute('role','status');
  for(const op of pending){const row=node('div');row.append(document.createTextNode('整理结果待确认 '),btn('检查结果',async()=>{await reconcile(op);await D.loadChat?.();await load();drawRecovery()}));
   if(op.unregistered&&op.path&&op.body)row.append(btn('重试',async()=>{if(busy.has(op.operationId))return;busy.add(op.operationId);try{await send(op)}finally{busy.delete(op.operationId);await D.loadChat?.();await load();drawRecovery()}}));box.append(row);}
  $('#composer').before(box);
 }

 // The operation ID is persisted locally before the POST so a lost response is only re-read.
 async function post(op,path,body){
  Object.assign(op,{path,body,conversationId:body?.conversationId||chatConversation});
  ops.push(op);if(!persist()){ops.pop();toast('本机无法记录操作，未提交');return undefined}
  return send(op);
 }
 async function send(op){
  try{const r=await api('POST',op.path,{...op.body,operationId:op.operationId});absorb(r);settle(op);return r}
  catch(e){if(e.status&&e.status<500&&e.status!==408){absorb(e.data?.detail||{});settle(op);toast(e.message);return undefined}return reconcile(op)}
  finally{drawRecovery()}
 }
 async function select(p,o){
  if(busy.has(p.id)||p.status!=='ready')return;busy.add(p.id);paint();
  try{await post({operationId:'cw-select-'+crypto.randomUUID(),kind:'select'},'/api/chat/choices/'+enc(p.id)+'/select',{revision:p.revision,optionId:o.id,conversationId:p.conversationId})}
  finally{busy.delete(p.id);await D.loadChat?.();await load()}
 }
 async function stop(w){try{const r=await api('POST','/api/chat/work/items/'+enc(w.id)+'/stop',{});absorb(r);if(!r.confirmed)toast('停止尚未确认，可稍后回查')}catch(e){toast(e.message)}await load()}
 async function resume(w){
  if(busy.has(w.id))return;busy.add(w.id);
  try{await post({operationId:'cw-resume-'+crypto.randomUUID(),kind:'resume'},'/api/chat/work/items/'+enc(w.id)+'/resume',{})}
  finally{busy.delete(w.id);await load()}
 }

 // Explicit source selection: only chosen saved notes are sent; sending with sources starts the document flow.
 function picked(){return selections.get(chatConversation)||[]}
 function drawSources(){
  $('#chat-work-sources')?.remove();const values=picked(),exec=execution();if(!values.length&&exec.engine==='business')return;
  const bar=node('div','desktop-attachments');bar.id='chat-work-sources';bar.setAttribute('aria-label','整理资料');if(exec.engine!=='business'){const chip=node('span');chip.append(document.createTextNode(exec.engine==='codex'?'Codex':'Claude'),btn('×',()=>{saveExecution(chatConversation,{engine:'business'});drawSources()},'remove-engine'));bar.append(chip)}if(values.length)bar.append(node('span','','整理资料：'));
  for(const s of values){const tag=node('span');tag.append(btn(s.title,()=>void showSource(s.id)));const remove=btn('×',()=>{selectSources(chatConversation,picked().filter(x=>x.id!==s.id));drawSources()},'remove');remove.setAttribute('aria-label','移除 '+s.title);tag.append(remove);bar.append(tag)}
  $('#composer').before(bar);
 }
 async function chooseSources(){
  const owner=chatConversation,box=node('div','chat-work-picker'),search=node('input'),list=node('div');let searchGeneration=0;
  search.type='search';search.placeholder='搜索资料标题';search.setAttribute('aria-label','搜索资料标题');
  const chosen=new Map(picked().map(s=>[s.id,s])),config={...execution()},controls=node('div','chat-native-controls');let catalog=[],loading=false;
  function field(label,key,options){const row=node('label'),select=node('select');select.setAttribute('aria-label',label);select.dataset.selectNative='chat-native-'+key;for(const [value,text]of options){const o=node('option','',text);o.value=value;select.append(o)}select.value=config[key]||'';select.onchange=()=>{config[key]=select.value;if(key==='engine'){config.model='';config.access=config.access||'full';void drawExecutor()}};row.append(node('span','',label),select);controls.append(row);return select}
  async function drawExecutor(){controls.replaceChildren();field('执行方式','engine',[['business','业务 Agent'],['codex','Codex'],['claude','Claude']]);if(config.engine!=='business'){field('权限','access',[['full','完全权限'],['edit','逐项批准'],['read-only','只读']]);const info=catalog.find(x=>x.engine===config.engine);if(info){field('模型','model',[['','原生默认'],...(info.catalog?.models||[]).map(m=>[m.id,m.label])]);if(!info.authenticated)controls.append(node('small','','尚未登录'))}else if(!loading){loading=true;try{const r=await api('GET','/api/chat/work/executors');catalog=r.executors||[]}catch(e){if(box.isConnected)toast(e.message)}finally{loading=false;if(box.isConnected&&owner===chatConversation){if(catalog.length)void drawExecutor();}}}}window.OpsTwinsSelects?.scan();}
  async function fill(){const g=++searchGeneration;try{const r=await api('GET','/api/chat/work/sources?limit=100&query='+enc(search.value.trim()));if(g!==searchGeneration||owner!==chatConversation||!box.isConnected)return;list.replaceChildren();if(!r.items.length)list.append(node('p','','没有可选择的资料'));for(const item of r.items){const label=node('label'),check=node('input');check.type='checkbox';check.checked=chosen.has(item.id);check.onchange=()=>{if(check.checked){if(chosen.size>=8){check.checked=false;toast('最多选择 8 份资料');return}chosen.set(item.id,{id:item.id,title:item.title})}else chosen.delete(item.id)};label.append(check,document.createTextNode(' '+item.title));list.append(label)}}catch(e){if(g===searchGeneration&&box.isConnected)list.replaceChildren(node('p','',e.message))}}
  let timerId=0;search.oninput=()=>{clearTimeout(timerId);timerId=setTimeout(fill,200)};
  box.append(controls,search,list,btn('完成',()=>{if(owner===chatConversation){if(!selectSources(owner,[...chosen.values()])||!saveExecution(owner,config))return;drawSources()}$('#detail-dialog').close()}));
  openDialog('资料与执行','',box);void drawExecutor();await fill();
 }
 async function propose(values,exec={engine:'business'}){
  const owner=chatConversation,text=$('#input').value.trim();if(!text)return;
  const isNative=exec.engine!=='business',op={operationId:(isNative?'cw-native-':'cw-proposal-')+crypto.randomUUID(),kind:isNative?'native':'proposal'};
  if(ops.some(o=>['proposal','native'].includes(o.kind)&&o.conversationId===owner)){toast('请先回查未确认的整理请求');return}
  if(isNative&&!saveExecution(owner,{engine:'business'}))return;
  $('#input').value='';inputChange();selectSources(owner,[]);drawSources();window.OpsTwinsChatTimeline.follow(owner);
  try{
   if(owner.startsWith('ui-side-'))await api('POST','/api/conversations/side',{id:owner,title:window.OpsTwinsChatSessions.title()||'新会话'});
   const r=await post(op,isNative?'/api/chat/work/native':'/api/chat/work/proposals',{message:text,sourceIds:values.map(s=>s.id),conversationId:owner,...(isNative?{engine:exec.engine,access:exec.access||'full',...(exec.model?{model:exec.model}:{})}:{})});
   if(!r&&!ops.some(o=>o.operationId===op.operationId)&&owner===chatConversation&&!$('#input').value){$('#input').value=text;inputChange();selectSources(owner,values);if(isNative)saveExecution(owner,exec);drawSources()}
  }catch(e){toast(e.message);if(owner===chatConversation&&!$('#input').value){$('#input').value=text;inputChange();selectSources(owner,values);if(isNative)saveExecution(owner,exec);drawSources()}}
  if(owner===chatConversation){await D.loadChat?.();await load(owner)}
 }

 const sourceButton=node('button','composer-icon');sourceButton.type='button';sourceButton.id='chat-work-source-button';sourceButton.setAttribute('aria-label','选择整理资料');sourceButton.title='选择整理资料';sourceButton.append(icon('file'));sourceButton.onclick=()=>void chooseSources();
 $('#attachment-info').after(sourceButton);
 const submit=$('#composer').onsubmit;
 $('#composer').onsubmit=e=>{const values=picked(),exec=execution();if(!values.length&&exec.engine==='business')return submit.call($('#composer'),e);e.preventDefault();void propose(values,exec)};
 const referenceChat=renderChat;renderChat=target=>{referenceChat(target);paint();if(loadedFor!==chatConversation)void load()};
 window.addEventListener('desktop-session-selected',()=>setTimeout(()=>{drawSources();void load()},0));
 window.addEventListener('desktop-owner-visible',()=>void load());
 // A 404 is only the current observation: retain the ID because the original POST may arrive late.
 for(const op of [...ops])void reconcile(op).then(()=>{drawRecovery();void load()});
 drawSources();drawRecovery();
 void load();
})();
