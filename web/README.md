# OpsTwin Advance Web (`web/`)

Vite + React 19 前端，响应式 Web/PWA；未来 macOS / iOS 走独立 API 接入（见 [原生客户端](../docs/spec/native-clients.md)），当前不宣称已交付原生 App。

界面、数据域、路由与恢复见 [Frontend 规范](../docs/spec/frontend.md)；视觉与交互基准见 [Design 规范](../docs/spec/design.md)；中英文界面见 [Settings 中英文设计](../docs/spec/settings-language-design.md)。本页只维护运行命令与硬边界。

## 运行

需要 Node.js 22.19+。命令均在仓库根目录执行：

```sh
npm ci
npm run dev          # Web 127.0.0.1:46100 + API 46110
npm run dev:web      # 仅 Vite，/api 与 /files 代理到 127.0.0.1:46110
npm run build        # tsc --noEmit + vite build → ../dist
```

开发服务绑定 `127.0.0.1:46100` 并 `strictPort`，端口被占用时先核对已有进程，禁止自动换端口。

## 边界

- 连接品牌图标在 `public/brands/`，仅作来源标识；不支持渠道明确显示暂不支持，不伪装授权成功（见 [连接与品牌旅程](../docs/journeys/connections-branding.md)）。
- 收件箱消息展示复用 InboxMessages 与 `message-presentation` 只读适配，不覆盖已保存草稿/判断/审批。
- 浏览器验收使用 ego-browser 单 TaskSpace 独立 Page；并行 Agent 的浏览器动作用 `node scripts/ego-locked.mjs nodejs`。

Inbox 草稿不再自动生成 Summary.pdf／图表，Autonomy 不再提供自动文件设置；手动附件和原有下载能力保留。行为见 [移除回复自动文件](../docs/journeys/remove-automatic-reply-files.md)。

MyGO 完整桌面适配在 `src/desktop/full/`，继承当前HTML与生产组件；构建和验收入口见 [桌面规格](../docs/spec/mygo-desktop.md)。
