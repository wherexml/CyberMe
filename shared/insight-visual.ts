// Insight visual grammar: a bounded, read-only description of how to show one saved insight.
// The model composes it; the server validates it strictly; the client renders it with generic components.
// Nothing here is an action, a template for a specific business, or executable markup.

export const INSIGHT_VISUAL_VERSION='insight-visual-v1';
/** Bump whenever any validation rule or helper below changes; it is part of every cache fingerprint. */
export const INSIGHT_VISUAL_POLICY='insight-visual-policy-9';

export const DATUM_STATUSES=['fact','quote','claim','estimate','proposal','pending','not-provided'] as const;
export type DatumStatus=typeof DATUM_STATUSES[number];
export interface Basis{ref:string;quote:string}
export interface Datum{text:string;status:DatumStatus;qualifier?:string;who?:string;basis:Basis[]}
export const CELL_STATES=['confirmed','failed','pending','not-run','not-provided','proposed'] as const;
export type CellState=typeof CELL_STATES[number];
export interface Cell{state:CellState;basis?:Basis[]}
export const VISUAL_ICONS=['file-text','chat-circle-text','table','database','user','users','lock-simple','buildings','calendar-blank','currency-circle-dollar','warning','check-circle','question','key','chart-bar','folder-simple','receipt','clipboard-text','git-branch','cloud','cpu','shield-check','note-pencil','presentation-chart','identification-card','scales','link-simple-horizontal','flag-banner','hourglass-medium','sparkle'] as const;
export const VISUAL_TONES=['neutral','blue','teal','purple','amber'] as const;
export const VISUAL_RELATIONS=['comparison','mapping','before-after','annotated-document','boundary','dependencies','gated-sequence','artifacts','claims','alternatives','schedule','stances','quote','values'] as const;
type Tone=typeof VISUAL_TONES[number];

export type VisualBlock=
 |{type:'values';items:{label:string;value:Datum;unit?:string}[];focus:number|null}
 |{type:'compare';subjects:{name:string;icon?:string;tone?:Tone}[];dimensions:{name:string;cells:Datum[]}[];highlight:'differences'|'none'}
 |{type:'mapping';from:{name:string;icon?:string};to:{name:string;icon?:string};rows:{role?:string;source:Datum;target:Datum;match:'same'|'changed'|'gap'|'unknown'|'corresponds'}[]}
 |{type:'beforeAfter';caption:string;before:Side;after:Side;later?:Datum[]}
 |{type:'document';kind:'chat'|'minutes'|'task'|'file'|'contract';source:string;lines:Datum[];marks?:{target:string;note:string;status:DatumStatus}[]}
 |{type:'boundary';label:string;icon?:string;tone?:Tone;condition?:Datum;inside:Datum[];outside?:Datum[]}
 |{type:'dependencies';nodes:{id:string;label:Datum}[];edges:{from:string;to:string;kind:'requires'|'feeds'}[]}
 |{type:'sequence';steps:{label:Datum;gate?:Datum}[]}
 |{type:'artifacts';groups:{name:string;icon?:string;tone?:Tone;items:Datum[]}[]}
 |{type:'claims';items:{claim:Datum;missing?:string[];use?:Datum}[]}
 |{type:'alternatives';question?:Datum;items:{label:Datum;detail?:Datum}[];selection:null}
 |{type:'schedule';events:{at:Datum;what:Datum}[]}
 |{type:'stances';actors:{name:string;role?:string;quote:Datum;lean:'positive'|'skeptical'|'neutral'|'unknown';leanBasis?:Basis[]}[]}
 |{type:'quote';line:Datum;speaker?:string}
 |{type:'matrix';columns:string[];rows:{label:Datum;cells:Cell[]}[]}
 |{type:'note';line:Datum}
 |{type:'split';left:VisualBlock;right:VisualBlock;relation:'versus'|'then'|'and'};
export interface Side{label:string;marks:{kind:'heading'|'text'|'rule'|'block'|'field'|'input'|'chip';emphasis?:boolean;removed?:boolean}[];note:Datum}
export interface InsightVisualSpec{version:string;title:string;titleBasis:Basis[];summary:string;summaryBasis:Basis[];relation:typeof VISUAL_RELATIONS[number];blocks:VisualBlock[];omitted?:string[]}
export type InsightReferences=Record<string,string>; // I = full saved title+body, E0.. = verbatim evidence quotes

const HEDGES=['约','一般','最高','最多','至少','可能','预计','左右','大概','以内','或'];
const WORKDAY=/工作日|自然日/;
const RETRIEVAL=/检索|未返回|没有返回|查不到|检索不到|未见|未查到|搜索|缓存/;
const ABSENCE=/(没有|无|不存在|缺少|未有)/;
const NEGATION=/(未|尚未|没有|没|不|无|非|未能|并未)$/;
const COMPLETION=/(已完成|已通过|已确认|已上线|已解决|已修复|已付款|已到账|已交付|已执行|已跑通|已批准|已签|已发送)/g;
const CELL_EVIDENCE:Record<string,RegExp>={confirmed:/(已完成|已通过|已确认|通过了|已验证|成功|已保存|已提交|已上线|已发送|已交付)/,failed:/(失败|未通过|报错|错误|不通过)/,'not-run':/(未执行|未运行|没有执行|没跑|未跑|尚未开始|未开始)/,pending:/(待确认|待定|进行中|in_progress|未确认|等待|待核)/};
const len=(s:string)=>[...s].length;
/** Honest absence: these exact texts may be not-provided without a basis (nothing to quote for missing information). */
export const GENERIC_ABSENT=new Set(['未提供','来源未提供','未说明','待提供','未记录']);
export const isGenericAbsent=(d:any)=>!!d&&d.status==='not-provided'&&typeof d.text==='string'&&GENERIC_ABSENT.has(d.text.trim())&&d.who===undefined&&d.qualifier===undefined&&(d.basis===undefined||(Array.isArray(d.basis)&&!d.basis.length));
/** Layout vocabulary: a before/after schematic is only for visual layout changes. */
const LAYOUT=/(版式|排版|布局|对齐|分隔线|横线|色块|间距|字号|字体|行距|边框|留白|栏位|页面|界面|样式|配色|layout|align|spacing|margin|padding|font|typograph)/i;
/** Date/time expressions that must appear whole in the source, not as separate digits. */
const DATE_EXPR=/\d{2,4}\s*[年\-/.]\s*\d{1,2}(?:\s*[月\-/.]\s*\d{1,2}\s*[日号]?)?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|\d{1,2}\s*[:：]\s*\d{2}/g;
const bare=(s:string)=>String(s||'').replace(/[「」“”"『』\s]/g,'');
const str=(x:unknown,max:number):x is string=>typeof x==='string'&&x.trim().length>0&&len(x)<=max;

/** First numbered recommendation inside I ("1." / "1、"). Text after it is the insight's own suggestion. */
export function recommendationStart(I:string){const m=I.match(/\n\s*1[.、]/);return m?.index??Infinity;}

/** Dimension lists the source itself declares, e.g. "四列：A、B、C、D" or "三栏：A、B、C". */
export function declaredDimensions(I:string):string[][]{
 const out:string[][]=[];
 for(const m of I.matchAll(/([一二三四五六七八九十\d]+)\s*(?:列|栏)[^：:\n]{0,6}[：:]\s*([^。；\n]+)/g)){
  // The list ends at the first clause break; parenthetical notes are removed before splitting on 、.
  const list=m[2].replace(/[（(][^）)]*[）)]/g,'').split(/[，,；;。]/)[0];
  const names=list.split('、').map(x=>x.replace(/[「」“”"]/g,'').trim()).filter(x=>x.length>=2&&x.length<=16);
  if(names.length>=2)out.push(names);
 }
 return out;
}

export interface ValidationResult{valid:boolean;errors:string[];visibleChars:number}

/** graphOnly: the card keeps its saved title/summary, so model headers are neither required nor checked.
 *  blockOnly: validate the given blocks in isolation (no relation, budget, note-count or declared-axes checks). */
export interface ValidationOptions{graphOnly?:boolean;blockOnly?:boolean}
export function validateInsightVisual(spec:any,refs:InsightReferences,opts:ValidationOptions={}):ValidationResult{
 try{return validateUnsafe(spec,refs,opts)}catch{return {valid:false,errors:['$: malformed structure'],visibleChars:0}}
}
/** Visual-only validation used for product display: same datum/reference/status/number/qualifier guards, no header fields. */
export function validateInsightGraph(spec:any,refs:InsightReferences):ValidationResult{return validateInsightVisual(spec,refs,{graphOnly:true})}
function validateUnsafe(spec:any,refs:InsightReferences,opts:ValidationOptions):ValidationResult{
 const graphOnly=!!(opts.graphOnly||opts.blockOnly);
 const errors:string[]=[];let visible=0,notes=0;const shownText:string[]=[];
 const err=(p:string,m:string)=>{if(errors.length<40)errors.push(p+': '+m)};
 const I=refs.I||'',recoStart=recommendationStart(I);
 const see=(t:unknown)=>{if(typeof t==='string'){visible+=len(t);shownText.push(t)}};
 const refsFlat=Object.values(refs).join('\n').replace(/\s+/g,'');
 // Labels carry no basis, so any number or date in them must occur in the input (whitespace aside); full dates as a whole.
 const groundedLabel=(x:string,p:string)=>{
  const dates=[...x.matchAll(DATE_EXPR)].map(m=>m[0]);let rest=x;for(const d of dates)rest=rest.replace(d,' ');
  const bad=[...dates.filter(d=>!refsFlat.includes(d.replace(/\s+/g,''))),...(rest.match(/\d+(?:\.\d+)?/g)||[]).filter(n=>!refsFlat.includes(n))];
  if(bad.length)err(p,`label contains number/date not found in the source (${bad.join(', ')}); use a descriptive label without numbers, or copy the exact number/date from the source`);
 };
 const label=(x:unknown,max:number,p:string)=>{if(!str(x,max))err(p,`must be a non-empty string of at most ${max} characters`);else if(/\d/.test(x))groundedLabel(x,p);see(x)};
 const icon=(x:unknown,p:string)=>{if(x!==undefined&&!(VISUAL_ICONS as readonly string[]).includes(x as string))err(p,'icon')};
 const tone=(x:unknown,p:string)=>{if(x!==undefined&&!(VISUAL_TONES as readonly string[]).includes(x as string))err(p,'tone')};
 const arr=(x:unknown,lo:number,hi:number,p:string):x is any[]=>{if(!Array.isArray(x)||x.length<lo||x.length>hi){err(p,`must be an array of ${lo}-${hi} items`);return false}return true};

 /** Resolve basis quotes; returns joined support text and whether every quote sits in the recommendation section of I. */
 function support(basis:unknown,p:string,required=true):{text:string;fromRecommendation:boolean;refs:string[];quoted:boolean}{
  const empty={text:'',fromRecommendation:false,refs:[] as string[],quoted:false};
  if(!Array.isArray(basis)||!basis.length){if(required)err(p,'basis required');return empty}
  if(basis.length>3){err(p,'basis 1-3');return empty}
  let text='',fromRec=true,quoted=true;const used:string[]=[];
  basis.forEach((b:any,i:number)=>{
   const src=typeof b?.ref==='string'&&Object.hasOwn(refs,b.ref)?refs[b.ref]:undefined;
   if(src===undefined){err(`${p}.basis.${i}`,'unknown ref');fromRec=false;return}
   if(typeof b.quote!=='string'||len(b.quote)<2||len(b.quote)>200){err(`${p}.basis.${i}`,'quote length');fromRec=false;return}
   const at=src.indexOf(b.quote);if(at<0){err(`${p}.basis.${i}`,'quote not verbatim');fromRec=false;return}
   text+=b.quote+'\n';used.push(b.ref);if(!(b.ref==='I'&&at>recoStart))fromRec=false;
   // Inside I, only text the insight itself put in quotation marks counts as someone's words.
   if(b.ref==='I'&&!insideQuotes(src,at,b.quote))quoted=false;
  });
  return {text,fromRecommendation:fromRec&&!!text,refs:used,quoted};
 }
 /** Numbers/dates shown must occur in their own basis, with nearby hedges preserved. */
 function grounded(shown:string,s:{text:string},p:string){
  for(const n of shown.match(/\d+(?:\.\d+)?/g)||[]){
   if(!s.text.includes(n)){err(p,'unsupported number '+n);continue}
   for(const at of indexes(s.text,n)){
    const win=s.text.slice(Math.max(0,at-6),at+n.length+8);
    for(const h of HEDGES)if(win.includes(h)&&!shown.includes(h))err(p,`dropped qualifier "${h}"`);
    if(WORKDAY.test(win)&&!WORKDAY.test(shown))err(p,'dropped workday qualifier');
   }
  }
  // Completion assertions are copied, never inferred: the same words must appear un-negated in the basis.
  for(const m of shown.matchAll(COMPLETION)){const w=m[0];const ats=indexes(s.text,w);if(!ats.length||ats.every(at=>NEGATION.test(s.text.slice(Math.max(0,at-3),at))))err(p,'unsupported completion claim "'+w+'"')}
  for(const w of ['不存在','没有','尚未','未完成','无法'])if(shown.includes(w)&&!s.text.includes(w)&&!RETRIEVAL.test(s.text))err(p,'unsupported absence/negation "'+w+'"');
  // "Nothing was retrieved" is not "it does not exist".
  if(ABSENCE.test(shown)&&RETRIEVAL.test(s.text)&&!RETRIEVAL.test(shown)&&!/记录/.test(shown))err(p,'retrieval absence stated as nonexistence');
 }
 function datum(d:any,p:string,o:{max?:number;status?:readonly string[];verbatim?:boolean}={}){
  if(!d||typeof d!=='object')return err(p,'datum missing');
  const max=o.max||40;
  if(!str(d.text,max))err(p,`text must be a non-empty string of at most ${max} characters`);
  if(!(DATUM_STATUSES as readonly string[]).includes(d.status))err(p,`status must be one of: ${DATUM_STATUSES.join(' ')}`);
  if(o.status&&!o.status.includes(d.status))err(p,`status ${JSON.stringify(d.status)} not allowed here; use one of: ${o.status.join(' ')}`);
  if(d.qualifier!==undefined&&!str(d.qualifier,8))err(p,'qualifier');
  if(d.who!==undefined&&!str(d.who,10))err(p,'who');
  see(d.text);see(d.qualifier);
  if(isGenericAbsent(d))return; // every other status/text keeps the basis requirement
  const s=support(d.basis,p);if(!s.text)return;
  const shown=String(d.text||'')+String(d.qualifier||'');
  grounded(shown,s,p);
  if(s.fromRecommendation&&!['proposal','pending','not-provided'].includes(d.status))err(p,'recommendation shown as '+d.status);
  if(d.status==='quote'&&!s.quoted)err(p,'quote needs evidence or a quotation in the source');
  if(d.status==='quote'||o.verbatim){
   const t=bare(d.text),src=bare(s.text);const at=src.indexOf(t);
   if(!t||at<0)err(p,'quoted text must occur verbatim in its basis');
   else if(NEGATION.test(src.slice(Math.max(0,at-3),at)))err(p,'quoted text drops a preceding negation');
  }
  if(d.status==='not-provided'&&/(^|[^\d.])0([^\d.]|$)/.test(String(d.text)))err(p,'unknown rendered as zero');
  if(d.who&&!s.text.includes(d.who)&&!I.includes(d.who))err(p,'speaker not in source');
 }
 function cell(c:any,p:string){
  if(!c||!(CELL_STATES as readonly string[]).includes(c.state))return err(p,`cell must be {state, basis}; state one of: ${CELL_STATES.join(' ')}`);
  if(c.state==='not-provided'){if(c.basis!==undefined)support(c.basis,p,false);return}
  // A state other than "not provided" is a claim about the world and needs its own evidence.
  const s=support(c.basis,p);if(!s.text)return;
  if(c.state==='proposed'){if(!s.fromRecommendation)err(p,'proposed cell needs a recommendation basis');return}
  if(s.fromRecommendation)err(p,'recommendation used as cell state');
  // Conservative: the basis must state that very state, un-negated. Otherwise the cell is not drawn.
  const re=CELL_EVIDENCE[c.state];const hit=re?[...s.text.matchAll(new RegExp(re.source,'g'))].some(m=>c.state==='confirmed'?!NEGATION.test(s.text.slice(Math.max(0,(m.index||0)-3),m.index)):true):false;
  if(!hit)err(p,'cell state not stated by its basis');
 }
 function block(b:any,p:string,inSplit=false){
  if(!b||typeof b!=='object')return err(p,'block');
  switch(b.type){
   case 'values':
    if(arr(b.items,1,3,p+'.items'))b.items.forEach((x:any,i:number)=>{const q=`${p}.items.${i}`;label(x?.label,12,q+'.label');datum(x?.value,q+'.value',{max:14});const t=String(x?.value?.text||'');if(!/\d/.test(t)&&len(t)>8)err(q,'value must be numeric, a code or a short identifier');if(x?.value?.status==='proposal'&&!/\d/.test(t))err(q,'non-numeric proposal cannot be a focal value');if(x?.unit!==undefined)label(x.unit,6,q+'.unit')});
    if(b.focus!==null&&!(Number.isInteger(b.focus)&&b.focus>=0&&b.focus<(b.items?.length||0)))err(p,'focus');break;
   case 'compare':
    if(arr(b.subjects,2,4,p+'.subjects'))b.subjects.forEach((s:any,i:number)=>{label(s?.name,12,`${p}.subjects.${i}`);icon(s?.icon,p);tone(s?.tone,p)});
    if(arr(b.dimensions,1,6,p+'.dimensions'))b.dimensions.forEach((d:any,i:number)=>{label(d?.name,10,`${p}.dimensions.${i}.name`);if(arr(d?.cells,b.subjects?.length||0,b.subjects?.length||0,`${p}.dimensions.${i}.cells`))d.cells.forEach((c:any,j:number)=>datum(c,`${p}.dimensions.${i}.cells.${j}`,{max:24}))});
    if(!['differences','none'].includes(b.highlight))err(p,'highlight must be one of: differences none');break;
   case 'mapping':
    for(const k of ['from','to']){label(b[k]?.name,12,`${p}.${k}`);icon(b[k]?.icon,p)}
    if(arr(b.rows,1,6,p+'.rows'))b.rows.forEach((r:any,i:number)=>{const q=`${p}.rows.${i}`;if(r?.role!==undefined)label(r.role,8,q+'.role');datum(r?.source,q+'.source',{max:24});datum(r?.target,q+'.target',{max:24});if(!['same','changed','gap','unknown','corresponds'].includes(r?.match))err(q,'match must be one of: same changed gap unknown corresponds');if(r?.match==='same'&&(['not-provided','pending'].includes(r?.target?.status)||['not-provided','pending'].includes(r?.source?.status)||bare(r?.source?.text)!==bare(r?.target?.text)))err(q,'same requires two known, identical values')});break;
   case 'beforeAfter':
    label(b.caption,16,p+'.caption');if(!String(b.caption||'').includes('示意'))err(p,'caption must contain 示意');
    // Layout-only: a side note (or its own basis) must talk about visual layout, not dates, quantities or business changes.
    if(!['before','after'].some(k=>{const n=b[k]?.note;return LAYOUT.test(String(n?.text||''))||(Array.isArray(n?.basis)&&n.basis.some((x:any)=>LAYOUT.test(String(x?.quote||''))))}))err(p,'beforeAfter is for visual layout changes only (a side note or its basis must describe layout); use compare, values or schedule for business, numeric or date changes');
    for(const k of ['before','after']){const s=b[k];if(!s){err(p,k);continue}label(s.label,8,`${p}.${k}.label`);datum(s.note,`${p}.${k}.note`,{max:24});if(arr(s.marks,2,7,`${p}.${k}.marks`))s.marks.forEach((m:any,i:number)=>{if(!['heading','text','rule','block','field','input','chip'].includes(m?.kind))err(`${p}.${k}.marks.${i}`,'mark kind must be one of: heading text rule block field input chip')})}
    if(b.later!==undefined&&arr(b.later,0,2,p+'.later'))b.later.forEach((d:any,i:number)=>datum(d,`${p}.later.${i}`,{max:24}));break;
   case 'document':
    if(!['chat','minutes','task','file','contract'].includes(b.kind))err(p,'kind must be one of: chat minutes task file contract');label(b.source,16,p+'.source');
    if(arr(b.lines,1,4,p+'.lines'))b.lines.forEach((l:any,i:number)=>datum(l,`${p}.lines.${i}`,{max:90,status:['quote','fact'],verbatim:true}));
    if(b.marks!==undefined&&arr(b.marks,0,3,p+'.marks'))b.marks.forEach((m:any,i:number)=>{const q=`${p}.marks.${i}`;if(!str(m?.target,40)||!b.lines?.some((l:any)=>String(l?.text||'').includes(m.target)))err(q,'mark target not in line');label(m?.note,24,q+'.note');if(!(DATUM_STATUSES as readonly string[]).includes(m?.status))err(q,'mark status')});break;
   case 'boundary':
    label(b.label,12,p+'.label');icon(b.icon,p);tone(b.tone,p);if(b.condition!==undefined)datum(b.condition,p+'.condition',{max:30});
    if(arr(b.inside,1,4,p+'.inside'))b.inside.forEach((d:any,i:number)=>datum(d,`${p}.inside.${i}`,{max:24}));
    if(b.outside!==undefined&&arr(b.outside,0,3,p+'.outside'))b.outside.forEach((d:any,i:number)=>datum(d,`${p}.outside.${i}`,{max:24}));break;
   case 'dependencies':{
    const ids=new Set<string>();
    if(arr(b.nodes,2,7,p+'.nodes'))b.nodes.forEach((n:any,i:number)=>{if(typeof n?.id!=='string'||!/^[a-z][a-z0-9]{0,5}$/.test(n.id)||ids.has(n.id))err(`${p}.nodes.${i}`,'id');ids.add(n?.id);datum(n?.label,`${p}.nodes.${i}.label`,{max:20})});
    if(arr(b.edges,1,8,p+'.edges'))b.edges.forEach((e:any,i:number)=>{if(!ids.has(e?.from)||!ids.has(e?.to)||e.from===e.to||!['requires','feeds'].includes(e?.kind))err(`${p}.edges.${i}`,'edge must be {from:node id,to:other node id,kind:requires|feeds}')});
    const deg:Record<string,number>={};for(const id of ids)deg[id]=0;for(const e of b.edges||[])if(ids.has(e?.to))deg[e.to]++;
    const queue=[...ids].filter(i=>!deg[i]);let seen=0;while(queue.length){const n=queue.shift()!;seen++;for(const e of b.edges||[])if(e?.from===n&&--deg[e.to]===0)queue.push(e.to)}
    if(seen!==ids.size)err(p,'dependency cycle');break;}
   case 'sequence':
    if(arr(b.steps,2,5,p+'.steps'))b.steps.forEach((s:any,i:number)=>{datum(s?.label,`${p}.steps.${i}.label`,{max:24});if(s?.gate!==undefined)datum(s.gate,`${p}.steps.${i}.gate`,{max:30})});break;
   case 'artifacts':
    if(arr(b.groups,1,3,p+'.groups'))b.groups.forEach((g:any,i:number)=>{label(g?.name,12,`${p}.groups.${i}.name`);icon(g?.icon,p);tone(g?.tone,p);if(arr(g?.items,1,4,`${p}.groups.${i}.items`))g.items.forEach((d:any,j:number)=>datum(d,`${p}.groups.${i}.items.${j}`,{max:24}))});break;
   case 'claims':
    if(arr(b.items,1,3,p+'.items'))b.items.forEach((c:any,i:number)=>{const q=`${p}.items.${i}`;datum(c?.claim,q+'.claim',{max:40,status:['claim','estimate','quote']});if(c?.missing!==undefined&&arr(c.missing,0,3,q+'.missing'))c.missing.forEach((m:any,j:number)=>label(m,10,`${q}.missing.${j}`));if(c?.use!==undefined)datum(c.use,q+'.use',{max:24})});break;
   case 'alternatives':
    if(b.selection!==null)err(p,'selection must be null');if(b.question!==undefined)datum(b.question,p+'.question',{max:30});
    if(arr(b.items,2,3,p+'.items'))b.items.forEach((x:any,i:number)=>{datum(x?.label,`${p}.items.${i}.label`,{max:16});if(x?.detail!==undefined)datum(x.detail,`${p}.items.${i}.detail`,{max:30})});break;
   case 'schedule':
    if(arr(b.events,1,4,p+'.events'))b.events.forEach((e:any,i:number)=>{const q=`${p}.events.${i}`;datum(e?.at,q+'.at',{max:16});datum(e?.what,q+'.what',{max:30});
     // A time must be stated as written (digits or words), or shown as an unresolved slot.
     const at=e?.at;if(at&&!['pending','not-provided'].includes(at.status)&&!(at.basis||[]).some((x:any)=>typeof x?.quote==='string'&&x.quote.includes(String(at.text||'').replace(/\s+/g,'')))&&!/\d/.test(String(at.text||'')))err(q,'time must appear verbatim in its basis')});break;
   case 'stances':
    if(arr(b.actors,2,4,p+'.actors'))b.actors.forEach((a:any,i:number)=>{const q=`${p}.actors.${i}`;label(a?.name,8,q+'.name');if(a?.role!==undefined)label(a.role,12,q+'.role');datum(a?.quote,q+'.quote',{max:40,status:['quote','claim']});if(!['positive','skeptical','neutral','unknown'].includes(a?.lean))err(q,'lean must be one of: positive skeptical neutral unknown');
     // A stance label is itself a claim; it needs evidence or stays unknown.
     if(a?.lean!=='unknown')support(a?.leanBasis,q+'.leanBasis')});break;
   case 'quote':datum(b.line,p+'.line',{max:70,status:['quote']});if(b.speaker!==undefined)label(b.speaker,10,p+'.speaker');break;
   case 'matrix':
    if(arr(b.columns,1,4,p+'.columns'))b.columns.forEach((c:any,i:number)=>label(c,6,`${p}.columns.${i}`));
    if(arr(b.rows,1,6,p+'.rows'))b.rows.forEach((r:any,i:number)=>{datum(r?.label,`${p}.rows.${i}.label`,{max:20});if(arr(r?.cells,b.columns?.length||0,b.columns?.length||0,`${p}.rows.${i}.cells`))r.cells.forEach((c:any,j:number)=>cell(c,`${p}.rows.${i}.cells.${j}`))});break;
   case 'note':notes++;datum(b.line,p+'.line',{max:40});break;
   case 'split':
    if(inSplit){err(p,'nested split');break}if(!['versus','then','and'].includes(b.relation))err(p,'relation');
    for(const k of ['left','right']){if(!['values','quote','artifacts','note','boundary'].includes(b[k]?.type))err(`${p}.${k}`,'split child must be compact');block(b[k],`${p}.${k}`,true)}break;
   default:err(p,`missing or invalid "type" (got ${JSON.stringify(b.type??null)}); every block needs type, one of: values compare mapping beforeAfter document boundary dependencies sequence artifacts claims alternatives schedule stances quote matrix note split`);
  }
 }
 if(!spec||typeof spec!=='object')return {valid:false,errors:['$: not an object'],visibleChars:0};
 if(spec.version!==INSIGHT_VISUAL_VERSION)err('$',`version must be "${INSIGHT_VISUAL_VERSION}"`);
 if(!graphOnly){
  if(!str(spec.title,32))err('$','title <= 32');if(!str(spec.summary,70))err('$','summary <= 70');
  if(spec.title&&spec.title===spec.summary)err('$','summary repeats title');
  // Title and summary are evidence-bound just like every datum.
  for(const k of ['title','summary'] as const){const s=support(spec[k+'Basis'],'$.'+k);if(s.text&&typeof spec[k]==='string')grounded(spec[k],s,'$.'+k)}
 }
 if(!opts.blockOnly&&!(VISUAL_RELATIONS as readonly string[]).includes(spec.relation))err('$',`relation must be one of: ${VISUAL_RELATIONS.join(' ')}`);
 if(!opts.blockOnly&&spec.omitted!==undefined&&arr(spec.omitted,0,3,'$.omitted'))spec.omitted.forEach((o:any,i:number)=>{if(!str(o,30))err(`$.omitted.${i}`,'omitted item must be at most 30 characters')});
 if(arr(spec.blocks,1,3,'$.blocks'))spec.blocks.forEach((b:any,i:number)=>block(b,`blocks.${i}`));
 if(!opts.blockOnly&&notes>1)err('$','max 1 note');
 if(!opts.blockOnly&&visible>280)err('$',`visible chars ${visible} > 280`);
 const raw=JSON.stringify(spec,(k,v)=>k==='basis'||k.endsWith('Basis')?undefined:v);
 if(/https?:|www\.|<\/?[a-z!]|javascript:|on\w+=/i.test(raw))err('$','URL or markup in visible text');
 const allowedKeys=/"(action|onClick|href|src|html|script|style|url|command|execute)"\s*:/i;if(allowedKeys.test(JSON.stringify(spec)))err('$','action or markup field');
 // Dimensions the source itself lists must be shown or honestly declared omitted.
 const everything=[...shownText,...(graphOnly?[]:[spec.title,spec.summary])].join('\n'),omitted=(Array.isArray(spec.omitted)?spec.omitted:[]).join('\n');
 if(!opts.blockOnly)for(const dims of declaredDimensions(I)){
  const missing=dims.filter(d=>{const core=d.slice(0,Math.min(4,d.length));return !everything.includes(core)&&!omitted.includes(core)});
  // Only enforced when the visual shows any of that list (partial coverage is the failure).
  if(missing.length&&missing.length<dims.length)err('$',`required dimensions missing: ${missing.join('、')}`);
 }
 // A workday-qualified figure anywhere in the input must not be shown elsewhere without it.
 // Graph-wide: a companion block may carry the qualifier, so this runs on the whole graph, never in blockOnly.
 // The datum-local hedge/workday check in grounded() still applies to every isolated block.
 const allRefs=Object.values(refs).join('\n');
 if(!opts.blockOnly)for(const t of shownText)for(const n of t.match(/\d+(?:[–\-~～、]\d+)?/g)||[]){
  if(/^\d$/.test(n))continue;
  const base=n.split(/[–\-~～、]/)[0];
  const qualified=indexes(allRefs,base).some(at=>WORKDAY.test(allRefs.slice(at,at+14)));
  if(qualified&&!WORKDAY.test(t)&&!shownText.some(o=>o!==t&&o.includes(base)&&WORKDAY.test(o)))err('$',`figure ${n} shown without the workday qualifier stated in the source`);
 }
 return {valid:!errors.length,errors,visibleChars:visible};
}
function insideQuotes(src:string,at:number,quote:string){
 if(/^[「“"]/.test(quote)||/[」”"]$/.test(quote))return true;
 const open=Math.max(src.lastIndexOf('「',at),src.lastIndexOf('“',at)),close=Math.max(src.lastIndexOf('」',at-1),src.lastIndexOf('”',at-1));
 return open>close;
}
function indexes(text:string,needle:string){const out:number[]=[];let at=text.indexOf(needle);while(at>=0&&out.length<20){out.push(at);at=text.indexOf(needle,at+1)}return out}

/** Two cells may be drawn as one "same" cell only when the complete datum agrees and neither is unknown. */
export function sameDatum(a:Datum,b:Datum){
 if(!a||!b||['not-provided','pending'].includes(a.status)||['not-provided','pending'].includes(b.status))return false;
 const key=(d:Datum)=>JSON.stringify([d.text,d.status,d.qualifier??null,d.who??null,(d.basis||[]).map(x=>[x.ref,x.quote])]);
 return key(a)===key(b);
}
