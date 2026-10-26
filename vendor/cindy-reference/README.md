# Cindy Agent 接入源码参考

来源：<https://github.com/makecindy/cindy>，commit `d3173a55c8dd4bc42cc85b69130a49c8dd34229e`，2026-10-17 获取。上游代码原样保留。后续直接接入已由 `server/src/executors/native.ts` 引用 Codex client/transport 及其相对依赖，其余文件保留为参考。

保留根 `LICENSE`（Apache-2.0）、`NOTICE` 及 `upstream-manifest.json` 中每个文件的 SHA256。完整只读检出在本项目忽略目录 `.local/references/cindy/`。本目录不包含 Claude/Codex 二进制，也不重新分发其 SDK。

| 文件（相对 `packages/maker-core/src/`） | 可复用部分 | 接入条件 |
| --- | --- | --- |
| `agents/codex/app-server/transport.ts` | NDJSON 字节流接口 | 不承担请求幂等或业务恢复 |
| `agents/codex/app-server/stdioTransport.ts` | 独立 `codex app-server` 子进程、输出排空、有界退出 | Node child_process/readline；传入已验证 binaryPath/cwd/env |
| `agents/codex/app-server/client.ts` | 请求关联、握手、通知与服务端请求、超时 | 本目录已含其相对 import 所需 protocol/logger/transport |
| `agents/codex/app-server/protocol.ts` | Cindy 使用的协议子集 | 本目录已含 account-rate-limits 类型；仍须按本机 CLI 版本验证 |
| `agents/codex/interaction-broker.ts` | 按 connectionId/requestId 等待及撤销输入 | 当前 kind 是 request_user_input/dynamic_tool；不是完整权限审批实现 |
| `agents/codex/history-recovery.ts` | 精确历史错误分类 | 不自动恢复、不改写原生历史 |
| `agents/claude-code/local-process-spawn.ts` | 观察 SDK 子进程代次和退出清理 | 类型引用 `@anthropic-ai/claude-agent-sdk`；上游固定 0.3.292，本项目未安装 |
| `agents/claude-code/invalid-resume.ts` | 精确 session-not-found 分类 | 不可把普通 404/网络错误当作会话丢失 |
| `interfaces/logger.ts` | 日志注入接口及 console 示例 | 产品应提供脱敏 logger；不直接启用原始 stdout/stderr 持久化 |
| `types/account-rate-limits.ts` | Codex 账号额度类型 | 不代表接入了额度消费/重置功能 |

这些文件构成底层协议与参考材料，任务连接器在本项目 `server/src/executors/`。未复制庞大的 `BaseAgent`、`ClaudeCodeAgent`、`CodexAgent` 和 Electron 宿主，避免把 Cindy 数据库、认证与运行策略一并带入。当前46400任务页通过真实原生协议执行，未宣称原生客户端或完整产品交付。

复核方法：逐项按 manifest 计算 SHA256，并与完整检出的同路径文件比较。协议 E2E：在仓库根执行 `node_modules/.bin/tsx scripts/cindy-codex-handshake-e2e.mts`，使用全新隔离 CODEX_HOME 和本机真实 CLI，验证 initialize、只读 model/list、关闭自有子进程，并输出脱敏 JSON。此实测不调用模型，也不验证产品任务执行/审批/恢复。

研究与接入方案见 [研究报告](../../docs/research/cindy-agent-connection-20261017.md)。
