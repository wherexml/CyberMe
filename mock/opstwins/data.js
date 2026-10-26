import {workspaceInbox,workspaceIdeas,workspaceTasks} from './workspace-demo.js';
import {demoSessions} from './demo-conversations.js';
export const settings = [['general','通用','sliders'],['models','模型','spark'],['connections','连接','link'],['filesystem','文件访问','folder'],['identity','身份与记忆','person'],['autonomy','自主权限','shield'],['channels','消息渠道','message'],['devices','设备','monitor'],['help','帮助','help'],['legal','隐私与条款','shield'],['about','关于','info']];
export const screens = [
 ['chat','对话','主会话 · 消息 · 侧会话'],['inbox','收件箱','待处理 · 判断 · 回复草稿'],['ideas','灵感','建议 · 来源 · 深入聊聊'],['tasks','任务','今天 · 之后 · 已完成'],['search','全局搜索','混合结果 · 全文详情'],['memory','会话记忆','摘要 · 自动记忆 · 来源与撤销'],['record','执行记录','输入 · 结果 · 运行状态'],['task-detail','任务详情','编辑 · 完成 · 保稿'],['idea-detail','灵感详情','完整建议 · 折叠来源'],
 ...settings.map(([id,label])=>['settings/'+id,label,'设置 / '+label]),
 ['settings/provider','供应商配置','地址 · 协议 · 模型参数'],['settings/provider-new','添加供应商','新供应商表单'],['settings/feishu','飞书连接','状态 · 采集 · 同步记录'],['settings/wechat','微信连接','只读会话 · 搜索 · 媒体'],['settings/gmail','Gmail 连接','Google 授权说明'],['settings/custom','自定义连接','协议 · 权限 · 检测'],['settings/knowledge','知识资料','个人记忆以外的资料'],['settings/soul','SOUL.md','完整身份文档 · 编辑'],['settings/memory-document','MEMORY.md','长期记忆文档 · 编辑'],['settings/binding','飞书 Bot 绑定','独立授权状态'],['activity','操作记录','时间线 · 精确记录'],
  ['capabilities','能力与意图','能力 · 注册与配置'],['capabilities/intents','能力与意图 · 意图','来源 · 捕获 · 后续执行'],['capabilities/runs','能力与意图 · 执行记录','捕获与执行 · 步骤']
];
export const initial = {
 prefs:/*EDITMODE-BEGIN*/{theme:'light',density:'standard',language:'zh',launch:false,notifications:true}/*EDITMODE-END*/,
 sessions:structuredClone(demoSessions),
 inbox:structuredClone(workspaceInbox),
 ideas:structuredClone(workspaceIdeas),
 tasks:structuredClone(workspaceTasks),
 demoWorkspaceVersion:1,
 groups:{today:true,later:true,done:false},
 model:{provider:'示例供应商',model:'示例对话模型',endpoint:'https://api.example.com/v1',protocol:'OpenAI compatible',tokens:'32768',temperature:'0.7'},
 autonomy:{hold:false,reply:'confirm',tasks:'confirm',files:'confirm',calendar:'confirm',connections:'read',deep:'confirm',quietStart:'23:00',quietEnd:'07:00',notify:true,disclose:true},
 documents:{soul:'# 我是谁\n\n我是你的工作分身，帮助你理解信息、整理思路并推进工作。\n\n## 工作方式\n\n- 先核实事实，再给出建议\n- 把需要你判断的问题说清楚\n- 重要的外部操作先确认\n\n## 沟通风格\n\n简洁、具体，保留真实的不确定性。',memory:'# 长期记忆\n\n## 沟通偏好\n\n偏好先讲结论，再给出必要的依据。\n\n## 工作偏好\n\n重要决定要保留来源与下一步。'},
 knowledgePaths:[],
 blockedFolders:['~/Documents/个人资料'],
 connections:{feishu:true,wechat:true,gmail:false},collections:{messages:true,documents:true,calendar:false,attachments:false},
 automatic:[{id:'m1',text:'偏好先讲结论，再给出必要的依据',source:'主会话 · 今天 09:30'},{id:'m2',text:'重要决定要保留来源与下一步',source:'产品评审准备 · 昨天'}], notes:{}, log:[]
};
