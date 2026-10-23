# CyberMe（MyGO）

当前目标为 macOS 完整产品 + 最新 HTML，原三页先导已扩展；完整交付尚须逐项验收，不能由编译或页面数量推定。

固定 MyGO v0.2.15 / Go 1.27.1，当前唯一桌面客户端为 MyGO；GPUI 已于 2026-10-18 退役，Logo 位于 brand/cyberme.svg。入口为 `mygo://localhost/desktop.html`；`index.html` 仅公开视觉资格，`pilot.html` 仅历史先导诊断。

## 运行

- `node --import tsx scripts/mygo-pilot-service.mjs`：公开隔离 API 46310，不导入姊妹数据、不运行后台调度、禁止外发。初次需要模型时显式加 `--reuse-model-config`；配置只在服务端私有文件。
- `node scripts/mygo-build.mjs`：构建并 ad-hoc 签名 `.local/apps/CyberMe QA.app`，独立 QA 状态。
- `node scripts/mygo-desktop-preview.mjs`：公开验收预览 46300，固定同源转发至 46310。
- `node scripts/mygo-build.mjs --workspace`：构建 `.local/apps/CyberMe Workspace.app`，连接现有日常工作区；先启动既有 API 46110。
- `node scripts/mygo-launch.mjs`：启动 46312 本机网关并打开工作区包，网关不复制或创建业务数据库。

## 复验

- `ego-browser nodejs < scripts/mygo-full-browser-e2e.mjs`：使用既有 TaskSpace 1 / p1。
- `node scripts/mygo-full-http-e2e.mjs`：真实隔离 HTTP。
- 实际 App 的系统选择器、Hide/恢复、硬件听写及视觉另验；证据留本项目 output，不能把浏览器结果当作原生通过。

Go 持连接 token；本机 state 0700/0600 + revision CAS + 原子替换。业务改动经 canonical API，草稿与原请求先耐久。完整契约：[桌面规格](../../docs/spec/mygo-desktop.md)、[验收旅程](../../docs/journeys/mygo-full-copy.md)、[85项表](../../docs/acceptance/mygo-full-copy-matrix.md)。历史先导结论保留于 [mygo-pilot](../../docs/journeys/mygo-pilot.md)。

## Installed app automatic startup (2026-10-16)

The workspace build now starts the missing API (46110) and capability gateway (46312) itself, waits for health and reuses existing services. Finder launch does not need `mygo-launch.mjs`. Services survive normal Quit; the next request recovers a stopped service without replaying business POSTs. QA builds retain manual isolated services. This local installation still requires this repository and the absolute Node executable captured at build time. Logs are private under `.local/mygo-runtime/`. See [managed startup journey](../../docs/journeys/mygo-managed-startup.md) for failure boundaries and installed-app evidence. The build script produces an ad-hoc candidate; release signing/notarization must follow for newly built bytes.

## Standalone release (2026-10-16)

Use `node scripts/mygo-build.mjs --standalone` for distribution. It bundles Node, backend, gateway, dependencies and policy/assets under Resources/runtime, and uses `~/Library/Application Support/OpsTwins` for private state. It requires neither the project directory nor system Node at runtime. The older `--workspace` mode remains a development option. One-time migration, signing and actual no-project sandbox acceptance are documented in [standalone journey](../../docs/journeys/mygo-standalone.md). Never include user state in the notarization upload. External configured integrations keep their own authorization and runtime requirements.

## Pi Agent SDK 1.3.0（2026-10-17）

当前使用官方精确1.3.0；standalone包内含SDK及Node。真实模型、业务工具、主动打断、失败与partial恢复，以及重新签名安装证据见 [升级旅程](../../docs/journeys/pi-sdk-upgrade-20261017.md)。升级时须重打包，修改工作区依赖不会自动更新安装版。

## 会话与自动记忆

独立App内嵌生产后端，启动时开启`OPSTWIN_MEMORY_BACKGROUND=1`；Chat的记忆入口读取同一工作区的真实持久状态。安装、真实模型和原生UI证据见[2026-10-17记忆旅程](../../docs/journeys/conversation-memory-20261017.md)。
