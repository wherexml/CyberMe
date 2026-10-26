import {legacyWorkspace} from './workspace-legacy.js';

const ref=(type,id,label)=>({type,id,label});
const check=(id,text,done=false)=>({id,text,done});
export const workspaceInbox=[
 {id:'i1',name:'林可',initial:'可',color:'lavender',source:'飞书 · 产品讨论',title:'确认本周评审的方案范围',summary:'两版方案的差异已列出，今天下午前需要确认核心路径与连接配置的边界。',time:'10:24',status:'pending',judgment:[90,78,32],draftConfidence:'STANDARD',
  messages:[['other','本周评审我整理了两版方案。A版先走收件箱、对话和任务的核心路径；B版把连接配置的完整表单也放进来。我的建议是先聚焦核心流程，连接配置放到下一轮，你看是否合适？'],['me','我先看看两版的区别，尤其是收件箱切到对话以后怎么回来'],['other','核心差异在收件箱与设置的衔接。A版保留查看原消息、修改回复、带上下文讨论、确认处理和返回列表；B版还要讨论新增供应商、授权和同步窗口，准备量会多不少。'],['other','连接配置的完整交互可以后移，但连接失效时的提示、人工稿保留和未确认结果回查不能后移，否则核心流程走不完整。方案笔记已经按这个边界更新。'],['other','希望今天下午前确定范围，我再按结论收敛演示顺序。你只需要确认本轮采用哪条边界，具体检查步骤我来补。']],
  draft:'本轮先聚焦收件箱到对话的核心流程，连接配置的完整交互放到下一轮\n评审时把来源上下文、草稿修改、确认处理和返回列表一起走完，连接失效时怎么保留输入也看一下\n两版方案就按这条路径列差异，先不用补全所有设置细节',
  analysis:'## 需要回复\n林可已经列出两版方案的差异，正在等范围决定。你上一条“我先看看”没有完成这个决定。\n\n## 需要你决策\n建议采用核心路径优先：连接配置完整表单后移，连接失效、保稿和未确认恢复留在本轮。这个取舍会改变准备范围，应由你确认。\n\n## 下一步\n你确认边界后，林可收敛演示顺序；任务“确认本周产品评审范围”记录结论，评审方案保留异常路径。',
  refs:[ref('task','t1','确认评审范围'),ref('idea','a1','评审决定与行动清单'),ref('document','review-plan','本周评审方案')]},
 {id:'i2',name:'周宁',initial:'宁',color:'sage',source:'飞书 · 设计协作',title:'下午评审的议程已更新',summary:'搜索与记忆已加入议程草案；开始时间还在协调，需要补齐时间并确认讨论顺序。',time:'09:48',status:'pending',judgment:[85,40,20],draftConfidence:'HIGH_CONFIDENCE',
  messages:[['other','下午评审的议程草案已更新，补充了搜索和记忆入口的讨论。现在按收件箱、对话、搜索和记忆、连接设置排了一版，麻烦确认是否按这个顺序。'],['me','先把核心流程放前面，开始时间也再给我一下'],['other','可以，搜索和记忆我会放在核心流程之后。连接配置如果单独开下一轮，这次就只保留连接失效时的用户反馈。'],['other','确切开始时间还在跟大家协调，确认后我会补到议程。你可以先看45分钟的讨论分配，暂时不要把它当成已经定好的日程。']],
  draft:'议程先看收件箱到对话的完整流程，再讨论搜索和记忆入口\n连接配置放到下一轮，核心流程里的断开和失败恢复这次保留\n开始时间再发我一下，我确认后我们就按这个顺序准备',
  analysis:'## 需要回复\n周宁希望确认议程顺序，也明确开始时间仍在协调。可以先确认顺序，并追问确切时间。\n\n## 不要代为承诺\n45分钟只是建议的讨论时长，没有开始时间，不能推定日程可用，更不能自动发送参会邀请。\n\n## 已完成与未完成\n议程初稿已整理，任务“整理评审议程初稿”可以保持完成；“确认评审时间与材料”仍待处理，两者不是同一件事。',
  refs:[ref('task','t4','议程初稿'),ref('task','t5','确认时间与材料'),ref('conversation','review','产品评审准备')]},
 {id:'i3',name:'项目协作群',initial:'项',color:'sand',source:'飞书 · 项目协作',title:'部署检查结果待核实',summary:'昨天的检查超时且没有确认结论，先回查原运行，再决定是否需要重试。',time:'昨天',status:'unknown',judgment:null,
  messages:[['other','昨天那次部署检查在等待结果时超时了，目前没有拿到完整结论。先不要把这条检查标记通过。'],['me','先查原记录，确认是不是还在执行，不要直接再跑一次'],['other','我会补原运行的状态、最后完成步骤和已有结果。超时可能只发生在等待返回阶段，现在还不能判断检查究竟失败了还是已经完成。'],['other','如果原记录显示部分步骤已做完，我们先列清已完成部分和剩余部分，再讨论怎么恢复。现在先保留待核实，避免重复执行。']],draft:'',
  analysis:'## 结果未确认\n现有消息只有超时与缺少结论，没有足够证据判断成功或失败，因此不生成判断百分比。\n\n## 先核实什么\n原运行是否还在执行、最后完成哪一步、是否已有结果、是否产生外部变化。先沿原记录回查。\n\n## 恢复边界\n确认失败且没有执行结果后才能讨论明确重试；部分完成先核已做部分；仍未知时保留原记录，不新开一轮。',
  refs:[ref('task','t3','回查部署原记录'),ref('idea','a4','部署检查恢复方案'),ref('document','deploy-check','部署检查核对单')]},
 {id:'i4',name:'陈一',initial:'一',color:'blue',source:'微信 · 只读',title:'参考资料已收到',summary:'参考资料已确认收到；后续只需把讨论、方案和任务按主题关联，无需再次回复。',time:'昨天',status:'done',judgment:[8,5,0],
  messages:[['other','评审参考资料已收到，谢谢。我会先看收件箱到对话的核心路径，有问题再补充。'],['other','方案和讨论最好放在同一主题下，后面查决定依据会方便一些。'],['me','先把方案笔记和对应任务关联，保留原讨论，不重复搬正文'],['other','收到，我会在下一轮评审前看完，后续有问题再补充。']],draft:'',
  analysis:'## 暂时不需要回复\n对方已经确认收到，并说明后续有问题再补充，当前没有新的请求。\n\n## 可以继续准备\n把方案、讨论和对应任务建立关联，保留原始来源。个人微信仍是只读，不能从本页发消息。',
  refs:[ref('idea','a3','评审资料关联'),ref('task','t6','整理评审资料索引'),ref('document','discussion','产品讨论记录')]},
];
for(const item of workspaceInbox)if(item.draft){item.generatedDraft=item.draft;item.previewDraft=item.draft}

export const workspaceIdeas=[
 {id:'a1',title:'把评审结论整理成下一步行动',body:'把林可的范围决定、周宁的议程安排和待核实的部署检查放进同一份行动清单，区分已定、待确认与下一轮。',category:'工作流',icon:'workflow',sources:['本周评审方案','产品讨论记录'],
  details:'## 要解决的问题\n同一场评审的决定分散在产品讨论、设计协作和任务里，容易把“提出建议”当成“已拍板”，或把“议程初稿完成”当成“会议已确认”。\n\n## 具体方案\n按事项保留三栏：已经决定什么、还缺谁的确认、下一步交付什么。范围问题关联林可原消息；时间问题关联周宁原消息；部署检查单独保留未确认，不混进评审通过结论。\n\n## 输出\n一份简短的评审决定清单，每条都能回到来源和对应任务。已有任务直接补充结论，不重复新建。\n\n## 何时算完成\n本轮与下一轮边界明确，确切开始时间得到确认，待核实项没有被写成通过。把未定问题留在清单，不用空白结论凑齐。',
  steps:['先确认本轮只看核心路径，同时保留断开、保稿和未确认恢复','把已定范围写入t1，把需要走通的路径留在t2，时间和材料由t5跟进','评审结束按原来源更新结果；部署原检查没有结论就继续待核实'],
  refs:[ref('inbox','i1','林可 · 范围确认'),ref('inbox','i2','周宁 · 议程确认'),ref('task','t1','确认评审范围'),ref('conversation','review','产品评审准备')]},
 {id:'a2',title:'建立一份轻量的每周工作回顾',body:'从这次评审准备开始，记录已完成的议程初稿、仍待决定的范围，以及部署超时的核实进展，让回顾有真实依据。',category:'简报',icon:'briefing',sources:['本周评审方案','收件箱流程笔记'],
  details:'## 回顾什么\n只记录已经有依据的变化：议程初稿已更新；范围仍待本人决定；开始时间仍待协调；部署检查没有完整结果。不要把草稿、建议或超时记录当成已完成成果。\n\n## 每周怎么整理\n先看完成任务的实际交付物，再看本周新增决定，最后列出未关闭问题。每项用一句结论配一个来源，长正文继续保留在原会话或方案里。\n\n## 回顾草案\n已完成：评审议程草案加入搜索与记忆讨论。待确认：本轮范围和确切开始时间。待核实：部署检查原运行状态。下一步：先拍板范围，再补时间和材料，检查结果沿原记录追踪。\n\n## 使用边界\n这份回顾先作为私人草稿；发送给团队或更新共享资料前，由你确认最终内容。',
  steps:['从完成任务核对实际交付，不按“点了完成”自动扩写成果','把范围与时间的未决问题保留下来，各自带回原消息','整理进展与下周重点为草稿，确认后再决定如何使用'],
  refs:[ref('task','t4','议程初稿已整理'),ref('task','t5','时间与材料待确认'),ref('inbox','i3','部署检查待核实')]},
 {id:'a3',title:'让项目资料更容易被找到',body:'以“本周产品评审”为主题，关联方案差异、原始讨论和六项行动；先整理索引，不复制一堆容易过期的正文。',category:'资料',icon:'files',sources:['本周评审方案','产品讨论记录','收件箱流程笔记'],
  details:'## 关联范围\n方案说明本轮边界；产品讨论记录保留为什么这样决定；流程笔记列出正常、失败与恢复的检查路径。三份材料职责不同，不要用一段总结覆盖原文。\n\n## 索引怎么组织\n入口使用“本周产品评审”。下面依次放范围决定、议程与时间、流程检查、部署核实和行动清单。每个入口链接到具体事项或任务，查到同名内容时也要核对来源。\n\n## 输出\n一份能从决定追到原消息、从任务追到交付标准的资料索引。陈一已确认收到资料，不需要为了建索引再回复他。\n\n## 更新原则\n只调整关联与索引。原讨论、人工稿和历史结论保留；资料有变化时更新对应引用，不把旧版本静默换成另一份。',
  steps:['按范围、议程、流程检查和部署核实建立主题索引','每个索引项连接到精确原消息、相关方案和对应任务','核对来源版本和重复项，不覆盖原正文或已确认决定'],
  refs:[ref('inbox','i4','陈一 · 资料已收到'),ref('task','t6','整理资料索引'),ref('document','review-plan','本周评审方案'),ref('document','flow-notes','收件箱流程笔记')]},
 {id:'a4',title:'给部署检查留一条明确的恢复路径',body:'把“仍在运行、确认失败、部分完成、结果未知”分开处理，先回查昨天的原检查，避免超时后重复执行。',category:'工作流',icon:'automation',sources:['产品讨论记录','部署检查核对单'],
  details:'## 当前事实\n项目协作群只确认等待结果超时，没有完整结论。这个状态既不能写成部署成功，也不能直接写成部署失败。\n\n## 核实顺序\n先定位原运行，再看当前状态、最后完成步骤、已有结果与外部变化。由这些证据决定后续动作，而不是由等待时间决定。\n\n## 四种结果\n仍在运行：继续观察同一记录。确认失败：核对没有已完成操作后再明确重试。部分完成：列已做和剩余部分，避免整体重放。结果未知：保留原记录和问题，不换一个请求当作重新开始。\n\n## 完成标准\n能说明原运行发生了什么，并给出下一步选择的依据。未核实时不关闭原事项，也不把核查清单当成真实执行结果。',
  steps:['定位原检查记录并核实状态、最后步骤、已有结果','按运行中、失败、部分完成或未知分别记录恢复选择','你确认后才执行需要重试的部分，保留原记录与新结果的对应关系'],
  refs:[ref('inbox','i3','项目协作群 · 原检查'),ref('task','t3','回查原记录'),ref('document','deploy-check','部署检查核对单')]},
];

export const workspaceTasks=[
 {id:'t1',title:'确认本周产品评审范围',note:'比较核心路径优先与包含完整连接配置两种范围。建议本轮保留收件箱→对话→确认处理→返回列表，同时保留连接失效、人工稿保护和未确认恢复；完整连接配置另排一轮。把本人最终决定写回原事项。',owner:'你',goal:'让林可能按确定边界收敛方案和演示顺序',deliverable:'一段已确认的本轮/下一轮范围结论，关联林可原消息和评审方案',group:'today',done:false,date:'2026-10-17',checklist:[check('scope','确认完整连接配置是否后移'),check('recovery','保留断开、保稿和未确认恢复'),check('decision','把最终决定补回原事项')],refs:[ref('inbox','i1','林可的范围问题'),ref('idea','a1','评审行动清单'),ref('document','review-plan','本周评审方案')]},
 {id:'t2',title:'整理收件箱到对话的完整流程',note:'按同一条范围确认事项演示：查看原消息、修改人工稿、带引用进入对话、追问后回到原事项。再检查切项晚到回包、候选采用和刷新恢复，不能只看正常路径。',owner:'林可 / 你确认',goal:'让评审能完整走过理解、判断和处理，而不是逐页看截图',deliverable:'一份按触发动作、期望结果和异常恢复组织的演示顺序',group:'today',done:false,date:'2026-10-17',checklist:[check('source','核对精确原消息与来源'),check('quote','把原文片段带入对话追问'),check('draft','人工稿与候选分别保留'),check('return','回到原事项并验证刷新恢复')],refs:[ref('inbox','i1','范围确认原事项'),ref('document','flow-notes','收件箱流程笔记'),ref('conversation','review','评审检查清单')]},
 {id:'t3',title:'核实部署检查的原运行与恢复',note:'先回查昨天那次部署检查的原运行：确认是否仍在执行、最后完成哪一步、是否已有结果和外部变化。超时不等于失败；部分完成不整体重放。把核实结论补到项目协作群的原事项，之后再决定是否明确重试。',owner:'项目协作 / 你确认恢复',goal:'找到部署检查的真实状态，再选择恢复方式',deliverable:'原检查状态、已有结果、缺失证据和下一步选择的核对记录',group:'later',done:false,date:'2026-10-19',checklist:[check('run','定位原运行记录'),check('status','核实当前状态和最后完成步骤'),check('effects','核对已有结果与外部变化'),check('next','明确继续观察、重试剩余部分或保留未知')],refs:[ref('inbox','i3','部署检查待核实'),ref('idea','a4','恢复路径方案'),ref('document','deploy-check','部署检查核对单')]},
 {id:'t4',title:'整理评审议程初稿',note:'议程草案已经补入搜索和记忆讨论，核心路径排在前面。此任务只代表草案整理完成；确切开始时间和参会确认由“确认评审时间与材料”继续跟进，不能据此宣称会议已约好。',owner:'周宁',goal:'把评审讨论内容整理成可确认的草案',deliverable:'核心流程优先、搜索与记忆随后讨论的议程草案',group:'today',done:true,date:'2026-10-17',checklist:[check('core','核心流程排到前面',true),check('search','加入搜索和记忆议题',true),check('time','开始时间明确标注待确认',true)],refs:[ref('inbox','i2','周宁的议程消息'),ref('task','t5','继续确认时间与材料'),ref('conversation','review','产品评审准备')]},
 {id:'t5',title:'确认评审时间与材料',note:'请周宁补确切开始时间，再确认是否可参加。材料先准备两版范围差异、核心路径的正常/失败/未确认顺序，以及需要本人拍板的问题。45分钟是建议时长，不是已约定日程。',owner:'你 / 周宁',goal:'补齐评审可开始的条件，不代为接受未知时间',deliverable:'确切开始时间、确认后的议程和材料清单',group:'today',done:false,date:'2026-10-17',checklist:[check('start','拿到确切开始时间'),check('available','本人确认该时间可用'),check('materials','准备方案差异与异常恢复演示')],refs:[ref('inbox','i2','议程与时间原消息'),ref('task','t4','已整理的议程初稿'),ref('document','review-plan','评审材料')]},
 {id:'t6',title:'整理评审资料索引',note:'以本周评审为主题，关联方案、讨论、流程笔记和对应任务。保留原文与版本，不再复制多个相似正文。陈一已经确认收到资料，当前无需再次回复；微信保持只读。',owner:'你',goal:'从决定能回到依据，从任务能找到交付标准',deliverable:'范围、议程、流程和部署核实四个入口的资料索引',group:'later',done:false,date:'2026-10-19',checklist:[check('index','建立同主题索引'),check('links','逐条核对原事项与任务链接'),check('history','保留原正文和历史版本')],refs:[ref('inbox','i4','资料已收到'),ref('idea','a3','资料关联方案'),ref('document','discussion','产品讨论记录')]},
];

export const workspaceDocuments=[
 {id:'review-plan',title:'本周评审方案',body:'# 本周评审方案\n\n## 要当场决定的事\n采用核心路径优先，还是把完整连接配置一并纳入。林可正在等这个边界，开始时间仍需周宁补齐。\n\n## 建议本轮范围\n查看事项和原消息、人工修改回复、引用到普通对话继续讨论、确认处理、回到列表。连接断开、人工稿保留和未确认恢复仍属于核心路径。\n\n## 下一轮\n新增供应商、完整授权和同步配置另排，不占用本轮大部分讨论。\n\n## 45分钟建议议程\n5分钟确认边界，15分钟走收件箱，10分钟看对话和草稿隔离，10分钟看搜索与记忆，最后5分钟收敛决定。时长只是建议，不代表已经约定开始时间。\n\n## 评审输出\n本轮/下一轮范围结论、具体触发动作与期望结果、未决问题及下一步。部署原检查没有结论，继续单独待核实。'},
 {id:'discussion',title:'产品讨论记录',body:'# 产品讨论记录\n\n## 林可 · 范围取舍\n提出先聚焦核心路径，并说明完整连接配置会增加表单与授权讨论。本人需要确认范围，不能把“先看看差异”视为已经同意。\n\n## 周宁 · 议程与时间\n议程草案已经加入搜索与记忆，开始时间仍在协调。草案完成与会议确认是两个状态。\n\n## 项目协作群 · 部署检查\n等待结果超时，尚无完整结论。先沿原记录核实状态、最后步骤、已有结果与外部变化，不直接重新执行。\n\n## 陈一 · 参考资料\n已确认收到并会在下一轮评审前看完，没有新请求。整理主题索引即可，不需要为此再发一条回复。'},
 {id:'flow-notes',title:'收件箱流程笔记',body:'# 收件箱流程笔记\n\n## 正常路径\n打开精确事项，读原消息，修改草稿，带原文片段进入普通对话追问，再回到原事项确认最终正文。对话里只显示消息，不插入另一套事项卡片。\n\n## 人工稿保护\n生成过程中又输入内容，后来输入必须保留；新结果作为候选，明确采用才替换。切换事项和刷新都要保持精确归属。\n\n## 引用追问\n选中的文字作为独立引用进入输入框，保留来源与原文，不覆盖未发送问题。发送后引用跟随该条问题，不串到其他会话。\n\n## 异常恢复\n失败先保稿；未知沿原记录回查；部分完成列清已做部分，不整体重放。连接断开时说明受限动作，保留当前可继续编辑的内容。'},
 {id:'deploy-check',title:'部署检查核对单',body:'# 部署检查核对单\n\n## 已知事实\n昨天的检查等待结果超时，没有完整结论。不能由超时推定执行失败，也不能推定部署成功。\n\n## 需要补齐\n原运行入口、当前状态、最后完成步骤、已有结果、可能产生的外部变化。此核对单不是原执行日志。\n\n## 恢复选择\n仍在运行则继续看同一记录；确认失败后先核已执行内容再讨论重试；部分完成则只处理尚未完成部分；仍未知就保留原记录，不换请求重新开始。\n\n## 记录方式\n把证据和缺口写回原事项。后续若有新的明确操作，保留它与原运行的关系，不覆盖最初的超时与未知记录。'},
];

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function hydrateWorkspaceDemo(state){
  for(const kind of ['inbox','ideas','tasks'])for(const row of state[kind]){
    const old=legacyWorkspace[kind].find(x=>x.id===row.id),next=({inbox:workspaceInbox,ideas:workspaceIdeas,tasks:workspaceTasks})[kind].find(x=>x.id===row.id);
    if(!old||!next)continue;
    if(kind==='inbox'&&same([row.source,row.title,row.messages],[old.source,old.title,old.messages])){
      const untouched=row.draft===old.draft&&!row.draftRevision&&!row.draftRequest&&!row.draftCandidate;
      for(const field of ['summary','messages','analysis','refs'])row[field]=structuredClone(next[field]);
      if(untouched){row.draft=next.draft;row.generatedDraft=next.generatedDraft;row.previewDraft=next.previewDraft}
    }
    if(kind==='ideas'&&same([row.title,row.body,row.steps],[old.title,old.body,old.steps]))for(const field of ['body','details','steps','sources','refs'])row[field]=structuredClone(next[field]);
    if(kind==='tasks'&&same([row.title,row.note],[old.title,old.note]))for(const field of ['title','note','owner','goal','deliverable','checklist','refs'])row[field]=structuredClone(next[field]);
  }
  if(state.demoWorkspaceVersion!==1){
    for(const row of workspaceIdeas.filter(x=>x.id==='a4'))if(!state.ideas.some(x=>x.id===row.id))state.ideas.push(structuredClone(row));
    for(const row of workspaceTasks.filter(x=>['t5','t6'].includes(x.id)))if(!state.tasks.some(x=>x.id===row.id))state.tasks.push(structuredClone(row));
    state.demoWorkspaceVersion=1;
  }
}

export function resolveWorkspaceSource(state,type,id){
  if(type==='document')return workspaceDocuments.find(x=>x.id===id)||null;
  const rows={inbox:state.inbox,idea:state.ideas,task:state.tasks,conversation:state.sessions};
  return rows[type]?.find(x=>x.id===id)||null;
}
export function workspaceSourceBody(type,row){
  if(type==='inbox')return row.messages.map(([who,text])=>(who==='me'?'你':row.name)+'：'+text).join('\n\n');
  if(type==='idea')return row.title+'\n\n'+row.body+'\n\n'+(row.details||'')+'\n\n'+row.steps.join('\n');
  if(type==='task')return row.title+'\n当前状态：'+(row.done?'已完成':'待完成')+'\n日期：'+(row.date||'未设置')+'\n负责：'+(row.owner||'未指定')+'\n\n'+row.note+'\n\n'+(row.goal||'')+'\n'+(row.deliverable||'')+'\n'+(row.checklist||[]).map(x=>(x.done?'[已完成] ':'[待办] ')+x.text).join('\n');
  return row.body||'';
}
