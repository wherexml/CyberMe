import React,{useEffect,useState} from 'react';
import {api} from './store';
import {validateInsightGraph} from '../../../shared/insight-visual';
import type {InsightGraph,GraphMode} from '../../../shared/insight-visual-compiler';

// Read-only: GET never triggers generation.
// Every workspace revision clears what was shown and invalidates older responses, so a revoked source never flashes an old visual.
// While items are still pending (generation finishes without a workspace change), the projection is polled, bounded.
export type VisualEntry={state:'ready'|'pending'|'fallback'|'unavailable';spec?:InsightGraph;mode?:GraphMode|null;informative?:boolean};
const POLL_MS=6000,POLL_MAX=40;
let items:Record<string,VisualEntry>={},shownRevision:unknown,generation=0,inflight=false,again=false,polls=0,timer:ReturnType<typeof setTimeout>|undefined;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(f=>f());

async function load(){
 if(inflight){again=true;return}
 inflight=true;const mine=generation;
 try{
  const r=await api<{items:Record<string,VisualEntry>}>('GET','/api/ideas/visuals',undefined,AbortSignal.timeout(15000));
  if(mine===generation){items=r?.items||{};emit()}
 }catch{if(mine===generation){items={};emit()}}
 finally{inflight=false}
 if(again){again=false;return load()}
 schedule();
}
function schedule(){
 clearTimeout(timer);
 if(!listeners.size||polls>=POLL_MAX||!Object.values(items).some(x=>x.state==='pending'))return;
 timer=setTimeout(()=>{polls++;void load()},POLL_MS);
}
function onRevision(revision:unknown){
 // Remount with the same revision resumes pending polling instead of stalling.
 if(revision===shownRevision){if(!inflight)schedule();return}
 shownRevision=revision;generation++;polls=0;items={};emit();void load();
}
export function useInsightVisuals(revision:unknown){
 const [,tick]=useState(0);
 useEffect(()=>{const f=()=>tick(x=>x+1);listeners.add(f);onRevision(revision);return()=>{listeners.delete(f);if(!listeners.size)clearTimeout(timer)}},[revision]);
 // Before the effect runs for a new revision, nothing from the old revision may render (no stale frame).
 return revision===shownRevision?items:{};
}
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
