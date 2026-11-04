import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {Ctx} from './App';
import {I} from './icons';
import {Hv,pill,avColor,initials} from './ui';
import {Buddy,BUDDY} from './Buddy';
import {api,enc,loadDoc,saveDoc,getUI,setUI,type Doc} from './store';
import {relTime} from './model';

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
 const [docs,setDocs]=useState<{soul?:Doc;memory?:Doc}>({}),[auto,setAuto]=useState<any[]>([]),[err,setErr]=useState('');
 const buffered=getUI().memDraft;
 // `base` is the document version the edit started from; it is persisted so a remounted or restarted editor
 // can never save over a newer server copy (the server answers 409 and the conflict stays blocking).
 const [edit,setEdit]=useState<Edit|null>(buffered?{kind:buffered.kind,idx:buffered.idx,text:buffered.text,base:buffered.base}:null),[status,setStatus]=useState<''|'saving'|'conflict'|'error'>(buffered?.status||''),[hover,setHover]=useState<string|null>(null);
 useEffect(()=>{const st=status==='conflict'||status==='error'?status:'';setUI({memDraft:edit?{...edit,status:st}:null})},[edit,status]);
 const gen=useRef(0);const docsRef=useRef<{soul?:Doc;memory?:Doc}>({});
 const load=useCallback(async():Promise<{soul?:Doc;memory?:Doc}|null>=>{const g=++gen.current;let out:{soul?:Doc;memory?:Doc}|null=null;try{const [soul,memory]=await Promise.all([loadDoc('soul'),loadDoc('memory')]);if(g!==gen.current)return null;out={soul,memory};docsRef.current=out;setDocs(out);setErr('')}catch(e:any){setErr(e.message)}try{const a=await api('GET','/api/memories/automatic');if(g===gen.current)setAuto(a.items||[])}catch{}return out},[]);
 useEffect(()=>{void load()},[load]);
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
  setStatus('saving');statusRef.current='saving';try{const saved=await saveDoc(e.kind,content,base);docsRef.current={...docsRef.current,[e.kind]:saved};setDocs(x=>({...x,[e.kind]:saved}));
   if(editRef.current&&editRef.current.kind===e.kind&&editRef.current.idx===e.idx){editRef.current={...editRef.current,base:saved.version};setEdit(x=>x&&x.kind===e.kind&&x.idx===e.idx?{...x,base:saved.version}:x)}
   setStatus('');statusRef.current='';return true}
  catch(x:any){const st=x.status===409?'conflict':'error';setStatus(st);statusRef.current=st;return false}};
  const p=queue.current.then(run,run);queue.current=p.catch(()=>{});return p};
 const timer=useRef<number|undefined>(undefined);
 useEffect(()=>{if(!edit||status==='conflict')return;clearTimeout(timer.current);timer.current=window.setTimeout(()=>{void save(edit)},900);return()=>clearTimeout(timer.current)},[edit?.text]);// eslint-disable-line react-hooks/exhaustive-deps
 /** Saves and closes the open editor; false (editor and text kept) when the save failed or conflicts. */
 const close=async():Promise<boolean>=>{if(!edit)return true;clearTimeout(timer.current);if(statusRef.current==='conflict'){ctx.notify(T.conflict,'error');return false}const ok=await save(edit);if(ok)setEdit(null);else ctx.notify(T.conflict,'error');return ok};
 // Reload fetches the newer copy but keeps the typed text open, re-anchored to its section by heading.
 // This is the only path that moves an edit onto a newer version (the user chose to reconcile).
 const reload=async()=>{const fresh=await load();if(!fresh)return;statusRef.current='';setStatus('');setEdit(e=>{if(!e)return e;const d=fresh[e.kind];if(!d)return e;if(e.kind==='soul')return {...e,base:d.version};const head=e.text.split('\n')[0].trim();const secs=parse(d.content).secs;const i=/^## /.test(head)?secs.findIndex(s=>s.raw[0].trim()===head):e.idx;return {...e,idx:i<0?secs.length:i,base:d.version}})};
 const discard=()=>{clearTimeout(timer.current);setEdit(null);setStatus('');void load()};
 async function addMemory(){if(!await close())return;const d=docsRef.current.memory;if(!d)return;const title=zh?'新记忆':'New memory';/* reference memAdd (R:1983) default heading; the button keeps XL.memNew */const cur=d.content.replace(/\n+$/,'');const content=(cur?cur+'\n\n':'')+'## '+title+'\n- ';
  setStatus('saving');try{const saved=await saveDoc('memory',content,d.version);setDocs(x=>({...x,memory:saved}));setStatus('');const n=parse(saved.content).secs.length-1;setEdit({kind:'memory',idx:n,text:parse(saved.content).secs[n]?.raw.join('\n').replace(/\n+$/,'')||'',base:saved.version})}catch(x:any){setStatus(x.status===409?'conflict':'error')}}
 async function revoke(m:any){try{await api('POST','/api/memories/automatic/'+enc(m.id)+'/revoke',{version:m.version});await load()}catch(e:any){ctx.notify(e.message,'error')}}

 type Card={key:string;kind:'soul'|'memory'|'auto';idx:number;title:string;raw:string;items:string[];paras:string[];isAbout?:boolean};
 const cards:Card[]=[];
 if(docs.soul){const {items,paras}=itemsOf(docs.soul.content.split('\n'));cards.push({key:'soul',kind:'soul',idx:0,title:zh?'关于我':'About me',raw:docs.soul.content,items,paras,isAbout:true})}
 const preBody=memParsed.pre.filter(l=>l.trim()&&!/^# /.test(l.trim()));
 if(preBody.length){const {items,paras}=itemsOf(memParsed.pre);cards.push({key:'pre',kind:'memory',idx:-1,title:zh?'笔记':'Notes',raw:rawOf(memParsed.pre),items,paras})}
 memParsed.secs.forEach((s,i)=>cards.push({key:'s'+i+s.title,kind:'memory',idx:i,title:s.title,raw:rawOf(s.raw),items:s.items,paras:s.paras}));
 // A kept edit whose section no longer exists (or before documents load) still shows its editor.
 if(edit&&!cards.some(c=>c.kind===edit.kind&&c.idx===edit.idx))cards.unshift({key:'kept-edit',kind:edit.kind,idx:edit.idx,title:'',raw:edit.text,items:[],paras:[]});
 const k=BUDDY[buddy.k]?buddy.k:'classic';
 const hint=status==='saving'?'…':status==='conflict'?T.conflict:status==='error'?T.saveFailed:XL.mdHint;

 return <div style={{display:'flex',flexDirection:'column',gap:12}}>
  {err?<div style={{padding:'10px 12px',borderRadius:'var(--r-inner)',background:'var(--errSoft)',color:'var(--errText)',fontSize:12}}>{err}</div>:null}
  {!cards.length&&!auto.length&&!err?<div style={{padding:'40px 4px',color:'var(--text2)',textAlign:'center'}}>{T.memEmpty}</div>:null}
  {cards.map(c=>{const editing=edit&&edit.kind===c.kind&&edit.idx===c.idx;
   if(editing)return <div key={c.key} style={{background:'var(--card)',boxShadow:'0 0 0 1.5px var(--accent)',borderRadius:'var(--r-card)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
    <textarea autoFocus ref={el=>{if(el&&document.activeElement!==el&&!el.dataset.f){el.dataset.f='1';el.focus();el.setSelectionRange(el.value.length,el.value.length)}}} value={edit!.text} onChange={e=>setEdit({...edit!,text:e.target.value})} onBlur={()=>{if(status!=='conflict'&&status!=='error')void close()}} onKeyDown={e=>{if(e.key==='Escape')(e.target as HTMLTextAreaElement).blur()}} rows={Math.max(4,edit!.text.split('\n').length+1)} spellCheck={false} style={{display:'block',width:'100%',boxSizing:'border-box',resize:'none',border:'none',background:'transparent',color:'var(--text)',fontFamily:"ui-monospace, 'SF Mono', Menlo, monospace",fontSize:12,lineHeight:1.7,padding:'16px 20px 8px',outline:'none'}}/>
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
  {auto.length?<div style={{display:'flex',flexDirection:'column',gap:6,animation:'cmIn 250ms ease-out both'}}>
   <div style={{display:'flex',alignItems:'center',gap:8,minHeight:26,padding:'0 4px 0 16px'}}><div style={{flex:1,minWidth:0,fontSize:12,fontWeight:500,color:'var(--text3)'}}>{zh?'自动记住':'Learned automatically'}</div></div>
   <div style={{background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine)',borderRadius:14,overflow:'hidden',display:'flex',flexDirection:'column'}}>
    {auto.map((m,ii)=><div key={m.id} onMouseEnter={()=>setHover('a'+m.id)} onMouseLeave={()=>setHover(h=>h==='a'+m.id?null:h)} style={{display:'flex',alignItems:'center',gap:12,minHeight:44,padding:'0 16px'}}>
     <div style={{flex:1,minWidth:0,alignSelf:'stretch',display:'flex',alignItems:'center',gap:12,padding:'10px 0',boxShadow:ii<auto.length-1?'inset 0 -0.5px 0 var(--line)':'none'}}>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:1}}><span style={tw({textWrap:'pretty'})}>{m.content||m.text||m.summary||m.title}</span><span style={{fontSize:12,color:'var(--text3)'}}>{[m.sourceTitle||m.source,relTime(m.createdAt||m.updatedAt,zh)].filter(Boolean).join(' · ')}</span></div>
      <Hv onClick={()=>void revoke(m)} style={{height:26,padding:'0 10px',border:'none',borderRadius:13,background:'transparent',color:'var(--text3)',font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',opacity:hover==='a'+m.id?1:0,transition:'opacity 200ms ease-out'}} hover={{background:'var(--hover)',color:'var(--text)'}}>{zh?'撤销':'Forget'}</Hv>
     </div></div>)}
   </div></div>:null}
  <Hv onClick={()=>void addMemory()} style={{alignSelf:'center',display:'flex',alignItems:'center',gap:8,height:36,marginTop:4,padding:'0 16px 0 6px',border:'none',borderRadius:18,background:'var(--card)',boxShadow:'0 0 0 0.5px var(--cardLine), 0 1px 3px rgba(0,0,0,.06)',color:'var(--text)',font:'inherit',fontSize:13,fontWeight:500,cursor:'pointer',transition:'box-shadow 250ms ease-out, transform 200ms cubic-bezier(.2,.8,.2,1)'}} hover={{boxShadow:'0 0 0 0.5px var(--lineStrong), 0 6px 16px rgba(0,0,0,.08)',transform:'translateY(-1px)'}}><span style={{width:24,height:24,borderRadius:'50%',background:'var(--accent)',color:'var(--onAccent)',display:'flex',alignItems:'center',justifyContent:'center'}}><I n="plus" style={{fontSize:13,fontWeight:700}}/></span><span>{XL.memNew}</span></Hv>
 </div>;
}
