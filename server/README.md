# OpsTwin Advance API (`server/`)

本地优先的独立后端：Hono + `node:sqlite`（独立 `data/opstwin-advance.db`）+ vendored PI 0.86.1 Agent。只监听 loopback。

架构、API、Agent 并发恢复、集成边界与失败场景见 [Backend 规范](../docs/spec/backend.md)；端点细节见 [API 契约](../docs/spec/api-contract.md)；应用内 Agent 工具目录见 [Agent 操作规格](../docs/spec/agent-operations.md)，运行指引实际加载 [server/agent/agents.md](agent/agents.md)。本页只维护运行命令与硬边界。

## 运行

需要 Node.js 22.19+。命令均在仓库根目录执行：

```sh
npm ci
npm run dev:server        # 仅 API，127.0.0.1:46110
npm start                 # 同时启动 Web(46100) 与 API(46110)
npm run start:api         # 同 dev:server
curl -s http://127.0.0.1:46110/api/health
```

服务端 AI / 语音 / Jev 凭据只读自私有忽略文件 `.local/config.json`（0600）与 `.local/jev.json`，不能从 API 读取或写入验收产物。迁移机器时按根 [README](../README.md) 自行配置。

## 验收

不写单元测试；复杂功能以真实 HTTP / ego-browser E2E 验收：

```sh
npm run typecheck
npm run e2e:api           # 隔离数据库，端口 46111，无外部动作
```

## 模块边界速查

| 模块 | 约束入口 |
| --- | --- |
| 飞书用户连接与外发 | 根 [AGENTS.md](../AGENTS.md)；仅许茂林本人 QA，回执/未知状态不得盲目重发 |
| 飞书数据同步 | `connection-sync.ts` 协调、`feishu-sync-data.ts` 采集；详见 [飞书数据同步迁移](../docs/journeys/feishu-sync.md) |
| 飞书 PersonalAgent 扫码绑定 | `feishu-binding.ts`；私有状态加密于 `.local/feishu-binding/` |
| 个人微信 wechat-sync | `wechat-sync.ts` 只读本机 GreenBubbles，不提供发送 |
| Inbox 显式来源规则 | `inbox-source-rules.ts`，写规则需直接用户请求证据 |
| 消息展示适配 | `message-presentation.ts` 只读适配姊妹库资料 |
