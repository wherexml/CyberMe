// 能力与意图 · 只读 Mock。全部为示例数据，不连接 /api/ideas-console，不创建任何执行。
import {esc,icon} from './ui.js';

const views=[['capabilities','能力'],['intents','意图'],['runs','执行记录']];
const missing='缺失',none='无记录';

const capabilities=[
 {id:'cap-local-task',name:'本地待办',kind:'工具',facts:[['注册','已注册','ok'],['配置','无需配置',''],['Worker','不适用',''],['当前状态','空闲',''],['历史成功','10-22 18:40','ok']]},
 {id:'cap-inbox-draft',name:'收件箱回复草稿',kind:'工具',facts:[['注册','已注册','ok'],['配置','已配置','ok'],['Worker','已启用','ok'],['当前状态','空闲',''],['历史成功','10-23 09:12','ok']]},
 {id:'cap-model-demo',name:'示例对话模型',kind:'模型',facts:[['注册','已注册','ok'],['配置','存在','ok'],['健康','未探测',''],['当前状态','不适用',''],['历史成功',none,'']]},
 {id:'cap-daily-digest',name:'每日整理',kind:'自动化',facts:[['注册','已注册','ok'],['配置','已配置','ok'],['Worker','未启用','warn'],['当前状态','未运行',''],['历史成功','10-19 08:00','ok']]},
 {id:'cap-feishu-capture',name:'飞书消息采集',kind:'连接',facts:[['注册','已注册','ok'],['配置','缺失','warn'],['Worker','未启用','warn'],['当前状态','未运行',''],['历史成功',none,'']]}
];

const intents=[
 {id:'idea-demo-01',title:'整理本周评审议程',sources:['灵感 · 示例评审笔记','收件箱 · 示例产品协作群'],capture:'run-demo-101',follow:{type:'待办',id:'task-demo-17',state:'active',label:'等待处理',tone:''}},
 {id:'idea-demo-02',title:'回复排期确认',sources:['收件箱 · 示例设计讨论'],capture:'run-demo-102',follow:{type:'回复草稿',id:'inbox-demo-08',state:'pending',label:'等待审批',tone:''}},
 {id:'idea-demo-03',title:'每周一汇总上周进展',sources:['灵感 · 示例周报'],capture:'run-demo-103',follow:{type:'自动化',id:'auto-demo-03',state:'disabled',label:'未启动',tone:'warn'}},
 {id:'idea-demo-04',title:'导出示例方案摘要',sources:['资料 · 示例方案.pdf'],capture:'run-demo-104',follow:{type:'文件',id:'artifact-demo-21',state:'generated',label:'已生成',tone:''}},
 {id:'idea-demo-05',title:'跟进旧线索',sources:null,capture:'run-demo-105',follow:{type:'待办',id:'task-demo-404',state:null,label:'未知',tone:'warn'}}
];

const runs=[
 {id:'run-demo-101',kind:'捕获',subject:'整理本周评审议程',status:'完成',tone:'ok',time:'10-23 09:30',steps:['读取灵感','创建待办'],trace:true},
 {id:'run-demo-102',kind:'捕获',subject:'回复排期确认',status:'完成',tone:'ok',time:'10-23 09:41',steps:['读取灵感','生成回复草稿'],trace:true},
 {id:'run-demo-103',kind:'捕获',subject:'每周一汇总上周进展',status:'完成',tone:'ok',time:'10-22 17:05',steps:['读取灵感','登记自动化'],trace:true},
 {id:'run-demo-104',kind:'捕获',subject:'导出示例方案摘要',status:'完成',tone:'ok',time:'10-22 16:20',steps:['读取资料','写入文件'],trace:true},
 {id:'run-demo-105',kind:'捕获',subject:'跟进旧线索',status:'完成',tone:'ok',time:'10-20 11:02',steps:[],trace:false},
 {id:'run-demo-201',kind:'执行',subject:'每日整理',status:'部分完成',tone:'warn',time:'10-19 08:00',steps:['读取收件箱','汇总待办','写入摘要'],trace:true,cut:'第 3 步后中断，未重试'},
 {id:'run-demo-202',kind:'执行',subject:'收件箱回复草稿',status:'未确认',tone:'warn',time:'10-23 09:12',steps:['生成回复草稿'],trace:true}
];

const sets={capabilities:[capabilities,x=>x.name+x.kind],intents:[intents,x=>x.title+x.id],runs:[runs,x=>x.subject+x.id+x.kind]};

export function capView(page){const v=String(page||'').split('/')[1];return views.some(x=>x[0]===v)?v:'capabilities'}

function rows(ui,view){const [list,key]=sets[view];const q=(ui.capQuery||'').trim();return q?list.filter(x=>key(x).includes(q)):list}
function current(ui,view,list){const id=(ui.capSelected||{})[view];return list.find(x=>x.id===id)||list[0]||null}
const tag=(text,tone='')=>`<span class="ic-tag ${tone}">${esc(text)}</span>`;

function listRow(view,x,selected){
 const [title,meta,side]=view==='capabilities'?[x.name,x.kind,x.facts[0][1]]:view==='intents'?[x.title,x.id,x.follow.label]:[x.subject,x.kind+' · '+x.time,x.status];
 return `<button type="button" class="ic-row ${selected?'selected':''}" data-action="cap-select:${view}:${esc(x.id)}" aria-current="${selected}"><span><b>${esc(title)}</b><small>${esc(meta)}</small></span><em>${esc(side)}</em></button>`;
}

function facts(list){return `<dl class="ic-facts">${list.map(([k,v,tone])=>`<dt>${esc(k)}</dt><dd>${tag(v,tone)}</dd>`).join('')}</dl>`}

function detail(view,x){
 if(!x)return `<div class="ic-blank">没有匹配的条目</div>`;
 if(view==='capabilities')return `<header><h2>${esc(x.name)}</h2><p>${esc(x.kind)} · ${esc(x.id)}</p></header>${facts(x.facts)}`;
 if(view==='intents'){
  const f=x.follow,run=runs.find(r=>r.id===x.capture);
  return `<header><h2>${esc(x.title)}</h2><p>${esc(x.id)}</p></header>
  <section><h3>来源</h3>${x.sources?`<ul class="ic-list-plain">${x.sources.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:`<p class="ic-missing">${missing}</p>`}</section>
  <section><h3>捕获</h3>${facts([['Run',x.capture,''],['状态',run?run.status:'未知',run?run.tone:'warn']])}<button type="button" class="ic-link" data-action="cap-run:${esc(x.capture)}">查看记录</button></section>
  <section><h3>后续执行</h3>${facts([['关联',f.type+' · '+f.id,''],['记录状态',f.state||missing,f.state?'':'warn'],['进度',f.label,f.tone]])}</section>`;
 }
 return `<header><h2>${esc(x.subject)}</h2><p>${esc(x.kind)} · ${esc(x.id)}</p></header>
  ${facts([['类型',x.kind,''],['状态',x.status,x.tone],['时间',x.time,''],['Trace',x.trace?'已记录':missing,x.trace?'':'warn']])}
  <section><h3>步骤</h3>${x.steps.length?`<ol class="ic-steps">${x.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:`<p class="ic-missing">${missing}</p>`}${x.cut?`<p class="ic-note">${esc(x.cut)}</p>`:''}</section>`;
}

function body(ui,view){
 const s=ui.scenario;
 if(s==='loading')return `<div class="ic-body"><div class="ic-list" aria-busy="true">${'<i class="ic-skeleton"></i>'.repeat(5)}</div><div class="ic-detail"></div></div>`;
 if(s==='error')return `<div class="ic-body"><div class="ic-state"><p>读取失败</p><button type="button" class="secondary" data-action="cap-retry">${icon('refresh')}重试读取</button></div></div>`;
 const list=s==='empty'?[]:rows(ui,view),x=current(ui,view,list);
 return `<div class="ic-body"><div class="ic-list" role="list">${list.map(r=>listRow(view,r,r===x)).join('')||`<div class="ic-blank">暂无条目</div>`}</div><div class="ic-detail">${detail(view,x)}</div></div>`;
}

export function capabilitiesPage(state,ui){
 const view=capView(ui.page);
 return `<section id="ideas-console" class="ic-page" data-view="${view}">
 <div class="ic-head"><h1>能力与意图</h1><nav class="ic-tabs" aria-label="视图">${views.map(([id,l])=>`<button type="button" class="${id===view?'active':''}" data-action="cap-view:${id}" aria-pressed="${id===view}">${l}</button>`).join('')}</nav><span class="ic-demo">示例数据</span><label class="ic-search">${icon('search')}<input id="cap-query" aria-label="搜索" placeholder="搜索" value="${esc(ui.capQuery||'')}"></label></div>
 ${body(ui,view)}</section>`;
}

export function createCapabilitiesController({getUI,render,navigate,toast}){
 document.addEventListener('input',e=>{
  if(e.target.id!=='cap-query')return;const ui=getUI();ui.capQuery=e.target.value;
  const t=document.createElement('template');t.innerHTML=body(ui,capView(ui.page));
  document.querySelector('#ideas-console .ic-body')?.replaceWith(t.content.firstElementChild);
 });
 return {actions:{
  'cap-view':v=>{getUI().capQuery='';navigate(v==='capabilities'?'capabilities':'capabilities/'+v)},
  'cap-select':v=>{const [view,...id]=v.split(':');const ui=getUI();ui.capSelected={...ui.capSelected,[view]:id.join(':')};render()},
  'cap-run':v=>{const ui=getUI();ui.capSelected={...ui.capSelected,runs:v};ui.capQuery='';ui.page='capabilities/runs';render()},
  'cap-retry':()=>{const ui=getUI();ui.scenario='normal';render();toast('已重新读取示例 · 未创建执行')}
 }};
}
