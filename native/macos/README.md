# OpsTwin macOS (GPUI) — Sprint 1003 技术验证

Rust + Longbridge gpui-kit 的最小原生 Chat 客户端。状态仅为「macOS 技术验证」，不是已交付的原生 App（无签名/公证/安装包）。

## 结构

```
Cargo.toml              workspace（依赖版本集中锁定）
Cargo.lock              精确锁定（含 gpui-pre-* 快照）
rust-toolchain.toml     固定 rustc 1.95.0（见下）
crates/opstwin-api/     reqwest(rustls)+tokio+serde；SSE 行解析；{error,message} 类型化错误；requestId 生成
app/                    二进制 `opstwin`：窗口、主题、Chat 视图
```

## 锁定版本

| 项 | 版本 |
|---|---|
| rustc / cargo | 1.95.0（`rust-toolchain.toml`；gpui-pre 0.3.7 使用 `std::hint::cold_path`，1.94 编译失败） |
| gpui-kit | `=0.7.0`（crates.io；仓库 tag `v0.7.0` = `0c830f4d257e69fdd17200650533ab4ca9a40cc0`） |
| gpui-component / gpui-base | 0.7.0（经 gpui-kit 传递） |
| GPUI | `gpui-pre =0.3.7`（含 gpui-pre-macos / -platform 0.3.7，由 gpui-kit 精确 pin） |
| reqwest | 0.12（rustls-tls） / tokio 1 |

升级 gpui-kit 时须同时升级其 pin 的整组 `gpui-pre-*`，单独评估。

## 构建与运行

```sh
cd native/macos
cargo build --release --locked  # 产物 target/release/opstwin
./target/release/opstwin        # 需本机 OpsTwin API 已在 46110 运行
./bundle-app.sh                 # 生成 .local/apps/OpsTwin.app，可在 Finder 双击
```

快捷键：Enter 发送、Shift+Enter 换行、Cmd+Shift+L 切换浅/深色、Cmd+Q 退出。启动时跟随系统外观。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPSTWIN_API` | `http://127.0.0.1:46110` | API 基址。客户端不监听端口、不持有模型密钥 |

日志写 stderr，只含 requestId、条数、错误码，不含消息正文或凭据。

## 行为约定

- 启动：`GET /api/native/version` 探测 features；缺 `messages.page` 时降级为 `/api/bootstrap` 切片，缺 `events.sse` 时降级为每 2 秒轮询 `/api/health` revision。
- 历史：`GET /api/conversations/primary` → `GET /api/conversations/:id/messages?limit=50`；列表滚到顶部（或点「加载更早消息」）用 `before=nextBefore` 取上一页，按 id 合并。
- 同步：SSE `hello`/`revision` 触发刷新最新一页并按 id 合并；若最新页与已有消息无交集则继续向前翻页补齐（最多 10 页），避免缺漏。断线指数退避重连并携带 `Last-Event-ID`。
- 发送：`POST /api/chat {conversationId,message,requestId}`，`requestId = native-<uuid v4>`。网络错误/5xx 用同一 requestId 自动重试（最多 3 次，1s/2s 退避），之后显示「发送失败 + 重试」，重试仍用同一 requestId；409 `request_in_progress`/`conversation_busy` 显示等待并在 revision 变化后回读再询问；409 `request_conflict` 显示错误、不提供重试。
- IME：见下。

## 中文输入法回车

输入框为 `TextareaState::new(..).auto_grow(1, 8).submit_on_enter(true)`（gpui-kit 0.7.0 `crates/base/src/input/base/state.rs`：多行模式下非 Shift 的 `Enter` 动作不插入换行，改为 `cx.emit(InputEvent::PressEnter { secondary, shift })`），视图订阅 `InputEvent::PressEnter { shift: false, .. }` 后发送。

组合期回车不会发送的原因：GPUI macOS 后端（gpui-pre-macos 0.3.7 `window.rs` `handle_key_event`）在 `input_handler.marked_text_range()` 为 `Some` 时，先把按键交给 `NSTextInputContext handleEvent:`，输入法消费回车用于确认候选，不再派发到键位绑定，因此 `Enter` 动作与 `PressEnter` 均不会产生。作为第二道保护，发送前再调用 `EntityInputHandler::marked_text_range`（`TextareaState` 实现该 trait，内部读取 `ime_marked_range`），非空则不发送。

2026-10-03 已通过真实 macOS 简体拼音输入法界面验收：按物理拼音键进入组合期，Return 只上屏、不提交，Space 可选择中文候选；粘贴、Emoji、选区替换和 Shift+Return 正常。不得用直接设置文本替代组合期验收。

## 界面验收与恢复

结果与可重复步骤见 [原生 GUI 验收](../../docs/acceptance/native-gpui-20261003.md)。真实服务长回复 3111 字符可显示标题、嵌套列表、代码和表格；Web 到原生窗口可见消息的测量上界为 1802ms。隔离 1000 条历史分页、回到底部与输入已验证；它不代表真实服务器千条 SQL 查询压力测试。

Tokio timer 必须在 `runtime::io(async move { ... })` 内构造；在 GPUI 前台直接调用 `tokio::time::sleep` 会因缺 reactor 崩溃。已通过真实 API 转发代理的 503 故障与 GUI 重试验证修复。发送失败保留在本地消息气泡，重试沿用 requestId；本地草稿尚未持久化。

复测工具（均只监听 loopback）：`node scripts/native-ui-proxy.mjs`（仓库根目录运行，46191 转发真实 API）；`node scripts/native-ui-history-fixture.mjs`（46192 合成只读历史）。以 `OPSTWIN_API` 指定对应地址启动二进制。`target/`、本地 bundle 与证据均忽略，不提交构建产物；bundle 未签名或公证。
