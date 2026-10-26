# Inbox Zero选定源码

来源：<https://github.com/elie222/inbox-zero>，固定commit `a281a644ea4c4cc91fbf327adfd91dc7755a6405`。

原始文件在`upstream/`，逐项路径与SHA256见`../mock-upstream-manifest.json`，不修改原文件。

实际浏览器复用：

- `draft-confidence.ts`原函数，经本目录的Prisma枚举shim构建；本地适配明确拒绝缺失/未知枚举，不采用上游宽松默认值。
- `thread-status-context.ts`的预算常量与纯函数由构建脚本逐字抽取到`thread-budget.ts`；邮件解析替换为本地纯文本适配，保持最新消息尾部并标记截断，限制64条。

`draft-management.ts`、`generate-draft.ts`、会话状态和同发件人示例保留为来源参考，不进入浏览器bundle，不引入Prisma、Redis、Gmail、OAuth、发信或附件操作。人工稿候选/采用是本项目适配，不冒称上游完整功能。

当前LICENSE包含AGPL与附加商业变现/企业使用限制，完整条文随本目录及Mock静态资产保留。本轮用于用户指定的本地Mock研究，没有获得额外商业授权，不纳入本次生产发布或原生包。

构建：在项目根目录运行`node scripts/opstwins-mock-vendor.mjs`。构建前校验所有上游摘要；修改上游源码会明确失败。
