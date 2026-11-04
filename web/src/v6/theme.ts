// V6 design tokens, copied from the reference. Paper uses the bundled Broadsheet ramp
// (web/src/v6/broadsheet.css) instead of the remote design-system bundle.
export type ThemeKey='quiet'|'paper'|'night';
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
 paper:{
  '--desk':'var(--color-neutral-300)','--convBg':'var(--color-bg)','--aiBubble':'var(--color-bg)','--aiLine':'var(--color-neutral-300)','--userBubble':'var(--color-surface)',
  '--panel':'var(--color-surface)','--card':'var(--color-bg)','--cardLine':'var(--color-neutral-300)','--composer':'var(--color-bg)','--segBg':'var(--color-neutral-200)','--segOn':'var(--color-bg)',
  '--line':'var(--color-neutral-300)','--lineStrong':'var(--color-neutral-400)','--hover':'var(--color-neutral-200)','--selected':'var(--color-neutral-300)',
  '--text':'var(--color-text)','--text2':'var(--color-neutral-700)','--text3':'var(--color-neutral-600)',
  '--accent':'var(--color-accent)','--accentHover':'var(--color-accent-600)','--accentText':'var(--color-accent-700)','--accentSoft':'var(--color-accent-100)','--onAccent':'#ffffff',
  '--warnSoft':'color-mix(in oklch, var(--color-process-yellow) 22%, var(--color-bg))','--warnText':'var(--color-neutral-800)','--warnDot':'var(--color-process-yellow)',
  '--errSoft':'var(--color-accent-2-100)','--errText':'var(--color-accent-2-700)','--errDot':'var(--color-accent-2-500)',
  '--okSoft':'var(--color-neutral-200)','--okText':'var(--color-accent-700)','--okDot':'var(--color-accent)',
  '--font':'var(--font-body), "Songti SC", serif',
  '--r-win':'3px','--r-bubble':'2px','--r-card':'2px','--r-inner':'2px','--r-innerBtn':'2px','--r-btn':'2px','--r-pill':'2px','--r-chip':'2px','--r-menu':'2px','--r-menuItem':'2px','--r-seg':'2px','--r-segOn':'2px','--r-sm':'2px','--r-xs':'2px',
  '--winShadow':'var(--shadow-lg)','--composerShadow':'0 0 0 0 transparent','--segShadow':'0 0 0 0.5px var(--color-neutral-400)'
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
export const isTheme=(v:unknown):v is ThemeKey=>v==='quiet'||v==='paper'||v==='night';
