// Optional, typed visual payloads for CyberMe V6 cards. Production never invents
// these: a card renders a visual only when a persisted record carries one that was
// produced from real, linked data. The public acceptance fixture supplies the V6
// reference sample through the same fields and the same components.
export type V6Pair=[string,string]; // [en, zh]
export type V6Text=string|V6Pair;

export type DecisionVisual=
 |{kind:'accts';rows:{name:string;sub:V6Text;date:V6Text;hot?:boolean}[];dateLabel?:V6Text} // dateLabel defaults to the reference "Renews"
 |{kind:'quiet';rows:{name:string;company:string;days:number;date:V6Text}[]}
 |{kind:'gantt';months:V6Text[];need:[number,number];needLabel:V6Text;spans:([number,number]|null)[];short:V6Text[]};
export interface DecisionMeters{axes:[V6Text,V6Text];values:[number,number][]}

export type InsightVisual=
 |{kind:'renew';rows:{name:string;lastDaysAgo:number;renewInDays:number;date:V6Text;done?:boolean}[]}
 |{kind:'cal';day:V6Text;blocks:{label:V6Text;startPct:number;widthPct:number;dim?:boolean}[];overlap?:{startPct:number;widthPct:number};ticks:string[]}
 |{kind:'sig';have:number;need:number};

export type GalleryVisual=
 |{kind:'lanes';range:[number,number];lanes:{label:V6Text;blocks:{label:V6Text;start:number;end:number;color:string}[]}[]}
 |{kind:'trip';from:string;fromCity:V6Text;dep:string;to:string;toCity:V6Text;arr:string;dur:V6Text;chips:{icon:string;label:V6Text}[]}
 |{kind:'focus';load:number[][];freeDay?:number;freeRows?:number;startHour?:number}
 |{kind:'bars';bars:number[];startLabel?:number;threshold?:number;legA:V6Text;legB:V6Text}
 |{kind:'people';person:string;lead:string;role:V6Text;months:number[];m0:V6Text;m1:V6Text}
 |{kind:'ring';pct:number;ringN:string;ringL:V6Text;checks:{label:V6Text;done:boolean}[]}
 |{kind:'spend';rows:{brand?:string;name:string;used:number;total:number;cost:string}[]}
 |{kind:'read';rows:{title:V6Text;source:string;minutes:number;color:string}[];total:number}
 |{kind:'reflect';quote:V6Text;goals:{label:V6Text;state:V6Text;tone:'ok'|'warn'|'off'}[]};

export type WorkVisual=
 |{kind:'drafts';rows:{to:string;company?:string;subject:V6Text;preview:V6Text;color?:string}[]}
 |{kind:'compare';rows:{name:string;where:V6Text;drive:V6Text;dates:V6Text;price:string;per?:V6Text;fit:number;best?:boolean}[]}
 |{kind:'stats';tiles:{value:string;label:V6Text;color?:string}[];events:{date:V6Text;text:V6Text}[]}
 |{kind:'moves';rows:{name:V6Text;from:string;to:string;rsvp:'yes'|'wait'}[]};

export const V6_GALLERY_KINDS=['lanes','trip','focus','bars','people','ring','spend','read','reflect'] as const;
export const V6_WORK_KINDS=['drafts','compare','stats','moves'] as const;

function pair(value:unknown):boolean{return typeof value==='string'||Array.isArray(value)&&value.length===2&&value.every(v=>typeof v==='string');}
// Exact per-variant validation of every nested field the renderers read (types, finite numbers, ranges).
type Check=(v:any)=>boolean;
const MAX=200;
const txt:Check=pair;
const str:Check=v=>typeof v==='string'&&v.length<=4000;
const num=(min=-Infinity,max=Infinity):Check=>v=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const opt=(c:Check):Check=>v=>v===undefined||c(v);
const bool:Check=v=>typeof v==='boolean';
const list=(c:Check,min=0):Check=>v=>Array.isArray(v)&&v.length>=min&&v.length<=MAX&&v.every(c);
const tuple=(...cs:Check[]):Check=>v=>Array.isArray(v)&&v.length===cs.length&&cs.every((c,i)=>c(v[i]));
const oneOf=(...xs:string[]):Check=>v=>xs.includes(v);
const obj=(shape:Record<string,Check>):Check=>v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(shape).every(([k,c])=>c(v[k]));
const pct=num(0,100),unit=num(0,1),count=num(0,1e9),hour=num(0,24);
const VARIANTS:Record<string,Check>={
 accts:obj({rows:list(obj({name:str,sub:txt,date:txt,hot:opt(bool)}),1),dateLabel:opt(txt)}),
 quiet:obj({rows:list(obj({name:str,company:str,days:count,date:txt}),1)}),
 gantt:v=>obj({months:list(txt,1),need:tuple(num(0,48),num(0,48)),needLabel:txt,spans:list(x=>x===null||tuple(num(0,48),num(0,48))(x)),short:list(txt)})(v)&&v.need[0]<=v.need[1]&&v.spans.length===v.short.length,
 renew:obj({rows:list(obj({name:str,lastDaysAgo:count,renewInDays:count,date:txt,done:opt(bool)}),1)}),
 cal:obj({day:txt,blocks:list(obj({label:txt,startPct:pct,widthPct:pct,dim:opt(bool)}),1),overlap:opt(obj({startPct:pct,widthPct:pct})),ticks:list(str)}),
 sig:v=>obj({have:count,need:num(1,1e6)})(v)&&v.have<=1000,
 lanes:v=>obj({range:tuple(hour,hour),lanes:list(obj({label:txt,blocks:list(obj({label:txt,start:hour,end:hour,color:str}))}),1)})(v)&&v.range[0]<v.range[1],
 trip:obj({from:str,fromCity:txt,dep:str,to:str,toCity:txt,arr:str,dur:txt,chips:list(obj({icon:str,label:txt}))}),
 focus:obj({load:list(list(num(0,10)),1),freeDay:opt(count),freeRows:opt(count),startHour:opt(hour)}),
 bars:obj({bars:list(count,1),startLabel:opt(count),threshold:opt(count),legA:txt,legB:txt}),
 people:obj({person:str,lead:str,role:txt,months:list(count,1),m0:txt,m1:txt}),
 ring:obj({pct,ringN:str,ringL:txt,checks:list(obj({label:txt,done:bool}))}),
 spend:obj({rows:list(obj({brand:opt(str),name:str,used:count,total:num(1,1e9),cost:str}),1)}),
 read:obj({rows:list(obj({title:txt,source:str,minutes:count,color:str}),1),total:num(1,1e9)}),
 reflect:obj({quote:txt,goals:list(obj({label:txt,state:txt,tone:oneOf('ok','warn','off')}))}),
 drafts:obj({rows:list(obj({to:str,company:opt(str),subject:txt,preview:txt,color:opt(str)}),1)}),
 compare:obj({rows:list(obj({name:str,where:txt,drive:txt,dates:txt,price:str,per:opt(txt),fit:unit,best:opt(bool)}),1)}),
 stats:obj({tiles:list(obj({value:str,label:txt,color:opt(str)}),1),events:list(obj({date:txt,text:txt}))}),
 moves:obj({rows:list(obj({name:txt,from:str,to:str,rsvp:oneOf('yes','wait')}),1)}),
};
/** Defensive guard: unknown kinds and any malformed nested field (missing rows, wrong row shape, NaN/out of range) are ignored. */
export function readVisual<T extends {kind:string}>(value:unknown,kinds:readonly string[]):T|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const kind=(value as any).kind;
 if(typeof kind!=='string'||!kinds.includes(kind)||!Object.hasOwn(VARIANTS,kind))return null;
 try{return VARIANTS[kind](value)?value as T:null}catch{return null}
}
export interface V6Step{short:V6Text;label:V6Text;detail:V6Text;done:boolean;run:boolean}
/** Work steps from a record's own `v6.steps` (`{s,l,d,done?,run?}` or `{short,label,detail,...}`); null when any step is malformed. */
export function readSteps(value:unknown):V6Step[]|null{
 if(!Array.isArray(value)||!value.length||value.length>12)return null;const out:V6Step[]=[];
 for(const x of value as any[]){if(!x||typeof x!=='object'||Array.isArray(x))return null;const short=x.s??x.short,label=x.l??x.label,detail=x.d??x.detail??'';
  if(!pair(short)||!pair(label)||!pair(detail)||(x.done!==undefined&&typeof x.done!=='boolean')||(x.run!==undefined&&typeof x.run!=='boolean'))return null;
  out.push({short,label,detail,done:!!x.done,run:!!x.run});}
 return out;
}
/** Meters for decision options: two axis labels and finite [0,1]-clamped value pairs. */
export function readMeters(value:unknown):DecisionMeters|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const m=value as any;
 if(!Array.isArray(m.axes)||m.axes.length!==2||!m.axes.every(pair)||!Array.isArray(m.values))return null;
 if(!m.values.every((v:unknown)=>Array.isArray(v)&&v.length===2&&v.every(n=>typeof n==='number'&&Number.isFinite(n))))return null;
 return {axes:m.axes,values:m.values.map((v:[number,number])=>v.map(n=>Math.max(0,Math.min(1,n))) as [number,number])};
}
export function v6Text(value:V6Text|undefined,zh:boolean):string{if(value===undefined)return '';if(!pair(value))return '';return Array.isArray(value)?value[zh?1:0]:value;}
