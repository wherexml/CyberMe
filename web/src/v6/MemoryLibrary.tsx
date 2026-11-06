import React,{useState} from 'react';
import {I} from './icons';
import {ContentArtwork} from './ContentArtwork';
import {Md} from './md';
import type {PeopleLibrary} from './memory-data';
import {memoryCategories,memoryCategory} from './memory-categories';
import lifeArtwork from './assets/memory/life.png';
import interestArtwork from './assets/memory/interests.png';
import './memory-library.css';

export type MemoryView='home'|'soul'|'automatic'|'people'|`category:${string}`|`section:${number}`|`person:${string}`;
export type MemoryFolder={idx:number;title:string;preview:string};
export type MemoryEntry={key:string;title:string;text:string;category:string;view:MemoryView};
const excerpt=(s:string)=>s.replace(/^#+\s*/gm,'').replace(/^[-*]\s*/gm,'').replace(/\*\*/g,'').trim();
export function memoryEntries(folders:MemoryFolder[]):MemoryEntry[]{
 return folders.flatMap(f=>{
  // Unsectioned notes are indexed by paragraph; editing always opens the intact source.
  const parts=f.idx===-1?f.preview.split(/\n\s*\n|\n(?=[-*] )/):[f.preview];
  return parts.filter(p=>p.trim()).map((text,i)=>({key:`${f.idx}:${i}`,title:f.title,text:excerpt(text),category:memoryCategory(f.idx===-1?'':f.title,text),view:`section:${f.idx}` as MemoryView}));
 });
}
export function MemoryHome({zh,people,folders,entries,automatic,onOpen}:{zh:boolean;people?:PeopleLibrary;folders:MemoryFolder[];entries:MemoryEntry[];automatic:any[];onOpen:(view:MemoryView)=>void}){
 const owner=people?.owner,self=people?.people.find(p=>p.aliases.some(a=>owner?.aliases.includes(a)));
 const name=owner?.name||'',role=self?.role||owner?.role;
 const tile=(title:string,icon:string,view:MemoryView,preview?:string)=><button type="button" key={view} className="mem-folder" data-memory-folder={view} onClick={()=>onOpen(view)}>
  <span className="mem-folder-icon">{view==='category:life'||view==='category:interest'?<img className="mem-generated-artwork" src={view==='category:life'?lifeArtwork:interestArtwork} alt="" width={56} height={56}/>:<ContentArtwork iconKey={icon} title={title}/>}</span><span className="mem-folder-title">{title}</span>
  {preview?<span className="mem-folder-preview">{excerpt(preview)}</span>:null}
  <I n="caret-right" style={{position:'absolute',right:18,top:24,fontSize:14,color:'var(--text3)'}}/>
 </button>;
 return <>
  <section className="mem-overview" aria-label={zh?'个人资料总览':'Personal overview'}>
   <div className="mem-overview-top"><span className="mem-overview-icon"><ContentArtwork iconKey="contact" size={44}/></span><button className="mem-link" onClick={()=>onOpen('category:identity')}>{zh?'查看资料':'View profile'}<I n="arrow-up-right"/></button></div>
   <h2>{name?(zh?`我对 ${name} 的了解`:`What I know about ${name}`):(zh?'对你的了解':'What I know about you')}</h2>
   {owner?<div className="mem-identity">{[...new Set([...(owner.aliases||[]).filter(a=>a!==name),role].filter(Boolean))].join(' / ')}</div>:null}
  </section>
  <div className="mem-section-heading">{zh?'记忆资料':'Your memories'}</div>
  <div className="mem-folder-grid">
   {memoryCategories.filter(c=>c.id!=='identity').map(c=>tile(zh?c.zh:c.en,c.icon,`category:${c.id}`,entries.find(e=>e.category===c.id)?.text||automatic.find(m=>memoryCategory('',m.content,m.category)===c.id)?.content))}
   {tile(zh?'人物档案':'People','team','people',people?.people.map(p=>p.name).slice(0,4).join('、'))}
   {tile(zh?'自动记住':'Learned automatically','knowledge','automatic',automatic[0]?.content)}
  </div>
  {folders.length?<><div className="mem-section-heading">{zh?'原始笔记':'Source notes'}</div><div className="mem-source-list">{folders.map(f=><button key={f.idx} className="mem-settings-entry" data-memory-folder={`section:${f.idx}`} onClick={()=>onOpen(`section:${f.idx}`)}><ContentArtwork title={f.title} size={28}/><span className="mem-folder-title">{f.title}</span><I n="caret-right"/></button>)}</div></>:null}
  <button className="mem-settings-entry" data-memory-folder="soul" onClick={()=>onOpen('soul')}><ContentArtwork iconKey="workflow" size={32}/><span>{zh?'身份与 Agent 设定':'Identity & agent settings'}</span><I n="caret-right"/></button>
 </>;
}
export function MemoryCategoryDetail({zh,id,entries,people,onOpen,onAdd,disabled}:{zh:boolean;id:string;entries:MemoryEntry[];people?:PeopleLibrary;onOpen:(view:MemoryView)=>void;onAdd:()=>void;disabled:boolean}){
 const owner=people?.owner,self=people?.people.find(p=>p.aliases.some(a=>owner?.aliases.includes(a)));
 return <div className="mem-category-detail">
  {id==='identity'&&owner?<div className="mem-source"><h3>{owner.name}</h3><p className="mem-identity">{self?.role||owner.role}</p>{self?<button className="mem-link" onClick={()=>onOpen(`person:${self.id}`)}>{zh?'查看人物档案':'Open profile'}<I n="arrow-up-right"/></button>:null}</div>:null}
  {entries.filter(e=>e.category===id).map(e=><button key={e.key} className="mem-category-note" onClick={()=>onOpen(e.view)}><span>{e.text}</span><small>{e.title}<I n="arrow-up-right"/></small></button>)}
  <button className="mem-settings-entry" disabled={disabled} onClick={onAdd}><I n="plus"/><span>{zh?'添加记忆':'Add memory'}</span></button>
 </div>;
}
export function MemoryPeople({zh,library,personId,onOpen}:{zh:boolean;library:PeopleLibrary;personId?:string;onOpen:(view:MemoryView)=>void}){
 const [q,setQ]=useState('');
 const person=library.people.find(p=>p.id===personId);
 const eventTime=(v:string|null)=>{if(!v||!Number.isFinite(Date.parse(v)))return zh?'时间待确认':'Time unconfirmed';return new Date(v).toLocaleString(zh?'zh-CN':'en-GB',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})};
 const kind=(v:string)=>({delegation:zh?'交办':'Delegation',commitment:zh?'承诺':'Commitment',progress:zh?'进展':'Progress',decision:zh?'决策':'Decision',information:zh?'信息':'Information'}[v]||v);
 if(personId&&!person)return <p className="mem-empty" role="status">{zh?'该人物档案已不可用':'This profile is no longer available'}</p>;
 if(person)return <div data-person-profile={person.id} className="mem-person-detail">
  <header className="mem-person-heading"><span className="mem-person-avatar">{person.name.slice(0,1)}</span><div><h2>{person.name}</h2><p>{person.role}</p></div></header>
  <div className="mem-person-facts">{person.relationship?<div><span>{zh?'与你的关系':'Relationship to you'}</span><strong>{person.relationship}</strong></div>:null}{person.reviewedAt?<div><span>{zh?'资料更新':'Profile updated'}</span><span>{person.reviewedAt}</span></div>:null}</div>
  <details className="mem-source" open><summary>{zh?'原始档案':'Source profile'}</summary><div className="mem-source-body"><Md text={person.markdown}/></div>{person.truncated?<p className="mem-empty">{zh?'档案较长，此处显示前 12,000 字符':'Showing the first 12,000 characters'}</p>:null}</details>
  <h3 className="mem-section-heading">{zh?'跟踪记录':'Tracking history'}</h3>
  {person.observations.length?person.observations.slice().reverse().map((o,i)=><article className="mem-observation" key={o.key||i}><div className="mem-observation-meta"><span>{kind(o.kind)}</span><time dateTime={o.eventAt||undefined}>{eventTime(o.eventAt)}</time></div><p>{o.summary}</p><details><summary>{zh?'来源':'Sources'}</summary>{o.evidence.map((e,j)=><div className="mem-evidence" key={j}><span>{e.actor==='owner'?(zh?'本人发言':'Your message'):e.actor==='other'?(zh?'对方发言':'Other speaker'):(zh?'发言方向待确认':'Speaker direction unconfirmed')}</span><blockquote>{e.quote}</blockquote><span>{e.sourceId}{e.messageId?' / '+e.messageId:''}</span><time>{eventTime(e.eventAt)}</time></div>)}</details></article>):<p className="mem-empty">{zh?'暂无跟踪记录':'No tracking records yet'}</p>}
 </div>;
 const people=library.people.filter(p=>[p.name,...p.aliases,p.role,p.relationship].join(' ').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()));
 return <div className="mem-people" data-memory-people>
  {library.incomplete?<p className="mem-empty" role="status">{zh?'部分资料目录暂不可读':'Some profile folders are unavailable'}</p>:null}
  {library.people.length?<label className="mem-search"><I n="magnifying-glass"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder={zh?'搜索人物':'Search people'} aria-label={zh?'搜索人物':'Search people'}/></label>:null}
  <div className="mem-people-list">{people.map(p=><button className="mem-person-row" key={p.id} onClick={()=>onOpen(`person:${p.id}`)}><span className="mem-person-avatar">{p.name.slice(0,1)}</span><span className="mem-person-label"><strong>{p.name}</strong><span>{p.role||p.relationship}</span></span><I n="caret-right"/></button>)}</div>
  {!people.length?<p className="mem-empty">{q?(zh?'没有匹配的人物':'No matching people'):(zh?'暂无人物档案':'No people profiles yet')}</p>:null}
 </div>;
}
