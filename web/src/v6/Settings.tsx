import React,{useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {I} from './icons';
import {Hv} from './ui';
import {BrandLogo} from './visuals';
import {api,enc,setUI,loadDoc,saveDoc} from './store';
import {isNative,desktopNotifications} from './native';
import {useUpdate,updateAction,updateTitle,showUpdate} from './updates';
import {relTime} from './model';
import ModelSettingsPage from './ModelSettings';
import {AddConnectionPage,GmailConnectionPage} from './ConnectionFlows';
import {APPLE_IDS,AppleConnectionPage} from './AppleConnection';

// V6 settings rows. Every reference row is kept; only rows with a real backend or a real local
// preference are interactive. Unsupported rows stay visible, dimmed, with a tooltip.
type Row={key?:string;tip?:string;pro?:string;isProfile?:boolean;profileLetter?:string;icon?:string;tile?:string;brand?:string;logoIcon?:string;label:React.ReactNode;sub?:React.ReactNode;value?:React.ReactNode;valueStyle?:React.CSSProperties;labelStyle?:React.CSSProperties;
 dot?:boolean;swRo?:boolean;seg?:{opts:[string,string][];cur:string;on:(k:string)=>void};btn?:{label:string;on:()=>void};sw?:{on:boolean;fn:()=>void};check?:boolean;caret?:boolean;onRow?:()=>void;dim?:boolean;meter?:number;input?:{value:string;ph?:string;on:(v:string)=>void;blur?:()=>void;area?:boolean;type?:string}};
type Sec={title?:string;rows:(Row|null|false)[];note?:string};
const TILE:Record<string,string>={'ph-gear-six':'#8e8e93','ph-bell':'#ff3b30','ph-cpu':'#af52de','ph-plugs':'#34c759','ph-puzzle-piece':'#0a84ff','ph-lock-simple':'#0a84ff','ph-user-circle':'#8e8e93','ph-magnifying-glass':'#8e8e93','ph-chat-circle':'#30b0c7','ph-tray':'#ff9f0a'};
const tw=(s:any)=>s as React.CSSProperties;

function RowView({r,i}:{r:Row;i:number}){
 const clickable=!!r.onRow&&!r.dim;
 const segBtn=(on:boolean):React.CSSProperties=>({height:26,padding:'0 10px',border:'none',borderRadius:'var(--r-innerBtn)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',background:on?'var(--segOn)':'transparent',color:on?'var(--text)':'var(--text2)',boxShadow:on?'var(--segShadow)':'none',transition:'background 250ms ease-out'});
 const key=(e:React.KeyboardEvent)=>{if(e.target!==e.currentTarget||(e.key!=='Enter'&&e.key!==' '))return;e.preventDefault();r.onRow!()};
 // Navigable rows keep the reference look but are real buttons for keyboard and assistive technology.
 return <Hv as="div" title={r.tip} onClick={clickable?r.onRow:undefined} role={r.onRow?'button':undefined} tabIndex={clickable?0:r.onRow?-1:undefined} aria-disabled={r.onRow&&r.dim?true:undefined} onKeyDown={clickable?key:undefined} className={r.onRow?'cm-row':undefined} style={{display:'flex',alignItems:'center',flexWrap:r.seg?'wrap':'nowrap',gap:12,minHeight:44,padding:'8px 14px',margin:'0 -14px',boxSizing:'border-box',borderTop:i?'0.5px solid var(--line)':'none',cursor:clickable?'pointer':'default',opacity:r.dim?.45:1,transition:'background 250ms ease-out'}} hover={clickable?{background:'var(--hover)'}:undefined}>
  {r.tile?<span style={{width:28,height:28,flex:'none',borderRadius:7,background:'linear-gradient(180deg, color-mix(in oklch, '+(TILE[r.tile]||'#8e8e93')+' 82%, white), '+(TILE[r.tile]||'#8e8e93')+')',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,boxShadow:'inset 0 0 0 0.5px rgba(0,0,0,.08), 0 1px 1.5px rgba(0,0,0,.12)'}}><I n={'ph-fill '+r.tile}/></span>:null}
  {r.icon?<span style={{width:28,height:28,flex:'none',borderRadius:'var(--r-innerBtn)',background:'var(--hover)',color:'var(--text2)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n={r.icon} style={{fontSize:16}}/></span>:null}
  {r.brand!==undefined||r.logoIcon?<span style={{width:28,height:28,flex:'none',borderRadius:7,background:'#fff',boxShadow:'0 0 0 0.5px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.06)',display:'flex',alignItems:'center',justifyContent:'center'}}><BrandLogo brand={r.brand} icon={r.logoIcon} size={18}/></span>:null}
  {r.isProfile?<span style={{width:40,height:40,flex:'none',borderRadius:'50%',background:'var(--accent)',color:'var(--onAccent)',fontSize:16,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'}}>{r.profileLetter}</span>:null}
  <div style={{flex:1,minWidth:0,overflowWrap:'anywhere',display:'flex',flexDirection:'column',gap:2}}>
   <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={r.labelStyle||{fontSize:14,color:'var(--text)'}}>{r.label}</span>{r.pro?<span style={{position:'relative',display:'inline-flex',alignItems:'center',gap:4,height:20,padding:'0 8px 0 6px',borderRadius:10,background:'linear-gradient(135deg,#ff9f0a 0%,#ff375f 45%,#af52de 75%,#5e5ce6 100%)',backgroundSize:'200% 200%',color:'#fff',fontSize:11,fontWeight:700,letterSpacing:'0.04em',boxShadow:'0 2px 8px rgba(175,82,222,.35), inset 0 0.5px 0 rgba(255,255,255,.5)',animation:'cmShine 6s ease-in-out infinite'}}><I n="ph-fill sparkle" style={{fontSize:11}}/>{r.pro}</span>:null}</div>
   {r.sub?<span style={tw({fontSize:12,color:'var(--text3)',textWrap:'pretty'})}>{r.sub}</span>:null}
   {r.meter!==undefined?<span style={{display:'block',height:4,marginTop:6,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:r.meter+'%',background:'var(--accent)',borderRadius:2}}/></span>:null}
   {r.input&&!r.input.area?<input type={r.input.type||'text'} value={r.input.value} onChange={e=>r.input!.on(e.target.value)} onBlur={r.input.blur} placeholder={r.input.ph} style={{height:32,marginTop:4,width:'100%',boxSizing:'border-box',padding:'6px 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--convBg)',boxShadow:'inset 0 0 0 0.5px var(--lineStrong)',color:'var(--text)',font:'inherit',fontSize:14,outline:'none'}}/>:null}
   {r.input?.area?<textarea value={r.input.value} onChange={e=>r.input!.on(e.target.value)} onBlur={r.input.blur} placeholder={r.input.ph} rows={4} style={{resize:'vertical',lineHeight:1.5,marginTop:4,width:'100%',boxSizing:'border-box',padding:'6px 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--convBg)',boxShadow:'inset 0 0 0 0.5px var(--lineStrong)',color:'var(--text)',font:'inherit',fontSize:14,outline:'none'}}/>:null}
  </div>
  {r.dot?<span style={{width:6,height:6,borderRadius:'50%',background:'var(--warnDot)',flex:'none'}}/>:null}
  {r.value!==undefined&&r.value!==''?<span style={r.valueStyle||{fontSize:14,color:'var(--text2)',whiteSpace:'nowrap'}}>{r.value}</span>:null}
  {r.seg?<div style={{display:'flex',gap:2,padding:2,borderRadius:'var(--r-btn)',background:'var(--segBg)'}}>{r.seg.opts.map(([k,l])=><button key={k} type="button" disabled={r.dim} onClick={e=>{e.stopPropagation();r.seg!.on(k)}} style={r.dim?{...segBtn(r.seg!.cur===k),cursor:'default'}:segBtn(r.seg!.cur===k)}>{l}</button>)}</div>:null}
  {r.btn?<Hv disabled={r.dim} onClick={(e:any)=>{e.stopPropagation();r.btn!.on()}} style={{height:26,padding:'0 10px',border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:12,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap'}} hover={{background:'var(--accentHover)'}}>{r.btn.label}</Hv>:null}
  {r.sw?<button type="button" role="switch" aria-checked={r.sw.on} disabled={r.dim||r.swRo} onClick={e=>{e.stopPropagation();r.sw!.fn()}} style={{width:34,height:20,borderRadius:10,border:'none',padding:0,position:'relative',flex:'none',cursor:r.dim||r.swRo?'default':'pointer',background:r.sw.on?'var(--accent)':'var(--selected)',transition:'background 250ms ease-out'}}><span style={{position:'absolute',top:2,left:r.sw.on?16:2,width:16,height:16,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 2px rgba(0,0,0,.25)',transition:'left 250ms ease-out'}}/></button>:null}
  {r.check?<I n="check" style={{fontSize:16,color:'var(--accent)'}}/>:null}
  {r.caret?<I n="caret-right" style={{fontSize:14,color:'var(--text3)'}}/>:null}
 </Hv>;
}
export function Page({title,sub,sections}:{title?:string;sub?:string;sections:Sec[]}){
 return <div style={{display:'flex',flexDirection:'column',gap:20,animation:'cmIn 250ms ease-out both'}}>
  {title?<div style={{display:'flex',flexDirection:'column',gap:4,padding:'4px 4px 0'}}><div style={{fontSize:20,fontWeight:600,letterSpacing:'-0.01em'}}>{title}</div>{sub?<div style={tw({color:'var(--text2)',textWrap:'pretty'})}>{sub}</div>:null}</div>:null}
  {sections.map((s,si)=>{const rows=s.rows.filter(Boolean) as Row[];return <div key={si} style={{display:'flex',flexDirection:'column',gap:6}}>
   {s.title?<div style={{fontSize:12,color:'var(--text3)',padding:'0 4px'}}>{s.title}</div>:null}
   <div style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:'var(--r-card)',padding:'0 14px',overflow:'hidden'}}>{rows.map((r,i)=><RowView key={r.key||i} r={r} i={i}/>)}</div>
   {s.note?<div style={tw({fontSize:12,color:'var(--text3)',padding:'0 4px',textWrap:'pretty'})}>{s.note}</div>:null}
  </div>})}
 </div>;
}

// Explicitly synthetic acceptance values: `settings.v6.fixture` with `synthetic:true`, seeded through
// PATCH /api/settings on an isolated instance only. The product never writes this key.
type Fixture={synthetic:true;account?:{email?:string;plan?:string;usagePct?:number;renews?:string};usage?:{pct?:number;resets?:string};
 cfg?:Record<string,string|number|boolean>;skills?:{id:string;name:string;sub?:string;on?:boolean;auto?:boolean;ask?:boolean;uses?:string[];how?:string}[]};
export function fixtureOf(S:any):Fixture|null{const f=S?.v6?.fixture;return f&&typeof f==='object'&&!Array.isArray(f)&&f.synthetic===true?f:null}
const NOOP=()=>{};
export function useRows(ctx:Ctx){
 const {zh}=ctx;const z=(en:string,c:string)=>zh?c:en;const fx=fixtureOf(ctx.ws.settings);
 const na=z('Not available in this version','当前版本暂不支持');
 // A reference row without a backend: shown with fixture values when synthetic, otherwise dimmed with a tooltip.
 const off=(r:Row):Row=>fx?r:{...r,dim:true,tip:na};
 const fxv=<T,>(k:string,d:T):T=>fx?.cfg&&Object.hasOwn(fx.cfg,k)?fx.cfg[k] as T:d;
 const nav=(label:string,fn:()=>void,tile?:string,extra:Partial<Row>={}):Row=>({label,onRow:fn,caret:true,tile,...extra});
 const act=(label:string,fn:()=>void,tone?:'danger',extra:Partial<Row>={}):Row=>({label,onRow:fn,labelStyle:{fontSize:14,fontWeight:500,color:tone==='danger'?'var(--errText)':'var(--accentText)'},...extra});
 const tog=(label:string,on:boolean,fn:()=>void=NOOP,extra:Partial<Row>={}):Row=>({label,sw:{on,fn},...extra});
 const segR=(label:string,opts:[string,string][],cur:string,on:(k:string)=>void=NOOP,extra:Partial<Row>={}):Row=>({label,seg:{opts,cur,on},...extra});
 const field=(label:string,value:string,ph:string,on:(v:string)=>void,extra:Partial<NonNullable<Row['input']>>={}):Row=>({label,labelStyle:{fontSize:12,color:'var(--text3)'},input:{value,ph,on,...extra}});
 return {z,fx,na,off,fxv,nav,act,tog,segR,field};
}

/** Localized, truthful connection status with its semantic colour (shared by Connections and Skills). */
export function connStatusOf(c:any,zh:boolean):[string,string]{const z=(en:string,cn:string)=>zh?cn:en;const s=String(c?.status||'');
 return ['connected','active','ok','ready'].includes(s)?[z('Connected','已连接'),'var(--okText)']:['expired','reauth','setup_required','error','failed','unavailable'].includes(s)?[c.message||z('Needs attention','需要处理'),'var(--warnText)']:['connecting','syncing'].includes(s)?[z('Connecting…','连接中…'),'var(--text3)']:[z('Not connected','未连接'),'var(--text3)']}
export default function Settings({ctx,page,sub}:{ctx:Ctx;page:string|null;sub:any}){
 const {ws,ui,lang,goSet,XL,T}=ctx;const S=ws.settings as any;
 const {z,fx,na,off,fxv,nav,act,tog,segR}=useRows(ctx);
 const [busy,setBusy]=useState<string>('');
 const [desktopNotice,setDesktopNotice]=useState<{enabled:boolean;version:string}|null>();
 const [noticeRead,retryNotice]=useState(0),noticePending=useRef(false);
 useEffect(()=>{let active=true;if(page==='insights'&&isNative()){setDesktopNotice(undefined);desktopNotifications.status().then(s=>{if(active)setDesktopNotice(s)}).catch(()=>{if(active)setDesktopNotice(null)})}return()=>{active=false}},[page,noticeRead]);
 async function changeNotice(test=false){
  if(busy||noticePending.current||(!test&&!desktopNotice))return;
  noticePending.current=true;setBusy('desktop-notice');
  try{
   if(test){await desktopNotifications.test();ctx.notify(z('Submitted to macOS','已提交给 macOS'))}
   else if(desktopNotice)setDesktopNotice(await desktopNotifications.configure(!desktopNotice.enabled,desktopNotice.version));
  }catch(e:any){ctx.notify(e.message||String(e),'error');if(!test)retryNotice(n=>n+1)}
  finally{noticePending.current=false;setBusy('')}
 }
 async function patchSettings(patch:any,group:'identity'|'autonomy'){setBusy(group);try{await api('PATCH','/api/settings',{...patch,baseSettings:{[group]:S[group]}});await ctx.refresh()}catch(e:any){ctx.notify(e.status===409?T.conflict:e.message,'error');void ctx.refresh()}finally{setBusy('')}}
 const autonomy=S.autonomy||{};const perms=autonomy.permissions||{};
 // Keep historical records in workspace state; omit replaced entries from current connection lists.
 const visibleConnections=ws.connections.filter(c=>!c.supersededBy);
 const connStatus=(c:any)=>connStatusOf(c,ctx.zh);
 const profile=(extra:Partial<Row>={}):Row=>({isProfile:true,profileLetter:(S.identity?.name||'C').trim().slice(0,1).toUpperCase(),label:S.identity?.name||z('Your profile','你的资料'),sub:fx?.account?.email||S.identity?.role||'',pro:fx?.account?.plan?.toUpperCase(),labelStyle:{fontSize:16,fontWeight:600,color:'var(--text)'},...extra});

 if(!page){const warn=visibleConnections.some(c=>connStatus(c)[1]==='var(--warnText)');
  return <Page sections={[
   {rows:[profile({onRow:()=>goSet('account'),caret:true})]},
   {rows:[nav(z('General','通用'),()=>goSet('general'),'ph-gear-six'),nav(z('Insights & notifications','洞察与通知'),()=>goSet('insights'),'ph-bell')]},
   {rows:[nav(z('Model','模型'),()=>goSet('model'),'ph-cpu'),nav(z('Connections','应用连接'),()=>goSet('connections'),'ph-plugs',{dot:warn}),nav(z('Skills','技能'),()=>goSet('skills'),'ph-puzzle-piece')]},
   {rows:[nav(z('Privacy & data','隐私与数据'),()=>goSet('privacy'),'ph-lock-simple')]},
   {title:T.moreH,rows:[nav(z('Search','搜索'),()=>goSet('search'),'ph-magnifying-glass'),nav(z('Conversations','对话'),()=>goSet('conversations'),'ph-chat-circle')]}
  ]}/>;}

 if(page==='general')return <Page title={z('General','通用')} sections={[
  {title:z('Language','语言'),rows:[{label:'English',check:lang==='en',onRow:()=>lang!=='en'&&void ctx.setLanguage('en')},{label:'中文（简体）',check:lang==='zh',onRow:()=>lang!=='zh'&&void ctx.setLanguage('zh')},{label:'日本語',sub:z('Coming soon','即将支持'),dim:true},{label:'Español',sub:z('Coming soon','即将支持'),dim:true}]},
  {title:z('Appearance','外观'),rows:[segR(z('Theme','主题'),[['quiet',z('Light','浅色')],['night',z('Dark','深色')]],ui.theme,k=>setUI({theme:k as any}))]},
  {title:z('App','应用'),rows:[off(tog(z('Open at login','登录时打开'),!!fxv('launch',false))),off(tog(z('Show in menu bar','在菜单栏显示'),!!fxv('menubar',false))),off({label:z('Quick open','快速唤起'),value:String(fxv('quickOpen','—'))})]},
  {title:z('Conversation','对话'),rows:[tog(z('Press Enter to send','按 Enter 发送'),ui.cfg.enterSend,()=>setUI(s=>({cfg:{...s.cfg,enterSend:!s.cfg.enterSend}})),{sub:ui.cfg.enterSend?z('Shift Enter adds a new line','Shift Enter 换行'):z('⌘ Enter sends','⌘ Enter 发送')}),tog(z('Show task progress in conversation','在对话中显示任务进度'),ui.cfg.progress,()=>setUI(s=>({cfg:{...s.cfg,progress:!s.cfg.progress}})))]}
 ]}/>;

 if(page==='insights'){const live=visibleConnections.filter(c=>connStatus(c)[1]==='var(--okText)');return <Page title={z('Insights & notifications','洞察与通知')} sections={[
  {title:z('Notifications','通知'),rows:[
   isNative()&&(desktopNotice?tog(z('macOS insight notifications','macOS 洞察通知'),desktopNotice.enabled,()=>void changeNotice(),{dim:!!busy}):{label:z('macOS insight notifications','macOS 洞察通知'),...(desktopNotice===null?{btn:{label:z('Retry','重试'),on:()=>retryNotice(n=>n+1)}}:{value:z('Loading…','读取中…')})}),
   isNative()&&act(z('Test notification','测试通知'),()=>void changeNotice(true),undefined,{dim:!!busy}),
   tog(z(`Quiet hours, ${autonomy.quietFrom||'22:00'} to ${autonomy.quietUntil||'08:00'}`,`免打扰 ${autonomy.quietFrom||'22:00'} 至 ${autonomy.quietUntil||'08:00'}`),!!autonomy.quietEnabled,()=>void patchSettings({autonomy:{quietEnabled:!autonomy.quietEnabled}},'autonomy'),{dim:busy==='autonomy'||busy==='desktop-notice'})]},
  {title:z('Sources','来源'),rows:live.length?live.map(c=>({key:c.id,label:c.name,value:connStatus(c)[0],valueStyle:{fontSize:12,whiteSpace:'nowrap',color:'var(--okText)'},onRow:()=>goSet('connections',{type:'conn',id:c.id}),caret:true})):[nav(z('Connect a source','连接来源'),()=>goSet('connections'))]},
 ]}/>;}

 if(page==='model')return <ModelSettingsPage ctx={ctx} sub={sub}/>;
 if(page==='skills')return <SkillsPage ctx={ctx} sub={sub}/>;
 if(page==='search')return <SearchPage ctx={ctx}/>;
 if(page==='conversations')return <ConversationsPage ctx={ctx}/>;

 if(page==='connections'&&sub?.type==='conn'&&APPLE_IDS[sub.id])return <AppleConnectionPage ctx={ctx} kind={APPLE_IDS[sub.id]}/>;
 if(page==='connections'&&sub?.type==='conn'&&sub.id==='gmail-oauth')return <GmailConnectionPage ctx={ctx}/>;
 if(page==='connections'&&sub?.type==='conn'){const c=ws.connections.find(x=>x.id===sub.id);if(!c)return <Page title={z('Connections','应用连接')} sections={[{rows:[{label:z('This connection no longer exists.','此连接已不存在。')}]}]}/>;
  return <ConnectionPage ctx={ctx} c={c} status={connStatus(c)}/>;}
 if(page==='connections'&&sub?.type==='add')return <AddConnectionPage ctx={ctx}/>;
 if(page==='connections')return <Page title={z('Connections','应用连接')} sections={[
  {rows:visibleConnections.length?visibleConnections.map(c=>{const [full,col]=connStatus(c);const stt=col==='var(--warnText)'?z('Needs attention','需要处理'):full;return {key:c.id,label:c.name,brand:String(c.provider||c.type||c.name||''),logoIcon:'ph-plugs',value:stt,valueStyle:{fontSize:12,whiteSpace:'nowrap',color:col,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'},onRow:()=>goSet('connections',{type:'conn',id:c.id}),caret:true} as Row}):[{label:z('No apps connected','尚未连接应用')}]},
  {rows:[act(XL.addConn,()=>goSet('connections',{type:'add'}))]}
 ]}/>;

 if(page==='privacy'&&sub?.type==='autonomy'){const P=(k:string,label:string)=>segR(label,[['read',z('View only','仅查看')],['confirm',z('Ask first','先问我')],['auto',z('Automatic','自动')]],perms[k]||'confirm',v=>void patchSettings({autonomy:{permissions:{...perms,[k]:v}}},'autonomy'),{key:k,dim:busy==='autonomy'});
  return <Page title={z('Permissions & sending','权限与发送')} sections={[
   {rows:[P('reply',z('Replies','回复')),P('tasks',z('Tasks','任务')),P('files',z('Files','文件')),P('calendar',z('Calendar','日历')),P('connections',z('Connections','连接')),P('deep',z('Deep thinking','深度思考'))]},
   {rows:[tog(z('Hold every outgoing message for review','所有外发消息先等我确认'),!!autonomy.holdSending,()=>void patchSettings({autonomy:{holdSending:!autonomy.holdSending}},'autonomy'),{dim:busy==='autonomy'}),tog(z('Show what CyberMe did and why','展示 CyberMe 做了什么及原因'),!!autonomy.transparency,()=>void patchSettings({autonomy:{transparency:!autonomy.transparency}},'autonomy'),{dim:busy==='autonomy'})]},
  ]}/>;}
 if(page==='privacy')return <PrivacyPage ctx={ctx}/>;

 if(page==='account'&&sub?.type==='profile')return <ProfilePage ctx={ctx} patchSettings={patchSettings}/>;
 return <AccountPage ctx={ctx} profile={profile}/>;
}

function PrivacyPage({ctx}:{ctx:Ctx}){
 const {z,off,fxv,nav,act,tog,segR}=useRows(ctx);
 const [del,setDel]=useState<''|'confirm'|'busy'>('');const t=useRef(0);useEffect(()=>()=>clearTimeout(t.current),[]);
 // The memory document save snapshots the previous memories first, so this stays restorable from history.
 async function deleteMemory(){if(del==='busy')return;if(!del){setDel('confirm');t.current=window.setTimeout(()=>setDel(d=>d==='confirm'?'':d),3000);return}
  clearTimeout(t.current);setDel('busy');try{const d=await loadDoc('memory');if(d.content)await saveDoc('memory','',d.version);await ctx.refresh()}catch(e:any){ctx.notify(e.status===409?ctx.T.conflict:e.message,'error')}finally{setDel('')}}
 return <Page title={z('Privacy & data','隐私与数据')} sections={[
  {title:z('Memory','记忆'),rows:[off(tog(z('Use memory','使用记忆'),!!fxv('memoryOn',true))),off(tog(z('Ask before remembering','记住前先询问'),!!fxv('askRemember',false))),nav(z('Manage memory','管理记忆'),()=>ctx.openTab('memory'))]},
  {title:z('History','历史记录'),rows:[off(segR(z('Keep conversation','保留对话'),[['month',z('30 days','30 天')],['year',z('1 year','1 年')],['forever',z('Forever','永久')]],String(fxv('retention','forever'))))]},
  {title:z('Processing','处理'),rows:[off(tog(z('Process sensitive data on this Mac','敏感数据在本机处理'),!!fxv('onDevice',false)))]},
  {rows:[nav(z('Permissions & sending','权限与发送'),()=>ctx.goSet('privacy',{type:'autonomy'}))]},
  {rows:[act(z('Export my data','导出我的数据'),()=>{location.href='/api/activity/export'},undefined,{tip:z('Exports activity records','导出活动记录')}),act(del==='busy'?z('Deleting…','正在删除…'):del?z('Click again to delete all memory','再次点击以删除全部记忆'):z('Delete all memory','删除全部记忆'),()=>void deleteMemory(),'danger')]}
 ]}/>;
}

function AccountPage({ctx,profile}:{ctx:Ctx;profile:(extra?:Partial<Row>)=>Row}){
 const {z,fx,off,act}=useRows(ctx);
 const {value:up,busy:upBusy}=useUpdate();
 const state=up.status,version=up.current?.version||'';
 const upLabel=updateTitle(up,ctx.zh);
 const upAct=()=>{if(!isNative()||upBusy)return;if(up.available||up.ready)showUpdate();else void updateAction('check')};
 const a=fx?.account;const pct=typeof a?.usagePct==='number'&&Number.isFinite(a.usagePct)?Math.max(0,Math.min(100,a.usagePct)):undefined;
 return <Page title={z('Account','账户')} sections={[
  {rows:[profile({onRow:()=>ctx.goSet('account',{type:'profile'}),caret:true})]},
  {title:z('Plan','套餐'),rows:[off({label:z('Plan','套餐'),value:a?.plan||'—'}),off({label:z('Usage this month','本月用量'),value:pct===undefined?'—':pct+'%',meter:pct??0}),off({label:z('Renews','续费日期'),value:a?.renews||'—'})]},
  {title:z('App','应用'),rows:[{label:z('Version','版本'),value:version||'—'},act(upLabel,upAct,undefined,{dim:!isNative(),tip:isNative()?undefined:z('Available in the desktop app','在桌面应用中可用'),sub:state==='error'?(ctx.zh?'请重新检查或重试下载。':'Check again or retry the download.'):''})]},
  {rows:[off(act(z('Sign out','退出登录'),NOOP,'danger'))]}
 ]}/>;
}

function ProfilePage({ctx,patchSettings}:{ctx:Ctx;patchSettings:(p:any,g:'identity'|'autonomy')=>Promise<void>}){
 const {z,field}=useRows(ctx);const id=(ctx.ws.settings as any).identity||{};
 const [name,setName]=useState(id.name||''),[role,setRole]=useState(id.role||'');
 useEffect(()=>{setName(id.name||'');setRole(id.role||'')},[id.name,id.role]);
 return <Page title={z('Profile','资料')} sections={[
  {rows:[field(z('Name','名字'),name,'',setName,{blur:()=>{if(name!==(id.name||''))void patchSettings({identity:{name}},'identity')}}),field(z('Role','职责'),role,'',setRole,{blur:()=>{if(role!==(id.role||''))void patchSettings({identity:{role}},'identity')}})]}
 ]}/>;
}

function ConnectionPage({ctx,c,status}:{ctx:Ctx;c:any;status:[string,string]}){
 const {zh}=ctx;const {z,off,nav,act,tog}=useRows(ctx);const [busy,setBusy]=useState(''),[confirm,setConfirm]=useState(false),[result,setResult]=useState('');
 const t=useRef(0);useEffect(()=>()=>clearTimeout(t.current),[]);
 const provider=String(c.provider||c.type||c.id||'').toLowerCase();const connected=status[1]==='var(--okText)';
 const syncPath=provider.includes('feishu')||provider.includes('lark')?['/api/feishu/sync',{scope:'all'}] as const:provider.includes('wechat')||provider.includes('weixin')?['/api/wechat/sync',{}] as const:null;
 // Sync starts the provider's real sync job; the row shows the job's reported state, never an assumed success.
 async function sync(){if(busy)return;if(!syncPath)return;setBusy('sync');setResult('');try{const r=await api('POST',syncPath[0],syncPath[1]);const st=r?.status??r?.state;setResult(typeof st==='string'?st:'');await ctx.refresh()}catch(e:any){setResult(e.message)}finally{setBusy('')}}
 async function disconnect(){if(busy)return;if(!confirm){setConfirm(true);t.current=window.setTimeout(()=>setConfirm(false),3000);return}clearTimeout(t.current);setBusy('off');try{await api('POST','/api/connections/'+enc(c.id)+'/disconnect',{});await ctx.refresh();ctx.goSet('connections')}catch(e:any){ctx.notify(e.message,'error')}finally{setBusy('')}}
 // Exact-ID retest of the existing local identities; a failed refresh asks for a reload, never another POST.
 const testable=c.id==='feishu-local'||c.id==='wechat-sync-local';
 async function retest(){if(busy||!testable)return;setBusy('test');setResult('');try{const r=await api('POST','/api/connections/'+enc(c.id)+'/test',{baseUpdatedAt:c.updatedAt});setResult(r?.ok?'':String(r?.message||''));try{await ctx.refresh()}catch{setResult(z('Saved on the server. Reload to confirm.','服务端已更新，请重新加载确认。'))}}catch(e:any){setResult(e.message)}finally{setBusy('')}}
 const perms:string[]=Array.isArray(c.permissions)?c.permissions:[];const hold=!!(ctx.ws.settings as any).autonomy?.holdSending;
 const setupTip=z('Read-only','只读');
 const ro=(label:string,on:boolean):Row=>tog(label,on,NOOP,{swRo:true,tip:setupTip});
 const last=c.lastSyncAt||c.syncedAt||c.config?.lastSyncAt;
 return <Page title={c.name} sections={[
  {rows:[{label:z('Status','状态'),value:status[0],valueStyle:{fontSize:14,color:status[1],whiteSpace:'nowrap',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'}},{label:z('Last sync','上次同步'),value:busy==='sync'?z('Syncing…','同步中…'):(relTime(last,zh)||'—')},
   connected?act(busy==='sync'?z('Syncing…','同步中…'):z('Sync now','立即同步'),()=>void sync(),undefined,{sub:result,dim:!syncPath}):testable?act(busy==='test'?z('Checking…','检测中…'):z('Reconnect','重新连接'),()=>void retest(),undefined,{sub:result,dim:!!busy}):off(act(z('Reconnect','重新连接'),NOOP)),connected&&testable?act(busy==='test'?z('Checking…','检测中…'):z('Check again','重新检测'),()=>void retest(),undefined,{dim:!!busy}):null]},
  {title:z('Permissions','权限'),rows:[ro(z('Read','读取'),perms.includes('read')),ro(z('Create drafts','创建草稿'),perms.includes('draft')),ro(z('Ask before sending or changing','发送或修改前先询问'),!perms.includes('send')||hold),off(tog(z('Use as an insight source','作为洞察来源'),perms.includes('insight')))]},
  {rows:[act(busy==='off'?'…':confirm?z('Click again to disconnect','再次点击以断开'):z('Disconnect','断开连接'),()=>void disconnect(),'danger')]}
 ]}/>;
}

// V6 Skills: the actual local skill catalog the Agent uses (GET /api/skills, read-only). There is no
// create/remove/enable/automatic/ask contract, so no such controls are shown. The capability registry
// stays a separate subpage; it is not the skill inventory.
type SkillRow={id:string;name:string;description:string;source:string;manualOnly:boolean};
const SKILL_SOURCE:Record<string,[string,string]>={app:['App data','应用数据'],agents:['~/.agents/skills','~/.agents/skills'],pi:['Pi','Pi'],codex:['Codex','Codex'],'codex-system':['Codex system','Codex 系统'],projects:['~/Projects/skills','~/Projects/skills'],bundled:['Built-in','内置'],configured:['Configured','已配置']};
function SkillsPage({ctx,sub}:{ctx:Ctx;sub:any}){
 const {z,nav,act,field}=useRows(ctx);
 const [query,setQuery]=useState('');
 const [tick,setTick]=useState(0);
 const [inv,setInv]=useState<{items:SkillRow[]}|null>(null),[err,setErr]=useState('');
 const [detail,setDetail]=useState<any>(null),[dErr,setDErr]=useState('');
 const [cap,setCap]=useState<any>(null),[capErr,setCapErr]=useState('');
 const detailId=sub?.type==='skill'?String(sub.id||''):'';
 // Every refresh clears the previous result first, so a failed refresh never shows stale rows or detail.
 useEffect(()=>{if(sub?.type==='registry'||detailId)return;let live=true;setInv(null);setErr('');api('GET','/api/skills').then(r=>{if(live)setInv(r)},e=>{if(live)setErr(e.message||String(e))});return()=>{live=false}},[sub?.type,detailId,tick]);
 useEffect(()=>{if(!detailId)return;let live=true;setDetail(null);setDErr('');api('GET','/api/skills/'+enc(detailId)).then(r=>{if(live)setDetail(r)},e=>{if(live)setDErr(e.message||String(e))});return()=>{live=false}},[detailId,tick]);
 useEffect(()=>{if(sub?.type!=='registry')return;let live=true;setCap(null);setCapErr('');api('GET','/api/ideas-console/capabilities').then(r=>{if(live)setCap(r)},e=>{if(live)setCapErr(e.message||String(e))});return()=>{live=false}},[sub?.type,tick]);
 const retry=act(z('Retry','重试'),()=>setTick(n=>n+1));
 const pending=(title:string,error:string)=><Page title={title} sections={[{rows:error?[{label:error,labelStyle:{fontSize:14,color:'var(--errText)'}},retry]:[{label:'…'}]}]}/>;
 const sourceLabel=(s:string)=>{const v=SKILL_SOURCE[s];return v?v[ctx.zh?1:0]:s};
 const small={fontSize:12,color:'var(--text3)',whiteSpace:'nowrap'} as React.CSSProperties;
 if(sub?.type==='registry'){if(!cap)return pending(z('Capability registry','能力登记'),capErr);
  const a=sub.id?cap.actions.find((x:any)=>x.name===sub.id):null;const yes=(v:boolean)=>v?z('Yes','是'):z('No','否');
  if(a)return <Page title={a.name} sub={a.description} sections={[
   {rows:[{label:z('Registered','已登记'),value:yes(a.registered)},{label:z('Model configured','模型已配置'),value:cap.model?.state==='configured'?z('Yes','是'):cap.model?.state==='invalid'?z('Invalid','无效'):z('No','否')},{label:z('Background worker','后台处理'),value:cap.worker?.enabled?z('Enabled','已启用'):z('Off','未启用')},{label:z('Availability','可用性'),value:a.availability==='not_checked'?z('Not checked','未检测'):a.availability},{label:z('Reaches outside this Mac','会访问外部'),value:yes(!!a.external)},{label:z('Effect','作用'),value:a.effect||'—'}]},
  ]}/>;
  return <Page title={z('Capability registry','能力登记')} sections={[{rows:cap.actions.map((x:any)=>({key:x.name,label:x.name,sub:x.description,value:x.external?z('External','外部'):z('Local','本机'),valueStyle:small,onRow:()=>ctx.goSet('skills',{type:'registry',id:x.name}),caret:true}))}]}/>;}
 if(detailId){
  if(!detail)return pending(z('Skill','技能'),dErr);
  return <Page title={detail.name} sub={detail.description} sections={[
   {rows:[{label:z('Source','来源'),value:sourceLabel(detail.source)},{label:z('Use','使用方式'),value:detail.manualOnly?z('Only when you name it','仅在你点名时'):z('Automatically when relevant','相关时自动使用')},{label:z('Location','位置'),sub:<span style={{fontFamily:'var(--mono, ui-monospace, monospace)',wordBreak:'break-all'}}>{detail.path}</span>},{label:z('Version','版本'),value:String(detail.hash||'').slice(0,12),valueStyle:small}]},
   ...(detail.shadowed?.length?[{title:z('Same name elsewhere (not used)','其他位置的同名技能（未使用）'),rows:detail.shadowed.map((x:any)=>({key:x.path,label:<span style={{fontFamily:'var(--mono, ui-monospace, monospace)',fontSize:12,wordBreak:'break-all'}}>{x.path}</span>,value:sourceLabel(x.source),valueStyle:small}))}]:[]),
   ...(detail.diagnostics?.length?[{title:z('Diagnostics','诊断'),rows:detail.diagnostics.map((d:any,i:number)=>({key:String(i),label:d.message,labelStyle:{fontSize:12,color:'var(--warnText)'}}))}]:[]),
  ]}/>;
 }
 if(!inv)return pending(z('Skills','技能'),err);
 // Client-side filter over the already loaded catalog (name, description, source); no request, no counts.
 const term=query.trim().toLowerCase();
 const shown=term?inv.items.filter(q=>[q.name,q.description,q.source,sourceLabel(q.source)].some(v=>String(v||'').toLowerCase().includes(term))):inv.items;
 return <Page title={z('Skills','技能')} sections={[
  ...(inv.items.length?[{rows:[field(z('Search','搜索'),query,z('Name, description or source','名称、描述或来源'),setQuery)]}]:[]),
  {rows:shown.length?shown.map(q=>({key:q.id,label:q.name,sub:q.description.length>140?q.description.slice(0,140)+'…':q.description,value:q.manualOnly?z('Manual','手动'):sourceLabel(q.source),valueStyle:small,onRow:()=>ctx.goSet('skills',{type:'skill',id:q.id}),caret:true} as Row)):[{label:inv.items.length?z('No matching skills','没有匹配的技能'):z('No local skills found','未找到本机技能')}]},
  {rows:[nav(z('Capability registry','能力登记'),()=>ctx.goSet('skills',{type:'registry'}))]}
 ]}/>;
}

function SearchPage({ctx}:{ctx:Ctx}){
 const {zh}=ctx;const z=(en:string,c:string)=>zh?c:en;const [q,setQ]=useState(''),[res,setRes]=useState<any>(null),[err,setErr]=useState('');const gen=useRef(0);
 useEffect(()=>{const term=q.trim();if(!term){setRes(null);setErr('');return}const g=++gen.current;const t=setTimeout(async()=>{try{const r=await api('GET','/api/workspace/search?q='+enc(term)+'&limit=30');if(g===gen.current){setRes(r);setErr('')}}catch(e:any){if(g===gen.current)setErr(e.message)}},250);return()=>clearTimeout(t)},[q]);
 const open=(it:any)=>{const id=it.targetId||it.id;if(it.kind==='tasks'||it.kind==='task')ctx.openDetail({type:'task',id});else if(it.kind==='inbox'||it.kind==='ideas'||it.kind==='idea')ctx.openDetail({type:'ins',id});else if(it.kind==='messages'||it.kind==='conversations'){ctx.jumpTo(m=>m.id===id)}else if(it.kind==='memories')ctx.openTab('memory')};
 return <Page title={z('Search','搜索')} sections={[
  {rows:[{label:z('Search everything','搜索全部'),labelStyle:{fontSize:12,color:'var(--text3)'},input:{value:q,on:setQ,ph:z('Messages, tasks, inbox, memory…','消息、任务、收件箱、记忆…')}}]},
  ...(err?[{rows:[{label:err}]}]:res?[{title:z(`${res.total} results`,`${res.total} 条结果`),rows:res.items.length?res.items.map((it:any)=>({key:it.id,label:it.title||it.kind,sub:it.snippet,value:relTime(it.time,zh),valueStyle:{fontSize:12,color:'var(--text3)',whiteSpace:'nowrap'},onRow:()=>open(it),caret:true})):[{label:z('No matches','没有匹配结果')}]}]:[])
 ]}/>;
}

function ConversationsPage({ctx}:{ctx:Ctx}){
 const {ws,zh}=ctx;const z=(en:string,c:string)=>zh?c:en;const [busy,setBusy]=useState(false);
 const list=[...ws.conversations].filter(c=>!c.archived).sort((a,b)=>String(b.lastMessageAt||b.updatedAt||'').localeCompare(String(a.lastMessageAt||a.updatedAt||'')));
 async function create(){setBusy(true);try{const row=await api('POST','/api/conversations/side',{id:'ui-side-'+crypto.randomUUID(),title:z('New conversation','新会话')});await ctx.refresh();ctx.setConversation(row.id)}catch(e:any){ctx.notify(e.message,'error')}finally{setBusy(false)}}
 const current=ctx.conversationId||ws.primaryConversationId;
 return <Page title={z('Conversations','对话')} sections={[
  {rows:list.map(c=>({key:c.id,label:c.title||z('Untitled','未命名'),sub:relTime(c.lastMessageAt||c.updatedAt,zh),check:c.id===current,onRow:()=>ctx.setConversation(c.id===ws.primaryConversationId?null:c.id)}))},
  {rows:[{label:busy?'…':z('New conversation','新建会话'),onRow:()=>busy||void create(),labelStyle:{fontSize:14,fontWeight:500,color:'var(--accentText)'}}]}
 ]}/>;
}
