# 洞察后台可靠性：关闭思考、整批预算、失败分类与可见报错

本页约束 `ideas_refresh` 一次性结构化分析（`server/src/ideas-background.ts`、`server/src/agent.ts`）及 V6 页脚对后台状态的读取（`web/src/v6/InsightFooter.tsx`，页脚其他规则见 [洞察流页脚](insight-footer.md)）。证据、身份、权限、来源漂移与提交时校验、`protected`/`userManaged` 规则、单飞、回读语义、`/api/ideas/refresh` 响应结构和已存储模型配置保持不变。

## 失败案例（实现前记录，2026-11-14）

以下均已在当前源码上由原始响应复现或源码确认（复现报告不入库，仅保留字段与计数）。

1. 代理 IP 路由下命名空间 DeepSeek 模型（如 `x/deepseek-…`）在洞察中设为 `thinkingLevel=off`，实际请求却没有 `thinking:{type:'disabled'}`；网关默认开启思考，7000 输出 Token 全部耗在思考，`finish_reason: length`，可见正文为空。
2. 同一修正如果按主机名判断、修改账户/模型配置、全局补丁 SDK 或改为 `reasoning:true`，会改变普通聊天和其他供应商的行为（`developer` 角色、`reasoning_content` 注入）。
3. 思考耗尽、输出截断、空正文、上下文超限、流缺少结束标记、5xx、超时，在结构化校验前没有分类；空文本进入 `JSON.parse` 后统一记为 `invalid_ideas_output`。
4. 上述非结构错误仍发出 JSON 纠正轮：纠正轮重发近满上下文，SDK 把 `max_completion_tokens` 压到 219，且共用首轮 110 秒计时，最终记为 `llm_timeout`；纠正轮仍强制 `tool_choice` 到检索工具，可能只拿到工具调用而不是修正后的 JSON。
5. 一次性 `ideas_refresh` 会话可以自动压缩：压缩把不可信来源证据改写为摘要并占用回答计时，之后的逐字证据校验对象不再是送达的原文。
6. 首轮输入没有整批预算：最多 24 份变化来源 + 16 份引用来源（每份 6000 字）、100 条已有洞察（含已删除，描述最长 1600 字）、最多 16 份人物档案（每份 12000 字）各自限额，实测约 40 万字符、188492 输入 Token。检索结果每次最多 5 份来源及人物，没有累计上限。
7. 来源按最新排序后截取：持续有新消息时，较早的待分析来源一直轮不到；若压缩批次时把未送达的来源记为已分析，会永久漏掉。
8. 缩小批次时如果丢掉相关的受保护/已删除/人工洞察，模型会重提已忽略事项；服务端保护必须仍然以全部洞察为准。
9. 退避以输入指纹计次：每条新消息都把 `attempts` 重置为 1，`nextAt` 始终 +5 分钟，活跃工作区约每 5 分钟重发一次 19 万 Token 的请求；来源/权限/证据正常漂移又不应累计成数小时的供应商退避。
10. 自动运行 `.catch(()=>{})` 吞掉错误；开始新一轮时清空 `error`；`/api/bootstrap` 两种形式都不返回 `ideasBackground`；V6 页脚只从本机 `idle` 开始，后台失败从不显示。
11. 页脚如果直接用后台状态覆盖本机手动状态：会破坏原 run 回读、失联未知状态；后台运行中仍可点击导致重复 POST；迟到回调覆盖更新的操作；重启后的 `unknown` 被当成成功。
12. 诊断信息携带供应商原始错误、来源正文或生成内容，泄露私有文本。

13. （2026-11-14 本机首轮验收）配置 `contextWindow=12000,maxTokens=7000` 时，`Math.max(8000,…)` 让首轮预算 8000 Token 超过窗口扣除预留（54596）后的实际空间，仍发出一次请求并返回 200；隐藏最小值不得超过窗口，所需框架放不下时必须在任何供应商请求前拒绝。
14. （同上）四次并发检索、每次6份来源时，单次工具结果为 16325/16324/11013/392 字符：只计算了来源与人物，未计入 owner、来源元数据、coverage 及外层字段；单次 ≤16000、累计 ≤48000 必须按完整序列化结果计算，并发调用按调用顺序累计。
15. （同上）同一来源指纹连续自动失败、退避到期后，第四次被旧的 `attempts>=3` 永久拦截（模型请求数 2,2,2,0）；输入不变时也必须按 5/15/45/120 分钟持久退避继续重试。重启后的 `unknown` 及运行中不重放保护保留。
16. （同上）`coverage.runsToDrainOldest` 只描述第一条最旧来源，H4 记录 `{runs:15,bound:1}`；公平性上界必须覆盖原有最旧积压整体，并说明字节、配额及新到资料的影响。
17. （同上）HTTP 夹具在 `serve()` 实际监听前就输出 ready，受控重启后首个请求可能失败；测试连接池复用已关闭的旧连接；失败只记录 `fetch failed`，没有原因和阶段，且中途放弃的业务请求被吞掉。

18. （2026-11-14 本机真实模型临时副本，思考已关闭、首轮约6万Token）首次输出只有 `ideas`，缺少 `retire`：顶层数组检查直接抛出笼统 `invalid_ideas_output`，同一输出中的其他问题（2字聊天引用）没有一起报告；唯一一次纠正补了 `retire`，却保留了2字引用，最终 `invalid_evidence`。
19. （同上）首轮指令只写“逐字引用”，没有在输出格式旁写明必需数组、引用4–600字及 evidenceRef 必须指向包含该引用的同一条消息；这些约束只出现在纠正轮。另一次运行10条证据 `quote_not_in_referenced_message`，一次纠正未修复。校验正确拒绝，不得放宽、自动改绑、接受虚构引用或静默丢弃失败条目。
20. （审计）纠正余量只用 `usage.input+output`，供应商把部分上下文记为 cacheRead/cacheWrite 时会低估已用上下文；SDK 在供应商未报告思考用量时填0，被持久化为“实测0”。

## 设计

### 关闭思考（仅内部有界任务）

- 条件：内部一次性任务（`ideas_refresh` 等 internalMemory 类）、`thinkingLevel==='off'`、`api==='openai-completions'`、模型声明 `modelOptions.thinkingFormat==='deepseek'` 或模型 ID 的最后一段以 `deepseek-` 开头（`/(^|\/)deepseek-/i`），且 SDK 尚未写入 `thinking`。只在现有 `onPayload` 中写入 `thinking:{type:'disabled'}`。
- `modelOptions.thinkingFormat` 设为其他值时不写入（显式退出）。普通聊天、持久会话、其他模型和协议不变；不按主机名判断，不改注册模型、账户配置或 SDK。
- 审计：`provider_request` 事件的 `emittedThinking` 读取实际负载，另记 `thinkingControl:'explicit_disabled'`。

### 整批预算（`ideas-background.ts` 的 `snapshot()`/`budgetPlan()`）

- 估算：`估算 Token = ceil(字符数 / 2)`（本语料实测约 2.12 字符/Token，取更保守的 2）。
- 首轮目标 `min(60000, 上下文窗口 − 输出上限 − 4096 安全余量 − 检索累计 − 纠正预留 − 工具框架)`，没有隐藏最小值；结果不足以放下固定指令、框架和至少一份来源时，在任何供应商请求前以 `context_budget_exceeded` 失败（不改配置的模型上限）；检索累计 48000 字符、纠正预留 32000 字符来源 + 2000 输出 Token、工具与系统框架 3000 字符。上下文窗口/输出上限读取当前配置（默认 200000/7000）。
- 最终校验包含固定指令和系统/工具框架：组装完整提示后若估算超出目标，按确定顺序移除最后加入的非配额来源，直到满足；仍超出时以 `context_budget_exceeded` 失败，不发送。
- 分配：人物 ≤ 16000 字符（相关人物优先，档案正文截断到 1500 字并标记 `truncated`；人物跟踪仅保留与选中来源相关的观察），已有洞察 ≤ 20000 字符，其余给来源。
- 已有洞察：先放与选中来源相关的受保护/已删除/人工洞察，再放可更新的自动洞察，再按时间放其余；描述截为 240 字。服务端在提交时仍以全部洞察执行保护与合并（不依赖送达列表）。
- 来源：25% 来源预算保留给最早的待分析来源（按事件时间升序、ID 次序），75% 给最新变化；剩余空间放已有洞察引用的来源。未送达的来源不标记已分析，下一轮继续。
- 公平性的可解释上界：配额每轮从最旧待分析来源开始，至少送达1份，且未全部放下时送达字符 > 配额 − 最大单份。因此按事件时间排序的前 k 份（总字符 c）在连续成功运行中最多 `min(k, ceil(c / (配额 − 最大单份)))` 轮内全部送达（配额 ≤ 最大单份时为 k）。新到资料事件时间更晚，不占配额；前提是这些来源在期间不再变化、批次比例不缩小且末尾校验不移除配额来源。每轮 `coverage.drainBounds` 记录最多10个按时间累积的检查点 `{throughEventAt,items,chars,runs}`，并记录 `oldestQuotaChars/maxItemChars/oldestPendingEventAt`。
- 检索：按完整序列化工具结果（来源、元数据、人物、owner、coverage、外层字段）计算，单次 ≤ 16000 字符，累计 ≤ 48000 字符（为后续错误结果各预留 100 字符）；并发调用按执行顺序累计。超出部分不送达、不加入可引用集合，返回 `truncated`/`budgetExhausted`；空间不足以放下外层时返回 `research_budget_exhausted`。
- 同一绑定：预算选择、送达来源与 ID、送达洞察 ID、估算值写入 run 的 `inputBudget`，`inputFingerprint` 覆盖送达集合；证据校验只接受送达快照（含已送达的检索结果）。
- 上下文/输出耗尽后下一轮来源预算减半（最低 30000 字符），成功后恢复。

### 失败分类与纠正门控（`agent.ts`，仅 `ideas_refresh`）

- 结构校验前分类最后一条助手消息：`length` 且无正文且有思考 → `reasoning_exhausted`；其他 `length` → `output_exhausted`；无正文无工具 → `empty_ai_response`；上下文超限 → `context_overflow`；流缺少结束标记 → `provider_stream_incomplete`；HTTP 5xx → `provider_unavailable`；超时 → `llm_timeout`；其余 → `llm_failed`。
- 保存脱敏元数据 `failure={cause,phase,finish,stopReason,usage:{input,cacheRead,cacheWrite,output,contextTokens,reasoning},requests,priorCauses}`；思考用量只有大于0时才记录数值，未报告或SDK默认0记为 `null`（不作实测0）；不含来源、生成正文或供应商原文。
- `ideas_refresh` 关闭自动压缩；上下文超限直接失败，不压缩证据。
- 首轮输出格式旁明确：`ideas`/`retire`/`personUpdates` 三个数组都要给出（无内容写 `[]`）；quote 为4–600字逐字连续片段；聊天证据的 evidenceRef 必须是包含该 quote 的同一条消息。校验一次收集全部问题：缺少/超长数组与条目问题一起报告，问题带 `path/reason`，引用长度问题带 `actualLength/min/max`；纠正提示逐条列出这些数值约束（不含来源正文以外的生成文本）。
- 纠正：只对证据/结构校验码，最多一次；纠正余量按供应商报告的完整上下文（input+cacheRead+cacheWrite+output）估算；剩余回答时间 ≥ 40 秒、`max_tokens` 余量 ≥ 2000（发送前按供应商报告用量估算，`onPayload` 再按 SDK 实际 `max_tokens` 拦截）；纠正轮不强制 `tool_choice`。不满足条件以原校验码失败并记录 `repairSkipped`。

### 状态、退避与页脚

- 持久状态新增 `lastError/lastFailedAt/lastFailedRunId/failure/consecutiveFailures/failureClass/batchScale/coverage`；开始新一轮不清除，只有成功提交时清除。`error` 仍表示当前状态（兼容旧读取）。
- 退避：供应商/运行/模型输出失败按连续次数 5、15、45、120 分钟，之后倍增，最长 6 小时；不因输入变化重置，跨重启持久；输入不变时也继续按退避重试（移除旧的同指纹失败3次永久停止）。重启后的 `unknown` 同指纹仍不自动重放。来源/权限/证据漂移（`sources_changed/ideas_changed/analysis_context_changed`）只等待 1 分钟，不累计供应商退避。手动刷新仍绕过 `nextAt`。
- 两种 `/api/bootstrap` 都在路由层返回 `ideasBackground`（不在 store 引入循环依赖）。V6 复用 `App.tsx` 现有 15 秒工作区刷新，不新增轮询。
- 页脚：本机为 `idle/done` 时读取后台状态——`failed` 或 `unknown` → 现有「查找未完成 · 重试」（`role=alert`，`data-footer-error` 只放错误码）；`running` → 「查找中…」且禁用，有 `lastError` 时保留「查找未完成」但无重试。本机 `failed` 而后台运行中时隐藏重试；后台在本机操作之后成功则清除本机失败。本机手动的 `running/checking/unknown` 优先，回读与代次规则不变。不新增文案、统计或说明。

## 验收（本机协调 Agent 执行；源码作者未运行）

- HTTP：`scripts/insight-reliability-fixture.mjs`（API+Web 46891，受控模型 46892）+ `scripts/insight-reliability-http-e2e.mjs`，覆盖本页失败案例 1–12 的协议层部分。
- 浏览器：`scripts/insight-reliability-browser-e2e.mjs`，同一夹具，验证页脚首开即显示、重试一次 POST、运行中禁用、重启未知可重试、成功清除。
- 回归：既有 `ideas-background-*`、`insight-footer-*` 脚本保持原响应/回读语义。
- 真实恢复只以本机协调 Agent 在授权资料隔离副本上的真实模型探测为准；夹具通过不代表恢复。
