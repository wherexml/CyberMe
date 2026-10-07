# OpsTwins MyGO 先导

固定 MyGO v0.2.15 / Go 1.27.1。独立 bundle `com.opstwins.mygo.preview`，不覆盖 GPUI。

- `node scripts/mygo-build.mjs`：在仓库根目录运行，白名单投影公开HTML，编译并ad-hoc签名至 `.local/apps/OpsTwins MyGO Preview.app`。
- `node --import tsx scripts/mygo-pilot-service.mjs`：46310生产API隔离数据服务；无后台任务，禁止外发路由。
- 如需复用已有模型，使用该命令的 `--reuse-model-config`；仅初次将模型配置留在服务端 `.local/mygo-pilot-public-v2/runtime/config.json`，不输出凭据、不复制授权profile。
- `mygo://localhost/`为公开视觉资格页；`/pilot.html`为逐步接入的生产组件入口。

`.local/mygo-pilot-public-v2/`目录0700，连接token和状态0600。Go桥不接受自选服务器、任意HTTP路径或任意文件路径。草稿与请求先原子落盘，冲突用revision拒绝；本地失败不能发送。所有原型快照/capability禁止打包。

当前能力与未完成项以 `docs/journeys/mygo-pilot.md` 为准；不将资格页、编译或HTTP视为三页/85项完成。

- `node_modules/.bin/vite --config web/mygo.vite.config.ts`：46300 `/pilot.html` 同源公开只读布局预览。
- `node scripts/mygo-pilot-http-e2e.mjs`：服务就绪后复验8项真实HTTP门禁和草稿冲突，证据写 `output/mygo-1007/http-*.json`。

详见 [正式规格](../../docs/spec/mygo-pilot.md)。启动先导后可用 Finder 打开候选App。当前服务需单独运行，未提供发行版后台生命周期管理。

- `node scripts/mygo-preview-browser-e2e.mjs 1`：在本目标既有ego TaskSpace 1复验公开预览；其他会话请传自己的既有space ID。不创建新空间，不计原生GUI。
