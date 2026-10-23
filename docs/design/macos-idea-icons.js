/* Original fallback artwork for the HTML study. Source data and navigation icons are untouched. */
(() => {
 const base = new URL('assets/idea-icons/', document.currentScript.src);
 const labels = Object.freeze({"report":"周报","meeting":"会议","briefing":"每日摘要","followup":"客户跟进","automation":"自动化","insight":"洞察","research":"资料研究","reminder":"后续提醒","files":"文件整理","workflow":"流程优化","privacy":"权限与安全","finance":"费用与账单","calendar":"日程","deadline":"截止时间","checklist":"待办清单","roadmap":"路线规划","milestone":"里程碑","target":"目标","code":"开发","bug":"缺陷修复","deploy":"发布部署","server":"服务运行","database":"数据管理","api":"接口集成","cloud":"云资源","branch":"版本分支","test":"测试验收","terminal":"命令工具","team":"团队协作","handshake":"合作洽谈","contact":"联系人","message":"沟通反馈","presentation":"汇报演示","contract":"合同","approval":"审批确认","signature":"签署","book":"学习","knowledge":"知识整理","search":"检索","archive":"归档","chart":"数据分析","growth":"业务增长","budget":"预算","invoice":"票据报销","risk":"风险提醒","backup":"备份恢复","compass":"方向决策","focus":"专注推进"});
 // An ID-seeded choice gives each suggestion artwork without changing on refresh.
 function key(idea = {}) {
  if (typeof idea.iconKey === 'string' && Object.hasOwn(labels, idea.iconKey)) return idea.iconKey;
  let seed=2166136261;for(const char of String(idea.id||idea.title||'idea'))seed=Math.imul(seed^char.codePointAt(0),16777619)>>>0;
  const names=Object.keys(labels);return names[seed%names.length];
 }
 function create(idea) {
  const name = key(idea), img = document.createElement('img');
  img.className = 'idea-artwork';img.src = new URL(name + '.svg', base).href;
  img.alt = '';img.setAttribute('aria-hidden','true');img.width = 44;img.height = 44;
  img.draggable = false;img.dataset.iconKey = name;
  return img;
 }
 window.OpsTwinsIdeaIcons = Object.freeze({labels,key,create});
})();
