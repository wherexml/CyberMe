// A read-only index over original documents. Classification never rewrites stored facts.
export const memoryCategories=[
 {id:'identity',zh:'个人资料',en:'About me',icon:'contact',title:/^(关于我|关于你|个人资料|身份愿景|about (me|you|steve)|identity|profile)$/i,words:/我叫|我的名字|我负责|担任|my name|my role/i},
 {id:'work',zh:'工作与项目',en:'Work & projects',icon:'roadmap',title:/工作|项目|work|project/i,words:/项目|产品|客户|团队|业务|仓库|主仓|worktree|\/Users\/|project|repository|client/i},
 {id:'preference',zh:'沟通偏好',en:'Preferences',icon:'focus',title:/^(偏好|沟通偏好|preferences?|communication)$/i,words:/沟通|语言|中文|英文|回复|语气|排版|格式|prefer|communication|language/i},
 {id:'life',zh:'生活习惯',en:'Life & habits',icon:'calendar',title:/生活|习惯|life|habit/i,words:/生活|习惯|作息|运动|散步|跑步|早起|habit|routine/i},
 {id:'interest',zh:'兴趣爱好',en:'Interests',icon:'compass',title:/兴趣|爱好|interest|hobb/i,words:/喜欢|爱好|兴趣|摄影|旅行|音乐|电影|hobby|enjoy/i},
 {id:'learning',zh:'学习与知识',en:'Learning',icon:'knowledge',title:/学习|知识|learning|knowledge/i,words:/学习|阅读|读书|课程|研究|learn|reading|course/i},
 {id:'goal',zh:'目标与计划',en:'Goals & plans',icon:'target',title:/目标|计划|愿景|goal|plan|vision/i,words:/目标|计划|愿景|希望成为|goal|plan|aspire/i},
 {id:'device',zh:'设备与环境',en:'Devices',icon:'server',title:/设备|环境|device|environment/i,words:/设备|电脑|服务器|端口|macbook|mac mini|macmini|iphone|device|server/i},
 {id:'automation',zh:'自动化偏好',en:'Automation',icon:'workflow',title:/自动化|automation/i,words:/自动化|自动整理|定时|工作流|automation|workflow|schedule/i},
 {id:'finance',zh:'财务资料',en:'Finance',icon:'finance',title:/财务|财金|finance/i,words:/财务|预算|报销|账单|budget|finance|invoice/i},
 {id:'feedback',zh:'反馈与经验',en:'Feedback',icon:'insight',title:/反馈|经验|feedback|lesson/i,words:/反馈|经验|教训|复盘|feedback|lesson/i},
] as const;
export type MemoryCategory=typeof memoryCategories[number];
export function memoryCategory(title:string,text='',storedCategory=''){
 const explicit=memoryCategories.find(c=>c.title.test(title));
 if(explicit)return explicit.id;
 const stored=memoryCategories.find(c=>c.id===storedCategory);
 if(stored&&storedCategory!=='work'&&storedCategory!=='preference')return stored.id;
 // Specific topics win over general preference/work matches.
 const specific=memoryCategories.filter(c=>!['identity','work','preference'].includes(c.id)).find(c=>c.words.test(text));
 return specific?.id||memoryCategories.find(c=>c.words.test(text))?.id||stored?.id||'notes';
}
