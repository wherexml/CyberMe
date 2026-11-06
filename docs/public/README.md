# CyberMe 公开规格

- [明确交办的通用执行](agent-execution.md)：主聊天网络、命令、文件任务、凭证引用、真实回执与停止恢复。

- [分析身份、人物档案与证据时间](analysis-identity-and-time.md)：本人/交办方向、角色 Markdown 持续跟踪、逐条证据时间及历史提醒抑制。

- [V6 桌面界面](cyberme-v6.md)：四标签面板、真实接口绑定、状态投射与次级入口。
- [能力与意图后台](ideas-console.md)：只读能力目录、来源证据和执行进度。
- [对话排版与主动判断](chat-insight-quality.md)：编号、阅读宽度及有界本地资料调查。
- [灵感主对话提醒](ideas-chat.md)：派生提醒、去重、撤回与对话衔接。
- [提醒与报错展示](status-feedback.md)：紧凑状态、详情与安全恢复操作。
- [意图处理与用户注意力](intent-handling.md)：判断与注意力分层、直接忽略与撤销、绑定请求身份的重新进入。
- [注意力投递与决策/灵感分层](attention-delivery.md)：投递档位、摘要、类型化消息动作、持久忽略与推迟、时间模型。
- [验证与公开范围](validation.md)：可重复验收及已知边界。
- [窗口拖动与关闭](window-controls.md)：顶部拖动、Command+W 与本机验证。

主要源码：`server/src/`（HTTP 与持久状态）、`shared/`（跨端契约）、`web/src/`（Web 与桌面页面）、`native/mygo/`（macOS 客户端）、`scripts/`（构建和验收）。`docs/design/` 仅保留运行所需的页面资源与第三方许可证。

- [飞书本地 oMLX 分析与三分钟冷却](inbox-omlx-cooldown.md)

- [V6 数据与草稿契约](v6-data-contract.md)：语气、幂等回查、展示字段与能力边界。
- [2026-11-05 注意力投递提交说明](changes/2026-11-05-attention.md)
- [2026-11-05 中文提交说明](changes/2026-11-05-v6.md)：相对上一提交的差异、验证和发布边界。

- [连接新鲜度](connection-freshness.md)：飞书附件/精确时间、微信续页、判断重算与过期草稿保护。
- [本机主动提醒](desktop-notifications.md)：V6 安装、主对话洞察与 macOS 系统通知、去重和真实验证边界。

- [记忆召回小范围对比](memory-retrieval-evaluation.md)：现有关键词、真实 sqlite-vec 语义召回与项目范围/忘记验证边界。
- [pi-memory 隔离评估](pi-memory-evaluation.md)：项目隔离、忘记语义与实验接入结论。
- [记忆资料库](memory-library.md)：个人总览、Markdown 资料夹、人物原档与历史跟踪、身份及 Agent 设定入口。
- [内容图标与本机更新](content-artwork.md)：旧版原创 SVG 复用、资料与简报的统一图标，以及安装验收边界。
- [灵感内容分类](idea-content-categories.md)：AI 按内容生成分类，旧卡片补齐、指纹失效及合并洞察流的展示边界。

- [工作区启动与收件箱跳转性能](workspace-startup.md)：来源同步索引、首屏辅助加载与精确事项深链；本机更新验证。

- [仅保留 V6 产品入口](v6-only-navigation.md)：旧工作区退役与灵感内容核对。
- [洞察内容视觉](insight-visuals.md)：受限视觉语法、证据锚点缓存、合并洞察流；后台生成默认关闭及真实质量边界。
- [2026-11-06 V6 本地变更提交说明](changes/2026-11-06-v6.md)：相对上一提交的模块差异、复验和入库范围。
