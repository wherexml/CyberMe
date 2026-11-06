import React,{useLayoutEffect,useRef,useState} from 'react';
import {I} from './icons';
import {sameDatum,type VisualBlock,type Datum,type DatumStatus,type CellState} from '../../../shared/insight-visual';
import type {InsightGraph} from '../../../shared/insight-visual-compiler';
import './insight-visual.css';

// Deterministic, generic rendering of a validated insight visual. No case logic, no markup from data, no actions.
const TAG:Record<DatumStatus,[string,string]>={fact:['',''],quote:['',''],claim:['Reported','转述'],estimate:['Estimate','估计'],proposal:['Suggested','建议'],pending:['To confirm','待确认'],'not-provided':['Not in source','来源未提供']};
const STATE:Record<CellState,[string,string,string]>={confirmed:['✓','Confirmed','已确认'],failed:['✕','Failed','未通过'],pending:['◐','Pending','待定'],'not-run':['○','Not run','未执行'],'not-provided':['','Not in source','未提供'],proposed:['·','Suggested','建议']};
const LEAN={positive:['Supportive','倾向推进'],skeptical:['Doubtful','有质疑'],neutral:['Neutral','中立'],unknown:['Unstated','未表态']} as const;
const DOC_ICON={chat:'chat-circle-text',minutes:'note-pencil',task:'clipboard-text',file:'file-text',contract:'scales'} as const;
type Z={zh:boolean};
const tag=(s:DatumStatus,zh:boolean)=>TAG[s][zh?1:0];
const tone=(t?:string)=>'iv-tone-'+(t&&['neutral','blue','teal','purple','amber'].includes(t)?t:'neutral');
const title=(d:Datum)=>(d.basis||[]).map(b=>b.quote).join('\n');

/** A value never separates from its status, qualifier or speaker. */
export function DatumView({d,zh,hideTag,className=''}:{d:Datum;hideTag?:boolean;className?:string}&Z){
 return <span className={`iv-d iv-d-${d.status} ${className}`} data-status={d.status} title={title(d)}>
  {d.who?<span className="iv-who">{d.who}{zh?'：':': '}</span>:null}
  {d.qualifier&&!d.text.includes(d.qualifier)?<span className="iv-qual">{d.qualifier}</span>:null}
  <span className="iv-text">{d.text}</span>
  {!hideTag&&tag(d.status,zh)?<span className="iv-tag">{tag(d.status,zh)}</span>:null}
 </span>;
}
/** Generic missing placeholder: status not-provided, or a short placeholder text such as 待提供/未提供 (any status). */
const MISSING_TEXT=/^(来源)?(未提供|待提供|未说明|未记录|未知|不详|not provided|unknown|n\/a|—|-)$/i;
const isMissing=(d:Datum|undefined)=>!d||d.status==='not-provided'||MISSING_TEXT.test(String(d.text||'').trim());
/** Two cells read as "the same" only when both are real, known values and the full datum agrees. */
const sameKnown=(a:Datum,b:Datum)=>!isMissing(a)&&!isMissing(b)&&sameDatum(a,b);
const joinList=(xs:string[],zh:boolean)=>xs.join(zh?'、':', ');
const MissingLine=({names,zh,lead}:{names:string[];zh:boolean;lead?:string})=>names.length?<p className="iv-missing" data-missing={names.length}>{lead?<span className="iv-missing-lead">{lead}</span>:null}<span className="iv-missing-k">{zh?'来源未提供：':'Not in source: '}</span><span>{joinList(names,zh)}</span></p>:null;
/** When every item shares one status the tag is shown once on the container. */
const uniform=(ds:Datum[])=>ds.length>1&&ds.every(d=>d.status===ds[0].status)&&tag(ds[0].status,true)&&ds[0].status!=='not-provided'?ds[0].status:null;

function Block({b,zh}:{b:VisualBlock}&Z):React.ReactElement|null{
 switch(b.type){
  case 'values':{
   // Only known values become metrics; missing ones are named once in a muted line, never shown as a number or badge.
   const known=b.items.map((it,i)=>({it,i})).filter(x=>!isMissing(x.it.value)),missing=b.items.filter(it=>isMissing(it.value)).map(it=>it.label);
   return <div className="iv-values-wrap">{known.length?<div className="iv-values">{known.map(({it,i})=><div key={i} className={'iv-value'+(b.focus===i?' is-focus':'')+(it.value.status==='pending'?' is-pending':'')}>
   <span className="iv-label">{it.label}</span>
   <span className="iv-value-main" data-status={it.value.status} title={title(it.value)}>{it.value.qualifier&&!it.value.text.includes(it.value.qualifier)?<span className="iv-qual">{it.value.qualifier}</span>:null}<strong className={[...it.value.text].length>8?'is-long':''}>{it.value.text}</strong>{it.unit?<span className="iv-unit">{it.unit}</span>:null}</span>
   {tag(it.value.status,zh)||it.value.status==='quote'?<span className={'iv-state iv-s-'+it.value.status}>{it.value.status==='quote'?(zh?'引述':'Quoted'):tag(it.value.status,zh)}</span>:null}
  </div>)}</div>:null}<MissingLine names={missing} zh={zh}/></div>}
  case 'compare':{const n=b.subjects.length;
   // Rows where every subject is missing are listed once below; an all-missing table collapses to one contextual line.
   const rows=b.dimensions.filter(dim=>!dim.cells.every(isMissing)),empty=b.dimensions.filter(dim=>dim.cells.every(isMissing)).map(dim=>dim.name);
   const subjects=joinList(b.subjects.map(s=>s.name),zh);
   if(!rows.length)return <MissingLine names={empty} zh={zh} lead={subjects+' · '}/>;
   return <div className="iv-compare-wrap"><div className={'iv-compare cols-'+n} style={{gridTemplateColumns:`minmax(52px,auto) repeat(${n},minmax(0,1fr))`,['--n' as any]:n}}>
    <span className="iv-c-corner"/>
    {b.subjects.map((s,i)=><div key={i} className={'iv-c-head '+tone(s.tone)}>{s.icon?<I n={s.icon} style={{fontSize:14}}/>:null}<span>{s.name}</span></div>)}
    {rows.map((dim,r)=>{
     const merge=b.highlight==='differences'&&n>1&&dim.cells.every(c=>sameKnown(c,dim.cells[0]));
     return <React.Fragment key={r}><div className="iv-c-dim">{dim.name}</div>
      {merge?<div className="iv-c-cell is-same" style={{gridColumn:`span ${n}`}}><DatumView d={dim.cells[0]} zh={zh}/><span className="iv-same">{zh?'相同':'Same'}</span></div>
      :dim.cells.map((c,j)=>isMissing(c)
        ?<div key={j} className="iv-c-cell is-missing" data-status={c.status} title={title(c)}><span className="iv-gap" aria-label={zh?'来源未提供':'Not in source'}>—</span></div>
        :<div key={j} className={'iv-c-cell '+tone(b.subjects[j]?.tone)+(b.highlight==='differences'&&c.status!=='pending'?' is-diff':'')}><DatumView d={c} zh={zh}/></div>)}
     </React.Fragment>})}
   </div><MissingLine names={empty} zh={zh}/></div>}
  case 'mapping':return <div className="iv-mapping">
   <div className="iv-m-head">{(['from','to'] as const).map(k=><span key={k}>{b[k].icon?<I n={b[k].icon!} style={{fontSize:14}}/>:null}<b>{b[k].name}</b></span>)}</div>
   {b.rows.map((r,i)=><div key={i} className={'iv-m-row m-'+r.match}>
    <div className="iv-m-src"><DatumView d={r.source} zh={zh}/>{r.role?<small>{r.role}</small>:null}</div>
    <div className="iv-m-dst">{r.match==='gap'||r.target.status==='not-provided'?<span className="iv-blank"/>:null}<DatumView d={r.target} zh={zh}/><b className="iv-m-mark">{({same:'=',changed:'≠',gap:zh?'缺':'gap',unknown:'?',corresponds:'→'} as const)[r.match]}</b></div>
   </div>)}
  </div>;
  case 'beforeAfter':return <div className="iv-ba">
   <div className="iv-label">{b.caption}</div>
   <div className="iv-ba-pages">{(['before','after'] as const).map(k=><div key={k} className={'iv-ba-col is-'+k}>
    <div className="iv-ba-label">{b[k].label}</div>
    <div className="iv-mini" aria-hidden="true">{b[k].marks.map((m,i)=><div key={i} className={`mk mk-${m.kind}${m.emphasis?' is-em':''}${m.removed?' is-removed':''}`}>{['field','text','block'].includes(m.kind)?<><i/><i/></>:null}</div>)}</div>
    <div className="iv-ba-note"><DatumView d={b[k].note} zh={zh}/></div>
   </div>)}</div>
   {b.later?.length?<div className="iv-ba-later"><span className="iv-label">{zh?'后置':'Later'}</span>{b.later.map((d,i)=><DatumView key={i} d={d} zh={zh}/>)}</div>:null}
  </div>;
  case 'document':{const marks=(b.marks||[]).map((m,i)=>({...m,n:i+1}));
   return <div className="iv-doc">
    <div className="iv-doc-head"><I n={DOC_ICON[b.kind]||'file-text'} style={{fontSize:14}}/><span>{b.source}</span></div>
    {b.lines.map((line,i)=>{const parts:React.ReactNode[]=[];let cursor=0;
     const hits=marks.map(m=>({m,at:line.text.indexOf(m.target)})).filter(h=>h.at>=0).sort((a,c)=>a.at-c.at);
     for(const h of hits){if(h.at<cursor)continue;parts.push(line.text.slice(cursor,h.at));parts.push(<mark key={h.m.n} className={'iv-s-'+h.m.status}>{h.m.target}<sup>{h.m.n}</sup></mark>);cursor=h.at+h.m.target.length}
     parts.push(line.text.slice(cursor));
     return <p key={i} className={'iv-doc-line iv-d-'+line.status} data-status={line.status} title={title(line)}>{line.who?<span className="iv-who">{line.who}{zh?'：':': '}</span>:null}<span className="iv-doc-text">{parts}</span></p>})}
    {marks.length?<ol className="iv-doc-notes">{marks.map(m=><li key={m.n} className={'iv-s-'+m.status}><sup>{m.n}</sup><span>{m.note}</span>{tag(m.status,zh)?<span className="iv-tag">{tag(m.status,zh)}</span>:null}</li>)}</ol>:null}
   </div>}
  case 'boundary':{const u=uniform(b.inside);
   return <div className={'iv-boundary-wrap '+tone(b.tone||'purple')}>
    <div className="iv-boundary">
     <div className="iv-legend">{b.icon?<I n={b.icon} style={{fontSize:14}}/>:null}<span>{b.label}</span>{u?<span className="iv-tag iv-g">{tag(u,zh)}</span>:null}</div>
     <ul className="iv-list">{b.inside.map((d,i)=><li key={i}><DatumView d={d} zh={zh} hideTag={!!u}/></li>)}</ul>
     {b.condition?<div className="iv-cond"><DatumView d={b.condition} zh={zh}/></div>:null}
    </div>
    {b.outside?.length?<div className="iv-outside"><span className="iv-label">{zh?'边界外':'Outside'}</span><ul className="iv-list">{b.outside.map((d,i)=><li key={i}><DatumView d={d} zh={zh}/></li>)}</ul></div>:null}
   </div>}
  case 'dependencies':return <Dependencies b={b} zh={zh}/>;
  case 'sequence':{const u=uniform(b.steps.flatMap(s=>[s.label,...(s.gate?[s.gate]:[])]));
   return <div><ol className="iv-seq">{b.steps.map((s,i)=><li key={i}><span className="iv-seq-n">{i+1}</span><div className="iv-seq-body"><DatumView d={s.label} zh={zh} hideTag={!!u}/>{s.gate?<div className="iv-seq-gate"><span className="iv-label">{zh?'通过条件':'Gate'}</span><DatumView d={s.gate} zh={zh} hideTag={!!u}/></div>:null}</div></li>)}</ol>
    <div className="iv-label">{u?<span className="iv-tag iv-g">{tag(u,zh)}</span>:null}{zh?'顺序，不代表日期':'Order, not dates'}</div></div>}
  case 'artifacts':return <div className={'iv-artifacts n-'+b.groups.length}>{b.groups.map((g,i)=>{const u=uniform(g.items);
   return <div key={i} className={'iv-folder '+tone(g.tone)}><div className="iv-folder-tab"><I n={g.icon||'folder-simple'} style={{fontSize:13}}/><span className="iv-folder-name">{g.name}</span>{u?<span className="iv-tag iv-g">{tag(u,zh)}</span>:null}</div>
    <ul className="iv-files">{g.items.map((d,j)=><li key={j}><DatumView d={d} zh={zh} hideTag={!!u}/></li>)}</ul></div>})}</div>;
  case 'claims':{const u=uniform(b.items.map(c=>c.claim));
   return <div className="iv-claims">{u?<div className="iv-label iv-claims-head"><span className="iv-tag iv-g">{tag(u,zh)}</span></div>:null}{b.items.map((c,i)=><div key={i} className="iv-claim">
   <DatumView d={c.claim} zh={zh} hideTag={!!u} className="iv-claim-text"/>
   {c.missing?.length?<div className="iv-row iv-claim-missing"><span className="iv-label">{zh?'待补充：':'Needed: '}</span><span>{joinList(c.missing,zh)}</span></div>:null}
   {c.use?<div className="iv-row"><DatumView d={c.use} zh={zh}/></div>:null}
  </div>)}</div>}
  case 'alternatives':return <div className="iv-alts">
   {b.question?<div className="iv-alts-q"><DatumView d={b.question} zh={zh}/></div>:null}
   <div className="iv-alts-row" role="list">{b.items.map((x,i)=><div key={i} role="listitem" className="iv-alt"><span className="iv-radio"/><DatumView d={x.label} zh={zh} hideTag className="iv-alt-label"/>{x.detail?<DatumView d={x.detail} zh={zh} className="iv-alt-detail"/>:null}</div>)}</div>
   <div className="iv-label">{zh?'尚未选定':'Not chosen'}</div>
  </div>;
  case 'schedule':return <ol className="iv-sched">{b.events.map((e,i)=><li key={i} className={'at-'+e.at.status}><span className="iv-dot"/><time><DatumView d={e.at} zh={zh}/></time><div><DatumView d={e.what} zh={zh} hideTag={e.what.status===e.at.status}/></div></li>)}</ol>;
  case 'stances':return <div className={'iv-stances n-'+b.actors.length}>{b.actors.map((a,i)=><div key={i} className={'iv-actor lean-'+a.lean}>
   <div className="iv-actor-head"><span className="iv-avatar">{[...a.name][0]}</span><div className="iv-actor-name"><b>{a.name}</b>{a.role?<small>{a.role}</small>:null}</div><span className="iv-lean" title={(a.leanBasis||[]).map(x=>x.quote).join('\n')}>{LEAN[a.lean][zh?1:0]}</span></div>
   <DatumView d={{...a.quote,who:undefined}} zh={zh}/>
  </div>)}</div>;
  case 'quote':return <figure className="iv-quote"><blockquote><DatumView d={{...b.line,who:undefined}} zh={zh}/></blockquote>{b.speaker||b.line.who?<figcaption>— {b.speaker||b.line.who}</figcaption>:null}</figure>;
  case 'matrix':return <table className="iv-matrix"><thead><tr><th/>{b.columns.map(c=><th key={c}>{c}</th>)}</tr></thead>
   <tbody>{b.rows.map((r,i)=><tr key={i}><th scope="row"><DatumView d={r.label} zh={zh} hideTag/></th>{r.cells.map((c,j)=>{const [g,en,cn]=STATE[c.state];return <td key={j} className={'st-'+c.state} data-state={c.state} title={(c.basis||[]).map(x=>x.quote).join('\n')}>{g?<span className="st-g">{g}</span>:null}<span>{zh?cn:en}</span></td>})}</tr>)}</tbody></table>;
  case 'note':return <p className="iv-note"><DatumView d={b.line} zh={zh}/></p>;
  case 'split':return <div className={'iv-split rel-'+b.relation}><div className="iv-split-cell"><Block b={b.left} zh={zh}/></div><div className="iv-split-cell"><Block b={b.right} zh={zh}/></div></div>;
  default:return null;
 }
}

/** Layers by longest prerequisite path; prerequisites sit at the bottom. Edges are drawn after layout. */
function Dependencies({b,zh}:{b:Extract<VisualBlock,{type:'dependencies'}>}&Z){
 const depth:Record<string,number>={};const preds=(id:string)=>b.edges.filter(e=>e.to===id).map(e=>e.from);
 const d=(id:string,guard=0):number=>depth[id]??=(guard>8||!preds(id).length?0:1+Math.max(...preds(id).map(p=>d(p,guard+1))));
 b.nodes.forEach(n=>d(n.id));const max=Math.max(0,...Object.values(depth));
 const box=useRef<HTMLDivElement>(null),[paths,setPaths]=useState<{d:string;w:number;h:number}>({d:'',w:0,h:0});
 useLayoutEffect(()=>{const el=box.current;if(!el)return;
  const draw=()=>{const r0=el.getBoundingClientRect();let path='';
   for(const e of b.edges){const a=el.querySelector(`[data-node="${e.from}"]`)?.getBoundingClientRect(),c=el.querySelector(`[data-node="${e.to}"]`)?.getBoundingClientRect();if(!a||!c)continue;
    const x1=a.left+a.width/2-r0.left,y1=a.top-r0.top,x2=c.left+c.width/2-r0.left,y2=c.bottom-r0.top,my=(y1+y2)/2;path+=`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2} `}
   setPaths({d:path,w:r0.width,h:r0.height})};
  draw();const ro=new ResizeObserver(draw);ro.observe(el);return()=>ro.disconnect()},[b]);
 return <div className="iv-deps" ref={box}>
  <svg className="iv-deps-lines" width={paths.w} height={paths.h} aria-hidden="true"><path d={paths.d}/></svg>
  {Array.from({length:max+1},(_,k)=>max-k).map(layer=><div key={layer} className={'iv-deps-layer'+(layer===0?' is-base':'')}>{b.nodes.filter(n=>depth[n.id]===layer).map(n=><div key={n.id} data-node={n.id} className="iv-dep-node"><DatumView d={n.label} zh={zh}/></div>)}</div>)}
  <div className="iv-label iv-center">{zh?'下层是上层的前提':'Lower items are prerequisites'}</div>
 </div>;
}

export function InsightVisual({spec,zh}:{spec:InsightGraph}&Z){
 return <div className="iv-root" data-insight-visual={spec.relation}>
  {spec.blocks.map((b,i)=><section key={i} className={'iv-block iv-b-'+b.type}><Block b={b} zh={zh}/></section>)}
  {/* spec.omitted is coverage diagnostics; it stays in the payload and source details, not in the default visual. */}
 </div>;
}
