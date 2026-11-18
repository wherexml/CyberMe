import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {Page,useRows} from './Settings';
import {api,host} from './store';

export const APPLE_IDS:Record<string,'calendar'|'reminders'>={'apple-calendar-local':'calendar','apple-reminders-local':'reminders'};
export const appleTitle=(kind:'calendar'|'reminders',zh:boolean)=>kind==='calendar'?(zh?'Apple 日历':'Apple Calendar'):(zh?'Apple 提醒事项':'Apple Reminders');

// The OS prompt is only ever requested from this click, inside the installed app.
export function AppleConnectionPage({ctx,kind}:{ctx:Ctx;kind:'calendar'|'reminders'}){
 const {z,act}=useRows(ctx);
 const [s,setS]=useState<any>(null),[err,setErr]=useState(''),[busy,setBusy]=useState(''),[confirm,setConfirm]=useState(false);
 const lock=useRef(false),seq=useRef(0),alive=useRef(true),timer=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current)}},[]);
 const load=useCallback(async()=>{const id=++seq.current;try{const v=await api<any>('GET','/api/connections/apple/status');if(alive.current&&id===seq.current)setS(v)}catch(e:any){if(alive.current&&id===seq.current)setErr(e.message)}},[]);
 useEffect(()=>{void load()},[load]);
 async function run(name:string,fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(name);setErr('');try{await fn()}catch(e:any){if(alive.current)setErr(e.message)}finally{lock.current=false;if(alive.current)setBusy('')}}
 const sync=async()=>{await load();try{await ctx.refresh()}catch{if(alive.current)setErr(z('Saved on the server. Reload to confirm.','服务端已更新，请重新加载确认。'))}};
 const title=appleTitle(kind,ctx.zh);const row=s?.[kind];const native=!!host()&&s?.supported===true;
 if(!s)return <Page title={title} sections={[{rows:[{label:err||'…'}]}]}/>;
 if(!native)return <Page title={title} sections={[{rows:[{label:z('Status','状态'),value:z('Installed app only','仅限已安装应用'),valueStyle:{fontSize:14,color:'var(--text3)',whiteSpace:'nowrap'}}],note:err||undefined}]}/>;
 const connected=row.read===true,blocked=row.os==='denied'||row.os==='restricted';
 const pane=kind==='calendar'?'Privacy_Calendars':'Privacy_Reminders';
 const authorize=()=>void run('auth',async()=>{const r=await host()!.call('AppleAccess.Authorize',kind);if(r?.status!=='full'){await load();throw new Error(z('macOS did not grant full access.','macOS 未授予完整读取权限。'))}await api('POST','/api/connections/apple/'+kind+'/authorize',{});await sync()});
 const openSettings=()=>void run('settings',async()=>{await host()!.call('DesktopFiles.OpenExternal','x-apple.systempreferences:com.apple.preference.security?'+pane)});
 const disconnect=()=>{if(!confirm){setConfirm(true);timer.current=window.setTimeout(()=>setConfirm(false),3000);return}clearTimeout(timer.current);setConfirm(false);void run('off',async()=>{await api('POST','/api/connections/'+row.connectionId+'/disconnect',{});await sync();if(alive.current)ctx.goSet('connections')})};
 const [label,color]=connected?[z('Connected','已连接'),'var(--okText)']:blocked?[z('Blocked in System Settings','系统设置中已关闭'),'var(--warnText)']:row.os==='write_only'?[z('Write-only access','仅写入权限'),'var(--warnText)']:row.status==='reauth'?[z('Reconnect needed','需要重新连接'),'var(--warnText)']:[z('Not connected','未连接'),'var(--text3)'];
 return <Page title={title} sections={[
  {rows:[{label:z('Status','状态'),value:label,valueStyle:{fontSize:14,color,whiteSpace:'nowrap'}},
   !connected&&!blocked?act(busy==='auth'?'…':z('Authorize reading','授权读取'),authorize,undefined,{dim:!!busy}):null,
   blocked?act(z('Open System Settings','打开系统设置'),openSettings,undefined,{dim:!!busy}):null],note:err||undefined},
  ...(row.updatedAt&&row.status!=='disconnected'?[{rows:[act(busy==='off'?'…':confirm?z('Click again to disconnect','再次点击以断开'):z('Disconnect','断开连接'),disconnect,'danger',{dim:!!busy&&busy!=='off'})],note:z('Stops CyberMe from reading. The macOS permission stays until you change it in System Settings.','CyberMe 将停止读取；macOS 权限需在系统设置中更改。')}]:[])
 ]}/>;
}
