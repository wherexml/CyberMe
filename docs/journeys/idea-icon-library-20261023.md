# 灵感语义图标库（2026-10-23）

用户要求扩充现有 Mock 风格 SVG，由生成灵感的 AI 选择图标。本次替代“缺省按 ID 随机挑选”为正常生成路径；稳定回退仅用于旧数据和无效选择。

## 实现前失败面

- AI 返回不存在的 key、外部 URL、SVG/脚本或路径穿越；前端误作图片路径。
- 后台刷新与手动 think 链路遗漏其一，iconKey 被解析或持久化丢弃。
- 更新建议时模型未选图标，覆盖已有有效图标；刷新/重启改变图标。
- 服务端目录、HTML、Mock、构建包资源不一致或漏打包。
- 图形只有颜色变化，语义不可辨、24px 细节糊成一团。

## 方案

扩到48枚，保留已有12枚；统一48×48、透明背景、低饱和渐变、轻微厚度和落影。固定目录向模型给出 key、用途与关键词；只返回 iconKey，禁止模型生成 SVG/URL。服务端白名单校验，有效选择持久化；缺失/无效先保留旧有效 key，再稳定回退。不为图标额外启动模型调用。

## 验收结果

- 真实配置模型、隔离公开资料：3项通过。模型对部署与回滚、合同条款、会议安排分别选择 `deploy`、`contract`、`meeting`，持久化后回读一致；未修改正式工作区或主会话。
- 受控模型通过真实生成/持久化模块：8项通过。合法选择、未知路径/URL/非字符串、缺失key保留旧图标、每轮仅一次模型调用均覆盖。
- ego-browser 图板：6项通过。48种SVG共96个大小预览全部加载；56/24px实测、指定key优先、非法值白名单回退、配色切换和刷新稳定。
- 48份图标在源目录、Mock及桌面资源复制目录字节一致；`idea-icon-library.mjs --check`、本次模块依赖图的定向TypeScript检查、Vite桌面资源构建和 `git diff --check` 通过。
- 当前整仓 typecheck 被其他正在变更的缺失模块 `server/src/ideas-console.ts`、`server/src/executors/artifact-import.ts` 阻塞；完整资源打包在缺失 `web/src/desktop/full/ideas-console.css` 处停止。没有创建占位模块或回滚其他修改；不能把48枚图标复制通过当成整包完成。
- 上述缺失模块随后由其他正在进行的工作补齐；复跑整仓 TypeScript 检查和完整桌面资源打包均通过（`full-typecheck.log`、`assets.json`）。首次失败作为历史记录保留，不再是当前阻塞。
- 手动think真实生产HTTP追加4项通过：一次模型调用收到目录，合法/缺失/无效key落库，GET回读，PATCH非法值保留原值。上游为受控模型。后台refresh通过真实配置模型完整生成与落库验证；安装版原生GUI未运行，未替换安装包。
- [总览图](../../output/idea-icon-library-20261023/contact-sheet.png)为SVG源直接栅格化预览，不是浏览器截图或独立视觉评分。图片设计遵循已读取的imagegen技能中“现有SVG库直接扩展”的规则，没有使用位图生成或描摹。

证据位于 `output/idea-icon-library-20261023/`：`real-model.json`、`controlled-model.json`、`browser.json`、`gallery.snapshot.txt`、`assets.json`、`targeted-typecheck.log`、`full-typecheck.log`、`vite.log`、`think-http.json`。

复验命令：

```sh
node scripts/idea-icon-library.mjs --check
node --import tsx scripts/idea-icon-ai-e2e.mjs
node --import tsx scripts/idea-icon-ai-e2e.mjs --real
node scripts/idea-icon-preview-service.mjs
# 同一TaskSpace，页面指向46680
# ego-browser nodejs < scripts/idea-icon-library-browser-e2e.mjs
```

受控模型占46681，图板46680，均仅监听本机。真实模型仅读取已有服务端配置，不复制或输出凭据。


## 后续本机安装验收

用户随后明确授权安装。CyberMe 0.1.5（1792759047854）已签名、公证并更新到本机；实际原生草稿编辑/重复打开/正常重启/明确发送，以及真实模型选图和重启显示均通过。0.1.4旧缓存失败原件保留。安装、数据保护与限定证据见 [本机更新旅程](cyberme-ideas-installed-20261023.md)。以上早期“未安装”描述仅指原开发阶段。
