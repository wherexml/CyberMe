# V6 数据与草稿契约

模型设置和连接测试沿用现有路由。空配置、两个兼容角色的保存边界、供应商字段和本机测试回执见 [V6 模型设置](v6-model-settings.md)。

灵感 `contentCategory` 为 AI 生成的展示元数据（version、label、标题/正文 inputHash、generatedAt、runId）。GET 投影只返回版本有效且与当前正文指纹匹配的分类。分类不替代内部 category/action，不更新来源/建议时间、不触发业务动作；见 [灵感内容分类](idea-content-categories.md)。

## 记忆资料库只读人物投影

`GET /api/memory-library/people` 返回 `owner`（姓名、别名、角色、已有简介）、`incomplete` 与 `people`。人物项保留原档 `id/name/aliases/role/relationship/reviewedAt/markdown/truncated`，以及既有 `person_tracking` 的 `observations`（原事件时间、分类、摘要、原来源 ID、消息 ID、引用和发言方向）。不返回目录绝对路径，不执行分析或修改 Wiki；读取范围沿用已配置且符合人员模板的目录与既有截断上限。

客户端四项资源独立加载，分类入口立即可用。人物读取失败时停止展示旧档案详情，明确提示重试；成功刷新后不存在的档案显示不可用。重试与冲突重新载入只读取相关资源。人物档案日期、跟踪事件时间与界面读取时间不混用。个人文档、自动记忆、原档与跟踪记录分别读取，不因新的资料夹布局改变存储归属。

本页对应 `server/src/{drafts,chat-work,native-api,agent-capabilities,index}.ts`、`shared/v6-visuals.ts` 与 `web/src/v6/`。界面入口见 [V6 规格](cyberme-v6.md)。

## 草稿语气

`POST /api/inbox/:id/draft` 接受可选 `tone`，仅允许 `brief`、`warm`；缺省或 null 保持无指定语气，空字符串和其他值返回 400 `invalid_tone`。Agent 动作目录同步允许该参数。

语气与事项、模式、会话、基线版本及重试来源共同构成请求指纹。相同 requestId 更换语气返回 409 `request_conflict`；同参数成功回查复用原结果，不能重复调用模型。旧无语气账本继续无语气回放，历史默认模式兼容保留。

语气进入实际起草提示词，随草稿请求保存；直接采用结果保存 `draftTone`，人工稿竞争时只保存带语气的候选。应用候选从候选或原请求恢复语气。`GET /api/inbox/:id/draft-requests/:requestId` 仅在原请求确有语气时返回 `tone`，同时校验精确事项归属。

语气不绕过无需回复、来源变化、连接权限、敏感审批及外发门禁。生成草稿与批准、发送、外部回执是独立阶段。

## 展示数据与权威状态

Chat 面板、工作记录的 `v6` 只接受对象形态透传并沿既有公开值脱敏。服务端这一步不是完整视觉 schema 校验；客户端通过 `readVisual`、`readSteps`、`readMeters` 校验变体、嵌套字段、有限数字及范围，无效数据不绘制。

缺少持久视觉字段时，`derive.ts` 只用记录及精确关联已有数据推导，不编造数据。可视化、推荐项、步骤展示与动画都不构成执行授权或完成证明。待确认步骤显示对勾属于既定视觉规则，业务状态仍是待确认。

## 请求与恢复

### 聊天轮次顺序（2026-11-08）

实现前失败面：V6 先渲染历史、再追加本机未成功请求，导致三天前的失败气泡和报错出现在新回复之后；按精确 requestId 才查重还会漏掉仅有 runId 的历史。同毫秒请求、历史分页、刷新、重试状态变化、同文不同请求和会话切换也必须保持原轮次，不自动重发。

聊天历史和本机回执须在生成日期分隔符之前统一排序；有关联回执的轮次锚定原始 createdAt，同毫秒回执保留耐久数组顺序。只按精确 requestId / runId 关联，不按正文去重。失败、部分完成和未知结果留在原轮，成功回执不额外生成用户气泡；缺少 conversationId 的旧回执仅属于主会话。展示排序不修改业务记录或重试权限。

摘要在 V6 的显示位置以有效行中最新的 `occurredAt` 为准；全部缺失时回退到原 `createdAt`。排序不改变持久时间、服务端分页或投递预算。`GET /api/chat/requests/:id` 对失败与部分完成均可返回脱敏的 `failureCode`；旧的部分完成记录只读补齐显示原因，原状态和重试权限不变。

复验：`npx vite build --config web/mygo.vite.config.ts --outDir ../.local/chat-order-v6-web`；`node --import tsx scripts/chat-order-v6-fixture.mjs` 启动 46818 隔离合成数据；`ego-browser nodejs < scripts/chat-order-v6-browser-e2e.mjs`。停止并重启同一 fixture 后，将浏览器脚本的 `phase='initial'` 改为 `phase='restart'` 再运行。首轮 12 项、重启后 9 项通过，含新发送、分页、刷新、同毫秒轮次与无回执历史混排、精确关联及会话隔离；修改前原排序检查失败。类型检查与 V6 构建通过，截图、DOM 和 JSON 位于忽略目录 `output/chat-order-v6-20261108/`。使用受控 HTTP 回复，没有真实模型、生产重发、安装包替换或原生 WebKit 验收。

V6 在提交前保存请求 ID、语气与关联；聊天、提案和任务详情共用原对象及忙碌锁。未知结果先按原 ID 只读回查，partial 不自动重放；选择工作方向需 revision 与 operationId。文档按 version 保存，409 保留输入。

右侧内容点选后以 `contextIds` 关联当前轮次，服务端精确加载并作为“这个”等指代的优先对象，不再混入最近六条其他灵感提醒。缺失记录仍报错，不换成其他提醒；选定资料和引用中的文字不构成执行授权。无选定资料的主会话继续使用复核后的提醒上下文。验证入口：`scripts/selected-context-http-e2e.mjs`（`--real` 使用安装版模型配置与合成隔离数据），浏览器与安装版结果单独记录。

## 能力边界

- 技能列表为只读登记，不能安装、创建、删除或启停技能。
- 邮件提案外观不扩大现有发送范围；普通联系人邮件与微信外发未在本轮实现。
- 普通“跟进”仍是带日期待办。只有用户明确交办并绑定来源/人物/判据的[持续跟进](follow-up.md)才有只读到期检查与应用内提醒；不外发、不发原生通知。
- 经典版入口已退役：正式应用旧 `desktop.html` 仅回到 V6；详情保持 V6 内部导航。灵感共用原始数据，历史视图和部分高级配置未完全迁入，不能把入口退役声明为功能全量迁移。
- fixture 数据只是隔离验收输入，不能当作真实模型或外部业务成功。

## 验证

本轮以既有隔离 HTTP E2E 验证语气拒绝、提示词传递、同键重放、更换语气冲突及候选采用。模型为本机受控响应；结果不证明真实模型文风质量。构建、浏览器与远端源码校验记录见 [本轮提交说明](changes/2026-11-05-v6.md)。

## 2026-11-05 决定卡与起草修正

- 决定卡优先保留明确的 `v6.context`，否则按 `triage.requestMessageId` 精确显示未删除、未撤回的来源消息。没有消息列表的事项可显示摘要或正文；聊天缺少匹配请求时留空，不用最新闲聊或分类码补位。
- `triage.reason` 是内部分类，`priorityReason` 是优先级判断规则，均不作为事项摘要或历史参考。历史参考仅来自明确记录的 `v6.precedent`。
- 默认动作统一为“起草回复，等我确认”，适用于聊天与邮件。旧动作“起草一封回复，等我确认”和英文动作仍可保存草稿。
- 起草意图仅允许 Inbox 草稿字段写入；更新已有事项只接受 `draft` 与版本，创建草稿可附本地标题、正文、发送方及 Internal 渠道。不会扩大成批准、发送或修改其他资源的授权。
- 失败回查区分模型组件缺失、模型响应超时和额度耗尽；只向界面返回分类码，不返回私有路径或供应商原始错误。

验证入口：`scripts/brief-reply-http-e2e.mjs` 与 `scripts/brief-reply-browser-e2e.mjs`。隔离 HTTP 35 项及浏览器 10 项通过，包含真实工具调度/HTTP 保存/回放/刷新恢复；模型响应为受控公开 fixture。类型检查与 V6 构建通过。未重发生产请求、未外发、未替换安装包；不代表真实模型稳定性或安装版验收。

既有 `agent-operations-e2e.mjs` 在旧消息分页检查失败（0/63）；用修改前的权限与状态源码在独立副本运行，同样失败。本轮专用起草/权限验收通过，不能将既有回归套件记为全通过。

## 连续发送（2026-11-05）

2026-11-11 替代旧的默认打断行为：V6 新消息使用独立 requestId 与 `queueCurrent:true`，服务端先持久登记 queued 并返回 HTTP 202，再按同会话 FIFO 执行。后续消息不停止前一轮或已开始的文档任务；不同会话独立。出队时重新读取历史与范围，后续轮次能读取上一条回答，不能提前读取未来排队消息。原 `interruptCurrent:true` 只保留显式兼容路径，不能与 queueCurrent 同时启用。旧回执沿用其原请求参数以保持幂等指纹兼容。本地回执增加 queued 状态和 queueCurrent 参数；202 表示已登记，不能当作 succeeded。排队不占模型超时，暂时回查失败继续按原 ID 读取，持续已登记的队列不受旧 180 秒恢复总时长限制。进程重启时 queued/running 转为可回查的失败或 partial，不自动重放；未开始请求可由用户显式重试并加入队尾。客户端等待超时只中止传输并按原 ID 回查，不代表服务端操作已取消；不会自动重发 POST。可见期间每 15 秒及重新激活窗口时继续回查未知/未完成回执，同一请求不并发启动恢复循环，发送中的请求使用自身轮询。

超时退出补充：Agent 为整轮建立独立取消信号，合并到实际模型 HTTP fetch（包括流式响应体），超时、新消息打断和显式停止都撤销该信号；工具注册前加停止检查，禁止迟到模型片段启动新的业务工具。不会仅用 Promise.race 提前宣告结束而让旧工具继续运行。`scripts/chat-stream-abort-http-e2e.mjs` 使用真实 HTTP/Anthropic SSE 故意不结束响应，验证连接关闭、原请求终态与后续请求；真实供应商现场卡住的全部成因仍须与受控复现区分。

## 意图处理字段（2026-11-05）

`attention`、`lastOpenRequest` 是服务端只读投射，不落库；`attentionDismissal`、`attentionDismissalUndone` 是服务端管理的持久字段。客户端写入以上字段返回 403 `server_managed_field`。判断记录新增可选 `attempt`、`nextRetryAt`、`priorOpenRequest`，旧记录无需迁移，也不改变判断版本。语义见[意图处理与用户注意力](intent-handling.md)。

## 2026-11-07 推荐动作与上下文

`Idea.recommendation` 为可选展示元数据：`label`（非空单行，≤40字符）、`prompt`（非空，≤2000字符）、服务端生成的可选 `inputHash`（标题/正文指纹）。拒绝泛化的“创建任务/处理这件事”。共享读取器仅返回文本，不接受可执行动作类型。带指纹的推荐在正文改变后不再投影，元数据补齐可重新生成。生成失败保留原记录及兜底入口。

按钮选择以当前对话 `DraftPick(k=ctx,id=idea.id)`、完整引用和自动输入片段一起保存。发送时 `contextIds` 包含灵感及精确 `sourceIds`，服务端沿现有授权读取路径加载正文、证据、时间和来源。缺失来源仍报错，不能替换成最近提醒；“完整”指已授权本机记录内容，尚未下载的附件和来源本身的采集截断仍遵循既有边界。引用/资料不构成执行授权，发送的用户请求才进入正常聊天权限判断。旧 `k=idea` 草稿也不再直接调用 execute。


## 2026-11-08 洞察摘要绑定

`inboxAnalysis.digest.entries` 的 `kind=idea` 行使用精确 `entityId` 与来源 `revision`（可带已有 `:wake:` 后缀）。显示、待发及追问均重新核对当前洞察与来源版本；来源变化或单项静默后旧行撤回。信息和委派仍是只读资料，不因投递获得任务或执行权限；不进入会话记忆。现有消息结构、草稿和通知范围保持兼容。

## 2026-11-08 自动记忆状态

自动记忆列表增加 enabled / initialized / jobs，沿用 items 兼容旧客户端；初始化只处理已有成功且可写的直接用户 Chat，手写文档保持 version 契约。initialized 表示扫描排队完成，queued/running/failed/stale 仍按真实任务展示。V6 “自动记住”可对失败任务发起原会话 context/retry，不创建新请求；总览不再重复展示原始笔记和 Agent 设置入口。未归类手写内容保留主题入口。详见 [记忆资料库](memory-library.md)。

`conversation.memoryProjectId` 为旧版只读来源字段，`PATCH` 仍不可修改（409 `memory_scope_immutable`），但不再影响召回、提取、忘记或模型查询。`POST /api/chat/memory-scope` 已退役：`projectId:null` 返回主会话，其他值返回 410 `memory_scope_retired`，不创建或删除任何记录。`POST /api/chat` 接受并忽略 `memoryProjectId`（请求指纹仍包含客户端传入的值，旧请求重放保持一致），不再返回 `memory_scope_mismatch`、`memory_project_unavailable` 或 `memory_scope_conflict`；旧 `scope_*` 失败回执保留且可重试。自动记忆项保留原始 `memoryProjectId`，`scope` 恒为 `{kind:'global'}`。详见 [全局个人记忆](global-memory.md)。

人物档案可选的 `chatStatus` 包含自动记忆 ID、`active` 或 `left`、聊天原句和 `reportedAt`。它来自成功主聊天中的明确状态陈述，保留独立原档，不改变 `reviewedAt`。档案不存在、姓名有歧义、来源失效、被忘记或出现更新的原档状态时不返回该投影。`POST /api/chat`（含重放）与成功的 `GET /api/chat/requests/:id` 在该请求确有生效的全局人物状态时返回 `memoryChanged:["people","automatic"]`，该字段由持久记录读回，只表示需要重读，不是状态本身；V6 收到后中止在途读取并重读这两项，不重发聊天。


## 2026-11-11 持续 Agent 追加输入

queueCurrent 的普通 FIFO 行为保留；直接输入以明确补充/更正标记开头时，在当前工具批次结束后读入原工作。可选 appendDelivery=steer|followUp 用于显式兼容调用，不能与 interruptCurrent 同启。回查可选增加 delivery/claimedAt/consumedAt/parentRunId；每条请求仍有自己的 runId、结果及工具证据。一个回复可通过 requestIds 关联多条输入，并保留主归属 requestId，聊天按精确 ID 展示全部可读回复和成果附件。queued/consumed 不等于 succeeded；真实工具结果继续决定业务 taskOutcome。详见 [持续 Agent 消息追加](chat-input-append.md)。

## 2026-11-12 类型化动作回执（本机 UI 状态 `actions`）

- 键：`<entityKind>:<entityId>:<type>`。值只含 `operationId`、`type`、`binding`（entityKind/entityId/requestMessageId/requestRevision/provenanceKey）、不可变输入 `extra.until`、`at`、`phase`（`pending`/`not_saved`/`unknown`/`missing`/`succeeded`/`failed`/`refused`），以及最小结果引用（`taskId`/`dismissalId`）和错误码。不存来源正文或草稿。
- 未决（`pending`/`not_saved`/`unknown`/`missing`）永不过期、不截断；只清理 30 天前的终态回执。未决数达到 100 时拒绝新操作并提示先核对。迁移保留所有其他字段与草稿。
- 服务端 `/api/attention/actions` 的语义、指纹去重与重启转 `unknown` 均不变。见 [意图处理](intent-handling.md#2026-11-12-类型化动作的可靠恢复洞察卡消息动作详情)。

## 2026-11-13 输入框技能选择草稿字段

- `DraftState` 增加可选 `skill:{id,name}|null`，随对话草稿（`drafts[conversationId|_new]`）保存。读取时校验 `id` 为非空字符串、`name` 符合 `^[A-Za-z0-9][\w.-]{0,79}$`，否则置为 `null`；旧草稿无此字段时视为 `null`，`text/quote/refs/pick/auto` 保持原样。切换对话与刷新恢复各自选择。
- 发送消息体：`/skill:<name>[ <任务>]`，引用（`> `）在其后以空行分隔；无所选技能时消息体格式不变。`contextIds`、附件、`queueCurrent` 与回执流程不变；服务端沿现有原始输入解析调用，不新增接口或字段。
- 清除条件：仅在请求回执已在本机持久保存（`startChat` 成功，早于 POST 应答）后，且当前所有者与完整快照（文字、引用、资料关联、pick、自动片段、所选技能、附件 ID）均与发送时一致时清空输入框；已保存的同一所有者草稿也只在 `text/quote/refs/pick/auto/skill` 全部一致时重置。技能核对或本机保存期间新增的引用、关联、附件、编辑或改选，以及其他对话的草稿均保留；回执之后的新输入不继承已发送的技能。不扩大任何业务授权。
- 发送前以 `GET /api/skills` 核对 `id+name`；不一致或读取失败时不发送、不建立回执。


输入框本机验收（2026-11-13）：浏览器 87/87、签名安装与原生桥草稿保存、安装后保留 10/10 通过；可选 `skill:null` 与缺省视为等价，原有草稿字段完整比较。系统中文候选确认未完整实测；隔离模型和安装版读取/编辑分别记录，见 [本机技能实际验收](local-skills.md#输入框实际验收2026-11-13)。
