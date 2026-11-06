// V6 light and dark design tokens.
export type ThemeKey='quiet'|'night';
export const THEMES:Record<ThemeKey,Record<string,string>>={
 quiet:{
  '--desk':'#e0e1e6','--convBg':'#f7f7f9','--aiBubble':'#ffffff','--aiLine':'rgba(0,0,45,0.08)','--userBubble':'#e8e8ec',
  '--panel':'#eeeff3','--card':'#ffffff','--cardLine':'rgba(0,0,45,0.07)','--composer':'#ffffff','--segBg':'rgba(0,0,50,0.06)','--segOn':'#ffffff',
  '--line':'rgba(0,0,45,0.1)','--lineStrong':'rgba(0,0,45,0.16)','--hover':'rgba(0,0,50,0.05)','--selected':'rgba(0,0,50,0.09)',
  '--text':'#1c2024','--text2':'#60646c','--text3':'#80838d',
  '--accent':'#0090ff','--accentHover':'#0588f0','--accentText':'#0d74ce','--accentSoft':'#e6f4fe','--onAccent':'#ffffff',
  '--warnSoft':'#fff7c2','--warnText':'#ab6400','--warnDot':'#ffc53d',
  '--errSoft':'#feebec','--errText':'#ce2c31','--errDot':'#e5484d',
  '--okSoft':'#e6f6eb','--okText':'#218358','--okDot':'#30a46c',
  '--font':'-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", system-ui, sans-serif',
  '--r-win':'12px','--r-bubble':'16px','--r-card':'16px','--r-inner':'12px','--r-innerBtn':'8px','--r-btn':'10px','--r-pill':'22px','--r-chip':'16px','--r-menu':'14px','--r-menuItem':'8px','--r-seg':'10px','--r-segOn':'7px','--r-sm':'8px','--r-xs':'4px',
  '--winShadow':'0 0 0 0.5px rgba(0,0,0,0.14), 0 24px 64px -16px rgba(0,0,40,0.28), 0 8px 20px -8px rgba(0,0,40,0.12)',
  '--composerShadow':'0 2px 8px -2px rgba(0,0,40,0.06)','--segShadow':'0 0 0 0.5px rgba(0,0,40,0.08), 0 1px 2px rgba(0,0,40,0.08)'
 },
 night:{
  '--desk':'#0c0c0e','--convBg':'#111113','--aiBubble':'#1c1d20','--aiLine':'rgba(255,255,255,0.06)','--userBubble':'#2b2d31',
  '--panel':'#18191b','--card':'#212225','--cardLine':'rgba(255,255,255,0.07)','--composer':'#1c1d20','--segBg':'rgba(255,255,255,0.06)','--segOn':'#2e3135',
  '--line':'rgba(255,255,255,0.09)','--lineStrong':'rgba(255,255,255,0.16)','--hover':'rgba(255,255,255,0.06)','--selected':'rgba(255,255,255,0.1)',
  '--text':'#edeef0','--text2':'#b0b4ba','--text3':'#80848c',
  '--accent':'#6e56cf','--accentHover':'#7d66d9','--accentText':'#baa7ff','--accentSoft':'#291f43','--onAccent':'#ffffff',
  '--warnSoft':'#302008','--warnText':'#ffca16','--warnDot':'#ffc53d',
  '--errSoft':'#3b1219','--errText':'#ff9592','--errDot':'#e5484d',
  '--okSoft':'#132d21','--okText':'#3dd68c','--okDot':'#30a46c',
  '--font':'"IBM Plex Sans", "PingFang SC", system-ui, sans-serif',
  '--r-win':'12px','--r-bubble':'14px','--r-card':'14px','--r-inner':'10px','--r-innerBtn':'6px','--r-btn':'8px','--r-pill':'20px','--r-chip':'14px','--r-menu':'12px','--r-menuItem':'6px','--r-seg':'9px','--r-segOn':'6px','--r-sm':'6px','--r-xs':'3px',
  '--winShadow':'0 0 0 0.5px rgba(255,255,255,0.12), 0 24px 64px -16px rgba(0,0,0,0.7)',
  '--composerShadow':'0 0 0 0 transparent','--segShadow':'0 0 0 0.5px rgba(255,255,255,0.08)'
 }
};
export const isTheme=(v:unknown):v is ThemeKey=>v==='quiet'||v==='night';
