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
| 原生客户端兼容 | `native-api.ts` 新增版本、消息分页与 revision SSE；分页已下推为 SQL keyset 查询（部分索引 `native_messages_conv_created`，契约与返回不变）；`node scripts/native-api-e2e.mjs` 对真实 API 验证，见 [GUI 验收与限制](../docs/acceptance/native-gpui-20261003.md) |

Inbox 草稿只生成正文，已移除关键词／偏好触发的自动 PDF 与图表；历史未发送自动附件由启动迁移解除关联。回归命令：`node --import tsx scripts/remove-automatic-files-e2e.mjs`，见 [旅程与证据](../docs/journeys/remove-automatic-reply-files.md)。

HTML Chat 接入：`chat-status.ts` 只读请求回查，`scripts/macos-study-chat-bridge.mjs` 固定46114、私有capability、限定路径；API Origin 白名单保持。参见[执行契约](../docs/design/idea-chat-judgment-contract.md)。

HTML 多会话增加 `POST /api/conversations/side` 幂等创建，私有 46114 桥接提供限定 sessions 路由；主会话指针保持逻辑见 [Backend](../docs/spec/backend.md)。面板管理数据仍保存在设计稿浏览器中。

设置复杂验收可通过服务端进程环境 `OPSTWIN_PRIVATE_DIR` 隔离本项目 `.local` 内的模型/语音配置及加密Bot绑定；默认路径保持。该变量不经HTTP/Agent输入，禁止越界及悬空链接。可重复真实模型/保存/重启脚本 `node scripts/native-private-runtime-http-e2e.mjs` 默认46214，也可设置 `OPSTWIN_PRIVATE_RUNTIME_PORT=46215`，拒绝占用端口；私有副本只留服务端0700/0600路径，产物不含凭据。规格和实际21项证据见[私有运行配置](../docs/spec/private-runtime.md)。

自定义连接的私有凭据绑定精确目标及认证方式；公共编辑使旧验证失效，公开协议 header 以外的值不进入公共配置。REST/MCP 禁止跟随重定向，缺凭据不匿名检测为成功；旧短凭据只修复关联诊断。真实隔离 E2E：`node scripts/native-connection-credentials-http-e2e.mjs`（46220/46221），独立50/50 HTTP通过（含none/public-only协议header兼容），原生GUI另验，见[连接凭据旅程](../docs/journeys/native-connection-credentials.md)。

个人微信新增 typed CLI 联系人、会话内 stdin 搜索、精确消息和有界RAM图片读取；源/连接版本绑定精确ID，断开清媒体与ID注册，Agent证据省略query及正文。`node scripts/native-wechat-context-http-e2e.mjs`（46223）区分公开协议fixture和installed实际只读调用；原生新reader、语音/视频/文件与同秒歧义能力见[微信上下文旅程](../docs/journeys/native-wechat-context.md)。

精确非图片接入前基线：`node scripts/native-wechat-attachment-http-e2e.mjs`（46230，新SQL/空私有配置）使用公开 SQLite +完整候选 CLI；source 注入 wrapper 不伪造协议、不调用私人 profile。当前四个非图片附件仍实际501，10 PASS/5 FAIL基线保留；不得据候选CLI通过宣称API或原生已接通，见[附件闭环](../docs/journeys/native-wechat-attachment-api.md)。
