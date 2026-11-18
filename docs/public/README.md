# CyberMe 公开规格

主要源码位于 `server/src/`（HTTP 与持久状态）、`shared/`（跨端契约）、`web/src/`（Web 与桌面页面）、`native/mygo/`（macOS 客户端）和 `scripts/`（构建与验收）。

## 桌面入口与交付

- [V6 桌面界面](cyberme-v6.md)：四标签面板、真实接口绑定、状态投射与次级入口。
- [V6 数据与草稿契约](v6-data-contract.md)：语气、幂等回查、展示字段与能力边界。
- [仅保留 V6 产品入口](v6-only-navigation.md)：旧工作区退役与灵感内容核对。
- [工作区启动与收件箱跳转性能](workspace-startup.md)：来源同步索引、首屏辅助加载与精确事项深链；本机更新验证。
- [窗口拖动与关闭](window-controls.md)：顶部拖动、Command+W 与本机验证。
- [本机更新](local-updates.md)：签名更新、运行中等待、进程排空和回滚。
- [内容图标与本机更新](content-artwork.md)：旧版原创 SVG 复用、资料与简报的统一图标，以及安装验收边界。
- [静态官网](../../website/README.md)：三语页面、Cloudflare Pages 发布和复验。
- [产品 Mock](../../mock/README.md)：可点击原型、V6 稿件和旧版归档。

## 对话与执行

- [持续单一 Agent 会话](agent-session.md)：每个会话一个持续 SDK 会话、当前讨论对象、重启恢复、压缩与撤销边界。
- [持续 Agent 消息追加](chat-input-append.md)：新交办顺序追加、当前工作安全补充、独立回执与恢复。
- [聊天时间预算与来源仅@我](chat-time-budgets.md)：准备/压缩与回答/工具循环分离预算、阶段计时审计；来源规则 all/mentions/exclude 与可信@我元数据。
- [本机技能](local-skills.md)：SDK 目录、自动采用、/技能调用、manualOnly、跨轮工作范围续办、稳定操作键与只读技能页（已安装并完成目录路由、原生读页及数据保留验收，其他验证边界见模块说明）。
- [明确交办的通用执行](agent-execution.md)：主聊天网络、命令、文件任务、本机技能发现与读取、凭证引用、真实回执与停止恢复。
- [持续跟进](follow-up.md)：明确交办的单件跟进、只读到期检查、证据与覆盖边界、应用内提醒；已完成本机分层及日常安装版定向验收。
- [能力与意图后台](ideas-console.md)：只读能力目录、来源证据和执行进度。
- [对话排版与主动判断](chat-insight-quality.md)：编号、阅读宽度及有界本地资料调查。
- [提醒与报错展示](status-feedback.md)：紧凑状态、详情与安全恢复操作。

## 模型与连接

- [V6 模型设置](v6-model-settings.md)：单一当前模型、供应商目录获取、批量连接测试与回执恢复。
- [应用连接](app-connections.md)：V6 添加飞书/微信、Gmail 授权与对话查信、Agent 连接权限门禁。
- [GitHub Issue 与 Apple 只读](github-apple-read.md)：精确 Issue 读取、Apple 日历/提醒事项授权与按需读取。
- [连接新鲜度](connection-freshness.md)：飞书附件/精确时间、微信续页、判断重算与过期草稿保护。
- [飞书本地 oMLX 分析与三分钟冷却](inbox-omlx-cooldown.md)

## 收件箱、洞察与提醒

- [分析身份、人物档案与证据时间](analysis-identity-and-time.md)：本人/交办方向、角色 Markdown 持续跟踪、逐条证据时间及历史提醒抑制。
- [意图处理与用户注意力](intent-handling.md)：判断与注意力分层、直接忽略与撤销、绑定请求身份的重新进入。
- [注意力投递与决策/灵感分层](attention-delivery.md)：投递档位、摘要、类型化消息动作、持久忽略与推迟、时间模型。
- [灵感主对话提醒](ideas-chat.md)：派生提醒、去重、撤回与对话衔接。
- [洞察内容视觉](insight-visuals.md)：受限视觉语法、证据锚点缓存、桌面自动生成与新洞察优先调度。
- [洞察流页脚](insight-footer.md)：「刷新洞察 · 忽略与推迟」单行页脚、按记录类型恢复、刷新结果文案与回读边界。
- [洞察后台可靠性](insight-reliability.md)：内部任务显式关闭思考、整批输入预算与旧来源配额、失败分类与纠正门控、持久失败/退避及 V6 页脚后台报错。
- [洞察来源恢复](insight-source-recovery.md)：会议时间回填、观察与本人待办分离、精确聊天引用和真实模型结构化输出。
- [新洞察视觉与主会话推送恢复](insight-delivery-recovery.md)：桌面自动补图、信息/委派摘要及精确追问。
- [本机主动提醒](desktop-notifications.md)：V6 安装、主对话洞察与 macOS 系统通知、去重和真实验证边界。
- [灵感内容分类](idea-content-categories.md)：AI 按内容生成分类，旧卡片补齐、指纹失效及合并洞察流的展示边界。

## 记忆

- [全局个人记忆](global-memory.md)：单一全局记忆库、旧项目范围兼容、重放与忘记规则（取代项目隔离）。
- [记忆资料库](memory-library.md)：个人总览、Markdown 资料夹、人物原档与历史跟踪、身份及 Agent 设定入口。
- [Mem0 记忆召回与项目隔离](mem0-memory-evaluation.md)：真实本机模型、跨会话召回、来源核验、项目范围与验证清单。
- [记忆召回小范围对比](memory-retrieval-evaluation.md)：现有关键词、真实 sqlite-vec 语义召回与项目范围/忘记验证边界。
- [pi-memory 隔离评估](pi-memory-evaluation.md)：项目隔离、忘记语义与实验接入结论。

## 验证与提交记录

- [验证与公开范围](validation.md)：可重复验收及已知边界。
- [2026-11-18 提交说明](changes/2026-11-18-v6.md)：模块变更、复跑入口和验证边界。
- [主对话摘要位置与 PR 查询](changes/2026-11-09-chat-digest-and-pr-read.md)：摘要时间线、只读 PR 查询和超时回执。
- [2026-11-06 V6 本地变更提交说明](changes/2026-11-06-v6.md)：相对上一提交的模块差异、复验和入库范围。
- [2026-11-05 注意力投递提交说明](changes/2026-11-05-attention.md)
- [2026-11-05 中文提交说明](changes/2026-11-05-v6.md)：相对上一提交的差异、验证和发布边界。
