# 验证与公开范围

2026-10-23 灵感后台：类型检查通过；隔离真实产品 HTTP 8 项、浏览器交互 9 项通过。涵盖精确关联的 active 待办、缺失来源/运行、partial、工具步骤、分页、无业务写入、HTML 安全呈现、失败重试和迟到请求隔离。

2026-10-24 灵感主对话提醒（[规格](ideas-chat.md)）：类型检查通过；源码与冻结安装候选包各 27 项 HTTP E2E、真实模型 5 项、Chrome 浏览器 6 项通过。已通过原生更新入口安装本机 0.1.8，实测提醒展示、打开对应详情与示例删除后的撤回；6 项原数据保留检查通过。证据见本机忽略目录 `output/mygo-ideas-chat-20261024/REPORT.md`。原生截图保存在私有目录；未覆盖超大历史分页压力和全部外观。`invalid_evidence` 未改动，生成失败仍可能延迟提醒恢复。本次是 Developer ID 签名本机更新，未新公证或互联网发布。

复现入口：先准备桌面静态资源，再运行 `node --import tsx scripts/ideas-console-service.mjs`；执行 `node scripts/ideas-console-http-e2e.mjs`，并通过 ego-browser 运行 `scripts/ideas-console-browser-e2e.mjs`。fixture 使用 46760/46761，输出保留在忽略的 `output/ideas-console-20261023/`。

浏览器截图接口曾连续超时，不能把页面结构验收当成视觉截图通过。随后实际原生 0.1.3 截图发现通用 dialog 样式污染；已在源码修正，并通过 9 项浏览器交互复验及标题、按钮、搜索框和列表对齐的 DOM 几何检查。原生失败图仍保留，不以浏览器结果覆盖。

生产只读接口验证通过：能力目录、意图详情和关联运行均可读取，验收产物只保留数量和状态。本次观察面板未触发真实模型或外发消息。

0.1.3 首版已通过 Apple 公证并经应用更新按钮安装。随后并行任务将本机升级为 0.1.4，继续准备 0.1.5 灵感图标包；本次停止安装/发布旧候选，避免覆盖并行功能。最终布局修复须合入共同候选后重新进行原生截图验收。互联网发布源仍为已发布的 0.1.2，未将本次未合并候选发布为最新版。

公开历史已移除内部文档、运行记录、截图和业务链接；凭据、用户数据与本机私有备份不在仓库内。秘密扫描仅余测试脚本中幂等键字符串的误报，已按实际代码核对。

清理后的源码公开于 `wherexml/CyberMe`，原仓库保留私有；匿名访问验证新源码可读，旧私有提交和内部文档不可从新仓库访问。当前未配置 GitHub Actions，类型检查和上述验收为本地执行。

2026-11-05 注意力投递（[规格](attention-delivery.md)）：第一轮源码由协调方隔离通过类型检查和 58 项 HTTP 检查；后续汇总复验通过 73 项投递检查和 19 项重启检查。命令与隔离范围见 [2026-11-06 提交说明](changes/2026-11-06-v6.md)。

2026-11-06 持续单一 Agent 会话（[规格](agent-session.md)）：本机类型检查通过；`scripts/agent-session-http-e2e.mjs` 55/55（46971/46972，受控模型、真实 API 子进程与 SQLite，含崩溃恢复及持久化失败注入）；`scripts/agent-session-real-e2e.mjs` 30/30（46916，已配置的真实模型、隔离合成数据）；执行回归 `scripts/agent-execution-http-e2e.mjs` 52/52（46879–46881，受控模型、真实进程和 HTTP）。最终失败审计调整由受控 HTTP 再验，真实模型验证的是此前相同成功路径。未构建/安装桌面包、未进行安装版验收，未提交或推送。

同日安装补验：签名构建 `1793979716153` 已安装到本机。原生 UI、原会话、原选定事项及配置真实模型四轮连续对话通过，包含第二次应用/API/网关重启后的省略指代追问；19 项元数据检查通过。前三轮复用同一实例，重启恢复同一逻辑 ID。没有业务写工具调用、没有外发。证据 `output/agent-session-20261106/installed/` 保持私有；未新公证、未公开发布。


2026-11-14 模块回归：本机隔离源码完成 119 项可逐条对应的细化验收、33 组 HTTP/进程 E2E；最终证据中 1390 条去重断言通过，未新增单元测试。修复来源不可读及原引用消失被误判为历史证据、导致重新核对后不能原位恢复的两处分类问题；移除空聊天副标题，并更新与现行投递、持续会话和阶段预算不一致的 E2E 夹具。源码类型检查与 V6 构建通过；浏览器包含洞察、任务、记忆、设置、连接目录、技能和新会话，以及中英文图示失败页脚。精确矩阵、原始失败/复验结果、SHA-256、截图/URL 和复跑入口在本机忽略目录 `output/module-sweep-20261114/`。模型/CLI/OAuth 使用受控响应；S18 只读复制安装版缓存后在隔离库验证投影，其他业务测试使用合成数据。没有更换安装包、真实外发、提交、推送或部署。

## 2026-11-18 提交复验

- Web 与 V6 源码构建及 MyGO Go 编译通过。受控模型和合成数据的 [模型设置](v6-model-settings.md)浏览器 27 项通过，包含旧角色保存边界、并发重读与丢响应回查。供应商目录读取和批量探测另通过 HTTP 25 项、浏览器 16 项。
- HTTP 与进程检查通过：`scripts/follow-up-http-e2e.mjs` 198 项，`scripts/follow-up-adapters-http-e2e.mjs` 40 项，`scripts/global-memory-http-e2e.mjs` 27 项，`scripts/insight-reliability-http-e2e.mjs` 60 项，`scripts/insight-delivery-recovery-e2e.mjs` 39 项，`scripts/v6-connections-gmail-e2e.mjs` 27 项。从根目录用 `node --import tsx <脚本>` 运行。
- 早期 `scripts/insight-recovery-http-e2e.mjs` 的主会话提醒断言使用未补图的样例。该断言未通过。当前投递规则的补图、发布和撤回由 `scripts/insight-delivery-recovery-e2e.mjs` 覆盖。
- [官网](../../website/README.md)在线 HTTP 14 项、Chromium 16 项通过。Cloudflare Pages 项目采用 Direct Upload。GitHub 源码仓库无 Actions 工作流。本轮证据放在本机忽略的 `output/`，范围为隔离源码、Go 编译与线上静态站点。
