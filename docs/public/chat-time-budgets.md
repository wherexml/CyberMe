# 聊天时间预算与来源“仅@我”过滤

## 失败用例（实现前记录）

### A. 长会话超时

1. 长会话轮前 SDK `compact()` 实测 88.889s；旧实现在记忆召回和压缩之前就启动唯一的 110s 计时器，压缩结束后模型/工具回合只剩约 21s，几次有效的模型/工具回合被同一计时器杀掉，返回 `llm_timeout（tool/awaiting_headers）`，实际原因（压缩耗时）不可见。
2. 只调大共享超时会让卡死的压缩把回答预算一起吃掉，且仍无法区分“准备超时”和“回答超时”。
3. 压缩超时时若不调用 `abortCompaction()`，压缩请求会在下一轮继续占用实例，或与回答轮次重叠。
4. 准备阶段超时后若仍发送提示，模型会在过大的上下文上开始回答，工具写入时间不受界定。
5. 停止/新消息打断发生在压缩期间时，旧实现只中止 SDK agent，压缩可能继续；状态应为 `cancelled`，不能记为超时或成功。
6. 排队等待（`chat_requests` FIFO）不能计入任何预算；会话锁 15s 等待也不计入回答预算。
7. 追加输入（appended input）原本每消费一条重置回答预算；新的分离不能改变该行为，也不能让追加输入重置准备预算。
8. 超时、失败、部分完成或未知的工具写入必须按真实回执记录；不能因为压缩成功就推断回答成功，也不能自动重放。
9. 重启后同一 requestId 回查须返回原终态（幂等），不得重新执行压缩或工具。

### B. 来源“仅@我”过滤

1. `set_inbox_source_rule` 只有 `excluded:boolean`，用户说“这个群只看@我的”只能整体排除或保持，前者会漏掉@我的请求。
2. 用正文 `@名字` 子串判断提及会误判：转述、引用、他人同名、`email@域名`、“没有@我”。
3. 引用/转述/翻译的材料、否定句（“不要只看@我”）、方向不明、来源名不唯一都不能授权修改规则。
4. 旧规则（`active:true/false`）、已有草稿、敏感、失败、判断不明确的事项、原始消息必须保持。
5. Inbox、注意力投递、默认草稿、洞察来源四处投射必须一致遵守同一规则。

### C. 验收评审补充（修复前记录）

- R1 传输外包：准备 150s + 回答 110/150s 超过 Web `store.ts`、`mygo-workspace-gateway.mjs`、`native/mygo/proxy.go`/`bridge.go` 的 180s 限制，客户端会先于服务端合法的两段运行断开。
- R2 精确请求：轮次 `requestRoundId='other-request'` 的当前消息 `mentionsSelf=false`，同一 `messages` 中有两条无关早先请求 `mentionsSelf=true`；“上下文任一提及”会把当前请求误判为@我。
- R3 失败分析：已验证未@我的当前请求，旧的失败/过期分析会让它重新成为待办或通知（旧排除规则对失败判断保留关注）。
- R4 真实链路：使用当前日常网关与现有 CA（`NODE_EXTRA_CA_CERTS`），不是更换模型或提供方。
- R5/R7 私有快照：协调者提供的压缩前快照（167 条持久 SDK 条目，约 1.32MB）只能克隆到本机隔离目录；必须在该快照的实际长会话中，以协调者指定的来源名执行真实压缩与规则写入；关闭全部后台；只导出时间、回执、布尔值与哈希，不导出来源/规则对象或任何业务标识与正文。
- R6 精确配置：必须原样使用本机保存的日常 DeepSeek 模型、端点与协议，不得去掉模型前缀、更换主机或回退到其他提供方。

### D. 本机 HTTP 验收补充（修复前记录）

- R8 来源名精确优先：完整名称 `合成群Alpha` 因 `合成群Alpha备份` 也包含该子串而被判为歧义。应先取唯一的完整同名来源；完整同名重复或无完整同名且部分匹配多个时仍拒绝。
- R9 验收夹具：通过 HTTP 创建带 `requestRoundId`/`send_unknown` 的轮次会被服务端托管字段校验拒绝，后续直接写判断记录时 id 为空导致脚本崩溃；分页上限为 200，`limit=500/1000` 会返回 400。夹具须先普通 HTTP 创建、再在隔离夹具库中绑定并回读，判断记录显式写 id，逐页读取并断言响应形状，夹具失败单独标记 `FIXTURE`，不当作产品结论。真实验收的合成投射同样处理。
- 已确认：`mentions` 模式下已验证未@我的敏感事项保持安静，是本用户期望的策略。

### E. 安装版真实日常模型补充（修复前记录）

- R10 发现面过期：安装版真实 DeepSeek 在旧会话中先调用 `get_app_capabilities` 与 `app_read`，能力目录没有来源规则条目（也没有只读 action 或模式说明），模型据此回答“仅支持排除/恢复，不支持只看@我”，零次规则写入。专用工具已存在，但普通发现路径没有如实暴露 `all/mentions/exclude`。
- R11 验收绕过发现：受控 E2E 由提供方直接给出 `set_inbox_source_rule` 参数（预填 sourceKey），快照验收也没有走发现路径，因此未暴露 R10。
- R12 Agent 设定面：`server/agent/agents.md` 的能力清单只列 Inbox 判断/草稿/发送等，没有来源规则模式。
- 修复边界：发现面只增加只读 action `inbox_source_rules_read`（GET `/api/inbox-source-rules`，返回每个来源的 `mode`）和目录段 `inboxSourceRules`（支持模式、读写入口、参数 schema、示例、门禁、可信@我判定、保留项）；写入仍只经专用工具 `set_inbox_source_rule`，`app_action` 不提供来源规则写入，因此当前用户逐字证据、方向/否定/引用、唯一来源与只读门禁不变。


### F. 安装版日常长会话补充（修复前记录）

- R13 恢复的长会话沿用过期能力说法：安装版日常长会话中 `run.agentPolicy.hash` 已是新 `agents.md`，`set_inbox_source_rule` 也在本轮工具中，但模型不调用任何工具，重复本会话早先助手消息“只支持排除/恢复、不支持只看@我”。新进程/新会话副本成功；缺失的是“已持久化会话 + 历史中含过期助手说法”的情况。系统提示与工具描述离当前输入太远，压不过历史中的具体说法。
- R14 不能用的修法：自动写规则、伪造成功、删除或改写历史助手消息、新建会话或改会话 ID、把能力说明存为业务记忆，都不可接受。
- 修复：`prepareChatTurn` 在压缩之后、当前用户输入之前，注入一条服务端自有、可替换的 `cyberme_capability_context`（当前工具名、`inboxSourceRules` 支持模式/读写入口/schema/门禁，明确取代早先能力说法，声明不是授权）。版本为 `CAPABILITY_CONTEXT_VERSION`（可由 `CYBERME_CAPABILITY_CONTEXT_VERSION` 追加）与本轮工具集合的哈希，存于 SessionRecord JSON `capabilityContextHash`；版本或工具集合变化、本轮压缩成功、或卫生排除发生时，先退役旧副本再发送新副本（始终最多一条可见），并写 `agent_capability_context` 证据。会话 ID、历史条目与所有工具授权门禁不变；只读轮次的说明如实写明写工具不可用。


## 设计

### 时间预算

- 三段互不重叠：排队（不计时）→ 准备（记忆召回、会话卫生、轮前压缩、注入资料）→ 回答（模型回合、工具循环、结构化纠正）。
- 准备预算 `CYBERME_CHAT_PREPARE_BUDGET_MS`，默认 150000；压缩在其中运行，超时调用 `session.abortCompaction()` 并以 `504 chat_prepare_timeout`（`phase=compaction|preparation`）失败，提示未发送，会话保留，可重试。
- 回答预算 `CYBERME_CHAT_ANSWER_BUDGET_MS`，默认 110000（深度 150000），在 `session.prompt()` 之前才启动；准备计时器先清除。追加输入仍按原规则重置回答预算。
- 审计：`runs.timeBudget = {prepare:{budgetMs,startedAt,elapsedMs,status},answer:{…}}`，事件 `budget_phase_start/end`，工具证据 `chat_time_budget`、`agent_session_compaction.elapsedMs/status=timed_out|aborted`。
- 停止/打断：压缩期间同样 `abortCompaction()`，终态 `cancelled`；超时与打断互斥，以打断优先。

- 传输外包（R1）：`shared/chat-budgets.ts` 定义 `CHAT_TRANSPORT_TIMEOUT_MS = 150s + 150s + 45s（锁等待 15s、打断确认 10s、中止落盘 5s 与余量）= 345s`；Web `POST /api/chat`、网关与原生 proxy/bridge 对 `POST /api/chat` 使用 345s，其余路由保持 180s。服务端环境变量预算被钳制在 150s 以内，保证外包始终覆盖两段。断开后的回查仍按请求 ID 轮询终态。

### 来源规则

- 规则 `mode: 'all' | 'mentions' | 'exclude'`；旧记录无 `mode` 时按 `active` 推导（`true→exclude`，否则 `all`），并保持 `active === (mode==='exclude')`。
- 工具 `set_inbox_source_rule` 新增可选 `mode`，`excluded` 继续兼容；两者冲突拒绝。HTTP `POST /api/inbox-source-rules` 同样接受 `mode`。
- 来源解析：查询结果中唯一的完整同名来源优先；完整同名重复，或无完整同名而部分匹配多个，返回 `ambiguous_source`（附匹配计数）。
- 授权：evidence 必须逐字出自当前用户正文（去除引用/代码块/转述），包含唯一来源名；方向判断后否定句被移除；“仅@我/只看@我/only mentions”判为 `mentions`，与排除/恢复冲突或不明确即拒绝；来源名须唯一匹配 `sourceKey`。
- 当前请求绑定（R2）：只判定当前请求本身——优先 `requestRoundId`，否则成功判断的 `requestMessageId`；绑定消息缺失为 `unknown`，绝不改用其他历史提及。无绑定时只看最新外来消息，不一致为 `unknown`。
- 已验证未@我（R3）：`mentions` 模式下当前请求可信未@我时直接安静（`source_rule`），即使判断失败/过期也不进入待办、核对、通知或默认草稿；仅真实发送中/结果未知（`sending|send_unknown|send_failed|failed`、草稿准备 unknown）与人工草稿（`manualDraft`/`editedByUser` 或非自动生成）保留关注；敏感等原排除规则仅用于 `exclude` 模式。
- 提及判定只用可信元数据：飞书 `mentionsSelf===true` 或 `mentions[].id===item.selfId`，微信 CLI 计算的 `mentionsOwner===true`；明确 `false` 视为未提及；无元数据为 `unknown`（保留关注）。不做正文子串推断。
- 投射：只依据当前请求的可信提及元数据；已确认未@我时 `sourceRule.active=true, reason=mentions_only`，失败/过期分析不会重新提起。发送中、未知外发、外发失败与人工草稿保留；缺失元数据为 unknown。Inbox、投递、默认草稿与洞察遵循相同规则；原始消息不删除。

## 验证

- 受控 HTTP：`node scripts/chat-time-budget-http-e2e.mjs`（API 46981，提供方 46982，合成数据）。
- 真实验收：`NODE_EXTRA_CA_CERTS=<现有 CA> node scripts/chat-time-budget-real-e2e.mjs`（API 46983）；原样复制日常 `llm` 配置，每轮核对模型与保存值完全一致，无回退。快照模式：`CYBERME_SESSION_SNAPSHOT`、`CYBERME_SNAPSHOT_CONVERSATION_ID`、`CYBERME_SNAPSHOT_SOURCE_NAME`，克隆到本机隔离目录，在该会话内真实压缩并写入仅@我规则；结果只含布尔、计数、哈希与时间。
- 验证结果和安装边界由本机协调者的私有验收报告记录；受控提供方不等同真实模型验收。

### 能力发现

- get_app_capabilities 暴露来源规则 all/mentions/exclude、专用工具参数与回读字段。app_read 的 inbox_source_rules_read 为只读列表；写入必须使用 set_inbox_source_rule，不能借通用 app_action 绕过当前用户证据校验。

### 持久会话能力版本

- 轮前压缩后、当前用户输入前，注入至多一份有界的当前能力资料，按实际本轮工具列表和能力版本计算 hash；变更、压缩或卫生清理时重新注入并撤下旧份。会话 ID 和历史保留，能力资料不构成业务操作授权。

## 2026-11-13 持久排队聊天的进展预算（已本机安装验收）

实现前失败面见本机运行目录 `FAILURE-CASES.md`（19 项）。用户反馈的技能工作流：准备 6s 后，52s 来源读取、六条成功命令与九轮模型请求都在推进，最终流式回答在 111.4s 被单一 110s 回答计时器中止，并显示为“模型回复超时”。V6 请求均为 `queueCurrent`（HTTP 202 + 回查），已与传输外包解耦，因此只改该路径。

- **范围**：仅持久会话且 `POST /api/chat` 带 `queueCurrent:true` 的请求（服务端设置 `durable`）。345s 传输外包只约束同步（非排队）`POST /api/chat`；排队请求立即返回 202，由下述空闲窗口、硬上限与请求上限在服务端约束。同步聊天、模型探测、草稿、灵感、自动化等内部任务仍用原单一回答计时器，行为不变。
- **空闲窗口**：沿用 110s（深度 150s），从最近一次服务端观察到的进展起算。进展只包括：提供方响应头、无错误的助手消息结束、工具调用返回（含工具错误或拒绝）、消费追加输入。文本增量、请求载荷、`turn_start`、工具开始、轮询与心跳都不续期。
- **硬上限**：普通 600s、深度 900s，`CYBERME_CHAT_DURABLE_HARD_CAP_MS` 最高 900s；回答阶段开始时启动一次，任何事件（含追加输入）都不续期。
- **模型请求上限**：每次持久回答最多 60 次提供方请求（不计准备阶段）；`CYBERME_CHAT_DURABLE_MAX_PROVIDER_REQUESTS` 只能调低。超过上限的那次请求在发出前（`onPayload`）即被拒绝并中止本轮，实际发出的请求数不超过上限；中止后到达的任何迟到轮次同样在发出前被拒绝。
- **到时处理**：与原超时相同，先置标记，再中止 `lifetime` 与会话；所有工具调用先检查中止信号，之后不再发起模型或本机操作。停止/新消息打断优先于超时：即使时限先触发，被打断的请求仍为 `cancelled`，`endedBy` 也记为 `cancelled`（保留已发生的 timeout 事件）。结束、失败与清理时清除所有计时器，迟到计时器不生效；准备阶段与追加准备中的压缩沿用既有 `lifetime` 信号调用 `abortCompaction()`。准备阶段预算与压缩中止不变。
- **错误与审计**：提供方/流式空闲为 `llm_timeout`（`budget:'idle'`，phase 为 `awaiting_headers|streaming`）；工具阶段空闲为 `chat_processing_timeout`；硬上限或请求次数上限为 `chat_work_deadline`（`budget:'hard'|'turn_limit'`）。`runs.timeBudget.answer` 增加 `mode:'progress'`、`idleMs`、`hardMs`、`maxProviderRequests`、`progressEvents`、`providerRequests`、`endedBy`。
- **状态映射（只读时计算）**：`GET /api/chat/requests/:id` 对上述两类处理超时，以及旧单一计时器在工具执行后或工具阶段触发的 `llm_timeout`，返回 `failureCode:'processing_deadline'`；真正的提供方/流式空闲仍为 `model_timeout`。不改写已存的运行、请求或操作记录，不自动恢复或重放；`partial` 的已完成写入保持原样。同步请求在超时前已有完成写入时，仍按原保护返回 `409 partial_run_requires_review`。
- **V6**：`processing_deadline` 显示“处理超时，本轮已停止。/ Processing timed out; this turn stopped.”，其后保留原有的部分完成核对句；每个已挂载的 partial 请求只按请求 ID GET 回查一次以取得当前分类，不重发。

复验入口（端口 47541/47542，真实模型 47543）：

```sh
node scripts/chat-progress-budget-http-e2e.mjs            # 自行启动 fixture，缩放预算：空闲 2s、硬上限 20s/5s
npx vite build --config web/mygo.vite.config.ts --outDir ../.local/chat-progress-budget-web
node --import tsx scripts/chat-progress-budget-fixture.mjs
ego-browser nodejs < scripts/chat-progress-budget-browser-e2e.mjs   # 单一 TaskSpace，绝对路径 JSON 输入
node scripts/chat-progress-budget-real-e2e.mjs            # 仅本机已保存的日常模型配置，隔离合成技能
```

本机验收：类型检查与 V6 构建通过；受控 HTTP 40/40、浏览器 11/11，真实日常模型合成技能 6/6（回答耗时 163.454s，四次 35s 步骤与一次读回均只执行一次）。时间预算、技能、排队与追加回归分别 117/117、77/77、29/29、20/20。真实模型只证明超过旧 110s 时限且持续推进的合成流程可完成，各种到时路径由受控提供方覆盖；未重跑真实业务。

Developer ID 签名构建 `1794547763431` 已通过本地更新器安装到正式 CyberMe；安装文件与候选 31558 项一致，25 项安装与原失败记录保留检查、27 项已有技能路由检查及 10 项数据保留检查通过。原生 WebKit 实际卡片显示处理超时，仍保留部分完成；原请求、运行和六条成功操作记录未改写或重放。详情与截图位于本机私有 `output/skill-progress-timeout-20261113/REPORT.md`。没有提交、推送、新公证或公开发布。

## 2026-11-13 持久排队聊天的阶段计时（第一批，已本机安装验收）

实现前失败面见本机运行目录 `FAILURE-CASES.md`（21 项）。本批**取代**上节的单一 110/150s 空闲窗口，仅用于持久会话 + `queueCurrent`；同步聊天、内部 JSON 任务、准备/压缩阶段与 345s 同步传输外包不变，`CYBERME_CHAT_ANSWER_BUDGET_MS` 仍只作用于这些旧路径。硬上限（600/900s）与每次回答 60 次模型请求上限不变，仍为最后兜底。

- **单一负责者**：`server/src/chat-phase-watchdog.ts` 持有全部回答阶段状态与一个计时器，按当前最早的有效期限触发（硬上限、无工具运行时的模型阶段期限、每个在途工具调用的期限）；到期沿用原中止路径（`lifetime` + 会话 abort，工具包装在中止后拒绝执行）。
- **等待响应头**：每个模型步骤独立获得「会话已配置的提供方超时 + 5s」（普通 45+5=50s，深度 60+5=65s）；SDK 有限重试（1 次，初始 2s 退避）的等待为「退避 + 5s」，每步最多 2 次尝试获得新期限，之后不再续期；同一步骤中重复或迟到的重试事件不会再次延长等待。上一工具剩余时间不会被继承。
- **首段内容**：仅 2xx 响应头开始计时，60s 内须收到首个非空文本、推理或工具参数增量；空增量、SSE 注释/心跳、原始传输分片、请求载荷与轮询不算。
- **流式静默**：已有内容后，相邻两次非空增量最长间隔 30s。有效增量只表示连接仍在输出（不是业务进展），因此持续稳定的长输出可以超过旧 110/150s 窗口，仍受硬上限与请求上限约束。
- **工具**：按 `toolCallId` 跟踪在途调用，每个调用从实际开始获得自己的期限：`run_command` 为其请求的 timeoutMs（默认/最大 60s）+5s 清理余量，`read_github_issue` 与 `read_github_pull_request`（同一 15s `gh` 执行时限）为 15s+5s，其余工具 120s 兜底；工具执行器自身时限不变。有工具在运行时不施加模型阶段期限；某个并行调用结束不会缩短其他调用；未知或重复的开始/结束事件被忽略。最后一个工具结束后，下一模型步骤获得新的响应头期限。
- **重复失败**：按工具实际返回约定判定错误，不把任意业务字段当作执行回执：SDK `isError`（抛出的工具错误）；聊天工具包装返回的 `{error:<说明>,code}`（实体自身的业务 `code` 字段不算错误）；`run_command` 回执 `status:'failed'|'unknown'`（含 exitCode/reason）；GitHub 读取只含 `{code}` 的失败结果。错误与未知回执都不计为进展。同一工具 + 参数 + 错误连续 3 次即停止（`no_progress`），不同尝试与回读不受影响，不自动重试未知写入。
- **进展计数**：`progressEvents` 只计成功的助手消息、成功的工具结果与已消费的追加输入，不再续期任何窗口；追加输入不重置硬上限、重试预算或其他阶段。
- **结果与映射**：响应头/首段/流式静默到期为 `llm_timeout`（`budget:'headers'|'first_content'|'stream_silence'`，显示为模型超时）；工具超过自身期限为 `chat_processing_timeout`（`budget:'tool'`，含工具名）；重复失败为 `chat_work_deadline`（`budget:'no_progress'`）；后两者与硬上限/请求上限一样映射为 `processing_deadline`。停止/新消息打断仍优先，`endedBy` 记为 `cancelled`。旧运行的 `idle`/`answer` 映射保持不变，原记录不改写。
- **审计**：`runs.timeBudget.answer` 保留 `mode:'progress'`、`hardMs`、`maxProviderRequests`、`progressEvents`、`providerRequests`、`endedBy`，`idleMs` 保留为 `null`；新增 `watchdog:'phase'`、`phases{headersMs,firstContentMs,streamSilenceMs,toolFallbackMs,toolGraceMs,repeatErrorLimit,maxAttemptsPerStep}` 与计数 `steps/attempts/retries/toolCalls/maxParallelTools/toolErrors/deltas/lastPhase`，在结束时写入一次；不逐增量写库或记录内容。timeout 事件只含阶段、预算类别与工具名。
- **覆盖优先级**：默认值来自 `shared/chat-budgets.ts`；以下服务端环境变量只能**调低**，不能延长任何期限或兜底：`CYBERME_CHAT_HEADERS_MS`、`CYBERME_CHAT_FIRST_CONTENT_MS`、`CYBERME_CHAT_STREAM_SILENCE_MS`、`CYBERME_CHAT_TOOL_FALLBACK_MS`、`CYBERME_CHAT_TOOL_GRACE_MS`、`CYBERME_CHAT_REPEAT_ERROR_LIMIT`（最低 2）；硬上限与请求上限沿用原变量与上限。
- **清理与已知限制**：成功、失败、停止与 `finally` 都会释放计时器与在途状态，迟到事件不再影响同一 SDK 会话上的下一请求。到期后不对工具做 `Promise.race`：`run_command` 通过既有中止信号结束子进程；不响应中止的其他工具只能等待其自然结束（期间不会再发起新的模型或工具操作），这一清理限制如实保留，本批不新增后台任务或进程生命周期管理。例如 `app_read connection_read` 内部 12s 读取不受中止影响：工具兜底到期后本轮按工具超时结束，但请求要等该读取实际返回后才进入终态；受控 HTTP 用本地延迟 REST 端点验证这一行为。

复验（端口：HTTP 47561/47562，源码浏览器 47565/47566，真实模型 47563；缩放时钟已在脚本中标注）：

```sh
node scripts/chat-progress-budget-http-e2e.mjs
PROGRESS_API_PORT=47565 PROGRESS_MODEL_PORT=47566 node --import tsx scripts/chat-progress-budget-fixture.mjs   # 浏览器用
ego-browser nodejs < scripts/chat-progress-budget-browser-e2e.mjs
node scripts/chat-progress-budget-real-e2e.mjs
node scripts/chat-phase-installed-e2e.mjs   # 仅本机安装后：私有网关、独立 QA 侧会话、合成标记
```

本机验收：类型检查与 V6 构建通过；受控 HTTP 73/73、浏览器 11/11 与长流补验 3/3。真实日常模型隔离合成流程 6/6，回答耗时 184.519s：四个 35s 标记步骤均只执行一次，读回首次失败、随后读回成功，没有重跑步骤。时间预算、技能、排队与追加回归分别 117/117、77/77、29/29、20/20。HTTP 验收使用缩放时钟及真实 API、SQLite、SDK 与本机命令，不冒充生产默认秒数的逐项壁钟验证。

Developer ID 签名构建 `1794555685314` 已经本地更新器安装到 `/Applications/CyberMe.app`。安装文件与签名候选 31559 项一致，仅替换四个后端运行文件（其中一个新增），保留原有原生程序、前端及发送后技能胶囊 UI。29 项安装/原失败记录检查、10 项数据保留检查通过：175 个对话、1219 条消息、367 条记忆、80 个任务、5 条自动记忆，以及设置、主对话绑定、当前对话与草稿均保留；原超时请求及六条原操作记录未改写或重放。

安装版通过私有网关、原保存模型与独立 QA 侧对话完成 9/9 真实验收：三段各 45s 的合成命令均只执行一次，读回确认 3 次开始与 3 次结束；回答耗时 159.639s，`watchdog:'phase'`、`endedBy:'completed'`，5 次提供方请求、无工具错误。正式 WebKit 显示完成回复，随后恢复原主对话。完整边界、重复验收入口与产品截图见本机私有 `output/chat-phase-watchdog-20261113/REPORT.md`。未提交、推送、新公证或公开发布，真实业务未重跑。

覆盖边界：流式推理增量依赖提供方以 `reasoning_content` 返回并由 SDK 映射为 `thinking_delta`；无自带时限工具的兜底由生产 `connection_read` 加本地延迟端点（兜底缩放到 500ms）覆盖；同一步骤重复重试事件的去重没有可注入的端到端场景，仅由代码保证。对不响应中止的工具，仍须等其自然结束才能落终态；本批没有新增后台任务或超时后的自动续跑。

## 2026-11-14 洞察结构化纠正门控（未验收）

`ideas_refresh` 的 JSON 纠正轮仍共用首轮回答计时，不重新计时；只在证据/结构校验失败时进行一次，且剩余回答时间 ≥ 40 秒、输出余量 ≥ 2000 Token，纠正轮不强制工具。思考耗尽、截断、空正文、断流、5xx、超时先分类，不进入纠正。详见 [洞察后台可靠性](insight-reliability.md)。
