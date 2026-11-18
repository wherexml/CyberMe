import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {I} from './icons';
import {Hv,pill,avColor,initials} from './ui';
import {Buddy,BUDDY} from './Buddy';
import {saveDoc,getUI,setUI,type Doc} from './store';
import {useMemoryData,memorySnapshot,refreshMemory,cacheMemoryDocument,forgetMemory,retryMemory} from './memory-data';
import {relTime} from './model';
import {memoryCategories,memoryCategory} from './memory-categories';
import {MemoryHome,MemoryPeople,MemoryCategoryDetail,memoryEntries,type MemoryView} from './MemoryLibrary';

// Memory is server-owned Markdown (soul + memory documents). Edits are version-checked and saved one
// at a time; a failed or conflicting edit stays open (and in the persisted UI buffer) across card, tab and
// reload until it is saved or deliberately discarded. It never overwrites the newer server copy silently.
const tw=(s:any)=>s as React.CSSProperties;
interface Sec{title:string;raw:string[];items:string[];paras:string[]}
type Edit={kind:'soul'|'memory';idx:number;text:string;base:string};
function parse(md:string){const lines=md.split('\n');const pre:string[]=[];const secs:Sec[]=[];let cur:Sec|null=null;
 for(const l of lines){const t=l.trim();if(/^## /.test(t)){cur={title:t.slice(3).replace(/\*\*/g,''),raw:[l],items:[],paras:[]};secs.push(cur);continue}
  if(cur)cur.raw.push(l);else pre.push(l);
  if(cur&&/^[-*] /.test(t))cur.items.push(t.slice(2).replace(/\*\*/g,''));else if(cur&&t&&!/^# /.test(t))cur.paras.push(t.replace(/\*\*/g,''));}
 return {pre,secs};}
const rawOf=(lines:string[])=>lines.join('\n').replace(/\n+$/,'');
function itemsOf(lines:string[]){const items:string[]=[],paras:string[]=[];for(const l of lines){const t=l.trim();if(!t||/^#{1,2} /.test(t))continue;if(/^[-*] /.test(t))items.push(t.slice(2).replace(/\*\*/g,''));else paras.push(t.replace(/\*\*/g,''))}return {items,paras};}

export default function Memory({ctx}:{ctx:Ctx}){
 const {XL,T,zh,buddy}=ctx;
 const data=useMemoryData(),auto=data.automatic.value||[];
 const [docs,setDocs]=useState<{soul?:Doc;memory?:Doc}>(()=>({soul:memorySnapshot().soul.value,memory:memorySnapshot().memory.value}));
 const buffered=getUI().memDraft;
 // `base` is the document version the edit started from; it is persisted so a remounted or restarted editor
 // can never save over a newer server copy (the server answers 409 and the conflict stays blocking).
 const [edit,setEdit]=useState<Edit|null>(buffered?{kind:buffered.kind,idx:buffered.idx,text:buffered.text,base:buffered.base}:null),[status,setStatus]=useState<''|'saving'|'conflict'|'error'>(buffered?.status||''),[hover,setHover]=useState<string|null>(null);
 useEffect(()=>{const st=status==='conflict'||status==='error'?status:'';setUI({memDraft:edit?{...edit,status:st}:null})},[edit,status]);
 const [retrying,setRetrying]=useState<string|null>(null);
 const [view,setView]=useState<MemoryView>(buffered?(buffered.kind==='soul'?'soul':`section:${buffered.idx}`):'home');
 const docsRef=useRef<{soul?:Doc;memory?:Doc}>(docs);
 useEffect(()=>{void refreshMemory();const refresh=()=>{if(document.visibilityState==='visible')void refreshMemory()};const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh)}},[]);
 // Freeze the edited document and its section/version baseline during background refresh.
 useEffect(()=>{setDocs(d=>({soul:edit?.kind==='soul'&&d.soul?d.soul:data.soul.value,memory:edit?.kind==='memory'&&d.memory?d.memory:data.memory.value}))},[data.soul.value,data.memory.value,edit?.kind]);
 const memParsed=parse(docs.memory?.content||'');
 docsRef.current=docs;
 const editRef=useRef(edit);editRef.current=edit;const statusRef=useRef(status);statusRef.current=status;
 // Compose the document with section idx replaced (-1 = text before the first section, past the end = appended).
 const compose=(md:string,idx:number,text:string)=>{const {pre,secs}=parse(md);const P=idx===-1?text.split('\n'):pre;const S=secs.map((s,i)=>i===idx?text.split('\n').concat(['']):s.raw);if(idx>=secs.length)S.push(['',...text.split('\n'),'']);return P.concat(...S).join('\n')};
 // Saves are serialized so an autosave and a close never race with a stale version.
 const queue=useRef<Promise<unknown>>(Promise.resolve());
 // Always saves against the edit's own base version; a conflict is never auto-resolved by a later save.
 const save=(e:Edit):Promise<boolean>=>{const run=async()=>{if(statusRef.current==='conflict')return false;const cur=editRef.current;const base=cur&&cur.kind===e.kind&&cur.idx===e.idx?cur.base:e.base;
  const d=docsRef.current[e.kind];if(!d)return false;const content=e.kind==='soul'?e.text:compose(d.content,e.idx,e.text);if(content===d.content&&d.version===base){setStatus('');return true}
  setStatus('saving');statusRef.current='saving';try{const saved=await saveDoc(e.kind,content,base);cacheMemoryDocument(e.kind,saved);docsRef.current={...docsRef.current,[e.kind]:saved};setDocs(x=>({...x,[e.kind]:saved}));
   if(editRef.current&&editRef.current.kind===e.kind&&editRef.current.idx===e.idx){editRef.current={...editRef.current,base:saved.version};setEdit(x=>x&&x.kind===e.kind&&x.idx===e.idx?{...x,base:saved.version}:x)}
   setStatus('');statusRef.current='';return true}
  catch(x:any){const st=x.status===409?'conflict':'error';setStatus(st);statusRef.current=st;return false}};
  const p=queue.current.then(run,run);queue.current=p.catch(()=>{});return p};
 const timer=useRef<number|undefined>(undefined);
 useEffect(()=>{if(!edit||status==='conflict')return;clearTimeout(timer.current);timer.current=window.setTimeout(()=>{void save(edit)},900);return()=>clearTimeout(timer.current)},[edit?.text]);// eslint-disable-line react-hooks/exhaustive-deps
 /** Saves and closes the open editor; false (editor and text kept) when the save failed or conflicts. */
 const close=async():Promise<boolean>=>{if(!edit)return true;clearTimeout(timer.current);if(statusRef.current==='conflict'){ctx.notify(T.conflict,'error');return false}const ok=await save(edit);if(ok){const current=editRef.current||edit;setView(current.kind==='soul'?'soul':`section:${current.idx}`);setEdit(null)}else ctx.notify(T.conflict,'error');return ok};
 // Reload fetches the newer copy but keeps the typed text open, re-anchored to its section by heading.
 // This is the only path that moves an edit onto a newer version (the user chose to reconcile).
 const reload=async()=>{const owner=editRef.current;if(!owner)return;const state=await refreshMemory();if(editRef.current?.kind!==owner.kind||editRef.current?.idx!==owner.idx||state[owner.kind].error)return;const fresh={soul:state.soul.value,memory:state.memory.value};docsRef.current=fresh;setDocs(fresh);statusRef.current='';setStatus('');setEdit(e=>{if(!e)return e;const d=fresh[e.kind];if(!d)return e;if(e.kind==='soul')return {...e,base:d.version};const head=e.text.split('\n')[0].trim();const secs=parse(d.content).secs;const i=/^## /.test(head)?secs.findIndex(s=>s.raw[0].trim()===head):e.idx;return {...e,idx:i<0?secs.length:i,base:d.version}})};
 const discard=()=>{clearTimeout(timer.current);setEdit(null);setStatus('');void refreshMemory()};
 async function addMemory(categoryTitle?:string){if(!await close())return;const d=docsRef.current.memory;if(!d)return;const title=categoryTitle||(zh?'新记忆':'New memory');/* reference memAdd (R:1983) default heading; the button keeps XL.memNew */const cur=d.content.replace(/\n+$/,'');const content=(cur?cur+'\n\n':'')+'## '+title+'\n- ';
  setStatus('saving');try{const saved=await saveDoc('memory',content,d.version);cacheMemoryDocument('memory',saved);docsRef.current={...docsRef.current,memory:saved};setDocs(x=>({...x,memory:saved}));setStatus('');const n=parse(saved.content).secs.length-1;setView(`section:${n}`);setEdit({kind:'memory',idx:n,text:parse(saved.content).secs[n]?.raw.join('\n').replace(/\n+$/,'')||'',base:saved.version})}catch(x:any){setStatus(x.status===409?'conflict':'error');ctx.notify(x.status===409?T.conflict:T.saveFailed,'error');void refreshMemory()}}
 async function revoke(m:any){try{await forgetMemory(m.id,m.version)}catch(e:any){ctx.notify(e.status===409?T.conflict:(zh?'暂未确认，请刷新后重试':'Not confirmed. Refresh before retrying.'),'error')}}

 type Card={key:string;kind:'soul'|'memory'|'auto';idx:number;title:string;raw:string;items:string[];paras:string[];isAbout?:boolean};
 const cards:Card[]=[];
 if(docs.soul){const {items,paras}=itemsOf(docs.soul.content.split('\n'));cards.push({key:'soul',kind:'soul',idx:0,title:zh?'身份与 Agent 设定':'Identity & agent settings',raw:docs.soul.content,items,paras,isAbout:true})}
 const preBody=memParsed.pre.filter(l=>l.trim()&&!/^# /.test(l.trim()));
 if(preBody.length){const {items,paras}=itemsOf(memParsed.pre);cards.push({key:'pre',kind:'memory',idx:-1,title:zh?'笔记':'Notes',raw:rawOf(memParsed.pre),items,paras})}
 memParsed.secs.forEach((s,i)=>cards.push({key:'s'+i+s.title,kind:'memory',idx:i,title:s.title,raw:rawOf(s.raw),items:s.items,paras:s.paras}));
 // A kept edit whose section no longer exists (or before documents load) still shows its editor.
 if(edit&&!cards.some(c=>c.kind===edit.kind&&c.idx===edit.idx))cards.unshift({key:'kept-edit',kind:edit.kind,idx:edit.idx,title:'',raw:edit.text,items:[],paras:[]});
 const folders=cards.filter(c=>c.kind==='memory').map(c=>({idx:c.idx,title:c.title,preview:c.raw.replace(/^#{1,2} .*\n?/, '')}));
 const entries=memoryEntries(folders);
 const category=memoryCategories.find(c=>view===`category:${c.id}`)||(view==='category:notes'?{id:'notes',zh:'其他记忆',en:'Other memories'}:undefined);
 const k=BUDDY[buddy.k]?buddy.k:'classic';
 const hint=status==='saving'?'…':status==='conflict'?T.conflict:status==='error'?T.saveFailed:XL.mdHint;

 const open=(next:MemoryView)=>{void close().then(ok=>{if(ok)setView(next)})};
 const viewing=edit?(edit.kind==='soul'?'soul':`section:${edit.idx}`):view;
 const visibleCards=cards.filter(c=>(c.kind==='soul'&&viewing==='soul')||(c.kind==='memory'&&viewing===`section:${c.idx}`));
 const editorBox=useRef<HTMLDivElement|null>(null);
 useLayoutEffect(()=>{
  const node=editorBox.current,scroll=node?.closest('.cm-scroll') as HTMLElement|null;
  if(!node||!scroll)return;
  const fit=()=>{const offset=node.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop;node.style.setProperty('--memory-editor-height',`${Math.max(200,Math.min(760,scroll.clientHeight-offset-32))}px`)};
  scroll.scrollTop=0;fit();const observer=new ResizeObserver(fit);observer.observe(scroll);observer.observe(node.parentElement!);return()=>observer.disconnect();
 },[viewing,!!edit]);
 const title=viewing==='home'?(zh?'记忆':'Memory'):viewing==='soul'?(zh?'身份与 Agent 设定':'Identity & agent settings'):viewing==='people'?(zh?'人物档案':'People'):viewing==='automatic'?(zh?'自动记住':'Learned automatically'):viewing.startsWith('category:')?(category?(zh?category.zh:category.en):''):viewing.startsWith('person:')?data.people.value?.people.find(p=>p.id===viewing.slice(7))?.name||'':visibleCards[0]?.title||'';
 return <div data-memory-page data-memory-view={viewing} className="mem-library" data-memory-refreshing={data.soul.loading||data.memory.loading||data.automatic.loading||data.people.loading} style={{display:'flex',flexDirection:'column',gap:12}}>
  <div className="mem-library-header">{viewing==='home'?<h2>{title}</h2>:<button className="mem-breadcrumb" onClick={()=>open(viewing.startsWith('person:')?'people':'home')}><I n="caret-left"/>{viewing.startsWith('person:')?(zh?'人物档案':'People'):(zh?'记忆':'Memory')}</button>}{viewing==='home'?<button className="mem-add" title={XL.memNew} aria-label={XL.memNew} disabled={!docs.memory||status==='saving'} onClick={()=>void addMemory()}><I n="plus"/></button>:null}</div>
  {viewing!=='home'&&!viewing.startsWith('person:')?<h2 className="mem-detail-title">{title}</h2>:null}
  {(['soul','memory','automatic','people'] as const).map(key=>{const r=data[key],name=key==='people'?(zh?'人物档案':'People'):key==='soul'?(zh?'身份与 Agent 设定':'Identity & agent settings'):key==='memory'?(zh?'笔记':'Notes'):(zh?'自动记住':'Learned automatically');return r.error?<div key={key} role="alert" data-memory-error={key} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',color:'var(--errText)',fontSize:12}}><span style={{flex:1}}>{name} · {zh?'读取失败':'Could not load'}</span><Hv onClick={()=>void refreshMemory()} style={{border:0,background:'var(--hover)',color:'var(--text)',borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>{zh?'重试':'Retry'}</Hv></div>:r.value===undefined?<div key={key} data-memory-loading={key} role="status" aria-label={zh?'正在读取'+name:'Loading '+name} aria-busy="true" style={{height:key==='soul'?150:70,borderRadius:14,background:'var(--hover)'}}/>:null})}
  {viewing==='home'&&data.memory.value!==undefined?<MemoryHome zh={zh} people={data.people.error?undefined:data.people.value} entries={entries} automatic={auto} onOpen={open}/>:null}
  {viewing.startsWith('category:')&&category?<MemoryCategoryDetail zh={zh} id={category.id} entries={entries} people={data.people.error?undefined:data.people.value} onOpen={open} onAdd={()=>void addMemory(zh?category.zh:category.en)} disabled={!docs.memory||data.memory.error||status==='saving'}/>:null}
  {(viewing==='people'||viewing.startsWith('person:'))&&data.people.value&&!data.people.error?<MemoryPeople zh={zh} library={data.people.value} personId={viewing.startsWith('person:')?viewing.slice(7):undefined} onOpen={open}/>:null}
  {viewing.startsWith('section:')&&!visibleCards.length&&!data.memory.loading&&!data.memory.error?<p className="mem-empty">{zh?'这条记忆已不存在':'This memory no longer exists'}</p>:null}
  {visibleCards.map(c=>{const editing=edit&&edit.kind===c.kind&&edit.idx===c.idx;
   if(editing)return <div key={c.key} ref={editorBox} className="mem-editor" style={{background:'var(--card)',boxShadow:'0 0 0 1.5px var(--accent)',borderRadius:'var(--r-card)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
    <textarea className="mem-editor-input" aria-label={zh?'编辑记忆':'Edit memory'} autoFocus ref={el=>{if(el&&document.activeElement!==el&&!el.dataset.f){el.dataset.f='1';el.focus();el.setSelectionRange(el.value.length,el.value.length)}}} value={edit!.text} onChange={e=>setEdit({...edit!,text:e.target.value})} onBlur={()=>{if(status!=='conflict'&&status!=='error')void close()}} onKeyDown={e=>{if(e.key==='Escape')(e.target as HTMLTextAreaElement).blur()}} rows={16} spellCheck={false} style={{display:'block',width:'100%',boxSizing:'border-box',resize:'none',border:'none',background:'transparent',color:'var(--text)',fontFamily:"ui-monospace, 'SF Mono', Menlo, monospace",fontSize:12,lineHeight:1.7,padding:'16px 20px 8px',outline:'none'}}/>
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px 10px 20px'}}>
     <span style={{flex:1,minWidth:0,fontSize:12,color:status==='conflict'||status==='error'?'var(--errText)':'var(--text3)'}}>{hint}</span>
     {status==='conflict'||status==='error'?<><Hv onMouseDown={(e:any)=>{e.preventDefault();if(window.confirm(zh?'放弃这段未保存的修改？':'Discard this unsaved edit?'))discard()}} style={{height:26,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'transparent',color:'var(--errText)',font:'inherit',fontSize:12,cursor:'pointer'}} hover={{background:'var(--hover)'}}>{zh?'放弃修改':'Discard'}</Hv><Hv onMouseDown={(e:any)=>{e.preventDefault();void reload()}} style={{height:26,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:12,cursor:'pointer'}} hover={{background:'var(--selected)'}}>{T.reload}</Hv></>:null}
     <Hv onMouseDown={(e:any)=>{e.preventDefault();void close()}} style={{height:26,padding:'0 12px',border:'none',borderRadius:'var(--r-innerBtn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:12,fontWeight:500,cursor:'pointer'}} hover={{background:'var(--accentHover)'}}>{XL.done}</Hv>
    </div></div>;
   const chips=c.items.length>0&&c.items.every(i=>!i.startsWith('@')&&!/\[.+\]\s*$/.test(i)&&!/^[^:：]{1,16}[:：]\s*.+$/.test(i)&&i.length<=32);
   const rows=c.items.map(raw=>{let m;if(raw.startsWith('@')){const parts=raw.slice(1).split(/\s+[—-]\s+/);const n=parts[0];return {kind:'person',v:n,sub:parts.slice(1).join(' — '),lead:initials(n)}}if((m=raw.match(/^(.*?)\s*\[(.+)\]\s*$/)))return {kind:'pill',v:m[1],pill:m[2]};if((m=raw.match(/^([^:：]{1,16})[:：]\s*(.+)$/)))return {kind:'kv',k:m[1],v:m[2]};return {kind:'plain',v:raw}}) as any[];
   const on=hover===c.key;
   return <div key={c.key} onMouseEnter={()=>setHover(c.key)} onMouseLeave={()=>setHover(h=>h===c.key?null:h)} style={{display:'flex',flexDirection:'column',gap:6,animation:'cmIn 250ms ease-out both'}}>
    <div style={{display:'flex',alignItems:'center',gap:8,minHeight:26,padding:'0 4px 0 16px'}}>
     <div style={{flex:1,minWidth:0,fontSize:12,fontWeight:500,color:'var(--text3)'}}>{c.title}</div>
     <Hv onClick={(e:any)=>{e.stopPropagation();const ev={currentTarget:e.currentTarget};void close().then(ok=>{if(ok)ctx.toComposer(ev,c.raw.replace(/^## /,''),zh?'帮我修改这条记忆：':'Help me edit this memory: ')})}} title={XL.replyWithTip} aria-label={XL.replyWithTip} style={{width:26,height:26,padding:0,display:'flex',alignItems:'center',justifyContent:'center',border:'none',borderRadius:13,background:'transparent',color:'var(--text3)',cursor:'pointer',opacity:on?1:0,transform:on?'scale(1)':'scale(.8)',pointerEvents:on?'auto':'none',transition:'opacity 200ms ease-out, transform 250ms cubic-bezier(.2,.8,.2,1)'}} hover={{background:'var(--hover)',color:'var(--accent)'}}><I n="chat-circle" style={{fontSize:14}}/></Hv>
    </div>
    <Hv as="div" role="button" tabIndex={0} className="cm-row" onKeyDown={(e:any)=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.currentTarget.click()}}} onClick={()=>{if(String(window.getSelection?.()||''))return;void (async()=>{if(edit&&!(edit.kind===c.kind&&edit.idx===c.idx)&&!await close())return;{const d=docsRef.current[c.kind as 'soul'|'memory'];if(d)setEdit({kind:c.kind as 'soul'|'memory',idx:c.idx,text:c.raw,base:d.version})}})()}} title={XL.clickEdit} style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,overflow:'hidden',display:'flex',flexDirection:'column',cursor:'text',transition:'box-shadow 250ms ease-out, opacity 250ms ease-out',animation:'cmIn 250ms ease-out both'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 4px 16px rgba(0,0,0,.06)'}}>
     {c.isAbout?<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10,padding:'22px 20px 18px',textAlign:'center'}}>
      <span onClick={buddy.togglePick} title={XL.changeAvatar} style={{width:84,height:84,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><Buddy k={k} S={80} hop={buddy.hop} curHop={buddy.hop} happy={buddy.happy}/></span>
      <div style={{display:'flex',flexDirection:'column',gap:2}}><div style={{fontSize:20,fontWeight:600,letterSpacing:'-0.02em'}}>CyberMe</div><div style={{fontSize:12,color:'var(--text3)'}}>{XL.capIdle}</div></div>
      {c.paras.map((p,i)=><div key={i} style={tw({color:'var(--text2)',lineHeight:1.55,textWrap:'pretty',maxWidth:340})}>{p}</div>)}
      {/* `backwards` instead of the reference `both`: the static style already equals cmPop's final frame (opacity 1, no transform), so the entrance is identical but no filled layer is held after it (native blank-picker hypothesis, pending retest). */}
      {buddy.pick?<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,paddingTop:6,animation:'cmPop 320ms cubic-bezier(.2,.8,.2,1) backwards'}}>
       <div style={{display:'flex',gap:6,justifyContent:'center',flexWrap:'wrap'}}>{Object.keys(BUDDY).map(b=><Hv key={b} onClick={(e:any)=>buddy.choose(b,e)} title={BUDDY[b].name[zh?1:0]} aria-label={BUDDY[b].name[zh?1:0]} style={{width:46,height:46,padding:0,border:'none',borderRadius:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',background:b===k?'var(--accentSoft)':'var(--hover)',boxShadow:b===k?'inset 0 0 0 1.5px var(--accent)':'none',transition:'transform 250ms cubic-bezier(.2,.8,.2,1), background 200ms'}} hover={{transform:'translateY(-2px)'}}><Buddy k={b} S={34} hop={0} curHop={buddy.hop} happy={false}/></Hv>)}</div>
       <span style={{fontSize:12,color:'var(--text3)'}}>{BUDDY[k].name[zh?1:0]}</span>
      </div>:null}
     </div>:null}
     {!c.isAbout&&c.paras.length?<div style={{display:'flex',flexDirection:'column',gap:6,padding:'14px 16px'}}>{c.paras.map((p,i)=><div key={i} style={tw({color:'var(--text2)',textWrap:'pretty'})}>{p}</div>)}</div>:null}
     {chips?<div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'14px 16px'}}>{c.items.map((v,i)=><span key={i} style={{display:'inline-flex',alignItems:'center',height:28,padding:'0 12px',borderRadius:14,background:'var(--hover)',fontSize:13}}>{v}</span>)}</div>
     :rows.length?<div style={{display:'flex',flexDirection:'column'}}>{rows.map((i,ii)=><div key={ii} style={{display:'flex',alignItems:'center',gap:12,minHeight:44,padding:'0 16px'}}>
      {i.kind==='person'?<span style={{width:30,height:30,flex:'none',borderRadius:'50%',background:avColor(i.v),color:'#fff',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'}}>{i.lead}</span>:null}
      {i.kind==='pill'?<span style={{width:30,height:30,flex:'none',borderRadius:8,background:'var(--hover)',color:'var(--text2)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="folder-simple" style={{fontSize:16}}/></span>:null}
      <div style={{flex:1,minWidth:0,alignSelf:'stretch',display:'flex',alignItems:'center',gap:12,padding:'10px 0',boxShadow:ii<rows.length-1?'inset 0 -0.5px 0 var(--line)':'none'}}>
       {i.kind==='kv'?<><span style={{flex:'none',color:'var(--text)'}}>{i.k}</span><span style={tw({flex:1,minWidth:0,textAlign:'right',color:'var(--text2)',textWrap:'pretty'})}>{i.v}</span></>
       :<><div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}><span style={tw({textWrap:'pretty'})}>{i.v}</span>{i.sub?<span style={{fontSize:12,color:'var(--text3)'}}>{i.sub}</span>:null}</div>{i.kind==='pill'?<span style={pill(/paused|暂停|done|完成/i.test(i.pill)?'scheduled':'running')}>{i.pill}</span>:null}</>}
      </div></div>)}</div>:null}
     {!c.paras.length&&!c.items.length&&!c.isAbout?<div style={{padding:'14px 16px',color:'var(--text3)'}}>{XL.clickEdit}</div>:null}
    </Hv>
   </div>})}
  {viewing==='automatic'&&data.automatic.enabled===false?<p className="mem-empty" role="status">{zh?'自动记忆未启用':'Automatic memory is paused'}</p>:null}
  {viewing==='automatic'&&data.automatic.jobs?.some(j=>['queued','running'].includes(j.status))?<p className="mem-empty" role="status" data-memory-processing>{zh?'正在整理记忆…':'Organizing memories…'}</p>:null}
  {viewing==='automatic'?data.automatic.jobs?.filter(j=>['failed','stale'].includes(j.status)).map(j=><div key={j.id} className="mem-settings-entry" role="alert" data-memory-job={j.id}><span style={{flex:1}}>{zh?'记忆整理未完成':'Memory processing incomplete'}</span><button className="mem-link" disabled={retrying!==null} onClick={()=>{setRetrying(j.id);void retryMemory(j).catch(()=>ctx.notify(zh?'暂未确认，请刷新后重试':'Not confirmed. Refresh before retrying.','error')).finally(()=>setRetrying(null))}}>{retrying===j.id?'…':zh?'重试':'Retry'}</button></div>):null}
  {(viewing==='automatic'||category)&&auto.some(m=>viewing==='automatic'||memoryCategory('',m.content,m.category)===category?.id)?<div style={{display:'flex',flexDirection:'column',gap:6,animation:'cmIn 250ms ease-out both'}}>
   <div style={{display:'flex',alignItems:'center',gap:8,minHeight:26,padding:'0 4px 0 16px'}}><div style={{flex:1,minWidth:0,fontSize:12,fontWeight:500,color:'var(--text3)'}}>{zh?'自动记住':'Learned automatically'}</div></div>
   <div style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,overflow:'hidden',display:'flex',flexDirection:'column'}}>
    {auto.filter(m=>viewing==='automatic'||memoryCategory('',m.content,m.category)===category?.id).map((m,ii)=><div key={m.id} onMouseEnter={()=>setHover('a'+m.id)} onMouseLeave={()=>setHover(h=>h==='a'+m.id?null:h)} style={{display:'flex',alignItems:'center',gap:12,minHeight:44,padding:'0 16px'}}>
     <div style={{flex:1,minWidth:0,alignSelf:'stretch',display:'flex',alignItems:'center',gap:12,padding:'10px 0',boxShadow:ii<auto.length-1?'inset 0 -0.5px 0 var(--line)':'none'}}>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}><span style={tw({textWrap:'pretty'})}>{m.content||m.text||m.summary||m.title}</span><span style={{fontSize:12,color:'var(--text3)'}}>{[m.sourceTitle||m.source,relTime(m.createdAt||m.updatedAt,zh)].filter(Boolean).join(' · ')}</span></div>
      <Hv disabled={data.forgetting} aria-label={(zh?'忘记：':'Forget: ')+m.content} onClick={()=>void revoke(m)} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',opacity:1,transition:'opacity 200ms ease-out'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{zh?'忘记':'Forget'}</Hv>
     </div></div>)}
   </div></div>:null}
  {viewing==='automatic'&&!auto.length&&!data.automatic.jobs?.some(j=>['queued','running','failed','stale'].includes(j.status))&&data.automatic.value!==undefined&&!data.automatic.error?<p className="mem-empty">{zh?'暂无自动记忆':'No learned memories yet'}</p>:null}
 </div>;
}
