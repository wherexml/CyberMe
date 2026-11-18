# 持续单一 Agent 会话

## 实现前失败面（2026-11-06，脱敏）

记录于修改代码之前；以下全部为合成示例。

1. 第一轮选定「Project Alpha」来源并得到回答；第二轮用户说“你帮我看看这个任务如何处理吧”，没有再次选择。最近 14 条历史（含上一条回答）均已加载，摘要 ready、omittedMessages=0，但第二轮 contextIds 为空。模型调用不带范围的 `list_tasks`，把无关的「Project Beta」当作“这个任务”。该失败运行中没有注入任何提醒。
2. 已确认的架构缺口（不能仅凭截图归因于模型能力）：`server/src/agent.ts` 每轮 `SessionManager.inMemory()` + 新建 `AgentSession`，将过去 user/assistant 消息压平为一段用户提示，运行后 dispose。角色分离、工具调用/结果以及选定来源的关联在下一轮全部丢失；`index.ts` 只传当前轮 contextIds，历史消息中的 contextIds 被压平丢弃。
3. 既有选定资料测试只覆盖“第一轮明确选择”，没有覆盖无选择的追问连续性。
4. 每轮把全部近期历史重复注入为新文本：重复 token、无法使用会话原生压缩、服务重启后没有可恢复的会话身份。
5. 隐患（实现时必须避免）：工具与事件回调闭包持有 runId、证据、凭证捕获、abort signal 与 artifacts。复用会话时若不重新绑定，上一轮凭证/证据/readOnly 可能授权新一轮；旧订阅会把事件写入旧运行；用量会累计而非按轮。
6. 隐患：被忘记/撤销的来源轮次、派生投影排除在原实现中仅作用于“压平的历史”；会话原生转写若不处理，会通过转写回放或压缩摘要“复活”。
7. 隐患：内部草稿/摘要/记忆任务若复用聊天会话，会污染用户聊天上下文。

## 契约

- 每个用户会话（conversation）对应一个持续的逻辑 Agent 会话，SDK 会话 ID 稳定为 `cm-<conversationId 摘要>`；普通新消息、追问、steer 都进入同一个 `AgentSession` 实例，不按轮新建，不拆分子会话或多 Agent 交接。不同会话彼此隔离。
- 内部任务（draft、source_summary、semantic_classification、memory_extract、context_summary、ideas_refresh、chat_work_*、insight_visual、model_probe、follow_up_check）仍使用独立的一次性内存会话，从不写入聊天会话。
- 持久化：应用私有 SQLite 表 `agent_session_entries` 保存经 `publicValue` 脱敏后的 SDK 条目（按会话顺序，带运行归属），`agent_sessions` 保存会话身份、模型指纹、当前讨论对象和编辑状态。通过该实例 SessionManager 的追加入口即时写入（Pi 1.3 普通消息不触发 `entry_appended`），辅助监听条目事件，轮末再次冲刷；写入失败时本轮不报告成功（`agent_session_persist_failed`），实例被丢弃，下一轮从持久条目恢复。不使用 SDK 默认 `~/.pi` 文件，不写凭证值；个人微信 `app_read` 原始结果在持久副本中替换为审计摘要，图片字节替换为占位说明。
- 轮次结算：回答完成后对实时会话追加 `context_edit`，把本轮微信原始工具正文和图片字节替换为与持久副本相同的脱敏表示，并写入不进入模型上下文的 `cyberme_turn_settled` 标记。
- 重启：由已保存条目经 `SessionManager.inMemory(cwd,{id},entries)` 重建同一 ID、同一角色/工具历史；不重放任何提示或工具。没有结算标记的失败/停止轮次（例如进程在工具结果之后被杀）在下一轮以“未进入本会话的早先轮次”说明，已持久的工具结果保留；没有结果的工具调用改写为“中断、状态未知、未重放”的文本。
- 每轮重新绑定：工具定义注册一次，执行时委托给当前轮的 binding（runId、readOnly、prompt、凭证、artifacts、lifetime signal）；轮次结束解除绑定，迟到回调抛出 `stale_turn`。每轮按当前权限 `setActiveToolsByName`。事件订阅每轮新建、轮末取消；用量只统计本轮新增 assistant 消息。
- 当前讨论对象：本轮选定资料写入会话（custom message）并成为 focus；focus 只记录最后一次明确选择及来源追溯；未选择的追问直接依靠原生角色历史，不重复把旧资料标成当前对象；纯文本换题依靠最近对话承接；有 focus 时不注入环境提醒。选定该 focus 的轮次（或迁移来源消息）被遗忘后，focus 及其标题清除。
- 来源追溯：每个持续会话轮次照旧写 `load_conversation_context` 审计，historySourceIds 为下一轮仍可见的会话消息 ID（含迁移消息，最多 500 个），summarySourceIds 为迁移摘要来源；`conversation-memory.ts` 的忘记/撤销据此传播到派生轮次。
- 排除与撤销：每轮开始和恢复时，对属于排除运行/消息的条目追加 `context_edit(null)`；被删除或内容版本变化（标题、正文、content、summary、description、notes、status、dueDate、转写、消息）的选定来源条目替换为占位说明；引用已删除实体的工具结果替换为占位说明；迁移消息中的来源消息或摘要来源失效时去掉摘要并重写。任何压缩摘要只要覆盖了此后需要上述编辑的条目（按压缩时记录的覆盖运行与编辑状态判断），即被退役并以同一会话 ID 从原始条目重建实例。
- 压缩：SDK `compact()`，按上下文用量阈值（`CYBERME_AGENT_SESSION_COMPACT_RATIO`，默认 0.6）在轮前执行，自定义说明要求保留最新话题、换题与未完成事项。用量百分数统一除以 100；关闭轮内自动压缩，避免尚未脱敏的微信工具正文进入摘要。Pi 默认保留最近约 20000 tokens，会话过小时压缩返回“Nothing to compact”，记录为失败而不是成功。
- 旧会话迁移：首次进入时将原有效摘要与最近 14 条合规历史（经 `contextHistory` 排除，单条 4000 字符，总计 40000 字符）作为一条“迁移前会话记录”custom message 写入一次，之后不再重复注入。
- 模型/提供方设置变化：记录指纹（协议、地址、密钥摘要、模型、模型参数、思考级别、兼容模式、超时、策略与系统提示摘要）；任一变化都以同一会话 ID、同一条目重建实例并写 `agent_session_rebuilt` 证据。

## 接口

| 接口 | 语义 |
| --- | --- |
| GET /api/chat/conversations/:id/agent-session | 只读：会话 ID、实例 ID、本实例轮数、当前讨论对象、条目形状（角色、工具名、编辑/压缩），不返回正文 |

## 验收与边界

- M2 Max 仅编辑代码，本机完成验收：类型检查通过；`node scripts/agent-session-http-e2e.mjs` 55/55，覆盖实际 API/SQLite、连续追问、同一实时实例、角色/工具历史、权限逐轮绑定、停止、失败、撤销、来源变化、模型切换、压缩、重启、工具结果后强杀与持久化失败注入。
- `node --import tsx scripts/agent-session-real-e2e.mjs` 使用已配置的真实模型、隔离合成资料，30/30：连续追问、新选资料、纯文本换题后的追问、会话隔离、小会话不误触发压缩。成功路径复核后，最终仅补充了持久化失败路径的审计状态，该路径由受控 HTTP 再验通过。
- `node --import tsx scripts/agent-execution-http-e2e.mjs` 52/52：真实 OS/HTTP 执行、临时凭证、幂等、超时、停止、只读/否定授权；模型为受控提供方。验收脚本按最新用户消息定位本轮，并排除之前轮次工具结果。
- 所有验收使用独立五位端口与隔离数据库；结果写入私有 `.local/acceptance` / `output`。没有安装版 UI、真实来源原文、真实外发或生产升级验收；源码验收不等于安装版已生效。
- 已实测 Pi 1.3.0 普通消息不发出 `entry_appended`，因此按实例包裹 SessionManager 公共追加入口；custom message、context_edit 投影、实际 compact 和重启恢复均由 HTTP 路径验证。微信正文/图片脱敏代码已审查，未使用真实个人微信或图片完成端到端验收。
- 关闭轮内自动压缩后，单轮超出模型上下文窗口会明确失败；下轮可在脱敏后执行轮前压缩。
- 事件即时持久化在持久化失败时只记录错误、不中断正在进行的模型调用；失败在轮末才使本轮失败。
- 讨论对象切换由模型依据当前请求判断；服务端只在新选择时更新 focus，后续指代理解仍取决于模型，但不再注入旧 focus 与最新话题竞争。
- 来源追溯 historySourceIds 上限 500；超出时较早消息的遗忘不会通过审计传播到派生轮次（审计标记 provenanceTruncated）。忘记传播按现有规则波及之后所有可见该消息的轮次。
- 工具结果中任一被删除实体的 ID 会使整条结果被替换为占位说明（保守）；工具结果不做内容版本比较，只处理删除。连接断开但实体仍存在时不自动撤回会话中的旧正文。
- 每次来源变化/遗忘若命中压缩覆盖范围，会退役该摘要并使上下文暂时变大，直到下次阈值压缩。
- 图片输入只在当轮可见；轮末从实时上下文与持久副本中替换为占位说明。
- 删除会话后实时实例被回收，但持久转写行不物理删除。
- chat 与 deep 模式切换会以同一会话 ID 重建实例（不是新逻辑会话）。

## 安装版复验（2026-11-06）

本机 Developer ID 签名构建 `1793979716153` 已更新。原有聊天、原选定事项和真实模型连续四轮通过：第一轮选资料，随后两轮不选资料直接追问；正常退出应用并停止包内 API/网关后重新启动，第四轮仍正确承接。前三轮同一实时实例，四轮同一逻辑会话；第四轮 `restored=true`。19 项安装检查通过，无业务写工具调用，模型配置与主会话保留。私有证据位于 `output/agent-session-20261106/installed/`，可用其中 `collect-evidence.py` 只读复核。原生截图已在验收会话提供；实际页面使用 MyGO 内嵌 `cyberme.html`，不是浏览器预览地址。本次为本机更新，未新公证或公开发布；不将连续性验收等同于所有回答质量通过。


## 2026-11-11 会话轮次排队

V6 普通连发在 SDK 之外先进入 `chat_requests` 持久 FIFO（queueCurrent），前一轮完成后才申请同一会话实例；排队不占 SDK 锁的 15 秒等待预算或模型超时。不同会话独立，出队重读历史及授权范围，重试加入队尾；queued/running 都可按原 ID 回查。服务重启对尚未开始的 queued 同样留下 server_interrupted，不自动提交提示或工具，需用户显式恢复。既有显式 interruptCurrent 与 steer 契约保留。


## 2026-11-11 运行中追加

普通后续输入继续复用当前实例；明确补充在 SDK 工具批次结束后进入同一工作，通过独立子运行记录输入、权限和证据，不创建子 Agent。来源、原文在同一推理边界按序投递；received/claimed/consumed 与最终结果分开。工具批次运行期间不替换它的权限绑定，最多八条提前补充有界延长处理预算，普通后续工作仍依序继续。兼容 continuation 已并入 chat_requests 单一调度；详细契约、复验入口和安装边界见 [持续 Agent 消息追加](chat-input-append.md)。

轮前压缩与回答的时间预算已分离，见 [chat-time-budgets.md](chat-time-budgets.md)：压缩计入准备预算（默认 150s，可 `abortCompaction()`），回答/工具循环在提示发送时才开始独立预算。

## 2026-11-12 技能目录与工作范围消息（本机验收待进行）

持续会话新增三类可替换服务端资料：`cyberme_skill_catalog`（目录变化、压缩或遗忘清理后重发）、`cyberme_skill_hints`（每轮替换）与 `cyberme_work_scope`（每轮替换，归属原始运行以便遗忘时移除）；`cyberme_skill_invocation` 与 `read_local_skill` 正文在轮次结束后替换为 id/hash 存根。会话记录新增 `skillCatalogHash`，不进入会话指纹。系统提示与 `server/agent/agents.md` 的授权延续说明已更新，首次加载会以同一会话 ID 重建实例一次。详见 [本机技能](local-skills.md)。

## 2026-11-13 持久排队轮次的时限（已本机安装验收）

持久 AgentSession 的 `queueCurrent` 轮次使用进展空闲窗口加不可续期硬上限与模型请求上限，替代单一 110/150s 回答计时器；到时、停止与清理沿用同一中止路径，之后不发起新的模型或本机操作。会话 ID、历史、`cyberme_turn_outcome` 未完成说明、回执分类与不自动重放保持不变。详见 [聊天时间预算](chat-time-budgets.md#2026-11-13-持久排队聊天的进展预算已本机安装验收)。

本轮本机受控时限 40/40、浏览器 11/11、真实合成流程 6/6（163.454s），追加 20/20 与排队 29/29 回归通过。签名构建 `1794547763431` 已安装并完成原生界面、原失败记录与数据保留检查；真实业务未重跑。完整边界见上述时间预算文档与本机私有 `output/skill-progress-timeout-20261113/REPORT.md`。

## 2026-11-13 持久排队轮次的阶段计时（已本机安装验收）

持久 AgentSession 的 `queueCurrent` 轮次由每次运行独立创建的阶段看门狗负责响应头、首段、流式静默与逐调用工具期限；运行结束（成功、失败、停止或 `finally`）时释放，复用同一 SDK 会话的下一请求从全新状态开始。会话 ID、历史、`cyberme_turn_outcome` 未完成说明、回执分类与不自动重放保持不变。详见 [聊天时间预算](chat-time-budgets.md)。

本机受控 HTTP 73/73、浏览器 14/14（含长流补验）、真实隔离模型 6/6 通过；时间预算、技能、排队与追加回归分别 117/117、77/77、29/29、20/20。签名构建 `1794555685314` 已安装，安装版真实模型 QA 9/9：三段 45s 命令及读回正常完成（回答 159.639s），原生 WebKit 已核对完成回复并返回原主对话。安装及原失败记录检查 29/29、数据保留 10/10 通过。证据见本机私有 `output/chat-phase-watchdog-20261113/REPORT.md`；真实业务未重跑，未新增后台续跑能力。
