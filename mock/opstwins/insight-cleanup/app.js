const key='cyberme-insight-cleanup-mock-v1';
const $=s=>document.querySelector(s);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial=[
 {kind:'inbox',id:'release',title:'先确认发布范围，再补充验收细节',body:'发布评审先聚焦核心流程，扩展功能留到下一轮。现在适合把评审范围收紧，避免准备工作继续铺开。',time:'今天 09:40',icon:'compass',action:'梳理评审重点',prompt:'帮我梳理这次发布评审的重点。',source:'产品评审群 · 今天 09:40',quote:'这轮先看核心流程，扩展功能下次再评审。',folded:false},
 {kind:'idea',id:'feedback',title:'试用反馈开始集中到同一个问题',body:'近期反馈反复提到首次使用时找不到入口。可以先核对入口的位置与命名，再决定是否补充引导。',time:'今天 09:15',icon:'insight',action:'分析反馈共性',prompt:'帮我分析这几条试用反馈的共性。',source:'试用反馈 · 今天 09:15',quote:'功能用起来没问题，但第一次找入口花了些时间。',folded:false},
 {kind:'inbox',id:'shared',title:'下周评审的时间安排',body:'评审时间待下一次讨论确认，先保留已有时间安排。',time:'昨天 16:20',icon:'calendar',action:'梳理时间安排',prompt:'帮我梳理评审时间安排。',source:'项目群 · 昨天 16:20',quote:'下周评审的时间，我们周五再确认。',folded:true},
 {kind:'idea',id:'shared',title:'把零散反馈整理成一份讨论提纲',body:'几条零散反馈可以整理成共同讨论的问题，先核对原文再归纳。',time:'昨天 14:10',icon:'briefing',action:'整理讨论提纲',prompt:'帮我把这些反馈整理成讨论提纲。',source:'讨论记录 · 昨天 14:10',quote:'下次讨论前，可以把我们提到的几个问题放在一起。',folded:true}
];
const extra={kind:'idea',id:'new-observation',title:'评审材料与讨论范围可以一起收紧',body:'最新讨论继续围绕核心流程。准备材料时，可以沿用同一范围，把扩展功能留在附录。',time:'刚刚',icon:'focus',action:'核对材料范围',prompt:'帮我核对评审材料与讨论范围。',source:'评审讨论 · 刚刚',quote:'材料先对应核心流程，扩展部分作为附录。',folded:false};
const identity=r=>r.kind+':'+r.id;
let rows=structuredClone(initial),expanded=false,busy=false,generation=0,scene='initial',undoKey=null,undoTimer,theme='light',quoteKey=null;
try{const s=JSON.parse(localStorage.getItem(key));if(s?.version===1){const saved=new Map((s.rows||[]).map(r=>[r.key,r.folded]));rows=[...initial,...(s.extra?[extra]:[])].map(r=>({...r,folded:saved.has(identity(r))?saved.get(identity(r))===true:r.folded}));expanded=s.expanded===true;theme=s.theme==='dark'?'dark':'light';$('#draft').value=typeof s.draft==='string'?s.draft.slice(0,6000):'';quoteKey=rows.some(r=>identity(r)===s.quoteKey)?s.quoteKey:null}}catch{}
function save(){try{localStorage.setItem(key,JSON.stringify({version:1,rows:rows.map(r=>({key:identity(r),folded:r.folded})),extra:rows.some(r=>r.id===extra.id),expanded,theme,draft:$('#draft').value,quoteKey}));$('#storage-note').hidden=true}catch{$('#storage-note').hidden=false}}
function renderQuote(){const r=rows.find(r=>identity(r)===quoteKey);$('#quote-slot').innerHTML=r?`<div class="quote"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v5H4M4 10l5-5M4 10h10a5 5 0 0 1 5 5v3"/></svg><span>${esc(r.title)}</span><button type="button" id="remove-quote" aria-label="移除引用">×</button></div>`:''}
function render(){
 const active=rows.filter(r=>!r.folded),archived=rows.filter(r=>r.folded);
 $('#feed').innerHTML=active.length?active.map(r=>`<article class="insight-card" data-key="${esc(identity(r))}">
  <div class="card-head"><img class="artwork" src="../assets/idea-icons/${r.icon}.svg" alt=""><time>${esc(r.time)}</time><button type="button" class="menu-toggle" aria-label="更多：${esc(r.title)}" aria-expanded="false" data-action="menu" data-key="${esc(identity(r))}">···</button><div class="card-menu" hidden><button type="button" data-action="fold" data-key="${esc(identity(r))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14v11H5zM4 4h16v4H4zM10 12h4"/></svg>收起</button></div></div>
  <h2>${esc(r.title)}</h2><p class="card-body">${esc(r.body)}</p>
  <div class="card-actions"><button type="button" class="primary" data-action="prepare" data-key="${esc(identity(r))}">${esc(r.action)}</button><button type="button" class="secondary" data-action="ask" data-key="${esc(identity(r))}">问问CyberMe</button></div>
  <details class="source"><summary>查看来源</summary><blockquote>${esc(r.quote)}<cite>${esc(r.source)}</cite></blockquote></details>
 </article>`).join(''):'<div class="feed-empty">暂时没有新洞察</div>';
 $('#archive').hidden=!archived.length;
 $('#archive-toggle').setAttribute('aria-expanded',String(expanded));$('#archive-list').hidden=!expanded;
 $('#archive-list').innerHTML=archived.map(r=>`<div class="archive-row" data-key="${esc(identity(r))}"><span class="row-title">${esc(r.title)}</span><button type="button" data-action="restore" data-key="${esc(identity(r))}" aria-label="恢复：${esc(r.title)}">恢复</button></div>`).join('');
 document.documentElement.dataset.theme=theme;$('#theme-toggle').setAttribute('aria-pressed',String(theme==='dark'));$('#theme-toggle').textContent=theme==='dark'?'浅色':'深色';
 renderQuote();
}
function clearAck(){clearTimeout(undoTimer);undoKey=null;$('#ack').hidden=true}
function restore(id){const r=rows.find(r=>identity(r)===id);if(!r)return;r.folded=false;if(undoKey===id)clearAck();render();save();const card=[...document.querySelectorAll('.insight-card')].find(c=>c.dataset.key===id);card?.scrollIntoView({block:'nearest',behavior:'smooth'});if(!rows.some(r=>r.folded))$('#refresh').focus();else $('#archive-toggle').focus()}
function closeMenus(){for(const b of document.querySelectorAll('[data-action="menu"]')){b.setAttribute('aria-expanded','false');b.nextElementSibling.hidden=true}}
document.addEventListener('click',e=>{
 const button=e.target.closest('button[data-action]');if(!button){closeMenus();return}
 const r=rows.find(r=>identity(r)===button.dataset.key);if(!r)return;
 const action=button.dataset.action;
 if(action==='menu'){const open=button.getAttribute('aria-expanded')!=='true';closeMenus();button.setAttribute('aria-expanded',String(open));button.nextElementSibling.hidden=!open;if(open)button.nextElementSibling.querySelector('button').focus();return}
 closeMenus();
 if(action==='fold'){r.folded=true;clearAck();undoKey=identity(r);$('#ack').hidden=false;undoTimer=setTimeout(clearAck,8000);render();save();$('#undo').focus()}
 if(action==='restore')restore(identity(r));
 if(action==='ask'||action==='prepare'){quoteKey=identity(r);const prompt=action==='ask'?'请结合这条洞察和来源，帮我分析判断与下一步。':r.prompt;const draft=$('#draft');if(!draft.value.includes(prompt))draft.value=[draft.value,prompt].filter(Boolean).join('\n\n');renderQuote();save();draft.focus()}
});
document.addEventListener('click',e=>{if(e.target.closest('#remove-quote')){quoteKey=null;renderQuote();save();$('#draft').focus()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const opener=document.querySelector('[data-action="menu"][aria-expanded="true"]');closeMenus();opener?.focus()}});
$('#archive-toggle').addEventListener('click',()=>{expanded=!expanded;$('#archive-toggle').setAttribute('aria-expanded',String(expanded));$('#archive-list').hidden=!expanded;save()});
$('#undo').addEventListener('click',()=>{if(undoKey)restore(undoKey)});
$('#draft').addEventListener('input',save);
$('#theme-toggle').addEventListener('click',()=>{theme=theme==='light'?'dark':'light';render();save()});
function refreshState(){const b=$('#refresh');b.disabled=busy;b.setAttribute('aria-busy',String(busy));b.querySelector('span').textContent=busy?'查找中…':$('#refresh-error').hidden?'刷新洞察':'重新查找'}
$('#refresh').addEventListener('click',async()=>{
 if(busy)return;busy=true;const current=++generation;$('#refresh-error').hidden=true;refreshState();
 await new Promise(resolve=>setTimeout(resolve,1000));if(current!==generation)return;
 if(scene==='failure'){$('#refresh-error').textContent='刷新未完成';$('#refresh-error').hidden=false;scene='initial'}
 else if(!rows.some(r=>identity(r)===identity(extra))){const scroll=$('#feed-scroll'),top=scroll.scrollTop,anchor=scroll.querySelector('.insight-card'),before=anchor?.getBoundingClientRect().top;rows.push({...extra});render();if(top>0&&anchor){const first=scroll.querySelector('.insight-card');scroll.scrollTop=top+(first.getBoundingClientRect().top-before)}save()}
 busy=false;refreshState();
});
for(const b of document.querySelectorAll('[data-scene]'))b.addEventListener('click',()=>{generation++;busy=false;clearAck();scene=b.dataset.scene;rows=structuredClone(initial);expanded=scene==='expanded';if(scene==='empty')rows=[];$('#refresh-error').hidden=true;$('#feed-scroll').scrollTop=0;quoteKey=null;$('#draft').value='';for(const x of document.querySelectorAll('[data-scene]'))x.setAttribute('aria-pressed',String(x===b));render();refreshState();save()});
function fit(){const height=$('.studio').getBoundingClientRect().height;document.documentElement.style.setProperty('--studio-height',height+'px');const scale=Math.min(1,Math.max(.1,(innerWidth-32)/1000),Math.max(.1,(innerHeight-height-48)/700));$('#product-frame').style.width=1000*scale+'px';$('#product-frame').style.height=700*scale+'px';$('#product').style.setProperty('--scale',scale)}
new ResizeObserver(fit).observe($('.studio'));window.addEventListener('resize',fit);render();fit();
