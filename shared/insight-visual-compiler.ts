// Deterministic compiler from a model's visual plan to a displayable insight graph.
// It only applies known-equivalent grammar aliases and exact source-quote hydration, validates every block
// independently with the full datum guards, and keeps optional valid blocks when a sibling fails.
// It never invents content, trims cells/nodes inside a relational block, or changes a datum's status.
import {INSIGHT_VISUAL_VERSION,VISUAL_RELATIONS,validateInsightVisual,isGenericAbsent,type InsightReferences,type VisualBlock} from './insight-visual';

/** Bump whenever compiler behaviour changes; part of every cache fingerprint. */
export const INSIGHT_VISUAL_COMPILER='insight-visual-compiler-3';

export interface InsightGraph{version:string;relation:typeof VISUAL_RELATIONS[number];blocks:VisualBlock[];omitted?:string[]}
export type GraphMode='full'|'reduced'|'minimal';
export interface CompileIssue{path:string;errors:string[]}
export interface CompileQuality{
 mode:GraphMode|null;           // null = nothing displayable (original text fallback)
 informative:boolean;           // at least one block beyond note/quote
 primaryType:string|null;       // block type carrying the declared relation
 dropped:{index:number;type:string;reason:string[]}[];
 normalizations:{path:string;kind:string;from?:unknown;to?:unknown}[];
 issues:CompileIssue[];         // actionable diagnostics (JSON path + expected shape)
 omittedRaw?:unknown;           // model's omitted list when it could not be displayed as-is (kept privately)
 modelHeaders?:{title?:unknown;summary?:unknown}; // never displayed; the card keeps its saved title/summary
 failure?:string;
}
export interface CompileResult{graph:InsightGraph|null;quality:CompileQuality;score:number}

const BLOCK_TYPES=['values','compare','mapping','beforeAfter','document','boundary','dependencies','sequence','artifacts','claims','alternatives','schedule','stances','quote','matrix','note','split'];
/** Known spellings of the same grammar element. Nothing else is guessed. */
const BLOCK_ALIAS:Record<string,string>={comparison:'compare','before-after':'beforeAfter',before_after:'beforeAfter',beforeafter:'beforeAfter','annotated-document':'document','gated-sequence':'sequence',value:'values',dependency:'dependencies',artifact:'artifacts',claim:'claims',alternative:'alternatives',stance:'stances',timeline:'schedule'};
const RELATION_ALIAS:Record<string,string>={sequence:'gated-sequence',compare:'comparison',beforeAfter:'before-after',before_after:'before-after',document:'annotated-document',dependency:'dependencies',alternative:'alternatives',stance:'stances',claim:'claims',value:'values',artifact:'artifacts',timeline:'schedule'};
/** Deterministic block type -> relation. The first such block (note/quote excluded unless nothing else) is required. */
const BLOCK_RELATION:Record<string,string>={compare:'comparison',mapping:'mapping',beforeAfter:'before-after',document:'annotated-document',matrix:'annotated-document',boundary:'boundary',dependencies:'dependencies',sequence:'gated-sequence',artifacts:'artifacts',claims:'claims',alternatives:'alternatives',schedule:'schedule',stances:'stances',values:'values',quote:'quote'};
const MINIMAL=new Set(['note','quote']);
const NEGATION=/(未|尚未|没有|没|不|无|非|未能|并未)$/;
const bare=(s:unknown)=>String(s??'').replace(/[「」“”"『』\s]/g,'');
const len=(s:string)=>[...s].length;

/** Extract one JSON object from model text: optional code fence, then the first balanced {...}. No semantic repair. */
export function parseModelJson(text:string):{value?:any;error?:string}{
 const t=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
 const start=t.indexOf('{');if(start<0)return {error:'$: no JSON object found; output exactly one JSON object'};
 // Track {} and [] nesting so a closed-but-mismatched response is reported as such, not as truncation. No repair.
 const stack:string[]=[];let inStr=false,esc=false,end=-1;
 for(let i=start;i<t.length;i++){const c=t[i];
  if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue}
  if(c==='"')inStr=true;
  else if(c==='{'||c==='[')stack.push(c);
  else if(c==='}'||c===']'){const open=stack.pop(),want=open==='{'?'}':open==='['?']':undefined;
   if(want!==c)return {error:`$: malformed JSON: mismatched delimiter at offset ${i-start} (found "${c}", expected ${want?'"'+want+'"':'nothing'}); output a fresh, complete, valid JSON object`};
   if(!stack.length){end=i;break}}
 }
 if(inStr)return {error:'$: JSON object is truncated inside a string; output a shorter complete object with 1-2 blocks'};
 if(end<0)return {error:`$: JSON object is truncated (${stack.length} unclosed ${stack.length===1?'bracket':'brackets'}); output a shorter complete object with 1-2 blocks`};
 try{return {value:JSON.parse(t.slice(start,end+1))}}catch(e:any){return {error:'$: invalid JSON ('+String(e?.message||'parse error').slice(0,80)+')'}}
}

/** Datum locations whose displayed text must be a real source excerpt, with the maximum display length. */
function quoteSlots(b:any,path:string):{d:any;path:string;max:number}[]{
 const out:{d:any;path:string;max:number}[]=[];const push=(d:any,p:string,max:number)=>{if(d&&typeof d==='object')out.push({d,path:p,max})};
 if(!b||typeof b!=='object')return out;
 if(b.type==='document'&&Array.isArray(b.lines))b.lines.forEach((l:any,i:number)=>push(l,`${path}.lines.${i}`,90));
 if(b.type==='quote')push(b.line,`${path}.line`,70);
 if(b.type==='split'){out.push(...quoteSlots(b.left,path+'.left'),...quoteSlots(b.right,path+'.right'));return out}
 // Any other datum marked as a quotation is a 40-char slot (24 for table cells; validation enforces the real limit).
 const walk=(v:any,p:string)=>{if(Array.isArray(v))v.forEach((x,i)=>walk(x,`${p}.${i}`));else if(v&&typeof v==='object'){if(typeof v.text==='string'&&v.status==='quote'&&Array.isArray(v.basis)&&!out.some(o=>o.d===v))out.push({d:v,path:p,max:40});for(const [k,x] of Object.entries(v))if(k!=='basis')walk(x,`${p}.${k}`)}};
 walk(b,path);return out;
}
/** Replace a paraphrased quotation with its single, exact, un-truncated source excerpt when that is safe. */
function hydrateQuotes(b:any,path:string,refs:InsightReferences,norm:CompileQuality['normalizations']){
 for(const slot of quoteSlots(b,path)){
  const d=slot.d;if(d.status!=='quote'&&!(b.type==='document'&&['quote','fact'].includes(d.status)))continue;
  if(!Array.isArray(d.basis)||d.basis.length!==1)continue; // never concatenate excerpts or speakers
  const q=d.basis[0],src=typeof q?.ref==='string'&&Object.hasOwn(refs,q.ref)?refs[q.ref]:undefined;
  if(!src||typeof q.quote!=='string'||!q.quote.trim())continue;
  if(bare(q.quote).includes(bare(d.text))&&bare(d.text))continue; // already a verbatim excerpt
  const at=src.indexOf(q.quote);if(at<0||len(q.quote)>slot.max)continue;
  if(NEGATION.test(src.slice(Math.max(0,at-3),at)))continue; // excerpt would drop a preceding negation
  norm.push({path:slot.path+'.text',kind:'quote_hydrated',from:d.text,to:q.quote});d.text=q.quote;
 }
}
function normalizeBlock(b:any,path:string,norm:CompileQuality['normalizations']){
 if(!b||typeof b!=='object')return b;
 if(typeof b.type==='string'&&!BLOCK_TYPES.includes(b.type)&&BLOCK_ALIAS[b.type]){norm.push({path:path+'.type',kind:'type_alias',from:b.type,to:BLOCK_ALIAS[b.type]});b.type=BLOCK_ALIAS[b.type]}
 if(b.type==='split'){b.left=normalizeBlock(b.left,path+'.left',norm);b.right=normalizeBlock(b.right,path+'.right',norm)}
 return b;
}
const typesIn=(b:any):string[]=>b?.type==='split'?[...typesIn(b.left),...typesIn(b.right)]:[b?.type];

/** Compile one parsed model plan. Higher score = more fully valid independent semantic content. */
export function compileInsightVisual(raw:any,refs:InsightReferences):CompileResult{
 const quality:CompileQuality={mode:null,informative:false,primaryType:null,dropped:[],normalizations:[],issues:[]};
 const fail=(failure:string):CompileResult=>({graph:null,quality:{...quality,failure},score:0});
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){quality.issues.push({path:'$',errors:['must be one JSON object {version,relation,blocks}']});return fail('not_object')}
 const plan=JSON.parse(JSON.stringify(raw));
 if(plan.title!==undefined||plan.summary!==undefined)quality.modelHeaders={title:plan.title,summary:plan.summary};
 if(plan.version!==INSIGHT_VISUAL_VERSION){quality.normalizations.push({path:'$.version',kind:'version_set',from:plan.version,to:INSIGHT_VISUAL_VERSION});plan.version=INSIGHT_VISUAL_VERSION}
 if(typeof plan.relation==='string'&&!(VISUAL_RELATIONS as readonly string[]).includes(plan.relation)&&RELATION_ALIAS[plan.relation]){quality.normalizations.push({path:'$.relation',kind:'relation_alias',from:plan.relation,to:RELATION_ALIAS[plan.relation]});plan.relation=RELATION_ALIAS[plan.relation]}
 if(!Array.isArray(plan.blocks)||!plan.blocks.length){quality.issues.push({path:'$.blocks',errors:['must be an array of 1-3 blocks, each with "type"']});return fail('no_blocks')}
 const blocks=plan.blocks.slice(0,6).map((b:any,i:number)=>{const nb=normalizeBlock(b,`blocks.${i}`,quality.normalizations);hydrateQuotes(nb,`blocks.${i}`,refs,quality.normalizations);return nb});
 if(plan.blocks.length>3)quality.issues.push({path:'$.blocks',errors:['at most 3 blocks; prefer 1-2']});
 // Blocks beyond the sixth are never examined; each is recorded as dropped so the result cannot be "full".
 for(let i=6;i<plan.blocks.length;i++)quality.dropped.push({index:i,type:String(plan.blocks[i]?.type),reason:['beyond the 6-block input limit (not examined)']});
 // Relation is metadata derived from the drawing: the FIRST real primary block (not note/quote) defines it.
 // Supporting blocks never make it ambiguous; quote is primary only when nothing richer is present.
 const firstReal=(b:any)=>typesIn(b).find(t=>!MINIMAL.has(t)&&BLOCK_RELATION[t]);
 let primaryIdx=blocks.findIndex((b:any)=>!!firstReal(b));
 let canonical=primaryIdx>=0?BLOCK_RELATION[firstReal(blocks[primaryIdx])!]:undefined;
 if(primaryIdx<0){primaryIdx=blocks.findIndex((b:any)=>typesIn(b).includes('quote'));canonical=primaryIdx>=0?'quote':undefined}
 if(!canonical){quality.issues.push({path:'$.blocks',errors:['needs at least one primary block: '+Object.keys(BLOCK_RELATION).join(' ')]});return fail('primary_missing')}
 if(plan.relation!==canonical){quality.normalizations.push({path:'$.relation',kind:'relation_canonicalized',from:plan.relation??null,to:canonical});plan.relation=canonical}
 // Independent block validation with the full datum guards (relation is not part of block validity).
 const results=blocks.map((b:any,i:number)=>{const v=validateInsightVisual({version:INSIGHT_VISUAL_VERSION,relation:plan.relation,blocks:[b]},refs,{blockOnly:true});return {b,i,errors:v.errors.map(e=>e.replace(/^blocks\.0/,`blocks.${i}`))}});
 quality.primaryType=primaryIdx>=0?results[primaryIdx].b.type:null;
 for(const r of results)if(r.errors.length)quality.issues.push({path:`blocks.${r.i}`,errors:r.errors});
 if(results[primaryIdx].errors.length)return fail('primary_invalid');
 let kept=results.filter((r:{errors:string[]},i:number)=>!r.errors.length&&i<6);
 for(const r of results.filter((r:{errors:string[]})=>r.errors.length))quality.dropped.push({index:r.i,type:String(r.b?.type),reason:r.errors.slice(0,6)});
 // Optional supporting blocks beyond 3, extra notes, or over the visible budget are dropped whole, last first.
 const isPrimary=(r:{i:number})=>r.i===results[primaryIdx].i;
 const dropOptional=(reason:string,pred:(r:any)=>boolean)=>{for(let k=kept.length-1;k>=0;k--)if(!isPrimary(kept[k])&&pred(kept[k])){quality.dropped.push({index:kept[k].i,type:String(kept[k].b?.type),reason:[reason]});kept.splice(k,1);return true}return false};
 while(kept.length>3&&dropOptional('more than 3 blocks',()=>true)){}
 while(kept.filter((r:any)=>r.b.type==='note').length>1&&dropOptional('more than one note',(r:any)=>r.b.type==='note')){}
 // Omitted list: displayed only when valid; otherwise preserved privately and the declared-axes check decides.
 let omitted:string[]|undefined;
 if(plan.omitted!==undefined){const ok=Array.isArray(plan.omitted)&&plan.omitted.length<=3&&plan.omitted.every((o:any)=>typeof o==='string'&&o.trim()&&len(o)<=30);
  if(ok&&plan.omitted.length)omitted=plan.omitted;else if(!ok){quality.omittedRaw=plan.omitted;quality.normalizations.push({path:'$.omitted',kind:'omitted_not_displayed'})}}
 const assemble=()=>({version:INSIGHT_VISUAL_VERSION,relation:plan.relation,blocks:kept.map((r:any)=>r.b),...(omitted?{omitted}:{})});
 let check=validateInsightVisual(assemble(),refs,{graphOnly:true});
 while(!check.valid&&check.errors.every(e=>/^\$: visible chars/.test(e))&&dropOptional('over the visible text budget',()=>true))check=validateInsightVisual(assemble(),refs,{graphOnly:true});
 if(!check.valid){quality.issues.push({path:'$',errors:check.errors});return fail(check.errors.some(e=>e.includes('required dimensions'))?'required_axes':'assembled_invalid')}
 const graph=assemble() as InsightGraph;
 // Stable shared shape: an honest generic absence always carries basis:[].
 const canon=(v:any):void=>{if(Array.isArray(v))v.forEach(canon);else if(v&&typeof v==='object'){if(isGenericAbsent(v)&&v.basis===undefined)v.basis=[];for(const [k,x] of Object.entries(v))if(k!=='basis')canon(x)}};canon(graph.blocks);
 quality.informative=graph.blocks.some(b=>typesIn(b).some(t=>!MINIMAL.has(t)));
 quality.mode=!quality.informative?'minimal':quality.dropped.length?'reduced':'full';
 const score=1000+(quality.informative?100:0)+graph.blocks.length*10-quality.dropped.length;
 return {graph,quality,score};
}

/** Actionable repair text: only invalid parts, with JSON paths and expected shapes. */
export function repairDiagnostics(q:CompileQuality){
 return q.issues.slice(0,12).map(i=>({path:i.path,errors:i.errors.slice(0,6)}));
}
