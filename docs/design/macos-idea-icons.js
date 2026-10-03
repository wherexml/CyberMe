/* Original fallback artwork for the HTML study. Source data and navigation icons are untouched. */
(() => {
 const base = new URL('assets/idea-icons/', document.currentScript.src);
 const labels = Object.freeze({report:'周报',meeting:'会议',briefing:'每日摘要',followup:'客户跟进',automation:'自动化',insight:'洞察',research:'资料研究',reminder:'后续提醒',files:'文件整理',workflow:'流程优化',privacy:'权限与安全',finance:'费用与账单'});
 const samples = {'sample-weekly-review':'report','sample-meeting-followups':'meeting','sample-daily-digest':'briefing','sample-customer-followup':'followup','sample-work-pattern':'workflow','sample-open-loops':'reminder'};
 const categories = {productivity:'report',meetings:'meeting',Meetings:'meeting',customers:'followup',Customers:'followup',communication:'followup',automation:'automation',Automate:'automation',insight:'insight',followups:'reminder','Follow-ups':'reminder',research:'research',finance:'finance',security:'privacy'};
 function key(idea = {}) {
  if (Object.hasOwn(labels, idea.iconKey)) return idea.iconKey;
  if (Object.hasOwn(samples, idea.id)) return samples[idea.id];
  if (Object.hasOwn(categories, idea.category)) return categories[idea.category];
  return idea.action === 'file' ? 'files' : idea.action === 'automation' ? 'automation' : idea.action === 'task' ? 'reminder' : 'insight';
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
