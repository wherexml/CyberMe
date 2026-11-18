# 应用连接

设置 → 应用连接 → 添加连接。目录列出飞书、微信、Gmail；支持原生 EventKit 的 macOS standalone 包还列出 [Apple 日历和提醒事项](github-apple-read.md)。按精确连接 ID 匹配，不按名称合并。已有连接直接进详情，打开添加页不发起检测或授权。

## 飞书与微信

首次添加走 `POST /api/connections/test`；详情页的重新连接与重新检测走 `POST /api/connections/:id/test`（带 `baseUpdatedAt`），只对 `feishu-local`、`wechat-sync-local` 开放。服务端已有结果而界面刷新失败时提示重新加载，不重发写请求。

## Gmail

- 授权：`GET /api/connections/google/status`、`POST /api/connections/google/authorize`（系统浏览器）、`POST /api/connections/google/check`、`POST /api/connections/gmail-oauth/disconnect`。未配置 Google Desktop OAuth client 时显示「待配置」。
- 安装版的本机配置：从项目根目录运行 `node --import tsx scripts/configure-google-desktop-oauth.mjs --client-json /absolute/path/to/client.json`，导入 Google Desktop OAuth 客户端。配置加密存入当前用户的本地数据目录，命令不会打印凭证。导入客户端后，仍需在设置里完成 Google 授权和对话读取授权。
- OAuth 只证明账号已连。对话查信是单独的默认关闭授权：`PATCH /api/connections/gmail-oauth/grants {read,baseUpdatedAt}`，绑定账号，不在 Agent 动作目录中；重新授权、断开、令牌失效都会清除。
- 读取：`app_read` 的 `gmail_search {query,limit}`（1–10，默认 5，单页）与 `gmail_message {messageId}`（正文 20000 字上限，附件仅元数据）。两者没有 HTTP 路由，只在 `kind=chat` 的运行中、且用户本轮直接提出查信时可用，每轮最多 8 次。仅提及 Gmail、询问配置/状态、引用或否定不触发读取；礼貌的明确查信请求仍可用。
- 失败边界：`invalid_grant`、刷新令牌缺失或强制刷新后仍 401 才标记 `reauth` 并删除令牌；429、5xx、网络错误不改变连接状态。每次网络等待后重新核对连接，断开或重新授权后在途结果丢弃，刷新结果不落盘。
- 工具回执记录动作、查询哈希、条数和错误码；持久会话会把 Gmail 工具结果替换为摘要，原始查询参数及正常对话仍遵循会话保存规则。读取结果不会直接写入记忆或洞察，也不进入凭证发现。

## Agent 权限门禁

`server/src/connection-agent-guard.ts` 在结构化动作入口拒绝（403 `connection_grant_denied`）：

- 通用实体写连接只允许 `title`/`name`；禁止恢复已删除连接、删除 Gmail 连接。
- `connection_test` 只接受 `name`；已被替代的连接不可复测；有旧 `mcp.call` 通配授权的 MCP 只能从设置复测，避免 Agent 借重新发现扩大原权限；已断开的自定义连接须从设置重连，飞书、微信保持原有行为。
- `connection_create_test` 的 `permissions` 只能省略、为空，或无认证 REST 的恰好 `["read"]`；Gmail/Google provider 一律拒绝；飞书、微信不接受权限、端点或配置，飞书已存在时须复测。
- `settings_update`、`settings_restore` 不能改变连接权限档位。

这里约束的是产品动作路径。`run_command` 是主机终端能力，不是 OS 沙箱，能访问本机 API，因此本门禁不等于隔离环境。

## 验证边界

2026-11-09：类型检查与 V6 构建通过；`node --import tsx scripts/v6-connections-gmail-e2e.mjs --serve` 的 27 项通过，包含正式 HTTP/Chat 路由、受控 Google 与 CLI、授权撤回、否定/引用/配置询问、迟到回调；`ego-browser nodejs < scripts/v6-connections-gmail-browser-e2e.mjs` 的 8 项通过。设置 OAuth 29 项、GitHub PR 9 项回归通过。证据位于本机 Git 忽略目录 `output/connection-implementation-20261109/`。

后续安装版验收确认 Apple 两项已连接，GitHub Issue 使用本机 GitHub CLI，不建立 GitHub 设置页账号连接。Gmail 本机客户端导入和隔离 HTTP 验收 8 项通过，实际安装版仍未配置客户端：已提交 Google Cloud 新项目配额申请，真实邮箱授权和查信待验证。逐工具 MCP 授权和添加页搜索尚未交付。
