import React,{useEffect,useState} from 'react';
import {api} from '../domain/api';
export default function GoogleConnection({onConnected}:{onConnected:()=>Promise<void>}){
 const [state,setState]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[url,setUrl]=useState('');
 async function refresh(){try{const s=await api.get('/connections/google/status');setState(s);return s}catch(e:any){setError(e.message)}}
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{if(state?.status==='connected')void onConnected()},[state?.status]);
 async function authorize(){setBusy(true);setError('');try{const result=await api.post('/connections/google/authorize',{});setUrl(result.url);if(window.mygo)await window.mygo.call('DesktopFiles.OpenExternal',result.url);else window.open(result.url,'_blank','noopener,noreferrer')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function disconnect(){setBusy(true);setError('');try{await api.post('/connections/gmail-oauth/disconnect',{});setUrl('');await refresh();await onConnected()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function verify(){setBusy(true);setError('');try{const r=await api.post('/connections/google/check',{});setState({...state,message:r.message});await onConnected()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <section className="google-authorization"><p>使用 Google 账号授权连接 Gmail。授权在系统浏览器完成，密码不会交给 OpsTwins。</p>{state?.account&&<p>{state.account}</p>}<p role="status">{state?.message||'正在检查授权状态…'}</p>{error&&<p role="alert" className="settings-error">{error}</p>}<div className="settings-card-actions"><button className="settings-button settings-button-primary" disabled={busy||!state?.configured} onClick={authorize}>{busy?'处理中…':state?.status==='connected'?'重新授权':'使用 Google 授权'}</button>{state?.status==='connected'&&<button className="settings-button" disabled={busy} onClick={verify}>验证连接</button>}{state?.status==='connected'&&<button className="settings-button" disabled={busy} onClick={disconnect}>断开连接</button>}<button className="settings-button" onClick={()=>void refresh()}>刷新授权状态</button></div>{url&&state?.status!=='connected'&&<p><a href={url} target="_blank" rel="noreferrer">再次打开 Google 授权页</a></p>}</section>
}
