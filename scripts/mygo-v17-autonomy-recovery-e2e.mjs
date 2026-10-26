// RC11 coordinator rerun; original independent script preserved.
// Autonomy instant CAS on shared public settings; exact baseline restored in finally.
// Runs autonomy-1792231369381 / -1792231401418 failed on waitForSelector visibility of the empty
// feedback box (reviewer harness bug, not product); kept as original evidence.
import fs from 'node:fs/promises';
const OUT='/Users/steve/Projects/opstwin-advance/output/mygo-v17-final-20261018/functional';
export default async function(){
 const dir=OUT+'/autonomy-'+Date.now();await fs.mkdir(dir,{recursive:true});
 const t=await globalThis.taskSpace(116),p=t.page('p3'),checks=[],info={};
 const api=async(m,u,b)=>{const r=await fetch('http://127.0.0.1:46500'+u,{method:m,headers:{'content-type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});const x=await r.text();let d;try{d=JSON.parse(x)}catch{d=x}return {status:r.status,data:d}};
 const c=(item,name,pass,detail)=>checks.push({item,name,status:pass?'PASS':'FAIL',...(detail!==undefined?{detail}:{})});
 const shot=async n=>{await p.screenshot({path:dir+'/'+n+'.png'});await fs.writeFile(dir+'/'+n+'.ax.txt',await p.snapshot())};
 const W=(fn,arg,ms)=>p.waitForFunction(fn,arg,{timeout:ms||15000});
 const auto=async()=>(await api('GET','/api/settings')).data.autonomy;
 const fb=()=>p.evaluate(()=>document.querySelector('.v17-auto-feedback')?.textContent||'');
 const checked=l=>p.evaluate(l=>document.querySelector('[aria-label="'+l+'"]').checked,l);
 const open=async()=>{if(await p.evaluate(()=>document.querySelector('#task-dialog').open))await p.click('#close-task');if(!await p.evaluate(()=>document.querySelector('#settings-window').open))await p.click('button[aria-label="设置"]');await p.click('[data-setting=autonomy]');await W(()=>!!document.querySelector('.v17-auto-feedback')&&!!document.querySelector('[aria-label="外发身份披露"]'))};
 const baseline=await auto();await fs.writeFile(dir+'/baseline.json',JSON.stringify(baseline,null,2));
 try{
  await p.reload();await W(()=>!!window.OpsTwinsDesktop?.v17&&!document.querySelector('#desktop-boot'));await open();
  info.ui=await p.evaluate(()=>({time:!!document.querySelector('#settings-content input[type=time]'),footer:!!document.querySelector('.ss-form-footer'),selects:document.querySelectorAll('.v17-settings-section .ss-select').length,quietText:/安静时段|quiet/i.test(document.querySelector('#settings-content').textContent)}));
  c('F7','无安静时段与底部提交栏，六项权限',!info.ui.time&&!info.ui.footer&&!info.ui.quietText&&info.ui.selects===6,info.ui);
  c('F7','界面与canonical一致',await checked('暂停所有发送')===baseline.holdSending&&await checked('外发身份披露')===baseline.transparency);
  const tr=baseline.transparency;await p.click('[aria-label="外发身份披露"]');await p.waitForTimeout(1000);
  c('F7','即时保存无需提交',(await auto()).transparency===!tr);
  await p.click('[aria-label="外发身份披露"]');await p.click('[aria-label="外发身份披露"]');await p.click('[aria-label="外发身份披露"]');await p.waitForTimeout(1800);
  const rapid=await auto(),rapidUi=await checked('外发身份披露');c('F7','快速连改最终值与界面一致',rapid.transparency===rapidUi&&rapid.transparency===tr,{server:rapid.transparency,ui:rapidUi});
  await api('POST','/api/pilot/v17-fault',{name:'autonomy'});const al=(await auto()).alerts;await p.click('[aria-label="重要操作通知"]');await W(()=>/公开故障/.test(document.querySelector('.v17-auto-feedback').textContent));
  const uiAlerts=await checked('重要操作通知');c('F7','503保留新选择且canonical不变',(await auto()).alerts===al&&uiAlerts===(al==='digest'),{fb:await fb()});await shot('fault-503');
  await p.click('.v17-auto-feedback button');await W(()=>!document.querySelector('.v17-auto-feedback').textContent);
  const afterRetry=await auto();c('F7','显式重试后真实保存',(afterRetry.alerts!=='digest')===uiAlerts,afterRetry.alerts);
  const cur=await auto();const ext=await api('PATCH','/api/settings',{autonomy:{permissions:{...cur.permissions,calendar:'read'}},baseSettings:{autonomy:cur}});c('F7','外部客户端CAS修改日历权限',ext.status===200,ext.status);
  await p.click('[aria-label="外发身份披露"]');await W(()=>/更新/.test(document.querySelector('.v17-auto-feedback').textContent));
  const mid=await auto();c('F7','409冲突不覆盖外部修改并保留本地选择',mid.permissions.calendar==='read'&&mid.transparency===tr&&await checked('外发身份披露')===!tr,{fb:await fb()});await shot('conflict-409');
  const retainedBefore=await auto();await p.click('[aria-label="重要操作通知"]');await p.waitForTimeout(400);c('F7','409后继续修改仍保留冲突提示且不提前提交',/更新/.test(await fb())&&(await auto()).alerts===retainedBefore.alerts,{feedback:await fb()});
  await p.click('.v17-auto-feedback button:last-child');await W(()=>/尚未保存/.test(document.querySelector('.v17-auto-feedback').textContent));
  c('F7','重基线显示外部日历权限且本地选择仍在',await p.evaluate(()=>document.querySelector('[aria-label="管理日历"]')?.textContent.includes('仅查看'))&&await checked('外发身份披露')===!tr);
  await p.click('.v17-auto-feedback button');await W(()=>!document.querySelector('.v17-auto-feedback').textContent);
  const fin=await auto();c('F7','仅重放本地字段且保留外部及其他字段',fin.transparency===!tr&&fin.permissions.calendar==='read'&&fin.permissions.files===baseline.permissions.files&&fin.holdSending===baseline.holdSending,{transparency:fin.transparency,calendar:fin.permissions.calendar,files:fin.permissions.files,hold:fin.holdSending});
  await p.click('#close-settings');await p.reload();await W(()=>!!window.OpsTwinsDesktop?.v17&&!document.querySelector('#desktop-boot'));await open();
  c('F7','刷新恢复canonical',await checked('外发身份披露')===fin.transparency);await shot('reloaded');
 }catch(e){checks.push({item:'F7',name:'phase exception',status:'FAIL',detail:String(e).slice(0,500)});await shot('failure').catch(()=>{})}
 finally{
  if(await p.evaluate(()=>document.querySelector('#settings-window').open).catch(()=>false))await p.click('#close-settings').catch(()=>{});
  const cur=await auto();const r=await api('PATCH','/api/settings',{autonomy:baseline,baseSettings:{autonomy:cur}});const fin=await auto();
  info.restore={status:r.status,exact:JSON.stringify(fin)===JSON.stringify(baseline)};c('G2','自主权限恢复为精确基线',info.restore.exact,info.restore);
  await p.evaluate(()=>localStorage.removeItem('opstwins-v17-autonomy')).catch(()=>{});await p.reload().catch(()=>{});
  await fs.writeFile(dir+'/result.json',JSON.stringify({info,checks},null,2));
 }
 return {dir,info,checks};
}
