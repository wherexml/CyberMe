/* Secondary-entry bridge from the CyberMe V6 shell: open the requested classic view and offer a way back. */
(() => {
 const nav=document.querySelector('.nav-footer')||document.querySelector('.nav');
 if(nav&&!document.querySelector('#cyberme-v6-return')){
  const back=document.createElement('button');back.id='cyberme-v6-return';back.type='button';
  const zh=(document.documentElement.lang||'').startsWith('zh');
  back.setAttribute('aria-label',zh?'返回 CyberMe':'Back to CyberMe');back.dataset.tooltip=zh?'返回 CyberMe':'Back to CyberMe';
  back.innerHTML='<svg aria-hidden="true" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"><polyline points="160 208 80 128 160 48"/></svg><span></span>';
  back.querySelector('span').textContent='CyberMe';
  back.onclick=()=>{location.href='cyberme.html'};
  nav.prepend(back);
 }
 const [view,encodedId]=location.hash.slice(1).split('/');
 const page={inbox:'inbox',ideas:'ideas','ideas-console':'ideas',tasks:'tasks',search:'search',settings:'settings','settings-models':'settings','settings-connections':'settings','settings-autonomy':'settings'}[view];
 if(page)setTimeout(()=>{
  if(view==='inbox'&&encodedId){
   try{void window.OpsTwinsDesktop.openInbox(decodeURIComponent(encodedId))}catch{document.querySelector('button[data-page="inbox"]')?.click()}
  }else document.querySelector(`button[data-page="${page}"]`)?.click();
 },0);
})();
