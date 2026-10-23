/* Settings entry for the read-only capability and intent console. */
(() => {
 const D=window.OpsTwinsDesktop;
 function mount(){
  const root=document.querySelector('#settings-window[open] .ss-content');
  if(!root||(root.dataset.v17Section||root.dataset.settingsKey?.split(':')[0])!=='general'||root.querySelector('#ideas-console-entry'))return;
  const section=document.createElement('section');section.id='ideas-console-entry';section.className='v17-settings-section';
  const row=document.createElement('div'),copy=document.createElement('strong'),button=document.createElement('button');row.className='ss-row';
  copy.textContent=D.translate('能力与意图');button.type='button';button.className='ss-button';button.textContent=D.translate('查看');button.setAttribute('aria-label',D.translate('查看能力与意图'));button.onclick=()=>D.openIdeasConsole();
  row.append(copy,button);section.append(row);root.append(section);
 }
 const root=document.querySelector('#settings-window');if(root)new MutationObserver(mount).observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['open','data-v17-section','data-settings-key']});mount();
})();
