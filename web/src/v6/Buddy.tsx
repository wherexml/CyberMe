import React from 'react';
// Mascot variants and animation timings from the V6 reference `buddy()`.
export const BUDDY:Record<string,{name:[string,string];c:string;hi:string;in:string;ears:null|'bunny'|'round'|'fox'|'antenna'|'horns';eye:[number,number];gap:number;teeth?:number;cheek?:string;cat?:boolean}>={
 classic:{name:['Classic','经典'],c:'#0a84ff',hi:'#5eb3ff',in:'#fff',ears:null,eye:[8,11],gap:9},
 bubu:{name:['Bubu, the toothy bunny','Bubu · 小尖牙兔'],c:'#c8a27a',hi:'#ecd3b4',in:'#f6b7c4',ears:'bunny',eye:[9,11],gap:12,teeth:4,cheek:'#ff8fa3'},
 momo:{name:['Momo, the bear','Momo · 小熊'],c:'#ff8fb1',hi:'#ffd0de',in:'#ffe3ec',ears:'round',eye:[8,10],gap:14,cheek:'#ff5c8a'},
 kiki:{name:['Kiki, the fox','Kiki · 小狐狸'],c:'#ff9f45',hi:'#ffd2a3',in:'#fff',ears:'fox',eye:[7,10],gap:16,cat:true,cheek:'#ff6b3d'},
 nono:{name:['Nono, the sprout','Nono · 小芽'],c:'#5fd3a7',hi:'#b8f1db',in:'#ffd84d',ears:'antenna',eye:[9,12],gap:11,cheek:'#ff9fb0'},
 yaya:{name:['Yaya, the little monster','Yaya · 小怪兽'],c:'#9b7bff',hi:'#cdbdff',in:'#ffe9a8',ears:'horns',eye:[10,12],gap:10,teeth:3,cheek:'#ff8fd1'}
};
export function Buddy({k,S,hop,curHop,happy}:{k:string;S:number;hop:number;curHop:number;happy:boolean}){
 const u=(n:number)=>n*S/72,B=BUDDY[k]||BUDDY.classic;const isHappy=hop>0&&curHop===hop&&happy;
 const ear=(side:'l'|'r')=>{const L=side==='l';const base:React.CSSProperties={position:'absolute',zIndex:0,transformOrigin:'50% 100%',animation:(L?'cbEarL':'cbEarR')+' 2.6s ease-in-out infinite',animationDelay:L?'0s':'.3s'};const pos=(v:number)=>L?{left:v}:{right:v};
  if(B.ears==='bunny')return <span key={side} style={{...base,width:u(16),height:u(34),top:u(-20),...pos(u(12)),borderRadius:'50% 50% 45% 45%',background:B.c,boxShadow:'inset 0 0 0 '+u(4)+'px '+B.c,display:'flex',justifyContent:'center',alignItems:'flex-end',paddingBottom:u(4),boxSizing:'border-box'}}><span style={{width:u(7),height:u(20),borderRadius:u(4),background:B.in}}/></span>;
  if(B.ears==='round')return <span key={side} style={{...base,width:u(24),height:u(24),top:u(-4),...pos(u(4)),borderRadius:'50%',background:B.c,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{width:u(12),height:u(12),borderRadius:'50%',background:B.in}}/></span>;
  if(B.ears==='fox')return <span key={side} style={{...base,width:u(22),height:u(26),top:u(-10),...pos(u(6)),borderRadius:L?u(4)+'px '+u(20)+'px '+u(4)+'px '+u(4)+'px':u(20)+'px '+u(4)+'px '+u(4)+'px '+u(4)+'px',background:B.c,transform:'rotate('+(L?-12:12)+'deg)'}}/>;
  if(B.ears==='horns')return <span key={side} style={{...base,width:u(11),height:u(16),top:u(-6),...pos(u(16)),borderRadius:'50% 50% 30% 30%',background:B.in}}/>;
  return null;};
 const antenna=B.ears==='antenna'?<span key="ant" style={{position:'absolute',top:u(-16),left:'50%',marginLeft:u(-1),width:u(2.5),height:u(18),background:B.c,borderRadius:u(2),transformOrigin:'50% 100%',animation:'cbEarL 2.2s ease-in-out infinite'}}><span style={{position:'absolute',top:u(-7),left:u(-4.5),width:u(11),height:u(11),borderRadius:'50%',background:B.in,animation:'cbBall 1.4s ease-in-out infinite'}}/></span>:null;
 const eye=(key:number)=>isHappy?<span key={key} style={{width:u(10),height:u(6),borderTop:u(3)+'px solid #1d1d1f',borderRadius:u(10)+'px '+u(10)+'px 0 0',boxSizing:'border-box',marginTop:u(4)}}/>
  :<span key={key} style={{position:'relative',width:u(B.eye[0]),height:u(B.eye[1]),borderRadius:'50%',background:'#1d1d1f',animation:'cmBlink 4.2s infinite',transformOrigin:'center'}}><span style={{position:'absolute',top:u(2),left:u(2),width:u(3.5),height:u(3.5),borderRadius:'50%',background:'#fff'}}/></span>;
 const teeth=B.teeth?Array.from({length:B.teeth},(_,i)=><span key={i} style={{width:u(4),height:u(4.5),background:'#fff',clipPath:'polygon(0 0,100% 0,50% 100%)'}}/>):null;
 const mouth=B.teeth?<span key="m" style={{width:u(22),height:u(isHappy?11:9),borderRadius:'0 0 '+u(11)+'px '+u(11)+'px',background:'#4a1f2a',display:'flex',justifyContent:'space-between',padding:'0 '+u(3)+'px',boxSizing:'border-box',overflow:'hidden',transition:'height 200ms'}}>{teeth}</span>
  :B.cat?<span key="m" style={{fontSize:u(13),lineHeight:1,color:'#4a1f2a',fontWeight:700}}>ω</span>
  :<span key="m" style={{width:u(14),height:u(isHappy?9:6),borderRadius:'0 0 '+u(8)+'px '+u(8)+'px',background:k==='classic'?'#fff':'#4a1f2a',transition:'height 200ms'}}/>;
 const cheeks=B.cheek?[<span key="cl" style={{position:'absolute',left:u(9),top:u(38),width:u(11),height:u(7),borderRadius:'50%',background:B.cheek,opacity:.7}}/>,<span key="cr" style={{position:'absolute',right:u(9),top:u(38),width:u(11),height:u(7),borderRadius:'50%',background:B.cheek,opacity:.7}}/>]:null;
 const eyes=k==='classic'?[<span key={1} style={{width:u(7),height:u(13),borderRadius:u(4),background:'#fff',animation:'cmBlink 4.2s infinite'}}/>,<span key={2} style={{width:u(7),height:u(13),borderRadius:u(4),background:'#fff',animation:'cmBlink 4.2s infinite'}}/>]:[eye(1),eye(2)];
 const face=<span key="face" style={{position:'relative',zIndex:1,width:u(64),height:u(60),borderRadius:B.ears==='fox'?'48% 48% 46% 46%':'50%',background:'radial-gradient(circle at 35% 28%, '+B.hi+', '+B.c+' 62%)',boxShadow:'inset 0 '+u(-3)+'px '+u(8)+'px rgba(0,0,0,.1), 0 '+u(6)+'px '+u(16)+'px rgba(0,0,0,.14)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:u(5)}}>
  {cheeks}<span style={{display:'flex',gap:u(B.gap),animation:'cbLook 7s ease-in-out infinite',alignItems:'center',height:u(14)}}>{eyes}</span>{mouth}</span>;
 return <span key={'b'+hop} style={{position:'relative',width:u(72),height:u(72),display:'flex',alignItems:'flex-end',justifyContent:'center',animation:hop&&curHop===hop?'cbHop 700ms cubic-bezier(.3,.7,.4,1) both':'cbBob 3.2s ease-in-out infinite'}}>{ear('l')}{ear('r')}{antenna}{face}</span>;
}
