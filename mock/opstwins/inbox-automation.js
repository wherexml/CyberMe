import {esc,icon,button} from './ui.js';
const phases=['正在查看新消息','正在判断需要关注的事项','正在整理待回复内容'];
const fingerprint=item=>JSON.stringify([item.id,item.title,item.messages,item.judgment]);
export function createInboxAutomation({getState,save,changed,visible,scenario}) {
  let busy=false,restored=false;
  const state=getState();
  state.inboxRuns??=[];
  for(const run of state.inboxRuns){
    if(!Number.isSafeInteger(run.messageIndex)){run.messageIndex=state.sessions.find(x=>x.id==='main').messages.length;restored=true}
    if(run.status==='running'){run.status='unknown';run.error='上次分析中途退出，结果尚未确认';restored=true}
  }
  // This is a public local preview, never a real model or external action.
  async function sync(){
    if(busy||!visible())return;
    const scope=getState();scope.inboxRuns??=[];
    let created=false;
    const candidates=scope.inbox.filter(x=>['pending','unknown'].includes(x.status));
    for(const item of candidates){
      if(scope.inboxRuns.some(r=>r.itemId===item.id&&r.fingerprint===fingerprint(item)))continue;
      created=true;scope.inboxRuns.push({messageIndex:scope.sessions.find(x=>x.id==='main').messages.length,id:crypto.randomUUID(),sessionId:'main',itemId:item.id,fingerprint:fingerprint(item),status:item.judgment?'queued':'unknown',phase:0,trace:[],createdAt:new Date().toISOString(),error:item.judgment?'':'原消息结果未确认，暂不生成判断或回复'});
    }
    scope.inboxRuns=scope.inboxRuns.slice(-30);
    if(!scope.inboxRuns.some(r=>r.status==='queued')){if(created||restored){if(save())restored=false;changed(false)}return}
    busy=true;
    try{
      for(const run of scope.inboxRuns.filter(r=>r.status==='queued')){
        const owns=()=>getState()===scope&&scope.inboxRuns.includes(run);
        if(!owns())break;
        run.status='running';
        if(!save()){run.status='failed';run.error='本地记录未保存，尚未开始分析';changed(false);break}
        changed(true);
        for(let phase=0;phase<phases.length;phase++){
          await new Promise(resolve=>setTimeout(resolve,650));
          if(!owns())break;
          const item=scope.inbox.find(x=>x.id===run.itemId);
          if(!item||fingerprint(item)!==run.fingerprint){run.status='unknown';run.error='来源发生变化，需要核对原事项';break}
          if(['error','unknown','partial'].includes(scenario())){run.status=scenario()==='error'?'failed':scenario();run.error='分析预览未完成，保留已有步骤与原事项';break}
          run.trace.push(['已读取原始消息与来源','已区分回复需要、本人决策与深度思考','已整理回复草稿，等待你确认'][phase]);
          run.phase=phase+1;
          if(phase===2){run.status='completed';run.completedAt=new Date().toISOString();}
          if(!save()){run.status='failed';run.error='本地保存失败，已有结果暂留当前页面';break}
          changed(false);
        }
        if(!owns())break;
        save();changed(false);
      }
    }finally{busy=false;if(getState()!==scope)queueMicrotask(()=>sync())}
  }
  return {sync};
}
export function automationTimeline(state,ui) {
  if(ui.session!=='main'||ui.scenario==='empty')return '';
  const latest=new Map();for(const run of state.inboxRuns||[])latest.set(run.itemId,run);
  const runs=[...latest.values()];
  return `<section class="inbox-automation" aria-label="主会话收件箱分析"><div class="automation-caption">${icon('spark')}<span>收件箱自动分析</span><span class="tiny muted">本地流程预览</span></div>${runs.length?runs.map(run=>{
    const item=state.inbox.find(x=>x.id===run.itemId);if(!item)return '';
    const finished=run.status==='completed';
    return `<article class="attention-result" data-run-id="${esc(run.id)}" data-inbox-id="${esc(item.id)}"><div class="attention-source"><span class="avatar small ${esc(item.color)}">${esc(item.initial)}</span><span>${esc(item.name)}</span><span class="muted">${esc(item.source)}</span>${item.status==='done'?'<span class="attention-complete">已处理</span>':''}</div><h3>${esc(item.title)}</h3>${run.status==='running'||run.status==='queued'?`<div class="attention-progress" role="status"><span class="thinking"><i></i><i></i><i></i></span>${run.status==='queued'?'等待分析':phases[Math.min(run.phase,2)]}…</div>`:finished?`<p class="attention-conclusion">${item.judgment?.[0]>=50?'需要回复。':'暂时无需回复。'}${item.judgment?.[1]>=50?'涉及范围或安排，需要你确认。':'可以先核对信息，再给出简短回应。'}</p>${item.draft?`<div class="attention-draft"><span class="tiny muted">建议回复 · 待你确认</span><p>${esc(item.draft)}</p></div>`:'<p class="muted small">还没有回复草稿，打开事项继续处理</p>'}`:`<p class="attention-warning">${esc(run.error||'分析结果未确认，先核对已有记录')}</p>`}<details class="attention-trace"><summary>${finished?'分析过程':'查看分析记录'}</summary><ol>${run.trace.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>尚无已确认的分析步骤</li>'}</ol><p class="tiny muted">公开示例流程，不代表真实模型调用；没有发送消息</p></details><div class="attention-actions">${button('查看事项','attention-item:'+item.id,'subtle','right')}${finished&&item.draft?button('编辑回复','attention-edit:'+item.id,'subtle','edit'):''}</div></article>`;
  }).join(''):'<p class="muted small">正在检查新的待处理事项…</p>'}</section>`;
}
