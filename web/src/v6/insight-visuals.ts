import React from 'react';
import {validateInsightGraph} from '../../../shared/insight-visual';
import type {InsightGraph,GraphMode} from '../../../shared/insight-visual-compiler';

// publication: present only when a new insight is withheld because its visual failed (cause code only).
export type VisualEntry={state:'ready'|'pending'|'fallback'|'unavailable';spec?:InsightGraph;mode?:GraphMode|null;informative?:boolean;publication?:{status:string;cause:string|null;retryable:boolean;running?:boolean}};
/** The client re-checks the spec against the record's own saved text before drawing anything; never throws. */
export function readyVisual(entry:VisualEntry|undefined,idea:{title?:string;description?:string;evidence?:any[]}):InsightGraph|null{
 try{
  if(entry?.state!=='ready'||!entry.spec)return null;
  const refs:Record<string,string>={I:(String(idea.title||'')+'\n'+String(idea.description||'')).slice(0,4000)};
  (Array.isArray(idea.evidence)?idea.evidence:[]).filter((e:any)=>e&&typeof e.sourceId==='string'&&typeof e.quote==='string'&&e.quote.trim()).slice(0,6).forEach((e:any,i:number)=>{refs['E'+i]=String(e.quote).slice(0,600)});
  return validateInsightGraph(entry.spec,refs).valid?entry.spec:null;
 }catch{return null}
}
/** A rendering error in one visual falls back to the card's saved text instead of breaking the feed. */
export class VisualBoundary extends React.Component<{fallback:React.ReactNode;children:React.ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?this.props.fallback:this.props.children}
}
