// Strict, allowlisted contract for the independent semantic review of one compiled insight graph.
// Fails closed: anything other than a complete, well-formed verdict is treated as unusable.
import {createHash} from 'node:crypto';
import {parseModelJson} from '../../shared/insight-visual-compiler';
import {REVIEW_CHECKS,REVIEW_CODES} from './insight-visual-skill';

export interface ReviewIssue{path:string;code:string;refs:string[];basis:{ref:string;quote:string}[];note:string}
export type ReviewOutcome={state:'pass';issues:[]}|{state:'reject';issues:ReviewIssue[]}|{state:'invalid';error:string};

export const graphHash=(graph:unknown)=>createHash('sha256').update(JSON.stringify(graph)).digest('hex');
export const refsHash=(refs:Record<string,string>)=>createHash('sha256').update(JSON.stringify(refs)).digest('hex');

/** Resolve a dotted path ("$", "blocks.0.rows.1.target", "blocks[0].edges[1]") inside the graph. */
export function pathExists(graph:any,path:string){
 if(path==='$')return true;
 const parts=path.replace(/^\$\.?/,'').replace(/\[(\d+)\]/g,'.$1').split('.').filter(Boolean);
 if(!parts.length||parts.length>12)return false;
 let cur:any=graph;
 for(const p of parts){
  if(cur===null||typeof cur!=='object')return false;
  if(Array.isArray(cur)){if(!/^\d+$/.test(p)||Number(p)>=cur.length)return false;cur=cur[Number(p)]}
  else{if(!Object.hasOwn(cur,p))return false;cur=cur[p]}
 }
 return true;
}

export function parseReview(text:string,graph:any,refs:Record<string,string>):ReviewOutcome{
 const parsed=parseModelJson(text);if(parsed.error)return {state:'invalid',error:'review_parse'};
 const v=parsed.value;
 if(!v||typeof v!=='object'||Array.isArray(v))return {state:'invalid',error:'review_shape'};
 const keys=Object.keys(v).sort().join(',');if(keys!=='checked,issues,verdict')return {state:'invalid',error:'review_keys'};
 if(!['pass','reject'].includes(v.verdict))return {state:'invalid',error:'review_verdict'};
 if(!Array.isArray(v.checked)||v.checked.length!==REVIEW_CHECKS.length||new Set(v.checked).size!==REVIEW_CHECKS.length||!REVIEW_CHECKS.every(c=>v.checked.includes(c)))return {state:'invalid',error:'review_checks_incomplete'};
 if(!Array.isArray(v.issues)||v.issues.length>20)return {state:'invalid',error:'review_issues_shape'};
 const issues:ReviewIssue[]=[];
 for(const i of v.issues){
  if(!i||typeof i!=='object'||Array.isArray(i))return {state:'invalid',error:'review_issue_shape'};
  if(Object.keys(i).sort().join(',')!=='basis,code,note,path,refs')return {state:'invalid',error:'review_issue_keys'};
  if(typeof i.path!=='string'||!pathExists(graph,i.path))return {state:'invalid',error:'review_unknown_path'};
  if(!(REVIEW_CODES as readonly string[]).includes(i.code))return {state:'invalid',error:'review_code'};
  if(!Array.isArray(i.refs)||!i.refs.length||i.refs.length>3||i.refs.some((r:any)=>typeof r!=='string'||!Object.hasOwn(refs,r)))return {state:'invalid',error:'review_refs'};
  // Every rejection carries verbatim source evidence; the reviewer's own assertion is not authority.
  if(!Array.isArray(i.basis)||!i.basis.length||i.basis.length>3)return {state:'invalid',error:'review_basis'};
  for(const b of i.basis){
   if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='quote,ref')return {state:'invalid',error:'review_basis_shape'};
   if(typeof b.ref!=='string'||!Object.hasOwn(refs,b.ref)||typeof b.quote!=='string'||[...b.quote.trim()].length<2||[...b.quote].length>200||!refs[b.ref].includes(b.quote))return {state:'invalid',error:'review_basis_not_verbatim'};
  }
  const basisRefs=[...new Set(i.basis.map((b:any)=>b.ref))].sort(),listed=[...new Set<string>(i.refs)].sort();
  if(basisRefs.join(',')!==listed.join(','))return {state:'invalid',error:'review_refs_mismatch'};
  if(typeof i.note!=='string'||!i.note.trim()||[...i.note].length>120)return {state:'invalid',error:'review_note'};
  issues.push({path:i.path,code:i.code,refs:listed,basis:i.basis.map((b:any)=>({ref:b.ref,quote:b.quote})),note:i.note.trim()});
 }
 if(v.verdict==='pass')return issues.length?{state:'invalid',error:'review_pass_with_issues'}:{state:'pass',issues:[]};
 return issues.length?{state:'reject',issues}:{state:'invalid',error:'review_reject_without_issues'};
}
