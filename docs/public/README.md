# CyberMe 公开规格

- [能力与意图后台](ideas-console.md)：只读能力目录、来源证据和执行进度。
- [对话排版与主动判断](chat-insight-quality.md)：编号、阅读宽度及有界本地资料调查。
- [灵感主对话提醒](ideas-chat.md)：派生提醒、去重、撤回与对话衔接。
- [提醒与报错展示](status-feedback.md)：紧凑状态、详情与安全恢复操作。
- [验证与公开范围](validation.md)：可重复验收及已知边界。
- [窗口拖动与关闭](window-controls.md)：顶部拖动、Command+W 与本机验证。

主要源码：`server/src/`（HTTP 与持久状态）、`shared/`（跨端契约）、`web/src/`（Web 与桌面页面）、`native/mygo/`（macOS 客户端）、`scripts/`（构建和验收）。`docs/design/` 仅保留运行所需的页面资源与第三方许可证。

- [飞书本地 oMLX 分析与三分钟冷却](inbox-omlx-cooldown.md)
