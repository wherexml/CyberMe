/* Read-only projections. Untrusted source content is always text, never markup. */
(() => {
 const D=window.OpsTwinsDesktop,T=s=>D.translate(s);
 const capabilityNames={entity_list:'查看事项',entity_get:'查看事项详情',entity_create:'创建事项',entity_update:'更新事项',entity_delete:'移入回收站',entity_restore:'恢复事项',idea_think:'发现灵感',idea_execute:'执行建议',inbox_triage:'判断收件箱事项',inbox_draft:'起草回复',inbox_send:'发送已批准回复',inbox_undo:'撤回回复',models_read:'查看模型配置',models_update:'调整模型',models_test:'测试模型连接',health_read:'检查服务状态',diagnostics_read:'查看连接诊断'};
 const capabilityTitle=a=>T(capabilityNames[a.name]||a.description.split(/[，；]/)[0]);
 const labels={succeeded:'已完成',completed:'已完成',done:'已完成',created:'已生成',running:'执行中',waiting:'待处理',pending:'待处理',awaiting_approval:'待审批',scheduled:'已启用',disabled:'未启用',failed:'失败',partial:'部分完成',unknown:'未确认',missing:'记录缺失',cancelled:'已取消',archived:'已归档',new:'待处理',executed:'已转交',deferred:'已忽略',merged:'已合并',idle:'空闲',read:'读取',write:'写入'};
 const label=s=>T(labels[s]||s||'未记录'),n=(tag,cls='',value='')=>{const el=document.createElement(tag);el.className=cls;el.textContent=value;return el;};
 const button=(text,fn,cls='ss-button')=>{const b=n('button',cls,T(text));b.type='button';b.onclick=fn;return b;};
 let active;
 D.openIdeasConsole=()=>{
  if(active?.open){active.focus();return;}
  const opener=document.activeElement,dialog=n('dialog','ideas-console');dialog.id='ideas-console';dialog.setAttribute('aria-label',T('能力与意图'));active=dialog;
  let tab='capabilities',selected=null,generation=0,listRequest=0,detailRequest=0,closed=false,timer,searchTimer,lastDetail='';
  const header=n('header'),title=n('h1','',T('能力与意图')),close=button('关闭',()=>dialog.close());header.append(title,close);
  const nav=n('nav'),tabs=new Map();nav.setAttribute('aria-label',T('能力与意图视图'));
  const toolbar=n('div','ic-toolbar'),search=n('input');search.type='search';search.placeholder=T('搜索');search.setAttribute('aria-label',T('搜索能力或记录'));
  const refresh=button('刷新',()=>{void loadList();if(selected)void loadDetail(selected);});toolbar.append(search,refresh);
  const status=n('div','ic-status');status.setAttribute('role','status');
  const body=n('div','ic-body'),list=n('div','ic-list'),detail=n('article','ic-detail');body.append(list,detail);
  const more=button('加载更多',()=>void loadList(true));more.hidden=true;
  dialog.append(header,nav,toolbar,status,body,more);document.body.append(dialog);
  let offset=0,hasMore=false,capabilities=[];
  const alive=g=>!closed&&dialog.open&&g===generation;
  const message=(box,value)=>box.append(n('p','ic-muted',T(value)));
  const section=(name)=>{const el=n('section');el.append(n('h2','',T(name)));detail.append(el);return el;};
  const pair=(box,key,value)=>{const row=n('div','ic-pair');row.append(n('span','ic-muted',T(key)),n('span','',value));box.append(row);};
  const when=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString():T('未记录');};
  function renderList(items,append=false){if(!append)list.replaceChildren();if(!items.length&&!append)message(list,'暂无记录');for(const item of items){const id=tab==='capabilities'?item.name:item.id,b=button('',()=>{selected=id;lastDetail='';markSelected();void loadDetail(id)},'ic-item');b.dataset.recordId=id;b.append(n('strong','',tab==='capabilities'?capabilityTitle(item):item.title||id),n('small','',tab==='capabilities'?label(item.effect):label(item.status)));list.append(b);}markSelected();}
  function markSelected(){for(const b of list.querySelectorAll('[data-record-id]'))b.setAttribute('aria-pressed',String(b.dataset.recordId===selected));}
  function error(box,e,retry){box.replaceChildren(n('p','',e?.message||T('读取失败')),button('重试',retry));}
  async function loadList(append=false){const g=generation,request=++listRequest;try{
   if(tab==='capabilities'){const result=await D.api('GET','/api/ideas-console/capabilities');if(!alive(g)||request!==listRequest)return;capabilities=result.actions||[];renderList(capabilities.filter(a=>(a.description+' '+a.name).toLowerCase().includes(search.value.toLowerCase())));status.textContent=T(result.worker.enabled?'自动捕获已启用':'自动捕获未启用')+' · '+label(result.worker.status);if(!selected){detail.replaceChildren();const s=section('自动捕获');pair(s,'状态',label(result.worker.status));pair(s,'最近成功',when(result.worker.lastSuccessAt));pair(s,'模型配置',T(result.model.state==='configured'?'已配置':result.model.state==='invalid'?'配置无效':'未配置'));pair(s,'连接状态',T('未检测'));if(result.worker.error)message(s,result.worker.error);}more.hidden=true;return;}
   const result=await D.api('GET','/api/ideas-console/'+tab+'?limit=40&offset='+(append?offset:0)+'&query='+encodeURIComponent(search.value));if(!alive(g)||request!==listRequest)return;renderList(result.items,append);offset=result.nextOffset;hasMore=result.hasMore;more.hidden=!hasMore;status.textContent='';
  }catch(e){if(alive(g)&&request===listRequest)error(status,e,()=>void loadList(append));}}
  function runLink(box,run){if(!run){message(box,'运行记录缺失');return;}const b=button(run.title||'查看运行记录',()=>switchTab('runs',run.id),'ic-link');box.append(b);pair(box,'状态',label(run.status));}
  async function loadDetail(id){const g=generation,owner=tab,request=++detailRequest;try{
   const value=tab==='capabilities'?capabilities.find(a=>a.name===id):await D.api('GET','/api/ideas-console/'+tab+'/'+encodeURIComponent(id));
   if(!alive(g)||selected!==id||tab!==owner||request!==detailRequest)return;
   const encoded=JSON.stringify(value);if(encoded===lastDetail)return;lastDetail=encoded;detail.replaceChildren();if(!value){message(detail,'记录不存在');return;}detail.append(n('h2','',value.title||value.description));
   if(tab==='capabilities'){pair(detail,'目录',T('已注册'));pair(detail,'行为',label(value.effect));pair(detail,'依赖状态',T('未检测'));pair(detail,'外部操作',T(value.external?'是':'否'));return;}
   pair(detail,'状态',label(value.status));
   if(tab==='runs'){pair(detail,'开始',when(value.startedAt));pair(detail,'结束',when(value.completedAt));if(value.error)message(detail,value.error);const steps=section('执行步骤');if(!value.tools.length)message(steps,'未记录工具步骤');for(const t of value.tools){const row=n('div','ic-step');row.append(n('strong','',t.name),n('span','',label(t.status)));if(t.commitState)row.append(n('small','',label(t.commitState)));steps.append(row);}if(value.toolsTruncated)message(steps,'仅显示前 200 个步骤');return;}
   detail.append(n('p','ic-description',value.description));const capture=section('意图捕获');pair(capture,'来源',T(value.autoGenerated?'自动捕获':'已有建议'));runLink(capture,value.captureRun);
   const sources=section('来源依据');if(!value.sources.length)message(sources,'未记录来源');for(const source of value.sources){const row=n('div','ic-source');row.append(n('strong','',source.title||T('来源不可用')));for(const e of value.evidence.filter(e=>e.sourceId===source.id))row.append(n('blockquote','',e.quote));sources.append(row);}if(value.sourcesTruncated)message(sources,'来源已截断');
   const execution=section('后续执行');if(!value.targets.length)message(execution,value.status==='executed'?'关联结果缺失，进度未确认':'尚无执行结果');for(const target of value.targets){pair(execution,target.title||target.type,label(target.state));}for(const run of value.executionRuns)runLink(execution,run);if(value.runsTruncated)message(execution,'仅显示最近 50 次运行');
   const history=section('变更记录');if(!value.history.length)message(history,'未记录历史');for(const h of value.history)pair(history,when(h.createdAt),label(h.reason));if(value.historyTruncated)message(history,'仅显示最近 50 次变更');
  }catch(e){if(alive(g)&&selected===id&&request===detailRequest){lastDetail='';error(detail,e,()=>void loadDetail(id));}}}
  function switchTab(next,id=null){tab=next;selected=id;generation++;lastDetail='';search.value='';offset=0;detail.replaceChildren();status.replaceChildren();for(const [key,b]of tabs)b.setAttribute('aria-pressed',String(key===tab));void loadList();if(id)void loadDetail(id);}
  for(const [key,name]of [['capabilities','能力'],['intents','意图'],['runs','执行记录']]){const b=button(name,()=>switchTab(key),'ic-tab');tabs.set(key,b);nav.append(b);}
  search.oninput=()=>{generation++;selected=null;lastDetail='';detail.replaceChildren();clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadList(),180);};
  dialog.addEventListener('close',()=>{closed=true;generation++;clearInterval(timer);clearTimeout(searchTimer);dialog.remove();if(active===dialog)active=null;if(opener?.isConnected)opener.focus();},{once:true});
  dialog.showModal();switchTab('capabilities');timer=setInterval(()=>{if(!document.hidden&&dialog.open){if(offset<=40)void loadList();if(selected)void loadDetail(selected);}},5000);
 };
})();
