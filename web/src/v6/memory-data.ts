import {useSyncExternalStore} from 'react';
import {api,enc,type Doc} from './store';

// Session-only cache: survive tab switches, never persist personal documents in UI storage.
type Resource<T>={value?:T;loading:boolean;error:boolean};
export type PersonProfile={id:string;name:string;aliases:string[];role:string;relationship:string;reviewedAt:string;markdown:string;truncated:boolean;observations:{key:string;summary:string;kind:string;eventAt:string|null;evidence:{sourceId:string;messageId:string|null;quote:string;actor:string;eventAt:string|null}[]}[]};
export type PeopleLibrary={owner:{name:string;aliases:string[];role:string;about:string};incomplete:boolean;people:PersonProfile[]};
type State={soul:Resource<Doc>;memory:Resource<Doc>;automatic:Resource<any[]>;people:Resource<PeopleLibrary>;forgetting:boolean};
type Key='soul'|'memory'|'automatic'|'people';
let state:State={soul:{loading:false,error:false},memory:{loading:false,error:false},automatic:{loading:false,error:false},people:{loading:false,error:false},forgetting:false};
const listeners=new Set<()=>void>();
const requests:Partial<Record<Key,{controller:AbortController;promise:Promise<void>}>>={};
const generations:Record<Key,number>={soul:0,memory:0,automatic:0,people:0};
function publish(key:Key,value:Resource<any>){state={...state,[key]:value};listeners.forEach(fn=>fn());}
function invalidate(key:Key){generations[key]++;requests[key]?.controller.abort();delete requests[key];}
export const memorySnapshot=()=>state;
export function useMemoryData(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn)}},memorySnapshot);}
async function read(key:Key){
 if(key==='automatic'&&state.forgetting)return;
 if(requests[key])return requests[key]!.promise;
 const generation=++generations[key],controller=new AbortController();
 publish(key,{...state[key],loading:true});
 const timeout=window.setTimeout(()=>controller.abort(),12000);
 const promise=(async()=>{try{
  const response=await api('GET',key==='people'?'/api/memory-library/people':key==='automatic'?'/api/memories/automatic':'/api/settings/documents/'+key,undefined,controller.signal);
  if(key==='people'?!Array.isArray(response?.people)||typeof response?.owner?.name!=='string':key==='automatic'?!Array.isArray(response?.items):typeof response?.content!=='string'||typeof response?.version!=='string')throw Error('Invalid memory response');
  if(generation===generations[key])publish(key,{value:key==='automatic'?response.items:response,loading:false,error:false});
 }catch{if(generation===generations[key])publish(key,{...state[key],loading:false,error:true});}
 finally{clearTimeout(timeout);if(generation===generations[key])delete requests[key];}})();
 requests[key]={controller,promise};return promise;
}
export async function refreshMemory(){await Promise.all(['soul','memory','automatic','people'].map(k=>read(k as Key)));return state;}
export function cacheMemoryDocument(kind:'soul'|'memory',value:Doc){invalidate(kind);publish(kind,{value,loading:false,error:false});}
export async function forgetMemory(id:string,version:string){
 if(state.forgetting)return;
 invalidate('automatic');state={...state,forgetting:true};publish('automatic',{...state.automatic,loading:false});
 try{
  await api('POST','/api/memories/automatic/'+enc(id)+'/revoke',{version,action:'forget'},AbortSignal.timeout(12000));
  publish('automatic',{value:state.automatic.value?.filter(m=>m.id!==id),loading:false,error:false});
 }finally{
  state={...state,forgetting:false};publish('automatic',state.automatic);
  // Lost POST response may already have committed: reconcile with GET, never replay POST.
  void read('automatic');
 }
}
