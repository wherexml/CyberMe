# CyberMe 深入聊聊草稿与 AI 图标提交记录（2026-10-23）

## 行为与范围

“深入聊聊”从自动执行改为打开可编辑的侧会话草稿，带入建议标题、描述、步骤；同一建议复用会话，补充内容不会被再次打开覆盖。资料 ID 与附件 ID 保存至明确发送；切换页面或创建响应迟到不抢回当前页面，本机持久化失败不继续创建/发送。

新增36枚原创 SVG，加上原有12枚共48枚。模型在生成建议的同一次调用中选择白名单 iconKey；后台刷新与手动 think 均保存并回读该字段，无效/缺失选择保留旧有效图标或稳定回退。HTML、Mock、服务端目录、构建资源同步；不接受模型提供的 SVG、外部图片地址或任意路径。

原生资源采用全部内置文件的内容摘要前缀及 no-store，修复安装新版本后 WebKit 仍用旧脚本的问题；不清空 WebKit、本机草稿或数据库，保留 bundle identifier 与原数据目录。

## 已安装包与本机验收

- 安装版：CyberMe **0.1.5 / 1792759047854**，路径 `/Applications/CyberMe.app`。
- 安装版与候选可执行摘要一致；codesign、stapler、Gatekeeper 均通过，Apple 公证 Accepted。包摘要及签名检查见本机旅程与证据清单。
- 实际点击深入聊聊、补充文字、返回重开、正常退出并重启：同一侧会话保留148字草稿，发送前 messages=0、requests=0。
- 明确点击发送后：仅1个请求、2条消息，真实 Agent succeeded，精确 load_context 读取所选公开笔记，补充文字进入实际请求；无外发。
- 真实模型为部署/合同/会议分别选择 deploy/contract/meeting；实际原生截图显示三种不同 SVG，重启后保持一致。
- 原12700条实体均保留；原消息正文、Inbox 草稿/候选/回执、主会话、设置与原非空输入草稿核验通过。正常后台同步元数据和原灵感历史变化单列，不宣称数据库逐字节不变。
- 公开合成测试笔记及4条建议可恢复删除；2条测试侧会话已归档，运行记录保留。数据库一致性备份、状态备份和旧 App 留在私有本机目录。
- 0.1.4实际出现“图标仍为灯泡、深入聊聊仍自动发送”，原失败证据保留；0.1.5修复后重新验收通过。首次0.1.5安装被后台子进程门控阻止，未强杀或绕过，随后更新成功。

详情：[本机更新验收](../journeys/cyberme-ideas-installed-20261023.md)、[草稿旅程](../journeys/idea-discussion-draft-20261023.md)、[图标旅程](../journeys/idea-icon-library-20261023.md)。脱敏摘要及截图摘要：[证据索引](cyberme-ideas-20261023-evidence.json)。原截图/日志在忽略目录 `output/cyberme-ideas-installed-20261023/`，私有备份不入库。

## 提交快照检查

本次整理将共享文件中的相关片段应用到 HEAD 的独立导出快照，未新建分支或 Git worktree，未重装或重启本机应用。快照通过：

- `npm run typecheck`。
- `node scripts/idea-icon-library.mjs --check`：48枚、89份派生文件一致。
- `node --import tsx scripts/idea-icon-ai-e2e.mjs`：受控模型+生产生成持久化链路8项。
- `node --import tsx scripts/idea-icon-think-http-e2e.mjs`：真实HTTP+受控模型4项。
- Vite桌面构建与 `node scripts/idea-icon-assets-e2e.mjs`：整包完成、48份SVG与源/Mock一致。
- 本次脚本语法及 `git diff --check`。

这些检查认证本次独立提交快照；上述原生验收认证已安装0.1.5冻结包。两者不等同于完整产品85项验收，也不宣称独立视觉评分通过。

## 与其他任务的边界

仅提交草稿流程、图标库/选择链路、缓存修复、对应构建复制与验收脚本/文档。共享 workspace/runtime/main/index/Mock/build 文件逐段提取；refinement.js 仅提交本次讨论入口适配，其余 v17 内容保留在工作区。无关窗口、听写、微信、Inbox、任务执行、工作卡片、模型设置与版本号修改均未纳入。

其他任务已暂存的 interface-labels.js、interface-strings.json 和 mygo-full-assets.mjs 本地化片段保留；私有配置、业务数据、输出目录及安装包不提交。本次仅本地 Git 提交，不推送远端。
