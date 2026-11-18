// Injected into the existing V6 prototype's DC script. Synthetic records only; no fetch or business API.
const MOCK_NOW='2026-11-11T15:00';let mockSeq=0;
function mockRevisionSeed(empty){return {mockOpen:false,mockSearching:0,mockResult:'',mockUpdated:{},mockRows:empty?{}:{
 'decision:d2':{state:'snoozed',until:'2026-11-12T09:00'},'idea:g6':{state:'snoozed',until:'2026-11-14T08:30'},
 'idea:g3':{state:'ignored',at:'2026-11-10T16:20'},'idea:g5':{state:'local'},'idea:g4':{state:'snoozed',until:'2026-11-11T09:00'}}}}
const mockActive=r=>!(r.state==='snoozed'&&r.until<=MOCK_NOW);
function mockRevisionValues(c,v){
 const s=c.state,zh=s.lang==='zh',text=(en,cn)=>zh?cn:en,p=a=>Array.isArray(a)?a[zh?1:0]:a;
 const visible=s.tab==='today'&&!s.detail,rows=s.mockRows||{},hidden={};
 for(const [k,r] of Object.entries(rows))if(mockActive(r))hidden[k]=r;
 const decisions=[...BRIEF.items].sort((a,b)=>b.urgent-a.urgent);
 const at=iso=>{const [d,t]=iso.split('T'),[,m,day]=d.split('-').map(Number);return zh?`${m}月${day}日 ${t}`:`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${day}, ${t}`};
 const q=sel=>document.querySelector(sel);
 const stable=(update,after)=>{const top=q('[data-mock-footer]')?.getBoundingClientRect().top;c.setState(update,()=>{const f=q('[data-mock-footer]'),sc=q('[data-mock-panel-scroll]');if(f&&sc&&top!=null)sc.scrollTop+=f.getBoundingClientRect().top-top;after&&after()})};
 const setRow=(key,fn)=>c.setState(x=>x.mockRows[key]?{mockRows:{...x.mockRows,[key]:fn(x.mockRows[key])}}:{});
 const remove=key=>stable(x=>{const next={...x.mockRows};delete next[key];return {mockRows:next,mockOpen:x.mockOpen&&Object.values(next).some(mockActive)}},()=>{
  const a=document.activeElement;if(a&&a!==document.body&&!a.closest('[data-mock-footer]'))return;
  q(c.state.mockOpen?'[data-mock-history-toggle]':'[data-mock-refresh]')?.focus({preventScroll:true})});
 const run=(key,action)=>{const cur=c.state.mockRows[key];if(!cur||cur.busy)return;
  if(action==='restore'&&cur.state==='local')return remove(key);
  const token=++mockSeq,mode=c.state.mockRestoreMode||'ok';setRow(key,r=>({...r,busy:token,action,error:''}));
  c.later(1200,()=>{const r=c.state.mockRows[key];if(!r||r.busy!==token)return;
   if(mode!=='ok')return setRow(key,r=>({...r,busy:0,error:mode}));
   if(action==='ignore')return setRow(key,()=>({state:'ignored',at:MOCK_NOW}));
   remove(key)})};
 const rank={snoozed:0,ignored:1,local:2};
 const history=Object.entries(hidden).map(([key,r])=>{
  const [kind,id]=key.split(':'),record=(kind==='decision'?decisions:GAL).find(x=>x.id===id);if(!record)return null;
  const errors={'failed:restore':text("Couldn't restore. Try again.",'未能恢复，可重试'),'conflict:restore':text('Updated elsewhere; not restored','已有更新，未恢复'),'failed:ignore':text("Couldn't ignore. Try again.",'未能忽略，可重试'),'conflict:ignore':text('Updated elsewhere; not ignored','已有更新，未忽略')};
  const note=r.busy?(r.action==='ignore'?text('Ignoring…','忽略中…'):text('Restoring…','恢复中…')):r.error?errors[r.error+':'+r.action]:'';
  return {key,kind,r,title:p(record.q||record.t),state:r.state,busy:!!r.busy,busyAttr:r.busy?'true':'false',canIgnore:r.state==='local',
   status:r.state==='snoozed'?text('Snoozed until ','推迟到 ')+at(r.until):r.state==='ignored'?text('Ignored','已忽略'):text('Hidden on this device only','仅本机隐藏'),
   note,hasNote:!!note,noteStyle:{fontSize:12,color:r.error?'var(--warnText)':'var(--text3)'},
   onRestore:()=>run(key,'restore'),onIgnore:()=>run(key,'ignore')};
 }).filter(Boolean).sort((a,b)=>rank[a.state]-rank[b.state]||(a.state==='snoozed'?a.r.until.localeCompare(b.r.until):a.state==='ignored'?(b.r.at||'').localeCompare(a.r.at||''):a.key.localeCompare(b.key)));
 v.mockShowFooter=visible;v.mockHasHistory=history.length>0;v.mockHistoryOpen=visible&&!!s.mockOpen&&history.length>0;v.mockHistoryExpanded=v.mockHistoryOpen?'true':'false';
 v.mockHistoryLabel=text('Ignored & snoozed','忽略与推迟');v.mockRefreshLabel=s.mockSearching?text('Searching…','查找中…'):text('Refresh insights','刷新洞察');
 v.mockRestoreLabel=text('Restore','恢复');v.mockIgnoreLabel=text('Ignore','忽略');v.mockHistoryRows=history;v.mockSearching=!!s.mockSearching;
 // On expansion scroll the right panel only as far as needed to reveal the first complete row.
 v.mockToggleHistory=()=>c.setState(x=>({mockOpen:!x.mockOpen}),()=>{if(!c.state.mockOpen)return;
  const sc=q('[data-mock-panel-scroll]'),row=q('[data-mock-history-row]');if(!sc||!row)return;
  const over=row.getBoundingClientRect().bottom+8-sc.getBoundingClientRect().bottom;if(over>0)sc.scrollTop+=over});
 v.mockRefresh=()=>{
  if(c.state.mockSearching)return;
  const token=++mockSeq,mode=c.state.mockRefreshMode||'none';
  c.setState({mockSearching:token,mockResult:''});
  c.later(1600,()=>{if(c.state.mockSearching!==token)return;
   const target=mode==='updated'&&GAL.find(g=>!c.state.mockRows['idea:'+g.id]||!mockActive(c.state.mockRows['idea:'+g.id]));
   if(target)return c.setState(x=>({mockSearching:0,mockResult:'updated',mockUpdated:{...x.mockUpdated,['idea:'+target.id]:true}}));
   c.setState({mockSearching:0,mockResult:mode==='failed'?'failed':'none'})});
 };
 v.mockStatus=visible&&(!!s.mockSearching||!!s.mockResult);
 v.mockStatusText=s.mockSearching?text('Searching…','查找中…'):s.mockResult==='failed'?text('Search did not finish','查找未完成'):s.mockResult==='updated'?text('Insights updated','洞察已更新'):text('No new insights','暂无新洞察');
 v.mockFailed=!s.mockSearching&&s.mockResult==='failed';v.mockRetryLabel=text('Retry','重试');
 v.mockShowEmpty=visible&&!!s.empty;v.mockEmptyText=text('No insights yet','暂无洞察');
 const showFeed=visible&&!s.empty;
 v.showBrief=showFeed;v.showToday=showFeed;v.insEmpty=false;v.br.onDec=true;v.br.allDone=false;
 v.br.decs=v.br.decs.map((d,i)=>({...d,mockKey:'decision:'+decisions[i].id,askWhy:false,hasWhy:false,onLater:()=>stable(x=>({mockRows:{...x.mockRows,['decision:'+decisions[i].id]:{state:'snoozed',until:'2026-11-12T09:00'}}}))})).filter(d=>!hidden[d.mockKey]);
 v.gal=v.gal.map((g,i)=>{const key='idea:'+GAL[i].id;return {...g,mockKey:key,show:g.show&&!hidden[key],gone:false,when:s.mockUpdated&&s.mockUpdated[key]?text('Updated just now','刚刚更新'):g.when,
  onLater:()=>stable(x=>({mockRows:{...x.mockRows,[key]:{state:'ignored',at:MOCK_NOW}}}))}});
 v.tabs=v.tabs.map((tab,i)=>i===0?{...tab,label:text('Insights','洞察')}:tab);
 const seg=on=>({height:24,padding:'0 10px',border:'none',borderRadius:6,font:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap',background:on?'var(--convBg)':'transparent',color:on?'var(--text)':'var(--text2)',boxShadow:on?'0 0 0 0.5px var(--lineStrong)':'none'});
 const group=(label,field,current,opts)=>({label,opts:opts.map(([k,l])=>({label:l,style:seg(current===k),onClick:()=>c.setState({[field]:k})}))});
 v.simGroups=v.simGroups.map((g,i)=>i===0?{...g,opts:g.opts.filter((_,j)=>j!==1)}:g).concat([
  group(text('Restore','恢复'),'mockRestoreMode',s.mockRestoreMode||'ok',[['ok',text('Succeeds','成功')],['failed',text('Fails','失败')],['conflict',text('Conflict','冲突')]]),
  group(text('Refresh','刷新'),'mockRefreshMode',s.mockRefreshMode||'none',[['none',text('No change','无变化')],['updated',text('Updated','有更新')],['failed',text('Fails','失败')]])]);
 return v;
}
