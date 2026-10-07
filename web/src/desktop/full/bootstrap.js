(async()=>{
 const root=document.createElement('div');root.id='desktop-boot';root.style='position:fixed;inset:0;z-index:99999;background:#fff;display:grid;place-content:center;gap:16px;padding:24px';root.textContent='正在连接工作区…';document.body.append(root);
 const load=(url,module=false)=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;if(module)s.type='module';s.onload=resolve;s.onerror=()=>reject(Error('无法加载 '+url));document.body.append(s)});
 try{
  await window.OpsTwinsDesktop.initialize();
  window.OPSTWINS_DESIGN_DATA=await window.OpsTwinsDesktop.bootstrap();
  window.OpsTwinsDesktop.installLocale();
  await load(window.OPSTWINS_DESKTOP_MANIFEST.islands,true);
  for(const item of window.OPSTWINS_DESIGN_DATA.inbox)item.attention=window.OpsTwinsBusinessUI.needsInboxAttention(item);
  for(const url of window.OPSTWINS_DESKTOP_MANIFEST.scripts)await load(url);
  root.remove();
 }catch(e){root.textContent='工作区暂不可用：'+e.message;const retry=document.createElement('button');retry.textContent='重试连接';retry.onclick=()=>location.reload();root.append(retry)}
})();
