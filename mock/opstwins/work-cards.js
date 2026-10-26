import {esc,icon,button} from './ui.js';

export const workDemoId='demo-work-cards';
const options=[
 {id:'core',title:'核心流程优先',detail:'先走通收件箱到回复，连接配置留到下一轮',source:'review-plan',sourceTitle:'评审方案'},
 {id:'compare',title:'先对齐两版差异',detail:'列清范围与取舍，再决定这次评审看什么',source:'discussion',sourceTitle:'讨论记录'},
 {id:'agenda',title:'先准备评审议程',detail:'整理讨论顺序，开始时间仍待确认',source:'review-plan',sourceTitle:'评审方案'},
];
const uid=()=>crypto.randomUUID();
const artifact=(title,body)=>({id:uid(),title,body});
const brief=()=>artifact('评审准备.md','# 评审准备\n\n## 已整理\n- 本轮优先查看收件箱到回复的核心流程\n- 完整连接配置可以留到下一轮\n- 部署检查结果仍待核实\n\n## 待确认\n评审范围和确切开始时间\n\n## 依据\n本地公开示例：本周评审方案、产品讨论记录\n');
const panel=(version=1)=>({version,options:structuredClone(options),selected:null,retired:false});
const message=(text,extra={})=>({id:uid(),role:'assistant',text,...extra});
export function isWorkDemo(s){return s?.id===workDemoId&&s.workDemo===1}

export function workCardsMarkup(m,s){
 if(!isWorkDemo(s))return '';
 const t=m.workTask,p=m.workPanel;
 const task=t?`<section class="work-card" aria-label="任务：${esc(t.title)}"><button type="button" class="work-task-line" data-action="work-task:${m.id}">${icon(t.saveError?'info':t.status==='done'?'check':t.status==='running'?'clock':'stop')}<strong>${esc(t.title)}</strong><span role="status">${t.saveError?'待保存':({done:'已完成',running:'整理中',stopped:'已停止'})[t.status]}</span>${icon('right')}</button>${t.artifact?`<div class="work-artifact"><button type="button" data-action="work-file:${m.id}">${icon('record')}<span><strong>${esc(t.artifact.title)}</strong><small>Markdown</small></span>${icon('right')}</button>${button('下载','work-download:'+m.id,'work-download','download',`aria-label="下载 ${esc(t.artifact.title)}"`)}</div>`:''}${t.saveError?`<div class="work-resume" role="status">尚未保存 ${button('重试保存','work-save:'+m.id,'subtle')}</div>`:''}${t.status==='stopped'?`<div class="work-resume">${button('继续整理','work-resume:'+m.id,'subtle','refresh')}</div>`:''}</section>`:'';
 const choices=p?`<section class="work-choices" aria-label="Jev 选项"><div class="work-choice-heading"><span>你想先推进哪一项？</span><small>${p.selected?'已选择':p.retired?'已更新':'Jev'}</small></div>${p.options.map(o=>`<div class="work-choice ${p.selected===o.id?'selected':''}"><button type="button" class="work-choice-pick" data-action="work-choose:${m.id}:${p.version}:${o.id}" ${p.selected||p.retired?'disabled':''} aria-pressed="${p.selected===o.id}"><span class="work-choice-mark">${p.selected===o.id?icon('check'):''}</span><span><strong>${esc(o.title)}</strong><small>${esc(o.detail)}</small></span></button><button type="button" class="work-source" data-action="source:document:${o.source}" aria-label="查看来源：${esc(o.title)}">${icon('link')}${esc(o.sourceTitle)}</button></div>`).join('')}</section>`:'';
 return task+choices;
}

export function createWorkCards({getState,getUI,save,render,toast,info}){
 const timers=new Map();
 const current=()=>getState().sessions.find(s=>s.id===getUI().session);
 const locate=id=>{const s=current();return isWorkDemo(s)?s.messages.find(m=>m.id===id):null};
 function commit(s,mutate,repaint=true){
  const before=structuredClone(s);mutate();
  if(!save()){Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,before);render();return false}
  if(repaint)render();return true;
 }
 function follow(){requestAnimationFrame(()=>{if(getUI().overlay)return;const t=document.querySelector('.timeline');if(t)t.scrollTop=t.scrollHeight;document.querySelector('[name=message]')?.focus()})}
 function retire(s){for(const m of s.messages){if(m.workPanel)m.workPanel.retired=true;if(m.workTask?.status==='running')m.workTask.status='stopped'}delete s.workActive}
 function schedule(s,m){
  const scope=getState(),token=m.workTask.token;
  timers.set(token,setTimeout(()=>{
   timers.delete(token);
   if(getState()!==scope||!scope.sessions.includes(s)||s.workActive!==token||m.workTask.status!=='running')return;
   const wasHere=getUI().session===s.id&&getUI().page==='chat';
   (()=>{m.workTask.status='done';m.text='整理好了，开始时间仍留待确认。';m.workTask.artifact=artifact(m.workTask.title+'.md',`# ${m.workTask.title}\n\n## 处理方向\n${m.workTask.direction}\n\n## 准备清单\n- 核对核心流程的正常与异常状态\n- 保留需要本人决定的问题\n- 确认评审开始时间\n\n## 尚未执行\n未发送消息，未创建日程\n\n## 依据\n本地公开示例：本周评审方案、产品讨论记录\n`);delete s.workActive})();
   if(!save()){m.workTask.saveError=true;toast('成果尚未保存，内容已保留')}
   if(wasHere){render();follow()}
  },2400));
 }
 function start(s,title,direction){const m=message('我来整理成一份可查看的准备稿。',{workTask:{title,direction,status:'running',token:uid()}});s.messages.push(m);s.workActive=m.workTask.token;return m}
 function choose(value){
  const [id,version,optionId]=value.split(':'),s=current(),m=locate(id),p=m?.workPanel;
  if(!p||p.retired||p.selected||p.version!==Number(version)){toast('这组选项已更新');return}
  const o=p.options.find(x=>x.id===optionId);if(!o)return;
  let next;if(commit(s,()=>{retire(s);p.selected=o.id;s.messages.push({id:uid(),role:'user',text:o.title});next=start(s,o.title,o.detail)})){schedule(s,next);follow()}
 }
 function open(){
  let s=getState().sessions.find(x=>x.id===workDemoId);
  if(!s){s={id:workDemoId,title:'评审准备 · 示例',workDemo:1,draft:'',messages:[{id:uid(),role:'user',text:'帮我整理评审资料，再一起定一下推进顺序。'},message('资料已经整理好。',{workTask:{title:'整理评审资料',status:'done',artifact:brief()}}),message('',{workPanel:panel()})]};getState().sessions.push(s);if(!save()){getState().sessions.pop();return}}
  for(const m of s.messages)if(m.workPanel?.version===1&&m.text==='我们可以从这三项里选一个。'){m.text='';save()}
  Object.assign(getUI(),{session:workDemoId,page:'chat',setting:null,overlay:null,overview:false,sidebar:false,scenario:'normal'});render();
 }
 function send(){
  const s=current();if(!isWorkDemo(s))return false;
  const text=s.draft.trim();if(!text)return true;
  if(getUI().scenario!=='normal'){toast('请先返回正常场景，草稿已保留');return true}
  if(text.length>20000){toast('内容过长，草稿已保留');return true}
  if(commit(s,()=>{retire(s);s.messages.push({id:uid(),role:'user',text,quotes:structuredClone(s.draftQuotes||[])});s.draft='';s.draftQuotes=[];const next=panel(s.messages.length);next.options[0].title='按补充内容整理';next.options[0].detail=text.slice(0,90);s.messages.push(message('已保留你的补充。接下来先做哪一项？',{workPanel:next}))}))follow();
  return true;
 }
 return {open,send,recover(){const s=getState().sessions.find(isWorkDemo);if(s?.workActive){retire(s);save()}},actions:{
  'work-demo':open,'work-choose':choose,
  'work-task':id=>{const t=locate(id)?.workTask;if(t)info(t.title,`## ${t.saveError?'待保存':({done:'已完成',running:'整理中',stopped:'已停止'})[t.status]}\n\n${t.direction||'核对评审范围、讨论记录和未决事项'}\n\n${t.artifact?'成果已保存在此会话中':'尚未产生成果'}${t.saveError?`<div class="work-resume" role="status">尚未保存 ${button('重试保存','work-save:'+m.id,'subtle')}</div>`:''}${t.status==='stopped'?'，可从原卡片继续整理':''}`)},
  'work-file':id=>{const a=locate(id)?.workTask?.artifact;if(a)info(a.title,a.body,['下载','work-download:'+id])},
  'work-download':id=>{const a=locate(id)?.workTask?.artifact;if(!a)return;const url=URL.createObjectURL(new Blob([a.body],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=a.title;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},
  'work-resume':id=>{const s=current(),m=locate(id);if(m?.workTask?.status!=='stopped')return;let next;if(commit(s,()=>{retire(s);next=start(s,m.workTask.title,m.workTask.direction||'按已确认范围整理评审材料')})){schedule(s,next);follow()}},
  'work-save':id=>{const s=current(),m=locate(id);if(m?.workTask?.saveError){delete m.workTask.saveError;if(!save())m.workTask.saveError=true;render()}},
  'work-stop':()=>{const s=current();if(isWorkDemo(s)&&s.workActive)commit(s,()=>retire(s))},
 }};
}
