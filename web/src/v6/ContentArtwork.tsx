import React,{useState} from 'react';
import {ideaIconCatalog,validIdeaIcon} from '../../../shared/idea-icons';
import {I} from './icons';

// Original OpsTwins artwork. Static imports travel with both Vite and MyGO embeds.
const assets=import.meta.glob('../../../docs/design/assets/idea-icons/*.svg',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
const paths=Object.fromEntries(ideaIconCatalog.map(icon=>[icon.id,assets['../../../docs/design/assets/idea-icons/'+icon.file]]));
const aliases:[string,RegExp][]=[
 ['contact',/关于我|关于你|个人资料|本人身份|about me|about you|profile|identity/i],
 ['team',/人物|同事|员工|团队|people|colleagues|team/i],
 ['focus',/偏好|习惯|preferences?|habits?/i],
 ['workflow',/角色设定|agent|工作流|workflow/i],
 ['knowledge',/记忆|知识|memory|knowledge/i],
 ['roadmap',/工作|项目|work|projects?/i],
];
export function contentIcon(key:unknown,title='',fallback='files'){
 if(validIdeaIcon(key))return key;
 const alias=aliases.find(([,pattern])=>pattern.test(title));if(alias)return alias[0];
 const text=title.toLocaleLowerCase();
 const match=ideaIconCatalog.find(icon=>[icon.id,icon.label,...icon.keywords.split(/[、，,]/)].some(word=>word.length>=2&&text.includes(word.toLocaleLowerCase())));
 return match?.id||(validIdeaIcon(fallback)?fallback:'files');
}
export function ContentArtwork({iconKey,title='',fallback='files',size=44}:{iconKey?:unknown;title?:string;fallback?:string;size?:number}){
 const key=contentIcon(iconKey,title,fallback),src=paths[key];
 const [failed,setFailed]=useState('');
 return <span data-content-icon={key} data-icon-fallback={!src||failed===src} aria-hidden="true" style={{width:size,height:size,flex:'none',display:'inline-flex',alignItems:'center',justifyContent:'center',color:'var(--accentText)'}}>
  {src&&failed!==src?<img src={src} alt="" draggable={false} width={size} height={size} onError={()=>setFailed(src)} style={{display:'block',width:size,height:size,objectFit:'contain'}}/>:<I n="folder-simple" style={{fontSize:Math.round(size*.65)}}/>}
 </span>;
}
