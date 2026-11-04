import React from 'react';
// The reference's `style-hover` / `style-active` attributes compile (support.js createPseudoSheet) to real
// `.scpN:hover{…!important}` / `.scpN:active{…!important}` rules. Hv generates identical rules, so hover/press
// follow the browser's own pointer and keyboard state (no stuck JS hover, press works with Space/Enter too) and
// override inline styles exactly as in the reference.
type HvProps={as?:string;style?:React.CSSProperties;hover?:React.CSSProperties;press?:React.CSSProperties;[key:string]:any};
const UNITLESS=new Set(['opacity','zIndex','fontWeight','lineHeight','flex','flexGrow','flexShrink','order','zoom','scale']);
const cssText=(o:React.CSSProperties)=>Object.entries(o).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>{
 const prop=k.startsWith('--')?k:k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()).replace(/^(webkit|moz|ms)-/,'-$1-');
 return prop+':'+(typeof v==='number'&&!UNITLESS.has(k)&&!k.startsWith('--')?v+'px':String(v))+' !important'}).join(';');
let sheet:CSSStyleSheet|null=null;const cache=new Map<string,string>();let n=0;
function pseudoClass(pseudo:'hover'|'active',o?:React.CSSProperties){
 if(!o||!Object.keys(o).length)return '';const css=cssText(o);if(!css)return '';const key=pseudo+'|'+css;const hit=cache.get(key);if(hit)return hit;
 if(!sheet){const el=document.createElement('style');el.setAttribute('data-cyberme-pseudo','');document.head.appendChild(el);sheet=el.sheet}
 const cls='cmp'+(n++).toString(36);try{sheet!.insertRule('.'+cls+':'+pseudo+'{'+css+'}',sheet!.cssRules.length)}catch{}cache.set(key,cls);return cls;
}
// `all:unset` alone is not enough in WKWebView: a <button> there still paints the platform button face (grey) on
// resting rows. Spelling out the unset values inline, after `all` and before the element's own style, neutralises the
// native appearance and paint in every engine while keeping the reference's resulting values (Chrome computes the same).
const UNSET:React.CSSProperties={WebkitAppearance:'none',appearance:'none',background:'transparent',border:'none',borderRadius:0,margin:0,padding:0,
 font:'inherit',color:'inherit',textAlign:'inherit',letterSpacing:'inherit',textTransform:'inherit',boxShadow:'none',transform:'none',transition:'none'};
export const unset=(style?:React.CSSProperties):React.CSSProperties|undefined=>style&&style.all==='unset'?{all:'unset',...UNSET,...style}:style;
// A disabled Hv (production-only busy/unsupported state; reference buttons are never disabled) drops its hover/press
// rules and shows the default cursor, so it no longer looks actionable. Enabled buttons are unchanged.
export const Hv=React.forwardRef<any,HvProps>(function Hv({as='button',style,hover,press,className,...rest},ref){
 const off=!!rest.disabled;
 const cls=[className,off?'':pseudoClass('hover',hover),off?'':pseudoClass('active',press)].filter(Boolean).join(' ')||undefined;
 const props:any={...rest,ref,style:unset(off&&style?{...style,cursor:'default'}:style),className:cls};
 if(as==='button'&&props.type===undefined)props.type='button';
 return React.createElement(as,props);
});
export const seg=(on:boolean,extra:React.CSSProperties={}):React.CSSProperties=>({height:26,padding:'0 14px',border:'none',borderRadius:'var(--r-innerBtn)',font:'inherit',fontSize:12,fontWeight:on?500:400,cursor:'pointer',whiteSpace:'nowrap',background:on?'var(--segOn)':'transparent',color:on?'var(--text)':'var(--text2)',boxShadow:on?'var(--segShadow)':'none',transition:'background 250ms ease-out',...extra});
export type PillStatus='queued'|'running'|'sending'|'confirm'|'failed'|'done'|'scheduled'|'unknown'|'partial'|'cancelled'|'paused'|'interrupted';
export function pill(status:PillStatus):React.CSSProperties{
 const map:Record<PillStatus,[string,string]>={interrupted:['--warnSoft','--warnText'],queued:['--accentSoft','--accentText'],running:['--accentSoft','--accentText'],sending:['--accentSoft','--accentText'],confirm:['--warnSoft','--warnText'],failed:['--errSoft','--errText'],done:['--okSoft','--okText'],scheduled:['--hover','--text2'],unknown:['--warnSoft','--warnText'],partial:['--warnSoft','--warnText'],cancelled:['--hover','--text2'],paused:['--hover','--text2']};
 const [bg,fg]=map[status]||map.scheduled;
 return {display:'inline-flex',alignItems:'center',height:22,padding:'0 8px',borderRadius:'var(--r-innerBtn)',background:`var(${bg})`,color:`var(${fg})`,fontSize:12,whiteSpace:'nowrap',flex:'none',transition:'background 250ms ease-out, color 250ms ease-out'};
}
export const btn=(kind:'primary'|'sec'):React.CSSProperties=>kind==='primary'
 ?{height:32,padding:'0 14px',border:'none',borderRadius:'var(--r-btn)',background:'var(--accent)',color:'var(--onAccent)',font:'inherit',fontSize:14,fontWeight:500,cursor:'pointer',whiteSpace:'nowrap',transition:'opacity 250ms ease-out'}
 :{height:32,padding:'0 14px',border:'none',borderRadius:'var(--r-btn)',background:'var(--hover)',color:'var(--text)',font:'inherit',fontSize:14,cursor:'pointer',whiteSpace:'nowrap',transition:'opacity 250ms ease-out'};
// Detail and proposal actions in the reference are inline buttons with the same geometry as btn() but no inline
// transition (849/852/890/151, and the Fix button at 898), so the global transform 200ms press easing applies. btn()
// itself is the reference helper (1768, used by the insight judgement buttons and by the failed-detail Retry at 898 via
// retryStyle=btn(...), R:1986) and keeps its opacity transition; that Retry also declares no style-hover.
export const actBtn=(kind:'primary'|'sec'):React.CSSProperties=>{const {transition:_t,...rest}=btn(kind);return rest};
export const initials=(name:string)=>name.split(/\s+/).filter(Boolean).map(w=>Array.from(w)[0]||'').join('').slice(0,2).toUpperCase();
export const AVC=['#ff9f0a','#30b0c7','#af52de','#34c759','#ff375f','#5e5ce6'];
export const avColor=(v:string)=>AVC[((v.charCodeAt(0)||0)+v.length)%AVC.length];
export const tint=(c:string,a:number)=>'color-mix(in oklch, '+c+' '+a+'%, transparent)';
