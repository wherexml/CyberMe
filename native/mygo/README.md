# OpsTwins MyGO

当前目标为 macOS 完整产品 + 最新 HTML，原三页先导已扩展；完整交付尚须逐项验收，不能由编译或页面数量推定。

固定 MyGO v0.2.15 / Go 1.27.1，保留 GPUI 与旧先导 App。入口为 `mygo://localhost/desktop.html`；`index.html` 仅公开视觉资格，`pilot.html` 仅历史先导诊断。

## 运行

- `node --import tsx scripts/mygo-pilot-service.mjs`：公开隔离 API 46310，不导入姊妹数据、不运行后台调度、禁止外发。初次需要模型时显式加 `--reuse-model-config`；配置只在服务端私有文件。
- `node scripts/mygo-build.mjs`：构建并 ad-hoc 签名 `.local/apps/OpsTwins MyGO QA.app`，独立 QA 状态。
- `node scripts/mygo-desktop-preview.mjs`：公开验收预览 46300，固定同源转发至 46310。
- `node scripts/mygo-build.mjs --workspace`：构建 `.local/apps/OpsTwins MyGO.app`，连接现有日常工作区；先启动既有 API 46110。
- `node scripts/mygo-launch.mjs`：启动 46312 本机网关并打开工作区包，网关不复制或创建业务数据库。

## 复验

- `ego-browser nodejs < scripts/mygo-full-browser-e2e.mjs`：使用既有 TaskSpace 1 / p1。
- `node scripts/mygo-full-http-e2e.mjs`：真实隔离 HTTP。
- 实际 App 的系统选择器、Hide/恢复、硬件听写及视觉另验；证据留本项目 output，不能把浏览器结果当作原生通过。

Go 持连接 token；本机 state 0700/0600 + revision CAS + 原子替换。业务改动经 canonical API，草稿与原请求先耐久。完整契约：[桌面规格](../../docs/spec/mygo-desktop.md)、[验收旅程](../../docs/journeys/mygo-full-copy.md)、[85项表](../../docs/acceptance/mygo-full-copy-matrix.md)。历史先导结论保留于 [mygo-pilot](../../docs/journeys/mygo-pilot.md)。

## Installed app automatic startup (2026-10-16)

The workspace build now starts the missing API (46110) and capability gateway (46312) itself, waits for health and reuses existing services. Finder launch does not need `mygo-launch.mjs`. Services survive normal Quit; the next request recovers a stopped service without replaying business POSTs. QA builds retain manual isolated services. This local installation still requires this repository and the absolute Node executable captured at build time. Logs are private under `.local/mygo-runtime/`. See [managed startup journey](../../docs/journeys/mygo-managed-startup.md) for failure boundaries and installed-app evidence. The build script produces an ad-hoc candidate; release signing/notarization must follow for newly built bytes.
