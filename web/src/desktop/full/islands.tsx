import React,{useEffect,useState} from 'react';
import {createRoot,Root} from 'react-dom/client';
import type {Bootstrap,UIContext} from '../../../../shared/types';
import {needsInboxAttention} from '../../../../shared/inbox-surfacing';
import {LanguageContext} from '../../domain/i18n';
import Identity from './Identity';
import WechatReader from './WechatReader';
import Settings from '../../pages/Settings';
import {InboxMessages} from '../../pages/InboxMessages';
import Models from '../Models';
import Activity from '../../pages/Activity';
import Sources from '../../pages/Sources';
import Tasks from '../../pages/Tasks';
import {loadLocal} from '../runtime';
import './islands.css';
const w=window as any;await loadLocal();
const roots=new Map<HTMLElement,{root:Root;render:(options:any)=>void}>();
function Island({options}:{options:any}){
 const [data,setData]=useState<Bootstrap>(options.data),[route,setRoute]=useState(options.route||'/settings/'+options.section),[notice,setNotice]=useState('');
 useEffect(()=>{setData({...options.data})},[options]);
 async function refresh(){const next=await w.OpsTwinsDesktop.bootstrap();Object.assign(options.data,next);setData({...next});window.dispatchEvent(new Event('desktop-data-updated'))}
 const ctx:UIContext={state:data,refresh,applySettings:settings=>{options.data.settings=settings;setData(d=>({...d,settings}))},navigate:path=>{if(path.startsWith('/settings/')&&path.split('/')[2]===options.section){options.onRoute?.(path);setRoute(path);}else window.dispatchEvent(new CustomEvent('desktop-navigate',{detail:path}))},notify:(message)=>setNotice(message),openTwin:()=>window.dispatchEvent(new CustomEvent('desktop-navigate',{detail:'/chat'}))};
 return <LanguageContext.Provider value={data.settings.identity.language||'zh-CN'}><div className="desktop-island">{notice&&<div role="status" className="desktop-notice">{notice}<button onClick={()=>setNotice('')}>关闭</button></div>}{route==='/settings/connections/wechat-sync-local'?<WechatReader ctx={ctx}/>:options.section==='identity'?<Identity ctx={ctx}/>:options.section==='models'?<Models active embedded/>:options.section==='messages'?<InboxMessages item={options.item} full/>:options.section==='activity'?<Activity ctx={ctx}/>:options.section==='sources'?<Sources ctx={ctx}/>:options.section==='task-manager'?<Tasks ctx={ctx}/>:<Settings ctx={ctx} section={route.split('/')[2]} route={route}/>}</div></LanguageContext.Provider>
}
function mount(root:HTMLElement,options:any){let entry=roots.get(root);if(!entry){const reactRoot=createRoot(root);entry={root:reactRoot,render:props=>reactRoot.render(<Island options={props}/>)};roots.set(root,entry)}entry.render(options)}
w.OpsTwinsBusinessUI={needsInboxAttention,mount,unmount:(root:HTMLElement)=>{roots.get(root)?.root.unmount();roots.delete(root)}};
