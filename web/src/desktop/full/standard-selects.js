/* Presentation only: the original select owns validation, FormData and change. */
(()=>{
 const D=window.OpsTwinsDesktop,states=new WeakMap();let serial=0,queued=false,invalidCycle=false;
 const labelOf=s=>s.getAttribute('aria-label')||[...(s.labels||[])].map(l=>[...l.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ').trim()).find(Boolean)||s.name||D.translate('选择');
 function attach(s){if(!(s instanceof HTMLSelectElement)||s.multiple||s.size>1)return;let x=states.get(s);if(!x){const id='desktop-vm-'+(++serial),b=document.createElement('span');b.className='desktop-select-slot';s.after(b);x={id,slot:b,button:null,key:''};states.set(s,x);s.dataset.standardSelect=id;s.hidden=true;
  s.addEventListener('invalid',e=>{e.preventDefault();sync(s);const first=s.form?[...s.form.elements].find(n=>n.willValidate&&!n.validity.valid):s;if(first===s&&!invalidCycle){invalidCycle=true;setTimeout(()=>{invalidCycle=false;if(s.isConnected&&!s.validity.valid)x.button?.focus()},0);x.button?.focus()}x.button?.setAttribute('aria-invalid','true');let n=x.slot.querySelector('.vm-select-error');if(!n){n=document.createElement('small');n.className='vm-select-error';n.id=x.id+'-error';n.setAttribute('role','alert');x.slot.append(n)}x.button?.setAttribute('aria-describedby',n.id);n.textContent=s.validationMessage});
 }
 sync(s);return x.button;
 }
 function sync(s){const x=states.get(s);if(!x||!s.isConnected)return;const cfg={id:x.id,label:labelOf(s),value:s.value,disabled:s.disabled,options:[...s.options].map(o=>({value:o.value,label:o.textContent,group:o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:undefined,disabled:o.disabled||o.parentElement.disabled===true}))};if(s.validity.valid){x.slot.querySelector('.vm-select-error')?.remove();x.button?.removeAttribute('aria-invalid');x.button?.removeAttribute('aria-describedby')}const key=JSON.stringify(cfg);if(key!==x.key&&x.button?.getAttribute('aria-expanded')==='true')window.VMSelect.close(true);if(key===x.key&&x.button?.isConnected)return;x.key=key;
  const t=document.createElement('template');t.innerHTML=window.VMSelect.render(cfg);const fresh=t.content.firstElementChild;
  if(x.button?.isConnected){x.button.replaceChildren(...fresh.childNodes);x.button.dataset.vmSelect=fresh.dataset.vmSelect;x.button.disabled=cfg.disabled;x.button.setAttribute('aria-label',cfg.label)}else{x.button=fresh;x.slot.prepend(fresh)}
  s.parentElement?.querySelector(':scope>.ss-select-trigger')?.remove();
 }
 function scan(){queued=false;for(const s of document.querySelectorAll('select'))attach(s);const open=document.querySelector('[data-vm-select][aria-expanded=true]');if(document.querySelector('#vm-select-menu')&&!open)window.VMSelect.close()}
 const schedule=()=>{if(!queued){queued=true;queueMicrotask(scan)}};
 document.addEventListener('vm-select-change',e=>{const s=[...document.querySelectorAll('select[data-standard-select]')].find(s=>s.dataset.standardSelect===e.detail.id);if(!s||s.disabled||![...s.options].some(o=>o.value===e.detail.value&&!o.disabled&&!o.parentElement.disabled))return;s.value=e.detail.value;states.get(s)?.slot.querySelector('.vm-select-error')?.remove();s.dispatchEvent(new Event('change',{bubbles:true}));schedule()});
 document.addEventListener('change',schedule,true);
 document.addEventListener('click',e=>{const label=e.target.closest('label');const s=label?.control;if(e.target.closest('[data-vm-select]')||!(s instanceof HTMLSelectElement)||!states.has(s))return;e.preventDefault();states.get(s).button?.focus()});
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','aria-label','required','value','label']});
 document.addEventListener('close',()=>window.VMSelect.close(),true);
 document.addEventListener('desktop-navigate',()=>window.VMSelect.close());
 window.OpsTwinsSelects={attach,sync,scan};schedule();
})();
