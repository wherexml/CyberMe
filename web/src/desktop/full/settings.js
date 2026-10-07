/* Keep the reference settings layout; replace preview-only business forms with production flows. */
(() => {
 const original=window.OpsTwinsSettingsStudy,hosts=new Map();let options;
 const api=(...a)=>window.OpsTwinsDesktop.api(...a);
 const delegated=new Set(['models','connections','identity','channels']);
 function isNative(){return !!window.mygo}
 function nativeLink(e){const a=e.target.closest('a');if(!a)return;if(a.href.startsWith('x-apple.systempreferences:')){e.preventDefault();if(isNative())void window.mygo.call('DesktopFiles.OpenExternal',a.href).catch(x=>options.toast(x.message));else options.toast('请在 macOS App 中打开系统设置')}}
 document.addEventListener('click',nativeLink);
 window.OpsTwinsDesktop.saveSetting=async(key,draft,baseline)=>{
  if(['autonomy','identity'].includes(key)){const latest=await api('GET','/api/settings');if(JSON.stringify(latest[key])!==JSON.stringify(baseline)){const e=Error('配置已在其他位置更新；当前输入保留，请先读取最新版本');e.status=409;throw e}const saved=await api('PATCH','/api/settings',{[key]:draft,baseSettings:{[key]:baseline}});options.data.settings=saved;return saved[key]}
  throw Error('此设置必须通过对应业务表单保存');
 };
 function render(ctx){for(const [key,host] of hosts)if(key==='models'&&key!==ctx.setting){window.OpsTwinsBusinessUI.unmount(host);hosts.delete(key)}options=ctx;const root=ctx.root;document.querySelectorAll('[data-setting]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.setting===ctx.setting)));
  if(delegated.has(ctx.setting)){
   let host=hosts.get(ctx.setting);if(!host){host=document.createElement('div');host.className='desktop-settings-island';hosts.set(ctx.setting,host)}
   if(root.firstChild!==host){root.replaceChildren(host);root.scrollTop=0}root.classList.add('ss-content');window.OpsTwinsBusinessUI.mount(host,{data:ctx.data,section:ctx.setting});return;
  }
  original.render(ctx);
  if(ctx.setting==='about'){root.replaceChildren(ctx.node('h2','','OpsTwins'),ctx.node('p','','MyGO · macOS'),ctx.node('p','','工作区版本 '+ctx.data.revision));const log=ctx.btn('查看操作记录',()=>window.dispatchEvent(new CustomEvent('desktop-navigate',{detail:'/activity'})));root.append(log);return}
  if(ctx.setting==='devices'){for(const el of root.querySelectorAll('.ss-status'))if(el.textContent==='原生状态未接入')el.textContent=isNative()?'此 Mac · 已连接':'浏览器工作区';}
  if(ctx.setting==='legal'){for(const el of root.querySelectorAll('.ss-status'))if(el.textContent==='待原生接入')el.textContent=isNative()?'已用于文件选择与保存':'由当前浏览器权限管理';}
  if(ctx.setting==='filesystem'){for(const button of root.querySelectorAll('button'))if(button.textContent.includes('选择')&&button.disabled&&isNative()){button.disabled=false;button.onclick=async()=>{try{const path=await window.mygo.call('DesktopFiles.ChooseFolder');if(path){const input=root.querySelector('input[placeholder]');if(input){input.value=path;input.dispatchEvent(new Event('input',{bubbles:true}))}}}catch(e){ctx.toast(e.message)}}}}
 }
 window.OpsTwinsSettingsStudy={render,navigate(section){original.navigate(section)}};
 document.addEventListener('close',e=>{if(e.target.id==='settings-window'){for(const [key,host] of hosts)if(['models','connections'].includes(key)){window.OpsTwinsBusinessUI.unmount(host);hosts.delete(key)}}},true);
 window.addEventListener('desktop-owner-hidden',()=>{for(const [key,host] of hosts)if(key==='connections'){window.OpsTwinsBusinessUI.unmount(host);hosts.delete(key)}});
})();
