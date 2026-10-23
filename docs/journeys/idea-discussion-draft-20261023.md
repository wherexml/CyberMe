# 灵感讨论草稿与图标（2026-10-23）

本次用户要求覆盖旧的“深入聊聊自动执行”行为。MyGO/CyberMe 与现有 Mock 点击后先带入标题、描述和步骤，用户可编辑补充，明确发送后才请求模型。关联资料保留精确 ID；不扩大执行授权。重复打开同一建议保留已有草稿，不创建重复会话。

## 实现前失败面

- 点击讨论即 POST Chat、调用模型或产生伪造的助手回复。
- 切换覆盖原会话草稿；连续点击建立重复会话；迟到创建响应劫持用户导航。
- 刷新丢标题/描述/步骤或关联来源；发送丢 contextIds/attachmentIds。
- 本机保存失败仍发送；创建失败无法恢复；编辑后再次打开被初始建议覆盖。
- 图标缺包回退为同一灯泡，或者每次刷新/筛选随机变化。

## 验收

使用隔离公开数据、实际产品 HTML 与生产 HTTP 路由；浏览器点击/编辑/刷新/发送，记录零自动发送与明确发送的精确资料 ID。图片复用已有 SVG，不生成新图片。真实安装 App 与真实上游模型不由本地浏览器验收代替。

## 本次结果

- 产品 HTML + 生产 HTTP：11 项通过，包含零自动发送、完整草稿、编辑刷新恢复、同建议会话复用、主会话保稿、精确来源、显式发送成功及刷新不重发。上游为本地受控模型。
- 故障恢复：4 项通过，包含本机保存失败不发送、迟到创建不抢页面、重新进入复用原会话、恢复过程零 Chat POST。
- 现有 Mock：2 项通过，无自动助手回复，编辑刷新后重开保留。
- Vite 桌面资源构建、TypeScript typecheck、git diff --check 通过。
- 原始失败保留：首轮截图 API 超时；第二轮样例缺少 public-source，生产后端正确拒绝上下文。补齐公开 fixture 后发送成功。截图第二次仍超时，实际截图视觉评审未完成；图片加载、尺寸属性和图标差异由浏览器 DOM 确认，不冒充独立视觉评分。
- 本次未替换正在运行的客户端、未发布；原生安装包 GUI 与完整产品评分 NOT_RUN。

证据：`output/idea-discussion-20261023/{browser.json,recovery.json,mock.json,icons.snapshot.txt,editable-draft.snapshot.txt,typecheck.log}`；旧失败在同目录独立留存。

复验：先在全新隔离浏览器来源/五位端口启动 `node --import tsx scripts/idea-discussion-draft-service.mjs`（默认46672/46673；不要占用已有服务），再使用同一 ego TaskSpace 执行 `scripts/idea-discussion-draft-browser-e2e.mjs` 与 `scripts/idea-discussion-recovery-browser-e2e.mjs`。资产由 `vite build --config web/mygo.vite.config.ts --outDir ../.local/idea-discussion-assets` 和 `node scripts/idea-discussion-prepare-assets.mjs` 生成。脚本只使用公开 fixture，不读取生产配置。

独立复核状态：`codeagent-wrapper --backend claude --model haiku` smoke 返回成功；本次只读复核约 419 秒仍未给出结论，已中断，原始输出保留 `haiku-review.json`。wrapper 的 success/exitCode 不代表审查通过；独立评分 NOT_RUN。


## 后续本机安装验收

用户随后明确授权安装。CyberMe 0.1.5（1792759047854）已签名、公证并更新到本机；实际原生草稿编辑/重复打开/正常重启/明确发送，以及真实模型选图和重启显示均通过。0.1.4旧缓存失败原件保留。安装、数据保护与限定证据见 [本机更新旅程](cyberme-ideas-installed-20261023.md)。以上早期“未安装”描述仅指原开发阶段。
