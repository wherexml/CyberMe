import DOMPurify from './vendor/dompurify.js';
import remend from './vendor/remend.js';
import {Marked} from './vendor/marked.js';

const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const allowed=new Set(['P','BR','STRONG','EM','DEL','S','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','HR','TABLE','THEAD','TBODY','TR','TH','TD','A']);
const parser=new Marked({async:false,gfm:true,breaks:true,renderer:{
  html:token=>escape(token.text),
  image:token=>escape(token.text||''),
}});
export function renderMarkdown(text,{streaming=false,reflow=false}={}) {
  const original=String(text??'');
  try{
    const source=streaming?remend(original):original;
    const html=parser.parse(source,{breaks:!reflow});
    return sanitizeMarkdownHTML(html);
  }catch{return '<p>'+escape(original).replace(/\n/g,'<br>')+'</p>'}
}

export function sanitizeMarkdownHTML(html,{taskInputs=false}={}) {
  const template=document.createElement('template');template.innerHTML=DOMPurify.sanitize(html,{ALLOWED_TAGS:[...allowed].map(x=>x.toLowerCase()).concat(taskInputs?['input']:[]),ALLOWED_ATTR:['href','start',...(taskInputs?['type','checked','disabled']:[])],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
    for(const el of template.content.querySelectorAll('*')){
      if(!allowed.has(el.tagName)&&!(taskInputs&&el.tagName==='INPUT')){el.replaceWith(...el.childNodes);continue}
      for(const attr of [...el.attributes])if(!(el.tagName==='A'&&attr.name==='href')&&!(el.tagName==='OL'&&attr.name==='start')&&!(taskInputs&&el.tagName==='INPUT'&&['type','checked','disabled'].includes(attr.name)))el.removeAttribute(attr.name);
      if(el.tagName==='A'){
        const href=el.getAttribute('href')||'';
        if(!/^(https?:\/\/|mailto:)/i.test(href))el.removeAttribute('href');
        el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');
      }
    }
    for(const [tag,cls] of [['pre','md-code-scroll'],['table','md-table-scroll']])for(const el of template.content.querySelectorAll(tag)){
      const wrap=document.createElement('div');wrap.className=cls;wrap.tabIndex=0;el.replaceWith(wrap);wrap.append(el);
    }
    return template.innerHTML;
}
