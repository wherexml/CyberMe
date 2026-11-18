# Global personal memory (2026-11-11)

CyberMe returns to its original product model: there is ONE global personal memory library, managed from the right-hand 记忆 tab. Chat no longer has a 记忆范围 (memory scope) selector, and project-based memory partitioning has no effect. This page supersedes the project isolation rules in [Mem0 recall and project isolation](mem0-memory-evaluation.md) and the `memoryProjectId` contract in [V6 data contract](v6-data-contract.md). Mem0 is still used, only as a retrieval engine.

## Failure cases recorded before implementation

Recorded on 2026-11-11, before any code change. Each one is an outcome the change must not produce.

### Data preservation
- F1 Existing automatic memories, hand-written MEMORY/SOUL, preferences, messages, conversations, chat requests, jobs, summaries or exclusions are deleted, moved, merged, renamed, re-ID'd, rewritten or have their status changed just by being read under the new model.
- F2 Legacy `memoryProjectId` is removed from memories, conversations or request receipts. It must stay as inert provenance.
- F3 Chat histories from project conversations are merged into the primary conversation, moved, or re-parented. A project conversation's messages appear in another conversation's history or summary.
- F4 Failed, partial, cancelled or unknown request receipts, including old `scope_*` refusals, are rewritten as succeeded or disappear from `GET /api/chat/requests/:id`.
- F5 V6 drafts, the current conversation selection, quotes, and the unrelated local message queue (queued/interrupt delivery, FIFO ordering) are lost or changed.

### Global recall
- F6 Facts saved from a legacy project conversation, including one whose project was later removed, are invisible to the primary/global chat.
- F7 Global facts and hand-written MEMORY are hidden from a legacy project conversation.
- F8 A message naming a project, or one with selected context linked to another project, is refused with 409 `memory_scope_conflict`, gets no memory, or is excluded from extraction or person-status updates.
- F9 A legacy project conversation whose project was removed returns 409 `memory_project_unavailable`, or its jobs go `stale` with `memory_changed`.
- F10 Agent tools (`list_memories`, `get_entity`, `list_entities`, `runs_list`, `run_get`, `entity_*`, `memory_document_*`) still hide other "scope" conversations or memories, or return 403 `memory_scope_rejected`. Internal `memory_extract`/`context_summary` runs must stay hidden.
- F11 Communication preferences are resolved per project, so a project slot overrides the global value only in one conversation.
- F12 Two legacy active facts on the same slot (global plus project A, or A plus B) both reach the model as current. Only the newest by source time is current.

### Corrections, forgetting and tombstones
- F13 A new statement supersedes only facts with the same provenance, leaving an older same-slot fact current.
- F14 Forget or tombstone applies only to one provenance, so the same slot from another provenance remains active.
- F15 Initialization or a late job resurrects a slot that was forgotten under a legacy project tombstone or the global tombstone.
- F16 Forgotten, undone, superseded, excluded, edited-source or deleted-source facts, or facts whose conversation was deleted, are recalled or listed as current.

### Replay and isolation
- F17 Replaying the same `requestId` with the same body (including an old client body carrying `memoryProjectId`) no longer returns the stored result, because the fingerprint changed. A different body under the same ID still returns 409 `request_conflict`.
- F18 Replaying a `requestId` from a different conversation, where either side is a legacy bound conversation, is accepted and writes a second message.
- F19 Conversation history or the agent session leaks across conversations. History and summaries stay per conversation; only the memory library is global.

### Endpoint and UI
- F20 `POST /api/chat/memory-scope` still creates project conversations, or crashes old clients. It must create nothing, delete nothing, and return a clear retired response (null keeps the primary-conversation answer).
- F21 V6 still shows the 记忆范围 selector, sends `memoryProjectId` with new chats, labels 自动记住 items with project names or "项目已移除", or tells the user to switch memory scope.
- F22 Mem0 is unavailable, times out or is disabled, and chat blocks or the evidence claims `mem0-validated`. It must fall back to the bounded keyword search, and the evidence must say why.

## Compatibility decisions

- `conversation.memoryProjectId`, `automatic_memories.memoryProjectId` and `chat_requests.memoryProjectId` stay stored unchanged. They are read only as provenance: `GET /api/memories/automatic` and context items keep the raw field, but `scope` is always `{kind:'global'}`.
- Scope resolution: every existing conversation is global. A missing or deleted conversation still resolves to `none` (no recall), which is the existing fail-closed path.
- A fact's source validity is: source message exists, its conversation exists, and the content hash matches. It no longer requires the fact's provenance to equal the conversation binding.
- Same slot: the current fact is the newest active fact by source message time, across all provenances. Older duplicates keep their stored status (no write on read) but are shadowed in recall and preferences. A new statement supersedes the current fact. Forget tombstones the slot globally and forgets every same-slot fact.
- Tombstones: new forgets write the global key `memory-forgotten-slots`. Initialization also respects legacy `memory-forgotten-slots:<projectId>` keys, so history never resurrects a slot. A new explicit statement clears the slot from all keys. Structured preference suppression still reads only the global key, so a legacy project-only forget does not hide a global structured preference.
- The request fingerprint is unchanged and still includes `memoryProjectId` when a client sends it, so old queued or replayed bodies match. New V6 does not send it. A string `memoryProjectId` without a conversation is accepted and ignored. A retried legacy request keeps its stored `memoryProjectId` provenance.
- Cross-conversation replay rejection for legacy bound conversations (`request_conflict`) is kept. It is request/session isolation, not memory partitioning.
- `PATCH /api/conversations/:id` still rejects changes to `memoryProjectId` (409 `memory_scope_immutable`), so provenance cannot be rewritten.
- `POST /api/chat/memory-scope`: `projectId:null` returns the primary conversation as before. Any project ID returns 410 `memory_scope_retired` and creates nothing.
- Legacy project conversations are not promoted to primary. They are still selectable from history and use global memory.
- Initialization (version 2) is not re-run. Messages that earlier gates skipped are not backfilled automatically.
- Old `scope_*` failure receipts stay failed. V6 shows a neutral explanation and offers 重试. Because the scope guard no longer refuses, the retry can complete.

## Validation

The local coordinator ran these journeys with synthetic data and isolated ports/database; production data was only read to verify preservation.

```sh
node --import tsx scripts/global-memory-http-e2e.mjs            # HTTP only: API 47181, model 47183, unreachable oMLX 47184
npx vite build --config web/mygo.vite.config.ts --outDir ../.local/global-memory-web
node --import tsx scripts/global-memory-http-e2e.mjs --serve    # keeps the fixture: Web http://127.0.0.1:47182/
ego-browser nodejs < scripts/global-memory-browser-e2e.mjs      # browser journey against 47182
node --import tsx scripts/person-status-http-e2e.mjs            # regression; its project check now expects a global write
```

Evidence is written to the ignored `output/global-memory-20261111/`. F10 (agent lookup visibility) is covered by code review only, because the controlled model does not issue tool calls. The retired scripts `mem0-project-scope-e2e.mjs`, `mem0-project-acceptance*.mjs` assert the old isolation and now fail by design. Don't use them for acceptance.

### 2026-11-11 本机验收

类型检查与 V6 构建通过。全局记忆 HTTP 27 项、浏览器 5 项通过；原初始化 14 项、人物状态 20 项、扩展记忆 13 项回归通过。真实本机 oMLX 模型通过 5 项历史初始化与跨会话召回检查，未改日常模型设置。首次沿用日常配置的隔离模型补验遇到连接错误，该失败保留，不计为通过。

已通过现有 Developer ID 签名更新器安装 `/Applications/CyberMe.app`，版本 0.1.3 / build `1794373611595`。旧原生构建重建后 40 个 Mach-O 段与原安装版一致；候选只更新所需 Web 资源与 6 个后端模块（含并行完成的消息排队兼容模块），另外 31,542 个运行文件保留。首次准备因旧后台查询超时安全停止，确认无进行中的聊天或任务后重试成功，保留原包备份。

安装版 12 项签名、字节及 HTTP 核对通过，实际 WebKit 窗口已验证范围选择消失、右侧总览与原有自动记忆可读。10 项数据保留核对通过：会话、消息、资料记忆、自动记忆、任务、设置、主会话及草稿保持。没有向日常聊天发送合成消息或写入测试记忆。截图、复验入口与精确边界见本机忽略目录 `output/global-memory-20261111/REPORT.md`，浏览器验收 URL 为 `http://127.0.0.1:47182/`（仅隔离服务运行时可访问）。未提交、推送、重新公证或公开发布。
