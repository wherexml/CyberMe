import {esc,markdown} from './ui.js';
import {upgradeSelects} from './components/adapter.js';
const busy=new Set(['queued','running','awaiting_approval','stopping']);
const labels={queued:'准备中',running:'执行中',awaiting_approval:'等待批准',stopping:'正在停止',succeeded:'已完成',failed:'执行失败',partial:'部分完成',unknown:'结果未确认',stopped:'已停止'};
const engineNames={codex:'Codex',claude:'Claude Code'};
const accessLabels={full:'完全权限',edit:'逐项批准','read-only':'只读'};
const effortLabels={none:'无',minimal:'最少',low:'低',medium:'中',high:'高',xhigh:'超高',max:'最大',ultra:'极限'};
const engineList=Object.keys(engineNames),accessList=Object.keys(accessLabels);
// New executor settings default to full access; Claude keeps the verified model because its native default was unavailable. Saved choices win.
const blankPrefs=e=>({model:e==='claude'?'claude-opus-5-5':'',effort:'',access:'full'});
function readPrefs(raw,fallback){const p={...fallback};if(raw&&typeof raw==='object'){if(typeof raw.model==='string')p.model=raw.model;if(typeof raw.effort==='string')p.effort=raw.effort;if(accessList.includes(raw.access))p.access=raw.access}return p}
export function taskAgentPanel(task){return task?`<section id="task-agent-panel" class="task-agent-panel" data-task-id="${esc(task.id)}"></section>`:''}
export function createTaskAgentController({getTask}){
 let clientId,pointers={},drafts={},global={},storageError='';
 try{clientId=localStorage.getItem('opstwins-direct-client');if(!clientId){clientId=crypto.randomUUID();localStorage.setItem('opstwins-direct-client',clientId)}pointers=JSON.parse(localStorage.getItem('opstwins-direct-requests')||'{}')}catch{storageError='本机请求记录不可用，暂不能执行'}
 try{drafts=JSON.parse(localStorage.getItem('opstwins-direct-drafts')||'{}')||{}}catch{}
 try{global=JSON.parse(localStorage.getItem('opstwins-direct-executor-prefs')||'{}')||{}}catch{}
 const states=new Map();let element=null,timer=null;
 const current=()=>{const t=getTask();if(!t)return null;if(!states.has(t.id)){const saved=drafts[t.id]||{},base={engine:engineList.includes(global.engine)?global.engine:'codex',source:'',draft:'',prefs:{}};
  for(const k of ['engine','source','draft'])if(typeof saved[k]==='string')base[k]=saved[k];if(!engineList.includes(base.engine))base.engine='codex';
  // Legacy drafts kept one access value and a per-engine model map; both are explicit saved choices.
  for(const e of engineList){let p=readPrefs(global[e],blankPrefs(e));if(saved.prefs?.[e])p=readPrefs(saved.prefs[e],p);else{if(accessList.includes(saved.access))p.access=saved.access;if(typeof saved.models?.[e]==='string')p.model=saved.models[e];else if(e===saved.engine&&typeof saved.model==='string')p.model=saved.model}base.prefs[e]=p}
  states.set(t.id,{...base,sessions:[],cursor:null,history:null,row:null,error:'',loading:false,checking:false,loaded:false,requestId:pointers[t.id]||null})}return states.get(t.id)};
 function saveDraft(s){const t=getTask();if(!t)return;const {engine,source,prefs,draft}=s;const next={...drafts,[t.id]:{engine,source,prefs,draft}};try{localStorage.setItem('opstwins-direct-drafts',JSON.stringify(next));drafts=next}catch{s.error='草稿未能保存在本机，当前输入仍保留'}}
 function rememberExecutor(s){const next={...global,engine:s.engine,[s.engine]:{...s.prefs[s.engine]}};try{localStorage.setItem('opstwins-direct-executor-prefs',JSON.stringify(next));global=next}catch{}}
 const headers=()=>({'content-type':'application/json','x-opstwins-client':clientId||'','x-opstwins-agent':'direct'});
 async function api(path,body){const r=await fetch('/api/task-agents/'+path,{headers:headers(),...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message||({request_conflict:'原请求与当前内容不同',executor_busy:'执行器正忙',not_found:'原请求尚未找到，请保留原记录回查',approval_expired:'此审批已结束',read_only:'任务操作当前为仅查看'}[data.error]||'连接未完成，请重新检查')),{status:r.status});return data}
 function belongs(s){return current()===s&&element?.isConnected}
 const authOf=s=>s.status?.executors?.find(x=>x.engine===s.engine);
 // Efforts follow the selected model's native capability; unknown models send no effort.
 function capability(s){const c=authOf(s)?.catalog,p=s.prefs[s.engine],m=p.model?c?.models?.find(x=>x.id===p.model):null;const efforts=p.model?m?.efforts||[]:c?.defaultModel?.efforts||[];return {c,p,efforts,defaultEffort:p.model?m?.defaultEffort:c?.defaultModel?.defaultEffort,effort:efforts.includes(p.effort)?p.effort:''}}
 function authText(s,auth){if(s.checking)return '检查连接…';if(!auth)return '尚未检查';if(!auth.authenticated)return '未登录';return auth.authMethod==='chatgpt'?'ChatGPT 登录':auth.authMethod==='api_key'||auth.authMethod==='apiKey'?'本机 API Key':'本机登录'}
 const option=(value,label,selected,title='')=>`<option value="${esc(value)}" ${selected?'selected':''}${title?` title="${esc(title)}"`:''}>${esc(label)}</option>`;
 const field=(label,control)=>`<label class="task-agent-field"><span>${label}</span>${control}</label>`;
 function draw(s){if(!belongs(s))return;const r=s.row,active=r&&busy.has(r.status),auth=authOf(s),{c,p,efforts,defaultEffort,effort}=capability(s),models=c?.models||[],lock=active?'disabled':'';
 const modelOptions=option('',c?.defaultModel?.label?'默认 · '+c.defaultModel.label:'原生默认',!p.model)+(p.model&&!models.some(m=>m.id===p.model)?option(p.model,p.model,true):'')+models.map(m=>option(m.id,m.label,p.model===m.id,m.description)).join('');
 const sessionOptions=option('','新会话',!s.source)+(s.source&&!s.sessions.some(x=>x.id===s.source)?option(s.source,'已选历史会话',true):'')+s.sessions.map(x=>option(x.id,x.title,s.source===x.id)).join('')+(s.cursor?option('__more','加载更多会话…',false):'');
 // This panel redraws independently of the app render, including async status updates.
 const focused=document.activeElement,focusId=element.contains(focused)?focused?.dataset.vmId:null;
 if(element.querySelector('[data-vm-select][aria-expanded="true"]'))window.VMSelect.close();
 element.innerHTML=`<div class="task-agent-heading"><h3>执行</h3><span class="task-agent-auth ${auth&&!auth.authenticated?'warn':''}" role="status">${esc(engineNames[s.engine])} · ${esc(authText(s,auth))}${auth?.catalogError?' · 模型目录不可用':''}</span><button type="button" data-agent="refresh" class="task-agent-link" ${s.checking?'disabled':''}>重新检查</button></div>
 <div class="task-agent-controls">${field('执行器',`<select data-agent-field="engine" aria-label="任务执行器" ${active||s.checking?'disabled':''}>${engineList.map(e=>option(e,engineNames[e],s.engine===e)).join('')}</select>`)}
 ${field('模型',`<select data-agent-field="model" aria-label="任务执行模型" ${lock}>${modelOptions}</select>`)}
 ${efforts.length?field('推理',`<select data-agent-field="effort" aria-label="任务推理强度" ${lock}>${option('',defaultEffort?'默认 · '+(effortLabels[defaultEffort]||defaultEffort):'默认',!effort)}${efforts.map(x=>option(x,effortLabels[x]||x,effort===x)).join('')}</select>`):''}
 ${field('权限',`<select data-agent-field="access" aria-label="任务执行权限" ${lock}>${accessList.map(a=>option(a,accessLabels[a],p.access===a)).join('')}</select>`)}
 ${field('会话',`<select data-agent-field="source" aria-label="任务历史会话" ${active||s.loading||s.checking?'disabled':''}>${sessionOptions}</select>`)}</div>
 <textarea class="task-agent-draft" data-agent-field="draft" aria-label="任务执行补充要求" rows="2" placeholder="补充要求（可选）" ${lock}>${esc(s.draft)}</textarea>
 ${s.history?`<details class="task-agent-history" open><summary>历史消息${s.history.hasMore?' · 当前片段':''}</summary>${s.history.messages.map(m=>`<article><small>${m.role==='assistant'?'助手':'你'}</small><div>${markdown(m.text)}</div></article>`).join('')||'<p class="muted">当前片段没有可读消息</p>'}</details>`:''}
 <div class="task-agent-actions"><div class="task-agent-feedback" role="status">${esc(storageError||s.error||(r?.error)||'')}</div>
 ${s.source?`<button type="button" class="task-agent-link" data-agent="history" ${s.loading?'disabled':''}>查看历史</button>`:''}${s.requestId?'<button type="button" class="task-agent-link" data-agent="lookup">回查原请求</button>':''}
 ${active?'<button type="button" class="task-agent-secondary" data-agent="stop">停止执行</button>':r&&['unknown','partial'].includes(r.status)?'<button type="button" class="task-agent-secondary" data-agent="release">已核查，另建执行</button>':`<button type="button" class="task-agent-primary" data-agent="start" ${s.checking||storageError||!auth?.authenticated||s.requestId&&!r?'disabled':''}>${r?'再次执行':s.source?'基于历史执行':'开始执行'}</button>`}</div>
 ${r?`<section class="task-agent-result" aria-label="任务执行记录"><div class="task-agent-result-head"><b>${esc(labels[r.status]||r.status)}</b><span>${esc(engineNames[r.engine]||r.engine)}${r.model?' · '+esc(r.model):''}${r.access?' · '+esc(accessLabels[r.access]||r.access):''}</span></div>${r.approval?`<div class="task-agent-approval"><b>${esc(r.approval.tool)}</b><pre>${esc(JSON.stringify(r.approval.detail,null,2))}</pre><div class="task-agent-actions"><button type="button" data-agent="deny" data-approval="${esc(r.approval.id)}" class="task-agent-secondary">拒绝</button><button type="button" data-agent="approve" data-approval="${esc(r.approval.id)}" class="task-agent-primary">允许本次</button></div></div>`:''}<div class="task-agent-output">${markdown(r.text||'')}</div>${r.events?.length?`<details><summary>工具记录</summary>${r.events.map(x=>`<div>${esc(x.name)} · ${esc(x.status)}</div>`).join('')}</details>`:''}<details><summary>请求记录</summary><dl><dt>请求</dt><dd>${esc(r.requestId)}</dd><dt>原生会话</dt><dd>${esc(r.nativeSessionId||'尚未返回')}</dd><dt>延续方式</dt><dd>${r.continuation==='native-fork'?'原生分支':'新建'}</dd></dl></details></section>`:''}`;
 // Stable, panel-specific identities prevent collisions with settings/navigation selects.
 for(const select of element.querySelectorAll('select[data-agent-field]'))select.dataset.selectNative='task-agent-'+select.dataset.agentField;
 upgradeSelects(element);
 if(focusId)element.querySelector(`[data-vm-id="${CSS.escape(focusId)}"]`)?.focus({preventScroll:true});
 }
 async function check(s,more=false){if(s.checking)return;s.checking=true;s.error='';draw(s);const engine=s.engine;try{const [status,list]=await Promise.all([api('status'),api('sessions/'+engine+(more&&s.cursor?'?cursor='+encodeURIComponent(s.cursor):''))]);if(engine!==s.engine)return;s.status=status;s.sessions=more?[...s.sessions,...list.sessions.filter(x=>!s.sessions.some(y=>y.id===x.id))]:list.sessions;s.cursor=list.nextCursor;s.loaded=true;}catch(e){s.error=e.message}finally{s.checking=false;draw(s)}}
 async function lookup(s){if(!s.requestId)return;try{const id=s.requestId,r=await api('requests/'+id);if(s.requestId!==id)return;const recovering=!s.row;s.row=r;if(recovering&&engineList.includes(r.engine))s.engine=r.engine;s.error='';}catch(e){s.error=e.message}draw(s)}
 function persistPointer(taskId,id){const next={...pointers,[taskId]:id};localStorage.setItem('opstwins-direct-requests',JSON.stringify(next));pointers=next;}
 async function start(s){const t=getTask();if(!t||s.submitting||s.requestId&&(!s.row||busy.has(s.row.status)||['unknown','partial'].includes(s.row.status)))return;
 const {p,effort}=capability(s),model=p.model.trim(),id=crypto.randomUUID(),input={engine:s.engine,taskId:t.id,access:p.access,...(model?{model}:{}),...(effort?{effort}:{}),prompt:[t.title,t.note,t.goal?'目标：'+t.goal:'',t.deliverable?'交付物：'+t.deliverable:'',s.draft].filter(Boolean).join('\n\n'),...(s.source?{sourceSessionId:s.source}:{})};
 try{persistPointer(t.id,id)}catch{s.error='请求编号未能保存，未提交执行';draw(s);return}
 s.requestId=id;s.row={requestId:id,engine:s.engine,access:p.access,...(model?{model}:{}),status:'queued',text:''};s.error='';s.submitting=true;draw(s);
 try{s.row=await api('requests/'+id,input)}catch(e){s.error='提交结果未确认，请回查原请求';s.row={...s.row,status:'unknown'};await lookup(s)}finally{s.submitting=false;draw(s)}
 }
 document.addEventListener('change',e=>{const f=e.target.dataset.agentField;if(!f||!element?.contains(e.target))return;const s=current();if(!s)return;const value=e.target.value;
 if(f==='engine'){if(!engineList.includes(value))return;s.engine=value;s.source='';s.sessions=[];s.cursor=null;s.history=null;s.loaded=false;rememberExecutor(s);void check(s)}
 else if(f==='source'){if(value==='__more'){draw(s);void check(s,true);return}s.source=value;s.history=null;draw(s)}
 else if(['model','effort','access'].includes(f)){const p=s.prefs[s.engine];if(f==='access'&&!accessList.includes(value))return;p[f]=value;if(f==='model'&&!capability(s).efforts.includes(p.effort))p.effort='';rememberExecutor(s);draw(s)}
 else if(f==='draft')s.draft=value;
 saveDraft(s)});
 document.addEventListener('input',e=>{if(e.target.dataset.agentField==='draft'&&element?.contains(e.target)){const s=current();if(s){s.draft=e.target.value;saveDraft(s)}}});
 document.addEventListener('click',async e=>{const button=e.target.closest('[data-agent]');if(!button||button.disabled||!element?.contains(button))return;e.preventDefault();const s=current();if(!s)return;try{
 const action=button.dataset.agent;if(action==='refresh')await check(s);
 if(action==='start')await start(s);if(action==='lookup')await lookup(s);
 if(action==='history'){s.loading=true;s.error='';draw(s);try{const source=s.source,engine=s.engine,h=await api('sessions/'+engine+'/'+encodeURIComponent(source));if(s.source===source&&s.engine===engine)s.history=h}finally{s.loading=false;draw(s)}}
 if(action==='stop'){s.row=await api('requests/'+s.requestId+'/stop',{});draw(s)}
 if(action==='approve'||action==='deny'){await api('requests/'+s.requestId+'/approvals/'+button.dataset.approval,{decision:action==='approve'?'allow':'deny'});await lookup(s)}
 if(action==='release'){persistPointer(getTask().id,null);s.requestId=null;s.row=null;s.error='';draw(s)}
 }catch(error){s.error=error.message;draw(s)}});
 return {mount(){element=document.querySelector('#task-agent-panel');clearInterval(timer);const s=current();if(!element||!s)return;draw(s);if(!s.loaded)void check(s);if(s.requestId)void lookup(s);timer=setInterval(()=>{if(!element?.isConnected){clearInterval(timer);return}if(s.requestId&&(!s.row||busy.has(s.row.status)))void lookup(s)},900)}};
}
