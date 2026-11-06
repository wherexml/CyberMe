// V6 interface copy (reference L/X tables). Sample business content is intentionally absent:
// production text comes from persisted records, and the acceptance fixture supplies its own data.
export type Lang='en'|'zh';
const en={
 today:'Brief', tasks:'Tasks', memory:'Memory', settings:'Settings', ongoing:'Ongoing work',
 placeholder:'Message CyberMe', yesterday:'Yesterday', todayL:'Today',
 greeting:(n:string)=>n?`Good ${dayPart()}, ${n}`:`Good ${dayPart()}`, greetSub:'Ask anything, or attach an insight with +.',
 evidence:'Evidence', discuss:'Discuss', viewTask:'View task', insightRef:'Insight',
 st:{decide:'Awaiting decision', changed:'Sources changed', thin:'Not enough evidence', created:'Task created', resolved:'Resolved', watching:'Watching', reply:'Needs a reply', unknown:'Result unknown', partial:'Partly done'},
 ts:{queued:'Queued', running:'In progress', confirm:'Needs your review', sending:'Sending', failed:'Failed', done:'Done', scheduled:'Scheduled', unknown:'Result unknown', partial:'Partly done', cancelled:'Stopped', paused:'Paused', interrupted:'Interrupted'},
 insEmpty:'Nothing is waiting for a decision.', taskEmpty:'No tasks yet.', memEmpty:'Nothing remembered yet.',
 recheck:'Re-check', checking:'Checking…', dismiss:'Dismiss', watch:'Watch for more', unwatch:'Stop watching',
 evidenceH:'Evidence', gapH:'Not verified', actionH:'Proposed action', attachH:'Attach an insight',
 connect:'Connect', connecting:'Connecting…', notConnected:'Not connected', syncedNow:'Synced just now',
 taskCreated:'Task created', taskLinked:'Linked task', review:'Review drafts', retry:'Retry', checkAgain:'Check again',
 stepsH:'Progress', draftsH:'Drafts', jumpConv:'Show in conversation', editInConv:'Edit in conversation', resultH:'Result', taskDetails:'Task details',
 failedReply:'The reply failed. Nothing was sent.', unknownReply:'The result could not be confirmed. CyberMe will not resend it automatically.', partialReply:'Some steps finished before this stopped. Review the record before asking again.', stoppedReply:'Stopped.', quotaReply:'The model quota is used up. Change the model in Settings or try again later.',
 loadOlder:'Load earlier messages', offline:'Your workspace is not reachable.', reconnect:'Reconnect', loading:'Opening your workspace…', saveFailed:'Could not save. Your text is kept.', conflict:'Changed elsewhere. Your text is kept; reload to compare.', reload:'Reload',
 taskExists:'Task created', createTask:'Create task', pickOne:'Choose at least one recipient', recipients:'Recipients', tone:'Tone', brief:'Brief', warm:'Warm', follow:(d:string)=>`Remind me if no reply by ${d}`, followDone:'Follow-up scheduled',
 emailTitle:(n:number)=>`Draft follow-up emails for ${n} contact${n===1?'':'s'}`, sendN:(n:number)=>`Send ${n} email${n===1?'':'s'}`, sentN:(n:number)=>`Sent ${n} follow-up email${n===1?'':'s'}`, proposal:'Here is the plan: I will draft one email per person. Nothing is sent until you review it.', notSentN:(n:number)=>`${n} not sent`, attachFile:'Attach a file', uploading:'Uploading…', moreH:'More',
};
const zh:typeof en={
 today:'简报', tasks:'任务', memory:'记忆', settings:'设置', ongoing:'进行中的工作',
 placeholder:'和 CyberMe 聊天', yesterday:'昨天', todayL:'今天',
 greeting:(n:string)=>n?`${zhDayPart()}好，${n}`:`${zhDayPart()}好`, greetSub:'有什么想聊的？也可以用 + 引用一条洞察。',
 evidence:'证据', discuss:'讨论', viewTask:'查看任务', insightRef:'洞察',
 st:{decide:'待决策', changed:'来源已变化', thin:'证据不足', created:'已创建任务', resolved:'已解决', watching:'观察中', reply:'待回复', unknown:'结果未确认', partial:'部分完成'},
 ts:{queued:'排队中', running:'进行中', confirm:'等待你确认', sending:'发送中', failed:'失败', done:'已完成', scheduled:'已安排', unknown:'结果未确认', partial:'部分完成', cancelled:'已停止', paused:'已暂停', interrupted:'已中断'},
 insEmpty:'暂无待决策的事项。', taskEmpty:'还没有任务。', memEmpty:'还没有记住任何内容。',
 recheck:'重新核对', checking:'核对中…', dismiss:'忽略', watch:'继续观察', unwatch:'停止观察',
 evidenceH:'证据', gapH:'未核实', actionH:'建议行动', attachH:'引用一条洞察',
 connect:'连接', connecting:'连接中…', notConnected:'未连接', syncedNow:'刚刚同步',
 taskCreated:'已创建任务', taskLinked:'关联任务', review:'查看草稿', retry:'重试', checkAgain:'再次核对',
 stepsH:'进度', draftsH:'草稿', jumpConv:'在对话中查看', editInConv:'在对话中修改', resultH:'结果', taskDetails:'任务详情',
 failedReply:'回复失败，没有发出任何内容。', unknownReply:'结果暂未确认，CyberMe 不会自动重发。', partialReply:'停止前已有部分步骤完成，请先查看原记录再提出新请求。', stoppedReply:'已停止。', quotaReply:'模型额度已用完，请在设置中更换模型或稍后重试。',
 loadOlder:'加载更早的消息', offline:'暂时连不上工作区。', reconnect:'重新连接', loading:'正在打开工作区…', saveFailed:'保存失败，输入已保留。', conflict:'已在别处修改，输入已保留，请重新载入核对。', reload:'重新载入',
 taskExists:'任务已创建', createTask:'创建任务', pickOne:'至少选择一位收件人', recipients:'收件人', tone:'语气', brief:'简洁', warm:'温和', follow:(d:string)=>`如 ${d} 前未回复，提醒我`, followDone:'已安排跟进',
 emailTitle:(n:number)=>`为 ${n} 位联系人起草跟进邮件`, sendN:(n:number)=>`发送 ${n} 封邮件`, sentN:(n:number)=>`已发送 ${n} 封跟进邮件`, proposal:'计划如下：我会为每个人起草一封邮件，经你确认后才会发送。', notSentN:(n:number)=>`${n} 封未发送`, attachFile:'附加文件', uploading:'上传中…', moreH:'更多',
};
function dayPart(){const h=new Date().getHours();return h<12?'morning':h<18?'afternoon':'evening';}
function zhDayPart(){const h=new Date().getHours();return h<12?'早上':h<18?'下午':'晚上';}
export const L={en,zh};

const xen={settings:'Settings', yourCall:'Your call', capIdle:'Your personal AI workspace', capThink:'Thinking…', capWork:(n:number)=>`Working on ${n} task${n>1?'s':''}`, capWait:'Waiting for your review', hi:"Hi, I'm CyberMe",
 notNow:'Not now', snoozed:'Snoozed until Monday', bringBack:'Bring back', silent:(d:number)=>`${d} days silent`, emailed:'Emailed today', todayL:'Today', renewal:'Renews',
 recheckSrc:'Re-check sources', sigOf:(n:number,m:number)=>`${n} of ${m} signals needed`, threshold:'Change threshold',
 changeAvatar:'Change avatar', chatIt:'Chat about it', bestFit:'Best fit', wNeeds:'Needs you', wRun:'Working', wDone:'Done', wHandled:'Handled', wFailed:'Failed', wUnknown:'Unconfirmed', wFileFailed:'File check failed', wInterrupted:'Interrupted', wResume:'Resume', wChosen:'Chosen', wClosed:'Closed', chatAbout:(t:string)=>`Let's talk about this: ${t}`, memNew:'New memory', subDec:'Decisions', subIns:'Inspirations', insHead:'What I noticed', recommended:'Recommended', decideLater:'Decide later', talkIt:'Talk it through', undo:'Undo', whyQ:'Why this one? It helps me learn how you decide.', movedTomorrow:"Moved to tomorrow's brief", allClear:"You're clear for today. I'll take it from here.", patternL:"What I've learned", savedWhy:(r:string)=>`Saved to your journal: ${r}`, briefNum:(i:number,n:number)=>`${i} of ${n}`, todayJ:'Today', discussQ:(q:string)=>`Help me think through: ${q}`, replyWithTip:'Chat about it', clickEdit:'Click to edit', mdHint:'Markdown · Esc to close', done:'Done', quoteReply:'Quote', addConn:'Add connection', pickSent:'Sent to CyberMe. Not done until the task reports back.', pickPending:'Waiting for the result', pickFailed:'Not carried out', pickUnknown:'Result not confirmed',
 noPattern:'Patterns appear here after a few decisions.', galleryEmpty:'No inspirations yet.', refresh:'Look for more', refreshing:'Looking…'};
const xzh:typeof xen={settings:'设置', yourCall:'你的判断', capIdle:'你的个人 AI 工作台', capThink:'思考中…', capWork:(n:number)=>`正在处理 ${n} 个任务`, capWait:'等你确认', hi:'你好，我是 CyberMe',
 notNow:'暂不处理', snoozed:'已推迟到周一', bringBack:'恢复', silent:(d:number)=>`${d} 天未联系`, emailed:'今天已发邮件', todayL:'今天', renewal:'续约日',
 recheckSrc:'重新核对来源', sigOf:(n:number,m:number)=>`已有 ${n} 条，需要 ${m} 条信号`, threshold:'调整阈值',
 changeAvatar:'更换头像', chatIt:'聊聊这个', bestFit:'最合适', wNeeds:'等你确认', wRun:'进行中', wDone:'已完成', wHandled:'已处理', wFailed:'失败', wUnknown:'未确认', wFileFailed:'文件校验失败', wInterrupted:'已中断', wResume:'继续', wChosen:'已选择', wClosed:'已关闭', chatAbout:(t:string)=>`聊聊这个：${t}`, memNew:'新建记忆', subDec:'决策', subIns:'灵感', insHead:'我注意到的', recommended:'推荐', decideLater:'稍后决策', talkIt:'展开聊聊', undo:'撤销', whyQ:'为什么选这个？这能帮我了解你的决策方式。', movedTomorrow:'已移到明天的简报', allClear:'今天的决策都做完了，剩下的交给我。', patternL:'我注意到', savedWhy:(r:string)=>`已记入日志：${r}`, briefNum:(i:number,n:number)=>`第 ${i} 个，共 ${n} 个`, todayJ:'今天', discussQ:(q:string)=>`帮我想想：${q}`, replyWithTip:'在对话中让 CyberMe 帮你修改', clickEdit:'点击编辑', mdHint:'Markdown · Esc 关闭', done:'完成', quoteReply:'引用', addConn:'添加连接', pickSent:'已交给 CyberMe，任务回报后才算完成。', pickPending:'等待结果', pickFailed:'未执行', pickUnknown:'结果未确认',
 noPattern:'做过几次决策后，这里会出现你的决策规律。', galleryEmpty:'还没有灵感。', refresh:'再找找', refreshing:'查找中…'};
export const X={en:xen,zh:xzh};
