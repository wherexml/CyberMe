// Voice Input's VMSelect keeps the original interaction code. Native selects
// remain form controls; only their visible presentation is replaced.
export function upgradeSelects(root=document) {
  for (const [index,select] of [...root.querySelectorAll('select')].entries()) {
    const id=select.dataset.selectNative||select.id||`ot-${select.closest('form')?.dataset.kind||'settings'}-${select.name}-${index}`;
    select.dataset.selectNative=id;
    select.hidden=true;
    select.nextElementSibling?.matches('[data-vm-select]')&&select.nextElementSibling.remove();
    const options=[...select.options].map(o=>({value:o.value,label:o.textContent,group:o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:undefined}));
    select.insertAdjacentHTML('afterend',window.VMSelect.render({id,label:select.getAttribute('aria-label')||select.name,value:select.value,disabled:select.disabled,options}));
  }
}
document.addEventListener('vm-select-change',event=>{
  const select=[...document.querySelectorAll('[data-select-native]')].find(s=>s.dataset.selectNative===event.detail.id);
  if(!select||select.disabled||![...select.options].some(o=>o.value===event.detail.value&&!o.disabled))return;
  select.value=event.detail.value;
  select.dispatchEvent(new Event('change',{bubbles:true}));
  if(select.isConnected)upgradeSelects(select.parentElement);
});
// The original portal uses viewport coordinates. In a scaled desktop preview,
// constrain and scale it against the originating product window instead.
new MutationObserver(()=>{
  const menu=document.querySelector('#vm-select-menu'),button=document.querySelector('[data-vm-select][aria-expanded=true]');
  if(!menu||!button)return;
  const canvas=button.closest('.prototype-canvas'),r=button.getBoundingClientRect();
  const bounds=canvas?.getBoundingClientRect()||{left:0,top:0,right:innerWidth,bottom:innerHeight};
  const scale=canvas?bounds.width/1000:1;
  const below=bounds.bottom-r.bottom-12*scale,above=r.top-bounds.top-12*scale;
  const up=below<180*scale&&above>below;
  menu.style.setProperty('--vm-scale',scale);
  menu.style.width=r.width+'px';
  menu.style.left=Math.max(bounds.left+8*scale,Math.min(r.left,bounds.right-r.width-8*scale))+'px';
  menu.style.maxHeight=Math.max(40*scale,Math.min(330*scale,up?above:below))+'px';
  menu.style.top=up?'auto':r.bottom+6*scale+'px';
  menu.style.bottom=up?innerHeight-r.top+6*scale+'px':'auto';
}).observe(document.body,{childList:true});
