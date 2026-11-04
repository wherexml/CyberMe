import React from 'react';
import {marked} from 'marked';
// Same GFM pipeline as the existing chat (tables, quotes, nested lists, code), then an allow-list
// sanitizer: model and source text never becomes active HTML. `breaks:false` keeps assistant soft
// line breaks as natural reflow (docs/public/chat-insight-quality.md); blank lines, explicit Markdown
// breaks, lists and code are preserved. User bubbles render their own text with pre-wrap, not here.
const ALLOWED=new Set(['P','BR','STRONG','EM','DEL','S','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','HR','TABLE','THEAD','TBODY','TR','TH','TD','A']);
function safeHtml(text:string){
 const html=marked.parse(String(text||'').replace(/\r\n?/g,'\n'),{async:false,breaks:false,gfm:true}) as string;
 const doc=new DOMParser().parseFromString(html,'text/html');
 doc.querySelectorAll('script,iframe,object,embed,style,link,form,input,button,svg,math,img').forEach(n=>n.remove());
 doc.body.querySelectorAll('*').forEach(n=>{
  if(!ALLOWED.has(n.tagName)){n.replaceWith(...n.childNodes);return}
  [...n.attributes].forEach(a=>{if(!(n.tagName==='A'&&a.name==='href')&&!(n.tagName==='OL'&&a.name==='start')&&!((n.tagName==='TH'||n.tagName==='TD')&&a.name==='align'))n.removeAttribute(a.name)});
  if(n.tagName==='A'){const href=n.getAttribute('href')||'';if(!/^(https?:\/\/|mailto:)/i.test(href))n.removeAttribute('href');else{n.setAttribute('target','_blank');n.setAttribute('rel','noopener noreferrer')}}
 });
 doc.querySelectorAll('table').forEach(t=>{const w=doc.createElement('div');w.className='cm-md-table';w.tabIndex=0;t.replaceWith(w);w.append(t)});
 return doc.body.innerHTML;
}
export function Md({text}:{text:string}){
 const html=React.useMemo(()=>safeHtml(text),[text]);
 return <div className="cm-md" dangerouslySetInnerHTML={{__html:html}}/>;
}
/** Plain one-paragraph summary for card bodies. */
export function plain(text:string,max=240){const s=String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/^#+\s.*$/gm,' ').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/[`*_>#-]/g,' ').replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;}
export function firstPara(text:string,max=240){const p=String(text||'').split(/\n\s*\n/).map(x=>x.trim()).find(x=>x&&!/^\*\*[^*]+\*\*$/.test(x))||'';return plain(p,max);}
