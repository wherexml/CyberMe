import React from 'react';
// Exact Phosphor glyphs from the vendored @phosphor-icons/web@2.1.1 regular + fill fonts (MIT, see
// vendor/phosphor/LICENSE). Bundled by Vite, so the installed app has no CDN dependency.
// Names follow the reference `ph-*` classes: 'sparkle', 'ph-sparkle', 'ph-fill sparkle', 'ph-fill ph-sparkle'.
import './vendor/phosphor/regular/style.css';
import './vendor/phosphor/fill/style.css';
export function I({n,style,title}:{n:string;style?:React.CSSProperties;title?:string}){
 const fill=/^ph-fill(\s|$)/.test(n);
 const name=n.replace(/^ph-fill\s+/,'').replace(/^ph\s+/,'').replace(/^ph-/,'').trim()||'circle';
 return <i className={(fill?'ph-fill':'ph')+' ph-'+name} aria-hidden={title?undefined:true} role={title?'img':undefined} aria-label={title} title={title} style={{display:'inline-block',flex:'none',lineHeight:1,...style}}/>;
}
