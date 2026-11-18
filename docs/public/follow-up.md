# 持续跟进（第 1–3 阶段）

状态：**已实现并通过本机分层验收**（2026-11-07）：HTTP 198/198、生产适配器合成上游 40/40、真实模型合成材料 7/7、浏览器 13/13、既有洞察流程 14/14、单会话回归 55/55；另验证真实 MyGO WebKit 签名隔离候选包。初轮未替换日常安装版；后续已授权安装并验收（见文末）。真实账号长期跟进未验收，未提交或发布。失败面先于实现记录，红基线为 1 过 / 13 失败 / 1 未运行；实现位于 `server/src/follow-up.ts`。

相关契约：[持续单一 Agent 会话](agent-session.md)、[明确交办的通用执行](agent-execution.md)、[V6 数据与草稿契约](v6-data-contract.md)、[V6 桌面界面](cyberme-v6.md)、[连接新鲜度](connection-freshness.md)、[注意力投递](attention-delivery.md)、[灵感主对话提醒](ideas-chat.md)、[记忆资料库](memory-library.md)。

## 范围

用户在普通聊天中明确要求 CyberMe 跟进**一件具体的事**：绑定来源、结果判据和检查时间。跟进作为已有任务上的可选类型化对象 `followUp` 持久保存，属于发起它的会话，重启后保留；到点即检查（即使来源没有新内容），只在需要时请人判断，只有在满足证据或明确取消时才结束。一个会话可以同时有多件事；换话题、停止正在生成的回答都不能取消其他跟进。普通任务与“只产出文件即完成”的现有行为不变。来源材料、引用内容和提示注入都不构成授权。

第一版（MVP）：后台**只读**检查 + 本地记账 + 应用内提醒。

不做：无人值守外发、任意命令、macOS 原生跟进通知、第 4 阶段跨任务学习、目标子系统、通用工作流引擎、多 Agent 架构、新导航/页面/向导。普通的用户发送仍走现有草稿→批准→发送流程，不扩大现有策略；自动记忆保持不变。

## 实现前失败面（2026-11-07，合成示例）

1. 没有跟进对象：用户说“帮我盯一下 Alice 对报价的回复，周五上午看一次”，现有 Agent 只能 `create_task` 一个带日期的待办；[V6 数据契约](v6-data-contract.md)明确“跟进创建的是带日期待办，不能承诺未回复自动提醒”。没有到点检查，也没有完成判据。
2. 通用 CRUD 可以写入任意字段：`POST/PATCH /api/tasks` 的 `validate` 只保护 inbox 的服务端字段；任务上的 `followUp`、`followUpState`、证据或授权字段可被伪造，`app_action entity_create/entity_update` 同样可以写。
3. 以“完成生成/产出文件”推断完成：`chat-work.ts`、`chat-native.ts` 中的产物完成规则适用于产物型目标；跟进若沿用该规则，会把“写好了提醒文字”当作“对方已回复”。
4. 同群较晚时间不等于回复：群聊中其他人稍后发言，或同一人谈别的事，被当成对指定请求的回答。
5. 覆盖不完整被说成“没有回复”：连接断开、同步失败、分页未读完或缓存过期时，没有新消息被解释成否定结论。
6. 无新事件就不检查：只靠来源变化唤醒，来源无变化时到点检查从不发生；或者 N 次无变化后静默归档/放弃（类似 14 天清理）。
7. 主观判断被模型 OK 直接关闭：“对方是否同意方案”由一句模型“OK”判完成，没有人工确认。
8. 授权来自引用：用户引用别人说的“帮我跟进一下”或来源正文中的“请 CyberMe 每天提醒”，被当成用户的交办；否定句（“不用跟进了”/“别帮我盯”）也被识别为创建。
9. 取消、忘记、删除或撤销连接时检查正在进行，晚到的结果仍被采用并完成或提醒。
10. 重启/强杀：检查进行中被 SIGTERM/SIGKILL，重启后重复提醒、重复副作用，或丢失尝试历史；睡眠/离线后补跑所有错过的检查（积压）。
11. 派生提醒进入记忆：后台提醒文本进入自动记忆、会话摘要，或在下一轮被模型当作用户的新授权。
12. 后台检查复用人类聊天的 SDK 会话，污染会话历史或继承写工具。
13. 门控只登记不运行，或者“已登记”被展示为“正在运行/已验证”。
14. 浏览器：提醒刷新覆盖用户正在写的草稿；旧提醒上的按钮在新版本后仍可操作；两件事的按钮串到同一任务。

## 第二轮失败面（2026-11-07 本机验收与代码复核，修复前记录）

本机 HTTP E2E 154 过 / 3 失败 / 1 未运行（真实模型）。失败与复核发现：

15. 测试把标签放在 `> ` 前，引用被标签遮住，“引用授权”被误放行；且授权只剥离 `>` 与 `<quoted_context>`，代码块、成对中英文引号、翻译/总结包装未剥离；“看看/确认”单独即可通过创建意图；取消/确认/推迟/继续接受任何泛化跟进语句。
16. 响应丢失回放用例在两次请求间重新计算 `until`；创建时缺省 `checkAt` 在指纹前生成，同一请求重试指纹不同。回执回放返回当前视图而非原结果。
17. 生产飞书事项的 `sentAt` 是原始 `create_time`（毫秒字符串），回复关系字段是 `replyToId`：真实形状的飞书事项创建失败（`request_time_unknown`），群聊回复关系丢失。
18. 新的飞书/微信回复只来自实时读取、不在收件箱缓存中；复核用缓存判定“消息不存在”，把缓存缺失、分页受限、断开当作撤回。另有 30 天复核截止。
19. 慢模型返回后只核对连接，不核对候选的发送者、时间、回复关系与正文；确认在 await 之后未重新核对授权、目标、连接租约；删除后恢复任务会以原版本复活在途结果；忘记授权只在到期时生效，推迟中的事项不会停止。
20. 飞书连接版本只哈希 `id+selfId`，不随读取范围、过滤器或账号变化；飞书读取未应用连接过滤器、未补读缺失时间；微信读取绕过会话校验与 await 前后租约，未逐行核对 `conversationId`。
21. 另一 API 进程共用数据库时，`recoverInterrupted` 会把仍在运行的他方检查标记为中断；没有跨进程独占。轮询 `while(ticking)` 积压；`withLock` 清理条件永不成立；未捕获失败不重排；租约 120 s 短于读取+模型的最长耗时。
22. 请求锚点可以是对方消息；“任意回复”客观判据无需用户明确说明；VirtualIM 消息事件唤醒所有绑定该连接的事项。
23. 共享类型缺 `Task.followUp`、提醒字段和消息分页 `followUpReminderIds` 契约。

## 第三轮失败面（2026-11-07 本机第二轮验收，修复前记录）

主 HTTP 186 过 / 1 失败 / 1 未运行；适配器 23 过 / 7 失败。

24. 适配器 E2E 的合成飞书 CLI 返回的账号名与生产 `requireSelf` 固定校验的账号不一致，所有飞书实时读取为 `wrong_identity`。属于测试夹具错误：只改夹具（与既有 `feishu-context-http-e2e.mjs` 一致），不放宽生产身份校验。
25. 来源在模型等待期间断开：重新读取正确降级为未知，但检查记录仍写 `adopted:true`，与“未采用”语义不符（业务状态未变化，无误完成）。
26. 动作授权未检查否定：“不要确认完成”“不要取消跟进”匹配动作意图，可授权被禁止的操作。
27. 请求锚点在完整覆盖下被删除时，读取返回 unknown 但仍带出后续消息，客观判据可据此完成；锚点身份不含正文，编辑原请求不会失效。
28. 复核没有并发上限，来源事件在读取期间到达会重复启动同一事项的复核。

## 数据契约

`Task.followUp`（可选，服务端管理；通用 CRUD 与 `app_action` 写入返回 403 `server_managed_field`，包括 `followUp`、`followUpChecks`、`followUpReminder` 及其中任一子字段）：

| 字段 | 含义 |
| --- | --- |
| `id` | 跟进 ID，创建后不变 |
| `revision` | **业务版本**，仅在用户/权威事件（创建、取消、推迟、确认、继续、证据失效）改变义务时递增；检查与尝试不改变它 |
| `state` | `waiting` · `checking` · `needs_judgment` · `completed` · `cancelled` |
| `conversationId` | 所属会话（主会话或侧会话）；提醒只投到这里 |
| `authority` | `{messageId, requestId, runId, evidence, operationId}`：授权的用户消息（逐字片段必须出现在该用户消息中且不在引用块/否定语境内） |
| `predicate` | `{kind:'reply_from_person', objective:true}` 或 `{kind:'judgment', objective:false, criterion}`；自然语言推断安全形式，不强制问卷 |
| `binding` | `{connectionId, connectionVersion, sourceId, itemId, threadKey, personId, personName, requestMessageId, requestSentAt}`：精确连接、线程、人物与请求锚点及原事件时间 |
| `schedule` | `{checkAt, cadenceMinutes, snoozedUntil?, nextCheckAt, missedCatchUp:'once'}` |
| `evidence` | `{messageId, sentAt, senderId, replyTo?, sourceVersion, verifiedAt, status:'valid'|'invalid', invalidReason?}`；完成后失效仅标记，不抹除历史 |
| `outcome` | `{at, by:'objective'|'user', operationId, revision}` |

调度运行态 `follow_up_runtime`（`nextCheckAt`、`wakeAt`、连续失败/未变化/未知计数、最近结果）与操作回执 `follow_up_operations`（operationId、指纹、committed/rejected、结果）为私有表；检查不改写任务，因此不抬高任务 `updatedAt`、不与用户编辑冲突。

检查记录 `follow_up_checks`（独立表，服务端写入）：`{id, followUpId, taskId, revisionAtStart, attempt, state:'intent'|'claimed'|'evaluated'|'abandoned_interrupted', leaseUntil, coverage:'complete'|'partial'|'unknown', result:'satisfied'|'candidate'|'not_yet'|'unknown'|'failed', reason, startedAt, finishedAt}`。检查 ID 与业务版本分离；一次检查只能在其 `revisionAtStart` 仍为当前版本、跟进仍处于活动状态且授权仍有效时被采用。

提醒：每个任务在所属会话中只有一条当前派生提醒消息（`derivedKind:'follow-up-v1'`，字段 `taskId`、`followUpId`、`followUpRevision`、`checkId`，撤回时写 `withdrawnAt`）；新版本更新或撤回旧提醒，重启后不重复。派生提醒不进入自动记忆、会话摘要、`contextHistory`，也不能作为授权（与 `ideas-chat` 派生提醒同一排除机制）。

## 接口

| 接口 | 语义 |
| --- | --- |
| Agent 工具 `follow_up_create` | 普通（非 readOnly）主/侧聊天中可用；参数含 `operationId`、`evidence`（当前用户消息逐字片段）、`taskId?`/`title`、`itemId`（选定来源或精确解析结果）、`requestMessageId?`、`personId?`、`predicate`、`checkAt`、`cadenceMinutes?`。目标不唯一时返回 `ambiguous_target` 并让模型澄清，不任选 |
| `GET /api/follow-ups?conversationId=` | 列出某会话的跟进（只读投影） |
| `GET /api/follow-ups/status` | `{worker:{gate:'CYBERME_FOLLOWUP_WORKER', enabled, running, lastTickAt, lastError}, counts}`；登记≠运行≠已验证，分别报告 |
| `GET /api/tasks/:id/follow-up` | 当前状态、版本、绑定、证据、最近检查、当前提醒 |
| `POST /api/tasks/:id/follow-up` | 直接 HTTP 创建：必须给出 `conversationId`、`authority.messageId`（该会话中真实用户消息）、逐字 `evidence`、`operationId`；同 ID 同参数返回原结果，不同参数 409 `request_conflict` |
| `POST /api/tasks/:id/follow-up/cancel` | `{operationId, revision}` |
| `POST /api/tasks/:id/follow-up/snooze` | `{operationId, revision, until}` |
| `POST /api/tasks/:id/follow-up/decide` | `{operationId, revision, checkId, decision:'confirm'|'continue'}`；确认前重新核验候选证据 |
| `GET /api/tasks/:id/follow-up/operations/:operationId` | 响应丢失后按原 ID 回查 |
| `POST /api/follow-ups/tick` | 仅门控开启时执行一次到期检查（有界等待，未完成的检查保持认领）；门控关闭返回 409 `follow_up_worker_disabled`；不在桌面代理允许列表中 |
| Agent 工具 `follow_up_list` / `follow_up_action` | 列出本会话跟进；按 taskId + revision + 逐字 evidence 取消/推迟/确认/继续，走与界面相同的操作路由 |

版本不符返回 409 `revision_conflict`（附当前对象）；已终止返回 409 `follow_up_closed`；候选变化 409 `candidate_changed`；确认前核验失败 409 `evidence_changed` / `evidence_unverifiable`。活动跟进的任务不能经通用 PATCH 改状态（409 `follow_up_active`）。直接 HTTP 创建只接受该会话**最新一条**真实用户消息（403 `authority_not_current`），已提交的同一 operationId 之后仍可回放。`/api/tasks/:id/follow-up...` 已由两处代理的 `tasks` 命名空间覆盖；`GET /api/follow-ups` 与 `/status` 已加入 `native/mygo/proxy.go` 与 `scripts/mygo-workspace-gateway.mjs`。聊天侧创建与动作遵循现有 `autonomy.permissions.tasks=read`（仅查看）策略；用户在界面上的直接点击是本人操作。

## 语义规则

- **授权**：只有当前用户消息的逐字片段可以授权；引用块（`>`、引号转述）、否定（“不用/别/不要 跟进”）、来源正文、派生提醒、旧上下文都不授权。readOnly 轮次不提供 `follow_up_create`，强制调用也被拒绝。
- **绑定**：精确连接 + 线程 + 人物 + 请求锚点 + 原事件时间。群聊中，其他人稍后发言或同一人不相关发言都不是证据；客观判据为“锚点之后，同一线程内由该人物发出的回复（有 `replyTo` 时须指向锚点）”。适配器缺少逐人 ID 时只能绑定单人线程，群聊需等待适配器携带上游 `senderId`/`replyTo`（属生产适配器改动，不得只在 fixture 中设置）。
- **新鲜度与覆盖**：只使用现有生产同步字段（VirtualIM `virtualImSync.status/lastSyncedAt/cursor`、连接 `status/permissions/config.instanceId`；飞书/微信同理用 `scanComplete`、`windowLimited`、`coverageComplete`、partial/gap）。检查前可调用该连接已有的只读同步；断开、同步失败、分页未完成、缓存早于到期时间 → `coverage:'unknown'`，结果 `unknown`，不得写“未回复”。新鲜的正向证据可以采用，但不声称完整的否定覆盖。日志与证据不含原始凭证、查询或正文。
- **客观 vs 主观**：客观判据经确定性校验即可完成，无需再确认；主观判据（是否同意、内容是否合格）最多到 `needs_judgment`（候选），模型的“OK/完成”不能直接完成。
- **调度**：API 存活时到点检查，与来源是否变化无关；睡眠/离线后只补跑**一次**，不积压。来源变化可在有界去抖/冷却内唤醒相关等待中的跟进。有界节奏/退避/失败预算；重复的不变结果不刷屏、不重复提醒；不因 N 次无变化或 14 天而静默归档。
- **检查执行**：推理/读取前先持久化检查意图；独占认领 + 租约 + 尝试上限。被中断的检查可只读重评，不产生新业务版本，保留旧尝试历史。最终记账和提醒发布幂等；之前的写入绑定原 operationId，未知结果不重放。后台调用不复用人类聊天 SDK 会话，只获得有界的已授权来源、无写工具、不注入用户角色消息。
- **失效**：来源编辑/删除/撤回、连接撤销在采用前重新核验。已完成的证据后来失效 → 保留历史完成、标记证据 `invalid` 供复核，不静默抹除、不重复副作用。取消/删除任务/忘记授权消息 → 后续检查停止；旧上下文不能复活被忘记的授权。取消/确认/推迟使用 operationId + 业务版本并重新核验候选证据。
- **验收节拍**：`CYBERME_FOLLOWUP_TICK_MS`（仅隔离验收，下限 200 ms，默认按分钟级节奏）只改变轮询间隔，不改变判据、预算或补跑规则。
- **适配器（真实读取）**：VirtualIM 为单一有序日志，检查时执行既有只读同步，且同步在本次检查开始后对绑定实例成功结束（`virtualImSync.status/instanceId/lastSyncedAt`）才算完整覆盖；上游以同一消息 ID 的后续条目表达编辑/撤回，适配器更新原记录（撤回不进入事项消息），并携带上游 `senderId`/`replyTo`。飞书对绑定会话做实时读取（`readFeishuThread`：从请求锚点起，最多 5 页，非 open_id 发送者、缺精确时间、截断、分页上限即 partial；读取范围被撤销即失败），整体同步成功或缓存 `syncedAt` 不作为单会话证明。微信按绑定会话读取一页 100 条（`wechatFollowUpRead`：账号哈希须与绑定一致，`coverageComplete`、无警告、账号持有人已知且该页回溯到锚点才算完整）。
- **隔离时钟**：仅当 `CYBERME_FOLLOWUP_ISOLATED_CLOCK=1`（桌面运行时会过滤所有继承的 `CYBERME_FOLLOWUP_*` 变量）时，worker 读取 `<data>/follow-up-clock.json` 的 `offsetMs`；用于确定性验收，不改变业务节奏与补跑规则。
- **门控**：专用 `CYBERME_FOLLOWUP_WORKER=1`，独立于全局 `OPSTWIN_NO_BACKGROUND` 及其他后台开关；桌面运行时（`native/mygo/runtime.go`）为本功能显式开启；通用服务端默认关闭。不全局开启自动化/派发。
- **界面**：任务详情与普通聊天中，以简洁、带无障碍标签的控件查看/取消/推迟/确认/继续；可经现有输入框交接，但必须携带精确 task/revision 上下文并到达真实实现的动作，不能“只填文字假装完成”。用户决定后同一事项继续。保留用户草稿和当前洞察 UI（2026-11-07 两按钮洞察 → 完整上下文输入框 → 普通发送）。

## 验收矩阵与边界

验证分层，互不替代：

1. **受控模型 HTTP/SQLite**：`node --import tsx scripts/follow-up-http-e2e.mjs`。真实 API 子进程 + 隔离 SQLite + 受控 OpenAI 兼容提供方（46932）+ 合成 VirtualIM 上游（46933，经生产 VirtualIM 适配器读取）；API 46931。结果写 `output/follow-up-http-<时间>/result.json`。
2. **真实已配置模型 + 合成材料**：`node --import tsx scripts/follow-up-http-e2e.mjs --real`（仅本机读取已安装配置；仍用合成上游与隔离库；不外发）。
3. **浏览器生产 UI**：`node --import tsx scripts/follow-up-browser-fixture.mjs`（46934）后由浏览器驱动 `scripts/follow-up-browser-e2e.mjs`，截图 + URL 写 `output/follow-up-browser-<时间>/`。
4. **MyGO WebKit 安装版**：记录构建标识，区分源码预览与安装版；单独执行，不由前三层代替。

46935 预留给门控关闭的第二实例或协调方冲突时的替换端口。

覆盖项（与脚本中的 `case` 名对应）：普通中文聊天 + 选定来源创建；普通任务不受影响；当前用户证据 vs 引用/否定/来源注入；readOnly 拒绝；通用 CRUD 不能伪造跟进状态/授权；同 ID 回放原结果、改参数冲突；精确请求/线程/人物绑定；主观 OK 仍未决；客观精确回复完成；过期/部分/断开覆盖为 unknown；无新事件也到点检查；多件事与换话题隔离；检查进行中取消/忘记/删除/撤销阻止迟到采用；重启后 checkAt 只补跑一次；真实 SIGTERM/SIGKILL 中断恢复且无重复提醒/副作用；确认前证据被改则拒绝；完成后证据撤回保留历史；重复不变检查不放弃；门控关闭真正不检查；主/侧会话提醒路由；提醒上下文不进记忆；确认/继续/取消/推迟持久化；提交后响应丢失按同 ID 回查；浏览器草稿保留、刷新/重开、旧动作与两件事。

编辑/撤回由合成上游真实下发（同 ID、后续 seq），经生产 VirtualIM 适配器写入后被核验；飞书/微信的编辑撤回、覆盖缺口与范围撤销路径已实现但未在本机真实来源上验证（NOT_RUN），不以 VirtualIM 结果代替。

## 第二轮修正后的契约

- **授权**：先去掉 `<quoted_context>`、`>`/`＞` 引用行、代码块与行内代码、成对中英文引号（“”「」『』""‘’）以及翻译/总结/润色/改写/转述等包装之后的全部内容，再要求逐字证据。创建需要明确的持续跟进说法（跟进、盯、追踪、留意、提醒我、有结果告诉我、等…回复、follow up 等），“看看/确认”单独不够；取消、推迟、确认、继续各自需要对应的直接说法。
- **客观判据**：`reply_from_person` 只在用户证据明确说“回复即可”（回复/回了/答复/reply…）且不含同意、批准、内容是否合格等判断词时允许，否则 400 `judgment_required`。请求锚点必须是用户本人发出的消息（400 `request_not_owner`）。
- **身份元组**：候选与证据记录 `identity = hash(id, senderId, 精确 sentAt, replyTo, 正文哈希)`，锚点记录 `anchorIdentity = hash(id, senderId, sentAt)`；任何一项变化都不再视为同一条消息。每次读取都核对锚点仍在且未变。
- **目标与租约**：绑定记录 `sourceId` 与连接版本（VirtualIM：实例；飞书：连接 ID、账号 selfId、读取范围、过滤器；微信：账号哈希）。每次读取前后、模型返回后、采用与确认前都核对事项、来源 ID、适配器、版本与在线状态。
- **复核**：只在绑定事项（或 VirtualIM 同实例同会话的消息）发生来源事件后进行，使用一次实时有界读取。只有在完整覆盖下缺失、或同 ID 身份不同，才判为移除/修改；缓存缺失、分页受限、读取失败、断开、账号变化均为未知，证据保持有效。完成历史永远保留，无时间截止。
- **慢模型与确认**：主观候选在模型返回后重新读取，候选身份必须一致才可采用（否则记录 `candidate_changed` 并在 5 分钟内重试）；VirtualIM 在采用事务中再核对本地记录。确认在读取后、提交前同步核对版本、授权、目标、租约与候选身份。
- **删除与授权**：删除任务即在已删除记录上写入 `cancelled: task_deleted` 和新版本，恢复不会复活；删除所属会话或忘记授权消息，在下一次轮询时停止所有活动事项（包括推迟中和待判断）。
- **进程所有权**：`follow_up_owner` 单行记录唯一 worker（boot、pid、心跳）。只有心跳过期（≥15 s 或 4 个轮询周期）或 pid 已不存在时，才以比较交换接管；非所有者不检查、不恢复。检查行由 `intent` 原子更新为 `claimed`，采用前必须仍是本进程所有、仍为 `claimed`。单次检查总时长上限 240 s，租约 300 s；超时或异常都会写入检查记录并重新排期。
- **轮询合并**：运行中的 tick 只会合并出一次后续轮询，不积压；每进程同时最多 4 个检查。
- **回执**：创建指纹基于请求原文（缺省值在指纹之后计算）；同 ID 同参数回放原结果快照，并在 `current` 中附最新视图。
- **共享类型**：`shared/types.ts` 新增 `FollowUp`、`FollowUpEvidence`、`FollowUpReminderFields`、`MessagePage`，`Task.followUp`/`followUpCreated` 与 `Message` 提醒字段为可选，旧数据兼容。

适配器 E2E：`node --import tsx scripts/follow-up-adapters-http-e2e.mjs`（API 46936、受控模型 46937），使用公开合成的飞书 CLI 与 GreenBubbles CLI 走生产飞书/微信读取代码；飞书事项按生产形状（毫秒字符串、`replyToId`、`selfId`）预置，微信事项由真实后台同步生成。主脚本的双进程用例另用 46935。

## 第三轮修正

- **检查记录语义**：`adopted:true` 表示检查结果在绑定完好时被应用（包括 not_yet/unknown 的排期）；`businessChange:true` 另外表示它改变了业务状态（完成或待判断）。绑定变化、断开或不可读一律 `adopted:false` 加 `discardReason`，同时保持有界未知退避与“暂时无法读取”提醒。
- **否定动作**：动作证据所在子句若对该动作本身否定（不要/别/不用/不必/无需/先别/暂时不/不能… + 取消/推迟/确认/继续），返回 403 `negated_request`。“不用跟进了/不用再跟了”否定的是跟进而不是取消，仍是有效的取消。
- **锚点版本**：新增 `anchorVersion = hash(id, senderId, sentAt, 规范化正文)`（空白折叠、12000 字上限，缓存与实时同一规范化）；旧记录仍用 `anchorIdentity`。锚点被编辑、撤回，或在完整覆盖下缺失时，本次读取返回 unknown 且不含任何可采用消息；部分覆盖下缺失不视为删除。
- **复核并发**：每个事项同时最多一个复核；复核与检查共享每进程 4 个读取的上限；同一事项两次复核至少间隔去抖时间。开始读取前清除标记，读取期间到达的来源事件会重新置位，不会丢失。投影 `runtime.lastRevalidation/lastRevalidatedAt` 供验收确认复核确实发生。

## 实现边界（如实记录）

- 主观判据的模型只做相关性过滤（无工具、一次性会话、`follow_up_check` 内部任务、来源作为不可信数据）；模型三次失败后仍交给用户判断，不自动完成。提醒引用实际回复的前 240 字，不展示模型生成的摘要；截断片段不代表完整来源。
- 授权、否定与动作意图是有界的规则（关键词与引用剥离），不是完整语义理解；未加引号的口头转述（“她让我跟进…”）仍可能被当成用户请求，需模型与用户确认。
- 适配器缺少逐人 ID 时，群聊无法绑定人物（需上游 `senderId`）；群聊客观判据要求回复指向锚点（`replyTo`/飞书 `parent_id`），没有回复关系的群消息即使来自同一人也不算完成。
- 删除任务即取消跟进（`task_deleted`），恢复任务不会恢复跟进；需要时重新交办。
- 来源复核依赖来源事件（收件箱事项更新或 VirtualIM 消息事件）；飞书/微信在没有同步事件时发生的撤回，要到下次事项更新或用户确认时才会被发现。
- 进程所有权用 pid 判断存活，仅适用于同一台机器；pid 复用的极端情况由心跳过期兜底。
- 连续 3 次未知覆盖只发一次“暂时无法读取来源”提醒；之后同一连续段不再重复。
- 仅应用内提醒；没有原生通知、外发或命令执行。

## 本机界面与最终验收

- 当前提醒只显示正文、实际回复片段和动作，省去重复状态行；任务详情及过期提醒保留状态。跟进任务隐藏通用“标记完成/重新打开”按钮，使用跟进专属动作；普通任务保持原样。
- 最终 HTTP 198/198，默认运行中的真实模型项为 NOT_RUN；真实模型另行运行 7/7（仅自然语言创建和判据分类，合成来源）。飞书/微信使用合成 CLI 走生产适配器，40/40，不能据此声称真实账号端到端通过。
- 生产 UI 浏览器 13/13；洞察两按钮、完整上下文、草稿与普通发送回归 14/14；持续单一 Agent 会话回归 55/55。类型检查、Vite 构建和本机候选包签名校验通过。
- Go 桌面代理 → Node 网关 → HTTP API 8/8。实际签名隔离 MyGO 候选包验证回复引用、继续、推迟、取消、任务按钮、独立事项、草稿和退出重开恢复；没有替换日常安装版，没有公证或公开发布。
- 本机可复核产物位于私有忽略目录 `output/follow-up-acceptance-20261107/REPORT.md`；原始 HTTP、适配器与浏览器 JSON 各自保留。远端报告本身不作为测试通过的证据。

### 日常安装版（2026-11-07）

后续经用户明确授权，已通过本机更新器安装至 `/Applications/CyberMe.app`，构建 `1794021119215`；Developer ID 严格签名通过，保留旧包与数据备份，未提交或发布。原有消息、会话、记忆、任务、收件箱及连接 ID 无缺失；安装后原配置和本地状态 hash 一致。24 项安装定向检查通过，包括包身份、真实模型创建、原生推迟/取消、服务冷启动恢复、草稿退出重开与临时记录清理；证据在私有 `output/follow-up-installed-20261107/REPORT.md`。

真实模型首次将带引号的标题纳入授权证据而被拒绝，明确使用未引用的直接交办句后成功，仍有选句易用性限制。首次草稿验收受用户并发使用影响，不能判定；用户让出窗口后的串行复验通过。此次日常版临时跟进排在未来且随后取消，未强行触发真实来源到期读取，不替代长期真实账号验收。
