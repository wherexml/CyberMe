import React from 'react';
import type {DecisionVisual,DecisionMeters,InsightVisual,GalleryVisual,WorkVisual,V6Text} from '../../../shared/v6-visuals';
import {v6Text} from '../../../shared/v6-visuals';
import {I} from './icons';
import {initials,tint} from './ui';
import {X} from './strings';
// Rendering only. Every number shown here comes from the record's own visual payload.
type Z={zh:boolean};
const t=(v:V6Text|undefined,zh:boolean)=>v6Text(v,zh);
const inner:React.CSSProperties={borderRadius:'var(--r-inner)',background:'var(--convBg)'};
const rowLine=(i:number,n:number):React.CSSProperties=>({boxShadow:i<n-1?'inset 0 -0.5px 0 var(--line)':'none'});
// Bundled brand marks (provenance in web/public/brands/README.md); no runtime image requests.
const BRAND:Record<string,string>={gmail:'brands/gmail.svg','google-calendar':'brands/google-calendar.svg',slack:'brands/slack.svg',teams:'brands/teams.svg',wechat:'brands/wechat.svg',whatsapp:'brands/whatsapp.svg',feishu:'brands/feishu.svg',telegram:'brands/telegram.svg',
 figma:'brands/figma.svg',zoom:'brands/zoom.svg',salesforce:'brands/salesforce.svg',notion:'brands/notion.svg','google-drive':'brands/google-drive.svg',dropbox:'brands/dropbox.svg',github:'brands/github.svg',linear:'brands/linear.svg',zendesk:'brands/zendesk.svg',apple:'brands/apple.svg',outlook:'brands/outlook.jpg',hubspot:'brands/hubspot.png',mixpanel:'brands/mixpanel.png'};
// Brand keys, product names and reference domains that resolve to a bundled mark.
const ALIAS:[RegExp,string][]=[[/gmail|mail\.google/,'gmail'],[/google.?calendar|calendar\.google/,'google-calendar'],[/google.?drive|drive\.google/,'google-drive'],[/slack/,'slack'],[/teams/,'teams'],[/wechat|weixin|微信/,'wechat'],[/whatsapp/,'whatsapp'],[/feishu|lark|飞书/,'feishu'],[/telegram/,'telegram'],
 [/figma/,'figma'],[/zoom/,'zoom'],[/salesforce/,'salesforce'],[/notion/,'notion'],[/dropbox/,'dropbox'],[/github/,'github'],[/linear/,'linear'],[/zendesk/,'zendesk'],[/outlook/,'outlook'],[/hubspot/,'hubspot'],[/mixpanel/,'mixpanel'],[/apple|icloud/,'apple']];
export function brandKey(v?:string){const k=String(v||'').toLowerCase();if(!k)return undefined;if(BRAND[k])return k;return ALIAS.find(([re])=>re.test(k))?.[1]}
export function BrandLogo({brand,size=16,icon}:{brand?:string;size?:number;icon?:string}){
 const key=brandKey(brand);const src=key?BRAND[key]:undefined;
 if(src)return <span style={{display:'block',width:size,height:size,background:`center/contain no-repeat url(${src})`}}/>;
 return <I n={icon||'circle'} style={{fontSize:size,color:'#60646c'}}/>;
}

// ----- Brief decisions -----
function DecisionVisView({v,zh,recs}:{v:DecisionVisual;recs?:boolean[]}&Z){
 const XL=X[zh?'zh':'en'];
 if(v.kind==='accts')return <div style={{display:'flex',flexDirection:'column',padding:'4px 14px',...inner}}>{v.rows.map((a,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',...rowLine(i,v.rows.length)}}>
  <span style={{width:8,height:8,flex:'none',borderRadius:'50%',background:a.hot?'var(--warnDot)':'var(--lineStrong)'}}/>
  <span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={{fontWeight:500}}>{a.name}</span><span style={{fontSize:12,color:'var(--text3)'}}>{t(a.sub,zh)}</span></span>
  <span style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}><span style={{fontSize:11,color:'var(--text3)'}}>{v.dateLabel?t(v.dateLabel,zh):XL.renewal}</span><span style={{fontSize:13,fontWeight:500,fontVariantNumeric:'tabular-nums'}}>{t(a.date,zh)}</span></span></div>)}</div>;
 if(v.kind==='quiet')return <div style={{display:'flex',flexDirection:'column',padding:'4px 14px',...inner}}>{v.rows.map((q,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'30px minmax(0,1fr) auto',alignItems:'center',gap:12,padding:'9px 0',...rowLine(i,v.rows.length)}}>
  <span style={{width:30,height:30,borderRadius:'50%',background:['#ff9f0a','#30b0c7','#af52de'][i%3],color:'#fff',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'}}>{initials(q.name)}</span>
  <span style={{minWidth:0,display:'flex',flexDirection:'column'}}><span style={{fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{q.name}</span><span style={{fontSize:12,color:'var(--text3)'}}>{q.company} · {t(q.date,zh)}</span></span>
  <span style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}><span style={{fontSize:12,fontVariantNumeric:'tabular-nums',color:'var(--text2)'}}>{XL.silent(q.days)}</span><span style={{display:'block',width:72,height:4,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:Math.min(100,Math.round(q.days/30*100))+'%',borderRadius:2,background:q.days>=25?'var(--warnDot)':'var(--text3)'}}/></span></span></div>)}</div>;
 const n=v.months.length||4;
 return <div style={{display:'flex',flexDirection:'column',gap:6,padding:'12px 14px',...inner}}>
  <div style={{display:'grid',gridTemplateColumns:'92px minmax(0,1fr)',gap:10,fontSize:11,color:'var(--text3)'}}><span/><div style={{display:'grid',gridTemplateColumns:`repeat(${n},minmax(0,1fr))`}}>{v.months.map((m,i)=><span key={i}>{t(m,zh)}</span>)}</div></div>
  {[{label:t(v.needLabel,zh),labelStyle:{fontSize:12,fontWeight:600,color:'var(--warnText)'} as React.CSSProperties,bar:{position:'absolute',top:0,bottom:0,left:v.need[0]/n*100+'%',width:(v.need[1]-v.need[0])/n*100+'%',borderRadius:5,background:'var(--warnDot)',opacity:.55} as React.CSSProperties}]
   .concat(v.short.map((s,i):{label:string;labelStyle:React.CSSProperties;bar:React.CSSProperties}=>{const sp=v.spans[i];const rec=recs?!!recs[i]:i===0;return {label:t(s,zh),labelStyle:{fontSize:12,color:rec?'var(--text)':'var(--text2)',fontWeight:rec?500:400},bar:sp?{position:'absolute',top:0,bottom:0,left:sp[0]/n*100+'%',width:(sp[1]-sp[0])/n*100+'%',borderRadius:5,background:rec?'var(--accent)':'var(--text3)'}:{display:'none'}}}))
   .map((g,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'92px minmax(0,1fr)',gap:10,alignItems:'center',minHeight:26}}><span style={g.labelStyle}>{g.label}</span><div style={{position:'relative',height:10,borderRadius:5,background:'var(--hover)'}}><span style={g.bar}/></div></div>)}
 </div>;
}
function MetersView({m,index,rec,zh}:{m:DecisionMeters;index:number;rec:boolean}&Z){
 const vals=m.values[index];if(!vals)return null;
 return <span style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:14}}>{m.axes.map((ax,k)=><span key={k} style={{display:'flex',flexDirection:'column',gap:4}}><span style={{fontSize:11,color:'var(--text3)'}}>{t(ax,zh)}</span><span style={{display:'block',height:4,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:Math.round(vals[k]*100)+'%',borderRadius:2,background:rec?'var(--accent)':'var(--text3)'}}/></span></span>)}</span>;
}

// ----- Insight cards -----
const tr='all 250ms ease-out';
function InsightVisView({v,zh}:{v:InsightVisual}&Z){
 const XL=X[zh?'zh':'en'];const pos=(d:number)=>Math.max(0,Math.min(100,d/60*100));
 if(v.kind==='renew')return <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6,padding:'12px 14px',...inner}}>
  {v.rows.map((r,i)=>{const last=30-r.lastDaysAgo,ren=30+r.renewInDays,from=r.done?30:last;return <div key={i} style={{display:'grid',gridTemplateColumns:'104px minmax(0,1fr) 52px',alignItems:'center',gap:10,minHeight:38}}>
   <div style={{display:'flex',flexDirection:'column',minWidth:0}}><span style={{fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</span><span style={{fontSize:12,color:r.done?'var(--okText)':'var(--text3)',transition:tr}}>{r.done?XL.emailed:XL.silent(r.lastDaysAgo)}</span></div>
   <div style={{position:'relative',height:20}}>
    <span style={{position:'absolute',top:0,bottom:0,left:pos(30)+'%',width:1,background:'var(--lineStrong)'}}/>
    <span style={{position:'absolute',top:10,left:pos(30)+'%',width:(pos(ren)-pos(30))+'%',borderTop:'1px dashed var(--lineStrong)'}}/>
    <span style={{position:'absolute',top:9,height:3,borderRadius:2,left:pos(from)+'%',width:(pos(30)-pos(from))+'%',background:'var(--warnDot)',transition:tr}}/>
    <span style={{position:'absolute',top:6,left:`calc(${pos(from)}% - 4px)`,width:8,height:8,borderRadius:'50%',background:'var(--card)',boxShadow:`0 0 0 1.5px ${r.done?'var(--okDot)':'var(--warnDot)'}`,transition:tr}}/>
    <span style={{position:'absolute',top:6,left:`calc(${pos(ren)}% - 4px)`,width:8,height:8,borderRadius:'50%',background:'var(--accent)'}}/>
   </div>
   <span style={{fontSize:12,color:'var(--text2)',textAlign:'right',whiteSpace:'nowrap'}}>{t(r.date,zh)}</span></div>})}
  <div style={{display:'grid',gridTemplateColumns:'104px minmax(0,1fr) 52px',gap:10,fontSize:12,color:'var(--text3)'}}><span/><div style={{position:'relative',height:18}}><span style={{position:'absolute',left:'50%',transform:'translateX(-50%)',whiteSpace:'nowrap'}}>{XL.todayL}</span></div><span style={{textAlign:'right',whiteSpace:'nowrap'}}>{XL.renewal}</span></div>
 </div>;
 if(v.kind==='cal')return <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:6,padding:'12px 14px',...inner}}>
  <div style={{fontSize:12,color:'var(--text3)'}}>{t(v.day,zh)}</div>
  <div style={{position:'relative',height:56}}>
   <span style={{position:'absolute',top:0,bottom:0,left:(v.overlap?.startPct??0)+'%',width:(v.overlap?.widthPct??0)+'%',background:'var(--warnSoft)',borderRadius:'var(--r-xs)',transition:tr}}/>
   {v.blocks.map((b,i)=><span key={i} style={{position:'absolute',top:i===0?4:30,height:22,left:b.startPct+'%',width:`calc(${b.widthPct}% - 2px)`,boxSizing:'border-box',padding:'0 8px',borderRadius:'var(--r-innerBtn)',background:b.dim?'transparent':'var(--accentSoft)',boxShadow:b.dim?'inset 0 0 0 0.5px var(--lineStrong)':'none',color:b.dim?'var(--text3)':'var(--accentText)',fontSize:12,display:'flex',alignItems:'center',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',transition:tr}}>{t(b.label,zh)}</span>)}
  </div>
  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text3)'}}>{v.ticks.map(x=><span key={x}>{x}</span>)}</div>
 </div>;
 return <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:6,padding:'12px 14px',...inner}}>
  <div style={{display:'flex',gap:4}}>{Array.from({length:v.need},(_,i)=><span key={i} style={{flex:1,height:8,borderRadius:4,boxSizing:'border-box',background:i<v.have?'var(--text3)':'transparent',border:i<v.have?'none':'1px dashed var(--lineStrong)',transition:tr}}/>)}</div>
  <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,color:'var(--text3)'}}><span>{XL.sigOf(v.have,v.need)}</span></div>
 </div>;
}

// ----- Inspirations gallery -----
function GalleryVisView({v,zh}:{v:GalleryVisual}&Z){
 const box:React.CSSProperties={borderRadius:12,background:'var(--convBg)'};
 if(v.kind==='focus'){const days=zh?['一','二','三','四','五']:['Mon','Tue','Wed','Thu','Fri'];const free=v.freeDay??-1,freeRows=v.freeRows??0,h0=v.startHour??9;
  const cells:React.ReactNode[]=[<span key="c"/>];
  days.forEach((d,i)=>cells.push(<span key={'d'+i} style={{fontSize:11,textAlign:'center',color:i===free?'#34c759':'var(--text3)',fontWeight:i===free?600:400}}>{d}</span>));
  v.load.forEach((row,r)=>{cells.push(<span key={'h'+r} style={{fontSize:10,color:'var(--text3)',fontVariantNumeric:'tabular-nums',alignSelf:'center'}}>{(h0+r)+':00'}</span>);
   row.slice(0,5).forEach((n,c)=>{const isFree=c===free&&r<freeRows;cells.push(<span key={r+'-'+c} style={{height:14,borderRadius:4,background:isFree?tint('#34c759',28):n?tint('var(--accent)',[0,22,48,80][Math.max(0,Math.min(3,n))]):'var(--hover)',boxShadow:isFree?'inset 0 0 0 1px #34c759':'none',animation:'cmIn 400ms ease-out both',animationDelay:(r*30+c*15)+'ms'}}/>)})});
  return <div style={{display:'grid',gridTemplateColumns:'34px repeat(5,minmax(0,1fr))',gap:4,padding:12,...box}}>{cells}</div>;}
 if(v.kind==='trip')return <div style={{display:'flex',flexDirection:'column',gap:14,padding:16,...box}}>
  <div style={{display:'grid',gridTemplateColumns:'auto minmax(0,1fr) auto',alignItems:'center',gap:14}}>
   <div style={{display:'flex',flexDirection:'column'}}><span style={{fontSize:24,fontWeight:600,letterSpacing:'-0.02em'}}>{v.from}</span><span style={{fontSize:12,color:'var(--text3)'}}>{t(v.fromCity,zh)}</span><span style={{fontSize:13,fontWeight:500,fontVariantNumeric:'tabular-nums',marginTop:4}}>{v.dep}</span></div>
   <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}><div style={{display:'flex',alignItems:'center',gap:6,width:'100%'}}><span style={{flex:1,height:0,borderTop:'1.5px dashed var(--lineStrong)'}}/><I n="airplane-tilt" style={{fontSize:18,color:'var(--accent)'}}/><span style={{flex:1,height:0,borderTop:'1.5px dashed var(--lineStrong)'}}/></div><span style={{fontSize:11,color:'var(--text3)'}}>{t(v.dur,zh)}</span></div>
   <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}><span style={{fontSize:24,fontWeight:600,letterSpacing:'-0.02em'}}>{v.to}</span><span style={{fontSize:12,color:'var(--text3)'}}>{t(v.toCity,zh)}</span><span style={{fontSize:13,fontWeight:500,fontVariantNumeric:'tabular-nums',marginTop:4}}>{v.arr}</span></div>
  </div>
  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{v.chips.map((c,i)=><span key={i} style={{display:'inline-flex',alignItems:'center',gap:6,height:28,padding:'0 10px',borderRadius:14,background:'var(--card)',boxShadow:'0 0 0 0.5px var(--line)',fontSize:12}}><I n={c.icon} style={{fontSize:14,color:'var(--text2)'}}/><span>{t(c.label,zh)}</span></span>)}</div>
 </div>;
 if(v.kind==='bars'){const max=Math.max(1,...v.bars),th=v.threshold??35,s0=v.startLabel??8;return <div style={{display:'flex',flexDirection:'column',gap:8,padding:'14px 14px 10px',...box}}>
  <div style={{display:'flex',alignItems:'flex-end',gap:5,height:88}}>{v.bars.map((b,i)=><div key={i} style={{flex:1,minWidth:0,height:'100%',display:'flex',flexDirection:'column',justifyContent:'flex-end',gap:6,alignItems:'center'}}><span style={{display:'block',width:'100%',height:(b/max*100)+'%',borderRadius:'4px 4px 2px 2px',background:b>th?'#ff9f0a':'var(--accent)',transformOrigin:'bottom',animation:'cmBar 700ms cubic-bezier(.2,.8,.2,1) both',animationDelay:(200+i*40)+'ms'}}/><span style={{fontSize:10,color:'var(--text3)',fontVariantNumeric:'tabular-nums',height:12}}>{i%2?'':String(s0+i)}</span></div>)}</div>
  <div style={{display:'flex',gap:14,fontSize:11,color:'var(--text3)'}}><span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:2,background:'var(--accent)'}}/>{t(v.legA,zh)}</span><span style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:2,background:'#ff9f0a'}}/>{t(v.legB,zh)}</span></div>
 </div>;}
 if(v.kind==='people')return <div style={{display:'flex',flexDirection:'column',gap:12,padding:'14px 16px',...box}}>
  <div style={{display:'flex',alignItems:'center',gap:12}}><span style={{width:40,height:40,borderRadius:'50%',background:'#5e5ce6',color:'#fff',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}>{v.lead}</span><span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={{fontWeight:600}}>{v.person}</span><span style={{fontSize:12,color:'var(--text3)'}}>{t(v.role,zh)}</span></span></div>
  <div style={{display:'grid',gridTemplateColumns:`repeat(${v.months.length||12},minmax(0,1fr))`,alignItems:'center',height:22}}>{v.months.map((n,i)=><span key={i} style={{display:'flex',justifyContent:'center'}}><span style={n?{width:6+n*4,height:6+n*4,borderRadius:'50%',background:'#5e5ce6',opacity:.35+n*.2}:{width:6,height:6,borderRadius:'50%',boxShadow:'inset 0 0 0 1px var(--lineStrong)'}}/></span>)}</div>
  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text3)'}}><span>{t(v.m0,zh)}</span><span>{t(v.m1,zh)}</span></div>
 </div>;
 if(v.kind==='spend')return <div style={{display:'flex',flexDirection:'column',padding:'4px 14px',...box}}>{v.rows.map((r,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'26px minmax(0,1fr) auto',alignItems:'center',gap:12,padding:'10px 0',...rowLine(i,v.rows.length)}}>
  <span style={{width:26,height:26,borderRadius:7,background:'#fff',boxShadow:'0 0 0 0.5px rgba(0,0,0,.1)',display:'flex',alignItems:'center',justifyContent:'center',flex:'none'}}><BrandLogo brand={r.brand||r.name} icon="coins"/></span>
  <span style={{minWidth:0,display:'flex',flexDirection:'column',gap:5}}><span style={{display:'flex',gap:8,alignItems:'baseline'}}><span style={{fontWeight:500}}>{r.name}</span><span style={{fontSize:12,color:'var(--text3)',fontVariantNumeric:'tabular-nums'}}>{zh?r.used+' / '+r.total+' 席在用':r.used+' of '+r.total+' seats used'}</span></span><span style={{display:'block',height:4,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:(r.total?r.used/r.total*100:0)+'%',borderRadius:2,background:'#34c759',transformOrigin:'left',animation:'cmGrow 700ms cubic-bezier(.2,.8,.2,1) both',animationDelay:(200+i*80)+'ms'}}/></span></span>
  <span style={{fontSize:13,fontWeight:500,fontVariantNumeric:'tabular-nums',textAlign:'right'}}>{r.cost}</span></div>)}</div>;
 if(v.kind==='read'){const tot=v.rows.reduce((n,r)=>n+r.minutes,0);return <div style={{display:'flex',flexDirection:'column',gap:10,padding:'12px 14px',...box}}>
  {v.rows.map((r,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:12}}><span style={{width:4,alignSelf:'stretch',borderRadius:2,background:r.color,flex:'none'}}/><span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={{fontWeight:500,textWrap:'pretty'} as React.CSSProperties}>{t(r.title,zh)}</span><span style={{fontSize:12,color:'var(--text3)'}}>{r.source}</span></span><span style={{fontSize:12,color:'var(--text2)',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{r.minutes+(zh?' 分钟':' min')}</span></div>)}
  <div style={{display:'flex',flexDirection:'column',gap:6,paddingTop:4}}><div style={{display:'flex',height:8,borderRadius:4,overflow:'hidden',background:'var(--hover)'}}>{v.rows.map((r,i)=><span key={i} style={{width:(v.total?r.minutes/v.total*100:0)+'%',background:r.color,transformOrigin:'left',animation:'cmGrow 600ms ease-out both'}}/>)}</div><span style={{fontSize:11,color:'var(--text3)'}}>{zh?'共 '+tot+' 分钟，航程 '+v.total+' 分钟':tot+' of '+v.total+' minutes in the air'}</span></div>
 </div>;}
 if(v.kind==='ring')return <div style={{display:'flex',alignItems:'center',gap:18,padding:'14px 16px',...box}}>
  <span style={{width:76,height:76,flex:'none',borderRadius:'50%',background:'conic-gradient(#30b0c7 0 '+v.pct+'%, var(--hover) 0)',display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{width:60,height:60,borderRadius:'50%',background:'var(--convBg)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:20,fontWeight:600,lineHeight:1}}>{v.ringN}</span><span style={{fontSize:10,color:'var(--text3)'}}>{t(v.ringL,zh)}</span></span></span>
  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:7}}>{v.checks.map((c,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}><I n={c.done?'check-circle':'circle'} style={{fontSize:16,color:c.done?'#30b0c7':'var(--text3)'}}/><span style={{color:c.done?'var(--text2)':'var(--text)',fontWeight:c.done?400:500}}>{t(c.label,zh)}</span></div>)}</div>
 </div>;
 if(v.kind==='reflect'){const pc={ok:'#34c759',warn:'#ff9f0a',off:'#8e8e93'};return <div style={{display:'flex',flexDirection:'column',gap:12,padding:16,...box}}>
  <div style={{display:'flex',gap:10}}><I n="quotes" style={{fontSize:18,color:'var(--text3)'}}/><span style={{fontStyle:'italic',lineHeight:1.55,textWrap:'pretty'} as React.CSSProperties}>{t(v.quote,zh)}</span></div>
  <div style={{display:'flex',flexDirection:'column'}}>{v.goals.map((g,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',...rowLine(i,v.goals.length)}}><span style={{flex:1,minWidth:0,textWrap:'pretty'} as React.CSSProperties}>{t(g.label,zh)}</span><span style={{height:22,padding:'0 9px',display:'inline-flex',alignItems:'center',borderRadius:11,fontSize:11,fontWeight:500,whiteSpace:'nowrap',background:tint(pc[g.tone],16),color:pc[g.tone]}}>{t(g.state,zh)}</span></div>)}</div>
 </div>;}
 const [a0,a1]=v.range,W=Math.max(1,a1-a0);
 return <div style={{display:'flex',flexDirection:'column',gap:8,padding:14,...box}}>
  {v.lanes.map((ln,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'64px minmax(0,1fr)',gap:10,alignItems:'center'}}><span style={{fontSize:12,color:'var(--text2)'}}>{t(ln.label,zh)}</span><div style={{position:'relative',height:30,borderRadius:8,background:'var(--hover)'}}>{ln.blocks.map((b,j)=><span key={j} title={t(b.label,zh)} style={{position:'absolute',top:3,bottom:3,left:((b.start-a0)/W*100)+'%',width:((b.end-b.start)/W*100)+'%',borderRadius:6,background:b.color,color:'#fff',fontSize:11,fontWeight:500,padding:'0 6px',display:'block',lineHeight:'24px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',boxSizing:'border-box',transformOrigin:'left',animation:'cmGrow 600ms cubic-bezier(.2,.8,.2,1) both',animationDelay:'200ms'}}>{t(b.label,zh)}</span>)}</div></div>)}
  <div style={{display:'grid',gridTemplateColumns:'64px minmax(0,1fr)',gap:10}}><span/><div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text3)',fontVariantNumeric:'tabular-nums'}}>{Array.from({length:W+1},(_,i)=><span key={i}>{String(a0+i)}</span>)}</div></div>
 </div>;
}

// ----- Task work cards -----
function WorkVisView({v,zh}:{v:WorkVisual}&Z){
 const XL=X[zh?'zh':'en'];const box:React.CSSProperties={borderRadius:12,background:'var(--convBg)'};
 const row=(i:number,n:number,extra?:React.CSSProperties):React.CSSProperties=>({display:'flex',alignItems:'center',gap:12,padding:'10px 0',...rowLine(i,n),...extra});
 if(v.kind==='drafts')return <div style={{display:'flex',flexDirection:'column',gap:8}}>{v.rows.map((d,i)=><div key={i} style={{display:'flex',gap:12,padding:'12px 14px',...box}}>
  <span style={{width:32,height:32,flex:'none',borderRadius:'50%',background:d.color||['#30b0c7','#ff9f0a','#af52de'][i%3],color:'#fff',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center'}}>{initials(d.to)}</span>
  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:2}}><span style={{display:'flex',gap:6,alignItems:'baseline',flexWrap:'wrap'}}><span style={{fontWeight:500}}>{d.to}</span>{d.company?<span style={{fontSize:12,color:'var(--text3)'}}>{d.company}</span>:null}</span><span style={{fontSize:13,fontWeight:500}}>{t(d.subject,zh)}</span><span style={{fontSize:12,color:'var(--text2)',lineHeight:1.5,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'} as React.CSSProperties}>{t(d.preview,zh)}</span></div></div>)}</div>;
 if(v.kind==='compare')return <div style={{display:'flex',flexDirection:'column',overflow:'hidden',...box}}>{v.rows.map((o,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 14px',background:o.best?'var(--accentSoft)':'transparent',...rowLine(i,v.rows.length)}}>
  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:6}}>
   <span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontWeight:600}}>{o.name}</span>{o.best?<span style={{height:20,padding:'0 8px',display:'inline-flex',alignItems:'center',borderRadius:10,background:'var(--accent)',color:'var(--onAccent)',fontSize:11,fontWeight:500}}>{XL.bestFit}</span>:null}</span>
   <span style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:12,color:'var(--text2)'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><I n="map-pin" style={{fontSize:13}}/>{t(o.where,zh)}</span><span style={{display:'inline-flex',alignItems:'center',gap:4}}><I n="car" style={{fontSize:13}}/>{t(o.drive,zh)}</span><span style={{display:'inline-flex',alignItems:'center',gap:4}}><I n="calendar-check" style={{fontSize:13}}/>{t(o.dates,zh)}</span></span>
   <span style={{display:'block',height:4,borderRadius:2,background:'var(--hover)',overflow:'hidden'}}><span style={{display:'block',height:'100%',width:(o.fit*100)+'%',borderRadius:2,background:o.best?'var(--accent)':'var(--text3)',transformOrigin:'left',animation:'cmGrow 700ms cubic-bezier(.2,.8,.2,1) both',animationDelay:(150+i*80)+'ms'}}/></span>
  </div>
  <span style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}><span style={{fontSize:15,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{o.price}</span><span style={{fontSize:11,color:'var(--text3)'}}>{o.per?t(o.per,zh):(zh?'两晚总价':'two nights')}</span></span></div>)}</div>;
 if(v.kind==='stats')return <div style={{display:'flex',flexDirection:'column',gap:10}}>
  <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>{v.tiles.map((tl,i)=><div key={i} style={{display:'flex',flexDirection:'column',gap:2,padding:12,...box}}><span style={{fontSize:22,fontWeight:600,letterSpacing:'-0.02em',color:tl.color||'var(--text)',fontVariantNumeric:'tabular-nums'}}>{tl.value}</span><span style={{fontSize:12,color:'var(--text3)',textWrap:'pretty'} as React.CSSProperties}>{t(tl.label,zh)}</span></div>)}</div>
  <div style={{display:'flex',flexDirection:'column',padding:'4px 14px',...box}}>{v.events.map((e,i)=><div key={i} style={row(i,v.events.length,{alignItems:'flex-start'})}><span style={{width:48,flex:'none',fontSize:12,color:'var(--text3)',fontVariantNumeric:'tabular-nums'}}>{t(e.date,zh)}</span><span style={{flex:1,minWidth:0,fontSize:13,textWrap:'pretty'} as React.CSSProperties}>{t(e.text,zh)}</span></div>)}</div>
 </div>;
 return <div style={{display:'flex',flexDirection:'column',padding:'4px 14px',...box}}>{v.rows.map((m,i)=><div key={i} style={row(i,v.rows.length)}>
  <span style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}><span style={{fontWeight:500}}>{t(m.name,zh)}</span><span style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontVariantNumeric:'tabular-nums'}}><span style={{color:'var(--text3)',textDecoration:'line-through'}}>{m.from}</span><I n="arrow-right" style={{fontSize:11,color:'var(--text3)'}}/><span style={{color:'var(--text)'}}>{m.to}</span></span></span>
  <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12,color:m.rsvp==='yes'?'var(--okText)':'#b25e00',whiteSpace:'nowrap'}}><I n={m.rsvp==='yes'?'check-circle':'clock'} style={{fontSize:13}}/>{m.rsvp==='yes'?(zh?'已接受':'Accepted'):(zh?'待回复':'Pending')}</span></div>)}</div>;
}

// A malformed persisted visual hides only its own diagram; the card and the rest of the app keep rendering.
class VisualBoundary extends React.Component<{children:React.ReactNode},{bad:boolean}>{
 state={bad:false};static getDerivedStateFromError(){return {bad:true}}
 render(){return this.state.bad?null:this.props.children}
}
function guarded<P extends object>(View:(p:P)=>React.ReactNode){return (p:P)=><VisualBoundary><View {...p}/></VisualBoundary>}
export const DecisionVis=guarded(DecisionVisView),Meters=guarded(MetersView),InsightVis=guarded(InsightVisView),GalleryVis=guarded(GalleryVisView),WorkVis=guarded(WorkVisView);
