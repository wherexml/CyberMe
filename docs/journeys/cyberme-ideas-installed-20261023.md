# CyberMe 灵感本机更新与验收（2026-10-23）

## 范围与实施前失败面

本次用户明确要求将“深入聊聊先填可编辑草稿”和“48枚 SVG 由 AI 选择”更新到本机 CyberMe，保留现有数据。检查：点击误发、重复打开覆盖编辑、正常重启丢草稿、模型 key 未保存或资源漏包、旧工作区数据丢失、并行更新覆盖、签名/公证与实际运行包不一致。

安装候选基于已签名 0.1.3 能力与意图候选及冻结资源，版本 0.1.4；只移植本任务前端与后端差异。未打包其他正在开发的 Chat 工作卡片。构建器 `scripts/cyberme-ideas-candidate.py`，冻结资源/候选在 `.local/`，源码与每个资源摘要记录于 `output/cyberme-ideas-installed-20261023/candidate.json`。本地候选版本独立于当前未发布源码 package.json，未擅自更改整仓版本。

## 数据保护

安装前通过 SQLite backup API 建立私有一致性备份，并保存本机状态于 `.local/cyberme-ideas-preservation-20261023/`（目录0700、文件0600）。公开证据只保留行摘要、数量和设置摘要，不保存私有正文/凭据。更新器只替换 App，旧 App 与 transaction receipt 保留。原有行、主会话、设置与测试前非空草稿分别核验；正常后台新增记录不算原数据丢失。

## 安装与实际验收

已完成 0.1.5 安装版限定验收。候选 runtime 与0.1.3差异精确为 index.ts、ideas-background.ts、agent-capabilities.ts、types.ts、idea-icons.ts、idea-icon-catalog.json。48个SVG均嵌入。不会以此前浏览器21项或编译通过宣称安装版GUI通过。

证据目录：`output/cyberme-ideas-installed-20261023/`。

### 0.1.4 实际失败与后续修复

0.1.4 Apple Accepted，签名、票据与 Gatekeeper 通过；原生更新回执成功，进程与磁盘可执行摘要一致。但实际 GUI 仍显示灯泡，深入聊聊仍走旧自动发送路径；新草稿 key 没有写入。失败截图保留为 `native-icons-fail.png`、`native-stale-script-fail.png`。后端真实模型已选择 deploy/contract/meeting，原始输出与落库 key 一致（`real-model-choices.json`），不能据此判 GUI 成功。

定位到旧版本共用固定 `/desktop.html` 与静态资源地址。0.1.5 将全部内置资源的内容摘要作为 URL 路径前缀，静态资源响应 no-store；同一 origin 保留本机状态，API 路径和安全策略不变，不清空用户数据或 WebKit 存储。短暂考虑的 data URI 图标方案未提交公证、未安装，随后撤回；48枚原 SVG 保持原样。

本机自动刷新先于第一次手动点击启动，首次点击复用了正在进行的自动运行；完成后再次明确点击生成三项公开验收建议，服务端 trigger=manual，真实模型输出三种对应 key。自动刷新正常更新过一项原灵感，旧版本保留在 idea_history；原始消息、草稿、回执未变。


### 0.1.5 原生最终结果

安装版本 **0.1.5 / 1792759047854**，目标 `/Applications/CyberMe.app`。Apple 公证 `693eb893-3e14-4c0a-9e19-4b8f7f54839f` Accepted；安装版 codesign、stapler、Gatekeeper 均通过，可执行 SHA256 与候选一致：`7c68c12c98a6e5d5eaaec757fba4148e9588a8d57eef357628e4a870b17cb67a`。安装回执为 `final-install-receipt.json`，旧包保留于回执指定的 `.local/updates/backups/`。首次尝试被后台同步子进程门控阻止（`runtime_child_busy`），没有强杀或绕过门控，后续正常更新成功。

| 实际操作 | 结果 | 证据 |
| --- | --- | --- |
| 打开安装版灵感页 | 会议为清单夹、合同为证书文档、部署为火箭，48枚资源已嵌入 | `native-icons-pass.png` |
| 真实模型生成并保存 | deepseek-flash 原始输出与三项保存 key 分别为 meeting / contract / deploy | `real-model-choices.json` |
| 点击深入聊聊 | 新侧会话带入标题、描述、步骤；无自动消息或请求 | `draft-edited.json` |
| 在草稿里补充文字 | 保留原文及补充内容，messages=0、requests=0 | `native-editable-draft.png` |
| 返回灵感再次打开 | 同一侧会话、148字草稿不覆盖，仍零请求 | `draft-reopened.json` |
| 正常退出、进程结束、重新启动 | 同一草稿、补充内容恢复，仍零请求 | `draft-restarted.json`、`native-draft-restarted.png` |
| 明确点击发送 | 仅一条 durable request、两条消息；真实 Agent succeeded | `send-completed.json`、`native-explicit-send.png` |
| 来源传递 | userMessage.contextIds 与 load_context 均精确为公开测试笔记；readOnly=true | `explicit-send-receipt.json` |
| 重启后再看图标 | 三种图形与保存 key 保持一致 | `native-icons-restarted.png` |
| 保留用户数据 | 原12700条实体均仍存在；原消息正文、Inbox草稿/候选/回执、主会话、设置、原非空输入草稿检查通过 | `final.json` |

公开合成测试笔记与4条建议已通过生产 API 可恢复删除；两条本次测试侧会话已归档（含0.1.4失败会话），原消息和运行回执保留。清理仅限本次精确ID，见 `public-cleanup.json`、`public-conversations-archived.json`。未覆盖原数据库或清空用户数据；正常后台同步更新的来源元数据及原灵感历史变化另有记录。

复核：`node scripts/cyberme-ideas-installed-evidence.mjs recheck` 可再次只读验证安装版本及原数据保护。原生复现时选择一条建议→深入聊聊→补充文字→返回再打开→正常重启，点击发送前应没有发送请求；不要用保存的旧自动发送失败回执代替新草稿行为。内容摘要资源前缀已在实际窗口 URL 核对，与 `final-resource-address.json` 一致。

范围仅为本次两项改动和更新缓存修复；不代表完整产品85项验收或独立评分通过。无线上发布、未提交无关工作区修改。
