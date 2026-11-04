// Grounded V6 visuals for real records that carry no `v6.visual`. Each mapping uses only fields the
// record (or its linked records) actually has; when the evidence is missing the card shows no diagram
// rather than an invented one. The result goes through the same shared validator as persisted visuals.
import type {Idea,InboxItem} from '../../../shared/types';
import {readVisual,type DecisionVisual,type GalleryVisual,type V6Pair} from '../../../shared/v6-visuals';
import {plain} from './md';

const time=(v:unknown)=>{const t=typeof v==='string'||typeof v==='number'?Date.parse(String(v)):NaN;return Number.isFinite(t)?t:undefined};
const day=(t:number):V6Pair=>{const d=new Date(t);return [d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),`${d.getMonth()+1}/${d.getDate()}`]};
const month=(t:number):V6Pair=>{const d=new Date(t);return [d.toLocaleDateString('en-US',{month:'short'}),`${d.getMonth()+1} 月`]};
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).map(w=>Array.from(w)[0]||'').join('').slice(0,2).toUpperCase()||'?';
const messagesOf=(item:InboxItem)=>(Array.isArray((item as any).messages)?(item as any).messages:[]) as any[];

/** Decision: the people in the item's own source thread, latest message per sender (the newest is highlighted). */
export function deriveDecision(item:InboxItem):DecisionVisual|null{
 const by=new Map<string,{text:string;at:number}>();
 for(const m of messagesOf(item)){const name=String(m.sender||m.from||'').trim();const at=time(m.time||m.createdAt||m.sentAt);const text=plain(String(m.text||m.body||m.content||''),80);
  if(!name||at===undefined||!text)continue;const prev=by.get(name);if(!prev||at>=prev.at)by.set(name,{text,at});}
 if(by.size<2)return null;
 const rows=[...by.entries()].sort((a,b)=>b[1].at-a[1].at).slice(0,4);
 // These are message times, not renewal dates, so the date column is labelled as such.
 return readVisual<DecisionVisual>({kind:'accts',dateLabel:['Last message','最近消息'],rows:rows.map(([name,v],i)=>({name,sub:v.text,date:day(v.at),hot:i===0}))},['accts']);
}

/** Inspiration: when every explicitly linked source belongs to one contact (stable sender id when present),
 *  the monthly rhythm of those linked sources only — never other Inbox items that merely share a display name. */
export function deriveGallery(idea:Idea,inbox:InboxItem[]):GalleryVisual|null{
 const ids:string[]=Array.isArray((idea as any).sourceIds)?(idea as any).sourceIds:[];
 const sources=ids.map(id=>inbox.find(x=>x.id===id)).filter(Boolean) as InboxItem[];
 if(sources.length<2||sources.length!==ids.length)return null;
 const key=(s:InboxItem)=>{const id=(s as any).senderId;return typeof id==='string'&&id?'id:'+id:''};
 const keys=new Set(sources.map(key));if(keys.size!==1||keys.has(''))return null;
 const person=String(sources[0].sender||'').trim();if(!person)return null;
 const now=new Date();const s0=new Date(now.getFullYear(),now.getMonth()-11,1);const months=new Array(12).fill(0);
 for(const it of sources){const at=time((it as any).receivedAt||it.createdAt);if(at===undefined||at<s0.getTime())continue;const d=new Date(at);const i=(d.getFullYear()-s0.getFullYear())*12+d.getMonth()-s0.getMonth();if(i>=0&&i<12)months[i]++;}
 if(!months.some(Boolean))return null;
 return readVisual<GalleryVisual>({kind:'people',person,lead:initials(person),role:String(sources[0].channel||''),months:months.map(n=>Math.min(3,n)),m0:month(s0.getTime()),m1:month(now.getTime())},['people']);
}
