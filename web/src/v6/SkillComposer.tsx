// Composer skill picker. A slash token (`/query` or `/skill:query`) that starts at the beginning of the draft or right
// after whitespace, with the caret inside it, opens a searchable list from the real GET /api/skills catalog (metadata
// only). Choosing stores {id,name} beside the draft and removes only that token from the textarea text (prefix and
// suffix bytes kept); the textarea is never rewritten as rich text. The send path serializes the choice as the existing
// leading `/skill:name` command. Nothing here reads a skill body, posts, runs a model or grants execution.
import React,{useEffect,useRef,useSyncExternalStore} from 'react';
import {api} from './store';
import {I} from './icons';

export interface SkillRow{id:string;name:string;description:string;source:string;manualOnly:boolean}
export interface SkillPick{id:string;name:string}
/** Server invocation grammar (server/src/skill-catalog.ts parseSkillInvocation). */
export const SKILL_NAME=/^[A-Za-z0-9][\w.-]{0,79}$/;
export const isSkillPick=(v:any):v is SkillPick=>!!v&&typeof v==='object'&&typeof v.id==='string'&&!!v.id&&typeof v.name==='string'&&SKILL_NAME.test(v.name);
export const sameSkill=(a?:SkillPick|null,b?:SkillPick|null)=>(a?.id||null)===(b?.id||null)&&(a?.name||null)===(b?.name||null);
/** The canonical command the backend already resolves; placed at the very start of the message. */
export const skillCommand=(s:SkillPick)=>'/skill:'+s.name;

// ---------- catalog (one shared cache; newest response wins) ----------
type Cat={status:'idle'|'loading'|'ready'|'error';items:SkillRow[];error:string};
let cat:Cat={status:'idle',items:[],error:''};let seq=0;let flight:AbortController|null=null;
const subs=new Set<()=>void>();
const put=(c:Cat)=>{cat=c;subs.forEach(f=>f())};
const subscribe=(f:()=>void)=>{subs.add(f);return()=>{subs.delete(f)}};
const rows=(data:any):SkillRow[]=>(Array.isArray(data?.items)?data.items:[]).filter((s:any)=>s&&typeof s.id==='string'&&typeof s.name==='string'&&SKILL_NAME.test(s.name))
 .map((s:any)=>({id:s.id,name:s.name,description:typeof s.description==='string'?s.description:'',source:typeof s.source==='string'?s.source:'',manualOnly:s.manualOnly===true}));
/** Fetches the current catalog. A failure clears old suggestions instead of showing stale rows. */
export async function fetchSkills():Promise<SkillRow[]>{
 const n=++seq;flight?.abort();const ctl=new AbortController();flight=ctl;const timer=setTimeout(()=>ctl.abort(),15000);
 put({status:'loading',items:cat.items,error:''});
 try{const items=rows(await api('GET','/api/skills',undefined,ctl.signal));if(n===seq)put({status:'ready',items,error:''});return items}
 catch(e:any){if(n===seq)put({status:'error',items:[],error:ctl.signal.aborted?'timeout':String(e?.message||e)});throw e}
 finally{clearTimeout(timer);if(flight===ctl)flight=null}
}
export const useSkillCatalog=()=>useSyncExternalStore(subscribe,()=>cat);

// ---------- slash query ----------
/** The slash token holding the caret, else null. A token starts at index 0 or right after any whitespace (space,
 *  tab, newline, full-width space; indentation alone never suppresses it), so `你好/sub`, `\/sub`, URLs and `a/b` never
 *  match; it runs to the next whitespace. The query may be any short non-whitespace text (Chinese included, to search
 *  descriptions) but never contains a path separator, a colon (URLs, `/skill:x:y`), quotes or backticks. Explicit
 *  quote lines (`>`) and code stay inert: see codeContext. `start` is the token's `/`; `end` is its first index after
 *  the token. What is chosen and sent is always the canonical ASCII name. */
const QUERY_BAD=/[\/\\:`'"“”‘’<>]/;
const FENCE=/^[ \t]*(`{3,}|~{3,})(.*)$/;
/** True when index `s` sits on a fence line, inside an unclosed fenced block, or inside an inline backtick span.
 *  A fence closes only on a line holding the same character repeated at least as many times with nothing else
 *  (info strings of backtick fences may not contain backticks). An inline span opened by N backticks closes at the next
 *  run of exactly N on that line (so ``a ` b`` is one span); an unclosed run before the token is treated as code
 *  being typed and stays inert. Boundary: inline spans are scanned only on the current line, from its start to the
 *  slash (spans crossing lines are not recognized); every pass is linear in the draft length. */
function codeContext(text:string,s:number):boolean{
 const ls=text.lastIndexOf('\n',s-1)+1;let open:{ch:string;n:number}|null=null;
 for(const l of text.slice(0,ls).split('\n').slice(0,-1)){const m=l.match(FENCE);if(!m)continue;const ch=m[1][0],n=m[1].length;
  if(!open){if(ch==='`'&&m[2].includes('`'))continue;open={ch,n}}else if(ch===open.ch&&n>=open.n&&!m[2].trim())open=null}
 if(open)return true;
 const le=text.indexOf('\n',s),line=text.slice(ls,le<0?text.length:le);const fm=line.match(FENCE);
 if(fm&&!(fm[1][0]==='`'&&fm[2].includes('`')))return true;
 // One linear pass over the current line's prefix before the slash: `open` is the opening run length (0 = outside);
 // only a run of exactly that length closes it, other runs inside a span are literal. Still open at the slash means the
 // token is inside a span, or after an unclosed run (code being typed); both stay inert.
 let open2=0;for(let i=ls;i<s;){if(text[i]!=='`'){i++;continue}let j=i;while(j<s&&text[j]==='`')j++;const n=j-i;
  if(!open2)open2=n;else if(n===open2)open2=0;i=j}
 return open2>0;
}
export function slashQuery(text:string,start:number,end:number):{query:string;start:number;end:number}|null{
 if(start!==end||start<1||start>text.length)return null;
 let s=start;while(s>0&&!/\s/.test(text[s-1]))s--;
 if(text[s]!=='/'||start===s)return null;
 const m=text.slice(s).match(/^\/(?:skill:)?(\S*)/);if(!m)return null;
 const tokenEnd=s+m[0].length;if(start>tokenEnd)return null;
 const q=m[1];if(q.length>80||QUERY_BAD.test(q))return null;
 const ls=text.lastIndexOf('\n',s-1)+1,le=text.indexOf('\n',s),line=text.slice(ls,le<0?text.length:le);
 if(/^\s*>/.test(line)||codeContext(text,s))return null;
 return {query:q.toLowerCase(),start:s,end:tokenEnd};
}
/** Exact name, then name prefix, then name substring, then description/source; ties by name. No cap. */
export function rankSkills(items:SkillRow[],query:string):SkillRow[]{
 const q=query.toLowerCase();
 const score=(s:SkillRow)=>{const n=s.name.toLowerCase();if(!q)return 0;if(n===q)return 0;if(n.startsWith(q))return 1;if(n.includes(q))return 2;if([s.description,s.source,sourceLabel(s.source,true),sourceLabel(s.source,false)].some(v=>v&&v.toLowerCase().includes(q)))return 3;return -1};
 return items.map(s=>({s,k:score(s)})).filter(x=>x.k>=0).sort((a,b)=>a.k-b.k||a.s.name.localeCompare(b.s.name)).map(x=>x.s);
}

const W={zh:{loading:'正在载入技能…',failed:'技能载入失败',retry:'重试',empty:'没有匹配的技能',remove:'移除技能',manual:'手动',personal:'个人',bundled:'内置',app:'应用',configured:'已配置'},en:{loading:'Loading skills…',failed:"Couldn't load skills",retry:'Retry',empty:'No matching skills',remove:'Remove skill',manual:'Manual',personal:'Personal',bundled:'Built-in',app:'App',configured:'Configured'}};
/** Concise label for the catalog root kind (server/src/skill-catalog.ts skillRoots); unknown kinds show nothing. */
export function sourceLabel(source:string,zh:boolean){const t=zh?W.zh:W.en;
 if(['agents','pi','codex','codex-system','projects'].includes(source))return t.personal;
 return source==='bundled'?t.bundled:source==='app'?t.app:source==='configured'?t.configured:''}
export const skillText=(zh:boolean)=>zh?W.zh:W.en;

export const SKILL_LIST_ID='cm-skill-list';
export const skillOptionId=(i:number)=>'cm-skill-opt-'+i;

/** List above the composer. Rows are chosen with pointer down/click; focus stays in the textarea. */
export function SkillMenu({zh,items,active,status,onHover,onChoose,onRetry}:{zh:boolean;items:SkillRow[];active:number;status:Cat['status'];onHover:(i:number)=>void;onChoose:(s:SkillRow)=>void;onRetry:()=>void}){
 const t=skillText(zh);const listRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{listRef.current?.querySelector('#'+skillOptionId(active))?.scrollIntoView({block:'nearest'})},[active,items]);
 const note=(text:string)=><div className="cm-skill-note">{text}</div>;
 return <div className="cm-skill-menu" onMouseDown={e=>e.preventDefault()}>
  {status==='error'?<div className="cm-skill-note cm-skill-error"><span>{t.failed}</span><button type="button" className="cm-skill-retry" onClick={onRetry}>{t.retry}</button></div>
   :!items.length?note(status==='ready'?t.empty:t.loading)
   :<div ref={listRef} id={SKILL_LIST_ID} role="listbox" aria-label="Skills" className="cm-skill-list">
    {items.map((s,i)=><div key={s.id} id={skillOptionId(i)} role="option" aria-selected={i===active} className={'cm-skill-row'+(i===active?' is-active':'')} onMouseMove={()=>{if(i!==active)onHover(i)}} onClick={()=>onChoose(s)} title={s.description||s.name}>
     <I n="cube" style={{fontSize:14,color:'var(--accentText)'}}/>
     <span className="cm-skill-name">{s.name}</span>
     <span className="cm-skill-desc">{s.description}</span>
     {s.manualOnly?<span className="cm-skill-src">{t.manual}</span>:sourceLabel(s.source,zh)?<span className="cm-skill-src">{sourceLabel(s.source,zh)}</span>:null}
    </div>)}
   </div>}
 </div>;
}

/** Selected skill shown at the start of the input row; removable by its button or Backspace at caret 0. */
/** Shared capsule core (cube + name) for the composer token and sent messages: one markup and one base style
 *  (`.cm-skill-capsule`); each use keeps its own selectors and adds only its own layout/controls. */
function SkillCapsule({name,kind,title,children}:{name:string;kind:'cm-skill-token'|'cm-sent-skill';title?:string;children?:React.ReactNode}){
 return <span className={'cm-skill-capsule '+kind} title={title} {...(kind==='cm-sent-skill'?{'data-sent-skill':name}:{})}>
  <I n="cube" style={{fontSize:13}}/>
  <span className={'cm-skill-capsule-name '+kind+'-name'}>{name}</span>
  {children}
 </span>;
}
export function SkillToken({zh,skill,onRemove}:{zh:boolean;skill:SkillPick;onRemove:()=>void}){
 return <SkillCapsule name={skill.name} kind="cm-skill-token" title={skillCommand(skill)}>
  <button type="button" className="cm-skill-token-x" aria-label={skillText(zh).remove+' '+skill.name} onMouseDown={e=>e.preventDefault()} onClick={onRemove}><I n="x" style={{fontSize:10}}/></button>
 </SkillCapsule>;
}

// ---------- sent-message projection (display only) ----------
/** A sent message's explicit skill reference: only the canonical `/skill:<name>` at index 0, followed by whitespace or
 *  the end, using the server name grammar. Plain `/name`, leading whitespace, quotes, code, paths and malformed tokens
 *  stay plain text. The capsule shows what the user referenced, not whether that skill resolved or ran. */
export function parseSentSkill(content:string):{name:string;text:string;quote:string}|null{
 const m=String(content||'').match(/^\/skill:([A-Za-z0-9][\w.-]{0,79})(?=\s|$)/);if(!m)return null;
 // Drop exactly the separator the composer wrote: ' ' before a task, '\n\n' before a quote-only body.
 let rest=content.slice(m[0].length).replace(/^(?:\n\n| |\n)/,'');
 // The composer places the quote after the task: `task\n\n> line…` (or the whole rest for a skill-only quote).
 let quote='';const q=rest.match(/(?:^|\n\n)((?:> ?.*(?:\n|$))+)$/);
 if(q){quote=q[1].split('\n').map(l=>l.replace(/^> ?/,'')).join('\n').trim();rest=rest.slice(0,q.index)}
 return {name:m[1],text:rest,quote};
}
/** Read-only capsule for a sent message. Distinct classes keep composer `.cm-skill-token` selectors unambiguous. */
export function SentSkill({name}:{name:string}){
 return <SkillCapsule name={name} kind="cm-sent-skill"/>;
}
