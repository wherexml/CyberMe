# OpsTwins macOS（GPUI）

Rust + Longbridge gpui-kit 原生客户端：对话、收件箱、灵感、任务、全局搜索和十二个独立非模态设置分区。视觉继承 `docs/design/macos-ui-study.html` 和较新契约；真实业务复用 Web API。完整产品迁移与独立验收进行中，不能以构建成功或 HTTP 通过代替 UI／旅程评分。

运行包位于 `.local/apps/OpsTwins.app`；bundle 使用本机 ad-hoc 签名解决重新构建后的 macOS 校验问题，没有 Developer ID 签名、公证或正式分发安装包。

## 结构

```
Cargo.toml              workspace（依赖版本集中锁定）
Cargo.lock              精确锁定（含 gpui-pre-* 快照）
rust-toolchain.toml     固定 rustc 1.95.0（见下）
crates/opstwin-api/     reqwest(rustls,multipart)+tokio+serde；SSE 行解析；{error,message,detail} 类型化错误；Chat/Inbox/Tasks/Files 端点
crates/opstwin-store/   本地 JSON 状态（原子写 tmp+fsync+rename，0600/0700）
app/src/main.rs         启动、菜单、窗口位置恢复
app/src/shell.rs        78pt SVG 图标导航、Cmd+1/2/3/4、Cmd+K、Cmd+,、上次页面与窗口尺寸持久化
app/src/backdrop.rs     仅搜索背景的CoreAnimation滤镜及panel排除mask，关闭/换页/销毁清理
app/src/sync.rs         共享变更信号（SSE / health 轮询），各页面订阅
app/src/chat.rs         对话：历史分页、发送/重试、附件上传与下载
app/src/inbox.rs        收件箱：列表/筛选/搜索/分页、详情、草稿编辑与冲突、生成草稿、完成/忽略、本人测试项发送与撤回
app/src/tasks.rs        任务：筛选/搜索/分页、创建、编辑与冲突、完成/重开、取消、删除/恢复
app/src/files.rs        上传前 25MB 检查；下载校验大小/Content-Type/SHA-256 后写缓存
app/src/persist.rs      每个状态文件一个后台写入器（合并写；save_now 等待落盘）
app/src/util.rs         Chrono 设备本地公历时间、大小、真实日期校验
app/src/ideas.rs        真实灵感、类别、一步 Agent 执行与请求回查
app/src/search.rs       真实记录检索、最近会话、详情路由
app/src/settings.rs     十二分区、真实保存、模型／连接／同步／个人上下文
app/src/dictation.rs    内存录音生命周期、真实 ASR、取消与迟到结果屏蔽
assets/dictation.swift  AVAudioEngine helper，89秒／12MB，无录音落盘
assets/settings-permissions.swift  AV/AX只读状态helper，不读取私有TCC或弹窗
vendor/                可复现 GPUI macOS demand frame wake 修复
acceptance/             协议级验收二进制（保持可编译）
```

## 锁定版本

| 项 | 版本 |
|---|---|
| rustc / cargo | 1.95.0（`rust-toolchain.toml`；gpui-pre 0.3.7 使用 `std::hint::cold_path`，1.94 编译失败） |
| gpui-kit | `=0.7.0`（crates.io；仓库 tag `v0.7.0` = `0c830f4d257e69fdd17200650533ab4ca9a40cc0`） |
| gpui-component / gpui-base | 0.7.0（经 gpui-kit 传递） |
| GPUI | `gpui-pre =0.3.7`（含 gpui-pre-macos / -platform 0.3.7，由 gpui-kit 精确 pin） |
| reqwest | 0.12（rustls-tls、multipart） / tokio 1 |
| sha2 | 0.10（附件 SHA-256 校验；锁文件内已有，仅新增 multipart 相关条目） |

MVP 新增依赖后 `Cargo.lock` 新增 12 行（`opstwin-store` 与 reqwest multipart 的 `mime_guess`），之后 `cargo build --release --locked` 通过。

升级 gpui-kit 时须同时升级其 pin 的整组 `gpui-pre-*`，单独评估。

## 构建与运行

```sh
cd native/macos
cargo build --release --locked  # 产物 target/release/opstwin
./target/release/opstwin        # 需本机 OpsTwin API 已在 46110 运行
./bundle-app.sh                 # 生成 .local/apps/OpsTwins.app，可在 Finder 双击
```

快捷键：Cmd+1 对话、Cmd+2 收件箱、Cmd+3 灵感、Cmd+4 任务、Cmd+K 搜索、Cmd+, 设置（也在「前往」菜单）、Enter 发送、Shift+Enter 换行、Cmd+Shift+L 切换浅/深色、Cmd+Q 退出。启动时恢复已保存外观，未配置时跟随系统。Option+Space 在听写设置启用后切换录音。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPSTWIN_API` | `http://127.0.0.1:46110` | API 基址。客户端不监听端口、不持有模型密钥 |
| `OPSTWIN_DATA_DIR` | `~/Library/Application Support/OpsTwin` | 本地状态目录；设置后附件缓存也改到 `$OPSTWIN_DATA_DIR/cache/files`（QA 隔离用，如 `/tmp/opstwin-qa`） |

日志写 stderr，只含 requestId、条数、错误码，不含消息正文或凭据。

`OPSTWIN_KEY_TRACE=1`仅用于隔离键盘定位：输出escape/up/down键名及组合/IME/路由布尔值，不输出可打印文本。实际中文候选须单独验证，不能由英文导航路由推断通过。

## 行为约定

- 启动：`GET /api/native/version` 探测 features；缺 `messages.page` 时降级为 `/api/bootstrap` 切片，缺 `events.sse` 时降级为每 2 秒轮询 `/api/health` revision。
- 历史：`GET /api/conversations/primary` → `GET /api/conversations/:id/messages?limit=50`；列表滚到顶部（或点「加载更早消息」）用 `before=nextBefore` 取上一页，按 id 合并。
- 同步：SSE `hello`/`revision` 触发刷新最新一页并按 id 合并；若最新页与已有消息无交集则继续向前翻页补齐（最多 10 页），避免缺漏。断线指数退避重连并携带 `Last-Event-ID`。
- 发送：`POST /api/chat {conversationId,message,requestId[,attachmentIds]}`；响应解析顶层 `run`、`requestId`、`artifacts`，`requestId = native-<uuid v4>`。请求 ID 先持久化；未知结果先 GET `/api/chat/requests/:id` 回查，只在未开始的404或明确失败时用原载荷／ID重新提交；部分执行禁止重试；409 `request_in_progress`/`conversation_busy` 显示等待并在 revision 变化后回读再询问；409 `request_conflict` 显示错误、不提供重试。
- IME：见下。

## 本地持久化（opstwin-store）

| 文件 | 内容 | 何时清除 |
|---|---|---|
| `ui.json` | `lastPage`、窗口 `x/y/width/height/maximized` | 不清除；尺寸过小或不在任何显示器上时回退默认居中 |
| `chat.json` | 各会话独立草稿、已上传待发附件、未确认请求（`requestId`、原载荷、附件、状态、`generation`） | 依据原请求／continuation 回执确认成功后删除；历史中出现相似消息不作为确认；允许移除的明确失败由用户移除 |
| `inbox.json` | 每项未保存草稿（文本、`baseUpdatedAt`、起点草稿）；发送幂等键（key、草稿指纹、状态、回执 ID） | 草稿保存成功或放弃时删除；幂等键保留作撤回与回读依据 |

只保存服务器尚不知道的客户端状态，不保存凭据，也不复制服务端历史。普通 UI 状态损坏后移到 `*.corrupt-<ms>` 并使用默认值；文件访问策略通过 `load_strict` 读取，损坏、无权限、无效 schema 或残留损坏证据均阻止访问，禁止回退允许。重启后保留未确认请求与原载荷；先 GET 原回执，running 继续等待，partial 不重发。Cmd+Q 退出时同步写一次。

## 收件箱语义

- 列表：`GET /api/inbox/query?offset&limit[&query][&includeDone=true]`。待处理＝服务端默认（需关注且未完成）；全部＝`includeDone=true`；安静记录＝`includeDone=true` 后按共享注意力语义过滤，最多连续读 10 页。时间取有效来源末条日期并使用设备本地时区。
- 详情：`GET /api/inbox/:id`，复用标准化来源消息、头像和缓存附件；Jev 成功数值显示三条横条，规则／未知／失败不伪造概率。
- 草稿：`PATCH /api/inbox/:id {draft, editedByUser:true, baseUpdatedAt}`。409 `edit_conflict` 取 `detail.entity` 并排显示服务器版与本地版；「保留我的」以新 `updatedAt` 重新 PATCH，「使用服务器版本」丢弃本地修改。本地修改输入即写 `inbox.json`；SSE 刷新不会覆盖未保存修改，只提示服务器已变化。
- 生成：`POST /api/inbox/:id/draft {mode:"auto", requestId}`，无总超时，显示进度；409 `request_in_progress` 每 3 秒以同一 requestId 再问；网络/5xx 失败保留 requestId，「重试生成」不会产生第二次运行。有未保存修改时禁止生成。409 `draft_review_required` 保存候选并提供审阅／采用；保留本地草稿不会丢掉候选，显式采用带版本校验。
- 完成/忽略/重新打开：`PATCH {status:"done"|"dismissed"|"pending", baseUpdatedAt}`；已外发/未知状态禁用。
- 发送：仅 `isSelfTest && recipientId=="self" && sourceSystem!="opstwin" && testMarker 以 OPSADV-QA- 开头` 时可用；其他项按钮禁用并说明原因。流程：生成或复用幂等键 → `save_now` 落盘 → `GET` 回读（已发送且有回执则直接显示）→ 草稿与回读不一致则停止 → `PATCH {approved:true, sensitiveApproved}` → `POST /send {draft, idempotencyKey}`。网络丢失再回读一次；仍未知时保留同一 key，下次点击先回读再以原 key 请求（服务端按 key 回放或对账）。服务端 `send_failed` 后才提供「确认无回执，用新幂等键发送」。敏感项需勾选明确批准。回执显示 `receipt.messageIds`。
- 撤回：`POST /api/inbox/:id/undo {idempotencyKey}`，失败后回读状态。

## 任务语义

`GET /api/tasks?offset&limit[&deleted=true][&status][&query]`（信封）。进行中＝非 completed/cancelled（客户端过滤）；已完成/已取消用服务端 `status`；回收站用 `deleted=true`。创建 `POST /api/tasks {title,notes,status:"active",dueDate?}`；编辑 `PATCH {title,notes,dueDate,baseUpdatedAt}`，409 显示双方并选择；完成/重开 `status:"completed"/"active"`，取消 `status:"cancelled"`，均带 `baseUpdatedAt`；删除 `DELETE`；恢复 `POST /:id/restore {}`。写操作不自动重试，失败后重新读取列表。

## 文件

- 上传：Chat 输入框左侧「+」→ 系统文件选择器（可多选）→ 读取前检查 1 字节–25MB → `POST /api/files` multipart（`file` + 已有会话时 `conversationId`）→ 显示附件 chip（可移除）→ 随消息发送 `attachmentIds`。附件为空时请求不带该字段（服务端指纹 `attachmentIds||[]`，二者等价）。
- 下载：消息 `attachments` 使用真实 artifact id；元数据按精确 `GET /api/artifacts/:id` 读取，返回脱敏记录，不受旧列表5000条上限限制。点击预览／打开 → `GET /files/:id` 流式下载，大小超过记录即中止；校验字节数、Content-Length、Content-Type（与记录 mime 比较主类型）、必须有64位 SHA-256；缺少时刷新服务端元数据，仍缺失则拒绝打开。同大小缓存也校验 SHA-256，再原子写入客户端状态目录的 `cache/files`；明确打开使用 `cx.open_with_system`。正文图片通过相同验证链延迟加载，失败保留重试，预览不丢当前输入草稿。

## 同步

`sync.rs` 维护单一 SSE（或 2 秒 health 轮询）连接；Chat、Inbox、Tasks 订阅。不可见页面只标记 stale，切回时刷新；可见页面 350–400ms 防抖后刷新。首次连接不触发重复加载，断线重连后补读。

## 中文输入法回车

输入框为 `TextareaState::new(..).auto_grow(1, 8).submit_on_enter(true)`（gpui-kit 0.7.0 `crates/base/src/input/base/state.rs`：多行模式下非 Shift 的 `Enter` 动作不插入换行，改为 `cx.emit(InputEvent::PressEnter { secondary, shift })`），视图订阅 `InputEvent::PressEnter { shift: false, .. }` 后发送。

组合期回车不会发送的原因：GPUI macOS 后端（gpui-pre-macos 0.3.7 `window.rs` `handle_key_event`）在 `input_handler.marked_text_range()` 为 `Some` 时，先把按键交给 `NSTextInputContext handleEvent:`，输入法消费回车用于确认候选，不再派发到键位绑定，因此 `Enter` 动作与 `PressEnter` 均不会产生。作为第二道保护，发送前再调用 `EntityInputHandler::marked_text_range`（`TextareaState` 实现该 trait，内部读取 `ime_marked_range`），非空则不发送。

2026-10-03 第一阶段包曾通过真实 macOS 简体拼音输入法界面验收：按物理拼音键进入组合期，Return 只上屏、不提交，Space 可选择中文候选；粘贴、Emoji、选区替换和 Shift+Return 正常。当前完整产品 v11 包须重新复验，第一阶段证据不自动转为当前版本 PASS；不得用直接设置文本替代组合期验收。

## 界面验收与恢复

结果与可重复步骤见 [原生 GUI 验收](../../docs/acceptance/native-gpui-20261003.md)。真实服务长回复 3111 字符可显示标题、嵌套列表、代码和表格；Web 到原生窗口可见消息的测量上界为 1802ms。隔离 1000 条历史分页、回到底部与输入已验证；它不代表真实服务器千条 SQL 查询压力测试。MVP 编码后的独立评审、14 项实测矩阵与两个已知 P2 缺陷（重启恢复附件的哈希完整性、生成期并发修改后的候选草稿恢复入口）见 [MVP Review](../../docs/acceptance/native-mvp-review-20261003.md)，修复完成前不做原生 MVP 验收宣称。

Tokio timer 必须在 `runtime::io(async move { ... })` 内构造；在 GPUI 前台直接调用 `tokio::time::sleep` 会因缺 reactor 崩溃。已通过真实 API 转发代理的 503 故障与 GUI 重试验证修复。发送失败保留在本地消息气泡，重试沿用 requestId；MVP 起草稿与待发消息持久化到 `chat.json`。

复测工具（均只监听 loopback）：`node scripts/native-ui-proxy.mjs`（仓库根目录运行，46191 转发真实 API）；`node scripts/native-ui-history-fixture.mjs`（46192 合成只读历史）。以 `OPSTWIN_API` 指定对应地址启动二进制。`target/`、本地 bundle 与证据均忽略，不提交构建产物；bundle 仅本机 ad-hoc 签名，未公证。

## 产品品牌与本地启动

产品名称为 OpsTwins，窗口、菜单、侧栏和本地 App bundle 使用同一名称。`assets/opstwins.svg` 沿用 Web `TwinMark` 的紫蓝渐变、双圆与白色交集；系统身份保留 SVG；主导航不重复品牌区。bundle 脚本使用 rsvg-convert 和 macOS iconutil 生成 ICNS。运行 `./bundle-app.sh` 后打开 `.local/apps/OpsTwins.app`。既有 bundle identifier、API 协议、二进制名称和用户状态目录保持兼容，不迁移历史状态。

## 完整迁移与证据边界

[产品迁移旅程](../../docs/journeys/native-product-parity.md)、[Chat规格](../../docs/spec/native-chat-parity.md)、[Inbox规格](../../docs/spec/native-inbox-parity.md)、[设置与灵感规格](../../docs/spec/native-product-pages.md)分别记录实现及真实验收范围。原两个P2已有修复和真实协议／文件 helper 回归，当前 UI 与硬件旅程仍需独立复核。

46193 仅提供公开合成只读视觉数据；不得把它的截图当作真实 Agent、外发、系统权限或性能证明。独立截图及 Haiku 原始评分放忽略目录 `output/native-parity-20261003/`，不得自行抬分。光标、窗口、录音和失败恢复必须在真实原生 App 验收。

完整交付分 Part 1 独立截图视觉与 Part 2 原生界面到真实后端的85项功能及恢复旅程，两项评分均须 >95；范围和现有证据见 [Part 2 矩阵](../../docs/acceptance/native-product-part2-matrix-20261003.md)。非空搜索通过 [全文搜索API](../../docs/spec/native-workspace-search.md)按revision分页；完整详情另GET原Entity。附件元数据按精确ID读取，消除旧5000条列表上限，内容仍必须经过大小/MIME/SHA校验。任务状态操作回读 `includeDeleted=true` 和真实SQL删除标记，保留未保存editor，已删除状态禁保存。

## 设置、权限与新连接恢复

设置的完整接口／需求矩阵／本批GUI未测项见[设置与灵感规格](../../docs/spec/native-product-pages.md#本模块完整需求矩阵与本批gui待测)，失败面先记录在[设置失败清单](../../docs/journeys/native-settings-failure-matrix.md)。`node scripts/native-settings-product-http-e2e.mjs`从仓库根运行，使用46110真实API；最新61项HTTP证据覆盖独立记忆全文、稳定连接与只读微信真实分页，产物在`.local/acceptance/native-settings-product/`，不含私人正文。HTTP不执行原生控件，不能替代GUI或95分视觉评分。

`settings-permissions.swift`经bundle脚本编译为`Contents/MacOS/opstwin-settings-permissions`。Settings仅执行同目录helper，读取AVCaptureDevice麦克风与AX辅助功能状态；异常/缺失为unknown，完整磁盘/应用文件读取许可仍unknown且disabled。helper不请求授权、不扫描私有TCC或钥匙串。权限归属由macOS当前应用责任链决定：独立终端helper结果只证明该执行上下文，不证明本地ad-hoc签名bundle已获权限；需从真实App点击刷新核验。ad-hoc不等于Developer ID或公证。

新增自定义连接先把稳定`createId`原子保存到`settings-drafts.json`，回查原ID；404才`POST /api/connections`形成setup_required，再`POST /api/connections/:id/test`。重试复用原ID，已connected采用原结果；已创建但资料不同返回409并显示「读取原连接」，不再走无幂等ID的`/api/connections/test`重复生成。失败和未知保留表单，服务端真实检测成功前不显示已连接。

v13尺寸/键盘恢复及版本化原失败见[恢复旅程](../../docs/journeys/native-ui-v12-recovery.md)：使用真实单行InputState外层padding获得Inbox31px/会话38px，而非单行无效h；侧会话统一单个PopupMenu owner和稳定行焦点；录音composer持续焦点在Textarea卸载期间接收Escape，取消/完成按generation恢复输入。三项真实GUI子范围通过，独立完整视觉评分与完整85项功能仍进行中。

v14候选修复设置canonical保存回显及连接异步草稿迁移；搜索半径/边缘和Inbox消息分组待新包截图。生产Rust客户端真实ASR公开音频E2E已通过，使用`acceptance/src/bin/native-asr-http-e2e.rs`；合成音频不代表硬件GUI听写通过。当前运行包与候选二进制分开记录，验收期间不覆盖其他Agent正在使用的bundle。

v15候选修复隐藏Inbox自动选择造成的提前起草，并保护切页期间的迟到准备回调；[可见选择旅程](../../docs/journeys/native-inbox-visible-selection.md)记录真实Jev公开资格及未执行GUI。当前v14运行包冻结，工作树及target候选变化不改写旧包验收证据。

真实工作区 GUI 公开数据准备见[工作区旅程](../../docs/journeys/native-workspace-gui.md)，仅使用46214隔离服务；真实Agent本地写入后中断恢复见[partial旅程](../../docs/journeys/native-real-partial.md)，使用46218。不得将准备HTTP或真实partial恢复结果等同窗口交互通过。

v14独立搜索实测70.1%黑区，mandatory视觉gate失败、分数null；Inbox原12px间距子范围已通过。v15运行候选8a9c92a1…移除无限extent clamp，保留有限Gaussian3pt、外缘10pt不进入mask，必须检查完整背景/清晰面板/外缘突变；旧评分不继承。Opus只读阻塞分析建议实际Tab焦点及单次激活窗口后scroll复验，不能将CUA noWindowsAvailable直接记为产品FAIL。

v16 独立实际截图已修复黑区和复制背景，但四边约8px暗带仍导致 mandatory gate FAIL，评分保持null。v17加入有限内侧采样crop后clamp、Gaussian3pt和完整输出crop，保留全帧mask；候选尚需新包真实截图，不以编译推定暗边关闭。旧版本原始截图及色彩证据保留在[恢复旅程](../../docs/journeys/native-ui-v12-recovery.md)。

原生连接的协议选择和masked瞬时API Key由真实服务端目标绑定保护；独立HTTP48通过，原生保存/晚回包/退出尚需GUI，见[连接类型恢复](../../docs/journeys/native-connection-type-recovery.md)。飞书本人发送GUI的独立46224/46225准备服务与公开唯一草稿见[飞书GUI旅程](../../docs/journeys/native-feishu-gui.md)；准备不发送，实际回执另验。


个人微信完整上下文reader使用同连接/来源精确ID、RAM查询/get与已验证图片；服务端Agent日志省略query/正文，媒体RAM有界，断开阻断。真实34项HTTP和非图片缺口见[微信上下文旅程](../../docs/journeys/native-wechat-context.md)。新入口实际GUI尚未验收。

v18候选只补微信reader的RAM owner生命周期：隐藏设置立即失效请求并释放已读图片/正文/列表，保留未提交查询在RAM；切设置scope、返回连接/会话、改变精确cid/mid、断开或canonical连接id/updatedAt/status/read权限变化均拒旧回包。输入查询只在真实scope变化后使用render的现有Window清空；同version后台reload不丢查询或重新发送。图片metadata后、下载前及所有结果提交均复核visible/section/detail/精确cid/mid/请求代次/连接版本；普通设置draft和Saver字段不改，旧token不持久化。此修复仍是后续候选源码与cargo检查，当前运行v16 bundle保留，GUI全部NOT_RUN；非图片读取/显式保存/系统打开仍等待统一API契约，不计入本修复通过。

独立v18源码审查发现首版set_visible(false)没有真实调用接线，原失败报告保留。后续候选使用持有的`observe_window_visibility`订阅与`window.is_visible()`初值接入真实Hidden/Visible，使用弱实体的`on_window_should_close`在系统关闭前失效；Shell移除无条件true，并在显式Close路径先失效再remove。重新可见按stale刷新canonical连接，不自动读微信、不以普通blur/deactivate清查询。此接线修复仍需新包真实minimize/Hide/关闭/恢复GUI，不因源码或编译通过覆盖原审查结论。

v19候选将微信语音、视频、文件接入现有exact-message附件API：先读取当前capabilities，再按真实消息类型显示读取控件；精确metadata POST返回后复核UI owner，才GET同UUID附件。客户端验证固定URL、kind/MIME/format、25,000,000字节上限、有效期、长度与SHA。内容、token、已保存路径只留RAM，不进入Saver或自动附件缓存，沿v18隐藏/切scope/精确消息/断开/连接版本保护失效；旧token不能重启恢复。已有图片预览保留。服务端完整CLI及HTTP结果不等同原生控件验收。

非图片的「保存到…」使用真实GPUI `prompt_for_new_path`，取消或失败保留RAM可重试；未知/损坏文件策略禁保存。仅使用验证格式的固定文件名，未知文档保存`.bin`，不得系统打开。用户选择路径后复用fileAccess屏蔽策略，按父目录fd逐层`openat(O_NOFOLLOW)`拒符号链接，后台写随机exclusive临时文件（0600）并fsync/验证SHA；回到UI复核owner后同步`linkat`原子发布，不覆盖已有目标，失败/迟到仅清自己的临时inode。磁盘目录同步失败会明确提示目标可能已写入，不能声称回滚。仅显式选择保存才落盘；进程被强杀时未发布临时文件清理尚未验收。

独立v19源码复核曾发现Open的token GET与本地验证处于同一future，末次UI guard不能阻止等待期间隐藏后开始磁盘读；原报告与源hash保留。后续修复将GET结果先送回UI检查精确owner/cancel，再启动单独文件验证；helper在入口、fileAccess await返回后、实际文件打开/内容读取前和读取返回后检查取消与到期。已开始的有界网络或文件读可完成后丢弃，并非强制中止；最终系统打开前UI owner及保存路径快检仍执行。此修复尚待独立source复核与实际延迟GET/隐藏GUI，不把编译或回查成功记为系统打开通过。

「在系统应用打开」仅适用于本轮已显式保存的验证格式；先GET原token复核服务端资格，再验证已保存文件路径/inode/600权限/大小/SHA/格式，回到UI再次复核owner与路径后请求系统打开。该API没有播放/查看回执，界面只显示请求已发出，不能证明SILK等格式有系统播放器。ZIP/opaque文档只保存、不开启。容器头检查沿API的`header-only`/`opaque-bytes`语义，不声称完整媒体解码成功。此候选仅新增已锁定`libc = "=0.2.190"`直接依赖，未升级其他包；源码/locked cargo检查与GUI、文件选择器真实写入验收分别记录，当前v16运行bundle不替换。

固定v19独立source复核已完成RESOLVED_SOURCE，review `3cefe28665b756c992cd2e1062812b6cb4daa2216fe13fe1454dadc7a57273c1`、artifact `f914d4828bfec2e791a865cead8e1685b61f2c34c2c5276f7a910f850ace41b5`。GET→UI owner→磁盘验证源修复不等于动态取消/真实保存或系统播放；新包GUI仍NOT_RUN，旧报告保留，详见[非图片规格](../../docs/spec/native-product-pages.md)。

2026-10-04 模型设置新增供应商编辑和添加/编辑模型浮层，真实保存地址/协议/密钥及Token/推理/图片参数；设置保留三个交通灯，关闭可用、最小化和缩放置灰禁用、搜索采用固定字号和单行省略。API与GUI证据分别记录，见[旅程](../../docs/journeys/native-model-provider-ui.md)。

2026-10-04 会话侧栏展开采用240pt整高并排列，正文及输入框按剩余宽度共同居中；普通展开/多行/收起/760pt窄窗与重启偏好实际GUI证据见[侧栏旅程](../../docs/journeys/native-chat-sidebar-layout.md)。


设置最新截图布局：透明标题栏使导航表面延伸至窗口顶部，右侧标题顶部18pt，225pt导航/14pt字号/中性灰选中。契约见[设置连续布局](../../docs/design/native-settings-continuous-layout.md)。

2026-10-04 飞书原生本人真实外发已在同隔离根完成唯一发送、丢成功响应GET回查、同状态重启及撤回，原回执保留且精确CLI确认删除；见[飞书旅程](../../docs/journeys/native-feishu-gui.md)。这是实际子旅程，完整85项仍未完成。冻结01fb旧包27组静态Haiku评分91，不能继承给后续整高侧栏/新设置布局。

微信GUI环境用 `node scripts/native-wechat-gui-service.mjs`（46226），同scope `--stop/--resume`严格核路径/owner/自有PID与原token失效；[实际准备与恢复](../../docs/journeys/native-wechat-gui.md)不等于原生Read/Save/Hide通过。Chat真实听写可用 `OPSTWIN_API=http://127.0.0.1:46218 node scripts/native-chat-voice-gui-proxy.mjs`（46219），代理23项协议预检与真实硬件结果分开。

### 直接发送（2026-10-04）

运行中输入与普通发送相同，Enter/上箭头统一 `POST /api/chat` + `interruptCurrent:true`，停止旧回复后继续对话；不自动排队或插入运行。列表滚动条隐藏，滚轮/历史分页保留；遗留待发请求仍可恢复。主动打断为普通状态，完成写入保留原partial记录。可重复HTTP验收：`node scripts/native-chat-interrupt-http-e2e.mjs`（46240/46241公开隔离上游，report.json）；真实原生GUI与真实模型另记。

停止消息下仅显示灰色“已停止”；悬停或键盘聚焦消息可复制/查看原请求执行记录，移除文字入口取消。真实错误与partial恢复操作保留。

### 服务端未确认运行恢复

打开会话、刷新和同根重启均只读发现服务器未确认请求，不要求本机 `outgoing` 或已加载历史消息含该请求。`GET /api/chat/conversations/:id/unresolved` 返回有界元数据及 revision 分页；原生独立 RAM 缓存按会话与可见代次核对，刷新失败保留已有记录和草稿，分页变更要求重读。partial 提示真实写入次数，缺少证据显示未知；执行记录先按原 requestId 读取 receipt，再读原 run，不能生成可重发本机记录。真实 GUI、HTTP 和 Rust 客户端证据见 [Chat 恢复旅程](../../docs/journeys/native-chat-gui-20261003.md)。

- 2026-10-04录音框几何增量：在仓库根运行 `python3 scripts/native-composer-geometry-e2e.py`，默认读取本项目v35实际GUI原图，以真实ICC复现三组四列外壳上缘。失败原图、新包及完整评分边界见 [最终恢复旅程](../../docs/journeys/native-final-resume-20261004.md)。

恢复设置验收从仓库根执行 `python3 scripts/native-settings-resume-readback-e2e.py`，只读既有46214真实probe/模型角色/连接/公开Idea及本机blocked策略，原生18图与失败原件见[恢复旅程](../../docs/journeys/native-final-resume-20261004.md)。不会重新调用模型或重复写入，不计完整评分。

Search→Inbox精确跳转的v35原错跳与v36修复回归保留在 `output/native-parity-20261003/search-keyboard-v35-20261004/`，新包/472源码输入绑定，仍不计全产品评分。

- [模型测试原请求恢复](../../docs/journeys/native-model-probe-recovery.md)：持久 ID、事务 receipt、GET 回查、重启 unknown 与新包丢响应恢复；完整设置/产品评分仍未完成。

- [本机设置Saver恢复](../../docs/journeys/native-settings-local-saver.md)：真实写入失败保值、明确重试与同state正常重启，HTTP和本机错误分开。

v39连接状态/失败原因使用canonical row；删除迟到回调只清原分区未变稿。真实REST丢201/503/删除拒绝/12秒延迟跨分区/正常重启及17项只读复验见[连接恢复旅程](../../docs/journeys/native-connection-recovery.md)。根目录执行 `node scripts/native-connection-recovery-readback-e2e.mjs`；完整十二设置/85与两评分仍未闭合。

v41连接配置集合/Cancel/503/真实409及正常重启恢复见[集合旅程](../../docs/journeys/native-connection-collections.md)。仓库根运行 `node scripts/native-connection-collections-readback-e2e.mjs`，只读核验本次公开scope与源码/签名包，14项、40个原图/AX绑定；默认冻结快照回查不是实时PASS；`--live`在本批已清理后应失败。

字号实际14/16对比与正常重启见[字号恢复](../../docs/journeys/native-font-recovery.md)，根目录 `python3 scripts/native-font-recovery-readback-e2e.py` 只读冻结原件；原裁切原因未定位，不作渲染修复PASS。

十二设置中英文切换、两个正常重启及两行未提交草稿保持见[原生语言恢复](../../docs/journeys/native-language-recovery.md)。`python3 scripts/native-language-readback-e2e.py`回查49项冻结证据，实际语言写入仅两次；不认证隐藏弹窗、权限或最终评分。CUA历史.png字节实际JPEG，本批及字体/集合原件均保留，不把扩展名作为PNG资格。

## 2026-10-04 记忆恢复增量

实际9534字新建201丢响应后原ID GET恢复，无重复创建；9573字全文保存。v41冲突Reload旧lease及v42迟到200删除后输入FAIL均保留；v43实际保稿/丢稿精确读取、15秒成功后保稿、正常Quit重启继续Save及迟到真实409切分区保护通过。20项冻结回查仅认证上述27原JPEG/43AX及HTTP/源/App，不是完整85或独立评分。new成功后后来输入迁ID、Identity/历史恢复和next Agent消费仍待验。旅程：`docs/journeys/native-memory-recovery.md`。

## 2026-10-04 自主权限恢复增量

v43实际六等级锁定/选择、deepThink五勾选、23:15→06:45时段/通知/披露整组保存。代理503保稿跨正常重启、明确重试200、Cancel、关闭重开和保存重启后原生恢复baseline；15档案检查/17原JPEG/17AX。实际next Local只读deep模型消费everyone，原request ledger/GET run一致；本人hold HTTP423及0发送/日历意图。原生Record、自动调度、逐类deep/quiet通知/运输披露与并发仍未关闭。详见`docs/journeys/native-autonomy-recovery.md`，不计完整85或独立功能评分。

2026-10-04：冻结v41独立视觉混合采图达到100/100及五mandatory PASS；原单轮88保留。最新v43与完整85功能评分未建立，详见[恢复旅程](../../docs/journeys/native-final-resume-20261004.md)。

微信当前公开恢复入口为固定`native-wechat-recovery-api.mjs`→`native-wechat-recovery-http-preflight.mjs`→media proxy `--qualified-v43`，全部从仓库根运行；旧source gate失败保留。详见[微信GUI旅程](../../docs/journeys/native-wechat-gui.md)。Rust build必须在本目录执行以使用锁定1.95.0工具链，根目录仅传manifest不能替代toolchain工作目录。

v44最小断开诊断修复已构建/签名并实际回归；v43自然TTL与v43→v44重启证据单独绑定版本，详见微信GUI旅程。root验收包在.local/apps中，默认安装包与最终两评分尚未交付。

2026-10-04：冻结v44独立27+9+3帧、原始97/100及五mandatory PASS关闭Part1；原扣分及同session解析恢复保留，不认证后续包。Part2/85项与独立功能评分仍未完成，见`docs/journeys/native-final-resume-20261004.md`。

2026-10-04 v45 Tasks focus recovery: actual close/Save success Cmd+K, real conflict replacement title input and normal restart verified; late callbacks/hidden Settings return remain NOT_RUN. See `docs/journeys/native-task-editor-focus.md`. Frozen v44 Part1 97 does not certify later binaries.

2026-10-04 v46 precise Task read: v45 stale error FAIL retained; fresh v46 actual503/same-ID200 clears prior action_error only after dirty/busy gates. Dirty draft guard and explicit close recovery remain visible; v45 late GET Ideas/newquery protection independently verified. See `docs/journeys/native-task-editor-focus.md`; full85 score null.

- v46冻结包实际直接打断与物理麦克风组合、停止后可见填稿、Cancel/切页保稿和正常退出，见[Chat GUI旅程](../../docs/journeys/native-chat-gui-20261003.md)。原Stop切页干扰保留；不认证后续UI工作区改动或全部85项。

- 文字裁切/灵感交互当前契约及公开46257复验：[`native-text-layout.md`](../../docs/journeys/native-text-layout.md)。

- v46原生Chat来源规则屏蔽/恢复与引用否定、Inbox未知例外的真实模型/GUI绑定见[来源授权旅程](../../docs/journeys/native-agent-source-rules.md)；不把模型未调用当dispatcher拒绝，不升级完整85评分。

2026-10-04 v48：新建201后输入原v47重复Save Decode FAIL保留；同原ID只读GET迁稿→明确PATCH、正常重启、末尾换行及fresh visible/切General迟到回包保护实际通过。冻结99项回查只核原E2E，不是完整设置/85评分；历史Restore仍待验。见 docs/journeys/native-memory-recovery.md。

Inbox 后台生成与图标/提示回归见 [验收旅程](../../docs/journeys/native-inbox-background.md)：生成状态按事项隔离，公开fixture实际GUI不代表真实模型或完整产品评分。

Chat发送状态：长POST同时每秒只读回查原requestId；已确认运行在左侧显示三点气泡，未知/终态停止动画。公开隔离GUI及10项证据复核入口见[Chat规格](../../docs/spec/native-chat-parity.md)，fixture用46264，不连接真实模型。

Inbox已改为自动保存与服务端默认补稿，精简工具栏和迟到/失败/冲突/重启证据见 [热保存旅程](../../docs/journeys/native-inbox-autosave.md)。

- 聊天灵感结构化结果只作内部数据：新回复保存可读正文，历史assistant按精确ideas结构只读投影；执行记录呈现确认状态/操作摘要，业务taskOutcome优先，不展示原始JSON。Ideas移除审核占位；见 `docs/journeys/native-chat-readable-results.md`。
