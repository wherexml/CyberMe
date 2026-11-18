import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {Page,connStatusOf,useRows} from './Settings';
import {api,host} from './store';

// Only apps with a real adapter appear here. Matching uses exact connection IDs, never names.
const APPS=[
 {id:'feishu-local',label:['Feishu','飞书'],brand:'feishu',icon:'ph-chat-circle',create:{provider:'feishu',type:'CLI',name:'Feishu'}},
 {id:'wechat-sync-local',label:['WeChat','微信'],brand:'wechat',icon:'ph-chat-circle',create:{provider:'wechat',name:'WeChat'}},
 {id:'gmail-oauth',label:['Gmail','Gmail'],brand:'gmail',icon:'ph-envelope',create:null},
] as const;
// Shown only when the installed app's native adapter reports support.
const APPLE_APPS=[
 {id:'apple-calendar-local',label:['Apple Calendar','Apple 日历'],brand:'apple',icon:'ph-calendar-blank',create:null},
 {id:'apple-reminders-local',label:['Apple Reminders','Apple 提醒事项'],brand:'apple',icon:'ph-list-checks',create:null},
] as const;

export function AddConnectionPage({ctx}:{ctx:Ctx}){
 const {z}=useRows(ctx);const [busy,setBusy]=useState(''),[error,setError]=useState<{id:string;text:string}|null>(null);
 const lock=useRef(false),alive=useRef(true);
 const [apple,setApple]=useState(false);
 useEffect(()=>{if(!host())return;let active=true;api<any>('GET','/api/connections/apple/status').then(v=>{if(active)setApple(v.supported===true)},()=>{});return()=>{active=false}},[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const open=(id:string)=>ctx.goSet('connections',{type:'conn',id});
 async function add(app:{id:string;create:any}){
  if(!app.create){open(app.id);return}
  if(lock.current)return;lock.current=true;setBusy(app.id);setError(null);
  try{
   const result=await api<any>('POST','/api/connections/test',app.create);
   // The server already holds the outcome: a failed refresh asks for a reload, never a second POST.
   try{await ctx.refresh()}catch{ctx.notify(z('Saved on the server. Reload to confirm.','服务端已更新，请重新加载确认。'),'error')}
   if(alive.current)open(result?.connection?.id||app.id);
  }catch(e:any){if(alive.current)setError({id:app.id,text:e.message})}
  finally{lock.current=false;if(alive.current)setBusy('')}
 }
 return <Page title={ctx.XL.addConn} sections={[{rows:[...APPS,...(apple?APPLE_APPS:[])].map(app=>{
  const row=ctx.ws.connections.find(c=>c.id===app.id&&!c.supersededBy);const status=row?connStatusOf(row,ctx.zh):null;
  return {key:app.id,label:app.label[ctx.zh?1:0],brand:app.brand,logoIcon:app.icon,sub:error?.id===app.id?error.text:undefined,value:busy===app.id?z('Checking…','检测中…'):status?(status[1]==='var(--warnText)'?z('Needs attention','需要处理'):status[0]):z('Add','添加'),valueStyle:{fontSize:12,whiteSpace:'nowrap' as const,color:status?status[1]:'var(--accentText)'},onRow:()=>{if(row)open(app.id);else void add(app)},dim:!!busy&&busy!==app.id,caret:true};
 })}]}/>;
}

export function GmailConnectionPage({ctx}:{ctx:Ctx}){
 const {z,act,tog}=useRows(ctx);
 const [s,setS]=useState<any>(null),[err,setErr]=useState(''),[info,setInfo]=useState(''),[busy,setBusy]=useState(''),[confirm,setConfirm]=useState(false),[waitUntil,setWaitUntil]=useState(0);
 const lock=useRef(false),seq=useRef(0),alive=useRef(true),timer=useRef(0),baseline=useRef<string|undefined>(undefined);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current)}},[]);
 // Each read supersedes earlier ones, so a slow status response cannot overwrite a newer baseline.
 const load=useCallback(async()=>{const id=++seq.current;try{const v=await api<any>('GET','/api/connections/google/status');if(alive.current&&id===seq.current){setS(v);return v}}catch(e:any){if(alive.current&&id===seq.current)setErr(e.message)}},[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(!waitUntil)return;
  const tick=async()=>{if(Date.now()>waitUntil){setWaitUntil(0);setInfo('');return}const v=await load();if(v?.status==='connected'&&v.updatedAt!==baseline.current){setWaitUntil(0);setInfo('');void ctx.refresh()}};
  const t=setInterval(()=>void tick(),3000),focus=()=>void tick();addEventListener('focus',focus);
  return()=>{clearInterval(t);removeEventListener('focus',focus)}},[waitUntil,load]);// eslint-disable-line react-hooks/exhaustive-deps
 async function run(name:string,fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(name);setErr('');setInfo('');try{await fn()}catch(e:any){if(alive.current)setErr(e.message)}finally{lock.current=false;if(alive.current)setBusy('')}}
 const sync=async()=>{await load();try{await ctx.refresh()}catch{if(alive.current)setInfo(z('Saved on the server. Reload to confirm.','服务端已更新，请重新加载确认。'))}};
 const authorize=()=>void run('auth',async()=>{baseline.current=s?.updatedAt;const r=await api<any>('POST','/api/connections/google/authorize',{});const h=host();if(h)await h.call('DesktopFiles.OpenExternal',r.url);else window.open(r.url,'_blank','noopener,noreferrer');setWaitUntil(r.expiresAt);setInfo(z('Finish in your browser, then return here.','请在浏览器完成授权，然后回到这里。'))});
 const recheck=()=>void run('check',async()=>{try{const r=await api<any>('POST','/api/connections/google/check',{});setInfo(r.message||'')}finally{await sync()}});
 const toggleRead=()=>void run('read',async()=>{if(!s?.updatedAt)return;try{await api('PATCH','/api/connections/gmail-oauth/grants',{read:!s.read,baseUpdatedAt:s.updatedAt})}catch(e:any){if(e.status===409){await load();throw new Error(ctx.T.conflict)}throw e}await sync()});
 const disconnect=()=>{if(!confirm){setConfirm(true);timer.current=window.setTimeout(()=>setConfirm(false),3000);return}clearTimeout(timer.current);setConfirm(false);void run('off',async()=>{await api('POST','/api/connections/gmail-oauth/disconnect',{});await sync();if(alive.current)ctx.goSet('connections')})};
 if(!s)return <Page title="Gmail" sections={[{rows:[{label:err||'…'}]}]}/>;
 const connected=s.status==='connected',exists=!!s.updatedAt&&s.status!=='disconnected';
 const [label,color]=!s.configured&&!connected?[z('Setup required','待配置'),'var(--warnText)']:connected?[z('Connected','已连接'),'var(--okText)']:s.status==='reauth'?[z('Reconnect needed','需要重新连接'),'var(--warnText)']:[z('Not connected','未连接'),'var(--text3)'];
 return <Page title="Gmail" sections={[
  {rows:[{label:z('Status','状态'),value:busy==='check'?z('Checking…','检测中…'):label,valueStyle:{fontSize:14,color,whiteSpace:'nowrap'}},s.account?{label:z('Account','账户'),value:s.account}:null,
   act(busy==='auth'?'…':connected?z('Authorize again','重新授权'):z('Authorize in browser','在浏览器中授权'),authorize,undefined,{dim:!s.configured||!!busy}),
   connected?act(busy==='check'?'…':z('Check again','重新检测'),recheck,undefined,{dim:!!busy}):null],note:err||info||undefined},
  {title:z('Permissions','权限'),rows:[tog(z('Read mail when I ask in chat','在对话中按我的要求查信'),!!s.read,toggleRead,{dim:!connected||!!busy})]},
  ...(exists?[{rows:[act(busy==='off'?'…':confirm?z('Click again to disconnect','再次点击以断开'):z('Disconnect','断开连接'),disconnect,'danger',{dim:!!busy&&busy!=='off'})]}]:[])
 ]}/>;
}
