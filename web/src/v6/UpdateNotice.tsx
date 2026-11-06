import {useEffect} from 'react';
import {isNative} from './native';
import {showUpdate,startUpdates,stopUpdates,updateAction,updateTitle,useUpdate} from './updates';

export function UpdateNotice({zh}:{zh:boolean}){
 const {value:s,busy,open}=useUpdate();
 useEffect(()=>{startUpdates();return stopUpdates},[]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy&&!['installing','prepared'].includes(s.status))showUpdate(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[busy,s.status]);
 if(!isNative())return null;
 const freeze=(busy&&s.ready&&s.status!=='waiting')||['installing','prepared'].includes(s.status);
 const disabled=busy||['checking','verifying','installing','prepared','waiting'].includes(s.status);
 const action=s.status==='downloading'?'cancel':s.ready?'install':s.available?'download':'check';
 const label=action==='cancel'?(zh?'取消下载':'Cancel download'):action==='install'?(zh?'安装并重启':'Install and restart'):action==='download'?(zh?'下载更新':'Download update'):(zh?'检查更新':'Check for updates');
 return <>
  {freeze?<div style={{position:'fixed',inset:0,zIndex:90,cursor:'wait',background:'rgba(0,0,0,.08)'}}/>:null}
  {open?<div role="dialog" aria-label={zh?'软件更新':'Software update'} style={{position:'fixed',right:24,bottom:24,zIndex:91,width:'min(420px, calc(100vw - 48px))',boxSizing:'border-box',padding:20,display:'flex',gap:12,borderRadius:18,background:'var(--card)',color:'var(--text)',boxShadow:'0 0 0 1px var(--line), 0 12px 40px -8px rgba(0,0,30,.25)'}}>
   <span aria-hidden="true" style={{color:'var(--accent)',fontSize:24}}>↓</span>
   <div style={{flex:1,minWidth:0}}><strong>{updateTitle(s,zh)}</strong>
    <div role="status" style={{color:'var(--text2)',margin:'4px 0 12px'}}>{s.status==='ready'?(zh?'CyberMe 已下载更新，重启即可完成安装。':'CyberMe has downloaded an update. Restart to finish installing.'):(s.available?.version||'')}</div>
    {s.status==='downloading'?<progress aria-label={zh?'下载进度':'Download progress'} max={s.total||undefined} value={s.total?s.downloaded:undefined} style={{width:'100%',marginBottom:10}}/>:null}
    <button type="button" disabled={disabled} onClick={()=>void updateAction(action)} style={{font:'inherit',fontWeight:500,padding:'6px 14px',border:'1px solid var(--lineStrong)',borderRadius:20,background:'transparent',color:'inherit',cursor:disabled?'default':'pointer'}}>{label}</button>
   </div>
   {!freeze?<button type="button" aria-label={zh?'关闭更新提醒':'Close update notice'} onClick={()=>showUpdate(false)} style={{alignSelf:'flex-start',border:0,background:'transparent',fontSize:20,color:'var(--text3)',cursor:'pointer'}}>×</button>:null}
  </div>:null}
 </>;
}
