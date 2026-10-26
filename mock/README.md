# OpsTwins 产品 Mock

统一入口：**http://127.0.0.1:46400/**。

对话保留主会话、产品评审准备、工作流探索三组公开多轮示例。新发送及引用追问已接入真实模型，结合当前会话历史与精确选文回答；没有外部消息运输。旧默认示例精确升级，人工历史和草稿保留；预置内容在`demo-conversations.js`，最新规格见[真实模型追问](../docs/design/mock-real-chat.md)。

2026-10-17 已接入Inbox Zero的置信度门槛/上下文预算及remend流式Markdown展示；人工稿重新生成保留原稿并提供新候选。源码固定版本与许可见[引入说明](../docs/design/mock-open-source-integration.md)。本地bundle重建：`node scripts/opstwins-mock-vendor.mjs`；定向验收：`scripts/opstwins-mock-open-source-e2e.mjs`。收件箱草稿仍是本地预览；对话已接真实模型，Gmail未接入。

这是当前 MyGO 产品的独立可点击原型，以中文文案为基准。主窗口按客户端默认 **1000×700** 居中，设置窗 **900×640**；大浏览器不再放大，小屏幕按同一桌面比例缩小。首页集中展示 31 个页面缩略图，各页顶部「返回导航」回到同一入口；下拉菜单可以直接跳转。旧设计稿留在 `docs/design/`，界面维护在 `mock/opstwins/`，真实模型文字接口位于 `scripts/lib/opstwins-mock-*.mjs`。

## 启动

在本项目运行：

```sh
node scripts/opstwins-mock-server.mjs
```

服务默认监听本机五位端口46400，提供原型静态资源与精确的 `/api/mock-chat/requests/:id` 文字接口；CSP仅允许同源连接，没有通用API代理。凭据不进入浏览器。已运行时复用，不关闭其他服务。

## 页面入口

路径均附在统一入口后，例如 `/#inbox`。

| 模块 | 深链 |
| --- | --- |
| 对话、收件箱、灵感、任务 | `#chat`、`#inbox`、`#ideas`、`#tasks` |
| 能力与意图（独立 Tab） | `#capabilities`、`#capabilities/intents`、`#capabilities/runs` |
| 搜索、会话记忆、执行记录 | `#search`、`#memory`、`#record` |
| 任务、灵感详情 | `#task-detail`、`#idea-detail` |
| 通用、模型、连接 | `#settings/general`、`#settings/models`、`#settings/connections` |
| 文件访问、身份与记忆 | `#settings/filesystem`、`#settings/identity` |
| 自主权限、消息渠道、设备 | `#settings/autonomy`、`#settings/channels`、`#settings/devices` |
| 帮助、隐私与条款、关于 | `#settings/help`、`#settings/legal`、`#settings/about` |
| 编辑、添加供应商 | `#settings/provider`、`#settings/provider-new` |
| 飞书、微信、Gmail、自定义连接 | `#settings/feishu`、`#settings/wechat`、`#settings/gmail`、`#settings/custom` |
| 知识资料、身份文档、长期记忆 | `#settings/knowledge`、`#settings/soul`、`#settings/memory-document` |
| 飞书 Bot 绑定、操作记录 | `#settings/binding`、`#activity` |

## 迭代方式

- 顶部场景切换：正常、空状态、加载中、失败、未确认、部分完成。用于检查设计反馈，切换场景不执行真实操作。
- 「迭代备注」按页面分别保存；「导出迭代包」下载备注与当前公开示例状态的 JSON。
- 「外观与密度」比较浅色、深色、系统主题，以及紧凑、标准、舒展三种密度；恢复初始 Mock 需经过原型内的明确确认。
- 本地修改位于独立的 `opstwins-product-mock-v1` localStorage 命名空间。会话草稿、回复草稿、任务、设置、已保存文档与备注支持刷新恢复；未保存表单仅在当前页内 RAM 保留，不承诺跨刷新恢复。密码输入不进入本地存储、导出或表单恢复。
- 语音输入及听写设置已移除。模型配置页的测试、连接检测、同步和 OAuth 为本地预览；对话文字发送仍使用现有真实模型接口。

`fidelity.css` 维护本次源样式校准，`assets/product-icons.js` 直接复用现行设计原始SVG符号；产品响应式以 `product` 容器判断逻辑窗口，预览台按实际浏览器判断。`app.js` 管理路由、事件和持久化；`pages.js` 是四个工作页面；`settings.js` 是设置与子页；`data.js` 是公开示例和页面目录；`ui.js` 提供转义及组件；`styles.css` 管理主题、布局和响应式。新增入口同步更新目录、本文与设计规格。

## 浏览器验收

```sh
ego-browser nodejs < scripts/opstwins-mock-browser-e2e.mjs
```

脚本创建一个验收 TaskSpace。继续同一空间时，在脚本前加入 `globalThis.OPSTWIN_MOCK_SPACE=空间编号;`，不要重复创建。Ego CLI 不保证透传 shell 环境变量。脚本只通过本原型明确的重置入口恢复初始示例，保留重复执行结果，不清浏览器其他存储。

产物位于 `output/mock-product-20261017/<运行时间>/`：当前31页截图与 AX、异常场景和三个窄窗尺寸截图、迭代包、断言结果和源码 SHA256（包含 fidelity.css 与原始图标模块）。脚本保留原型页供继续检查；工作完成后由调用者 finish 保留结果页。

设计范围与边界见 [产品 Mock 规格](../docs/design/opstwins-product-mock.md)。Mock 验收不改变真实产品、85 项功能或原生评分的状态。

Inbox紧凑调整：Jev以42px单行保留三项判断，右侧草稿入口明确“重新生成”；保存提示只显示“已保存”，悬停说明本浏览器范围。局部复验：`scripts/opstwins-mock-inbox-compact-e2e.mjs`。

共享组件位于 `opstwins/components/`，复用voice-input标准下拉及通用控件；原生select保留表单语义。较新用户批注要求Chat仅呈现对话消息：收件箱分析卡片及专用跳转入口已移除，Chat不再启动该本地分析预览；历史记录和独立Inbox草稿保留。当前约定见 [纯消息对话](../docs/design/mock-chat-messages-only.md)。规格见 [共享组件和主会话](../docs/design/mock-shared-components-main-inbox.md)。

模型设置迭代：`model-settings.js` / `model-settings.css` 维护供应商配置、独立模型列表获取与渐进测试反馈。支持多个本地示例供应商、精确独立草稿、模型添加/移除、保存与刷新；API Key 即使显示也不进入表单恢复或导出。获取与测试均为无网络的 Mock 预览。定向复验：`scripts/opstwins-mock-model-settings-e2e.mjs`，同目标使用 `globalThis.OPSTWIN_MOCK_SPACE` 续用已有空间；脚本结束恢复运行前的精确 Mock 存储值。规格见 [模型 Mock 迭代](../docs/design/mock-model-settings-20261017.md)。

### 关联演示与引用追问（2026-10-17）

四个收件箱事项、四份灵感方案、六项任务和四份资料，统一围绕范围确认、议程与时间、部署原检查核实、资料索引展开。点击正文中的关联入口可回到精确来源；任务详情有可保存的检查项，深入聊聊复用专用侧会话。

在对话、收件箱消息、灵感方案、任务正文和资料中选中文字，点击“添加到对话”或按 ⌘L。引用显示在输入框上方，保留已有问题；可以查看全文、查看来源、移除，再填写追问发送。也可使用各详情及消息操作栏的引用按钮。最多四段，每段6000字符，超限明确拒绝。引用与问题按会话本地保存；保存失败保留输入，发送失败回滚新增消息。未知/部分完成场景不发送新问题。预置历史仍为公开示例，新回复使用真实模型；未接外部消息发送。

规格：[关联工作区与引用追问](../docs/design/mock-linked-workspace-quotes.md)。复验：`ego-browser nodejs < scripts/opstwins-mock-workspace-quotes-e2e.mjs` 与 `ego-browser nodejs < scripts/opstwins-mock-quote-boundaries-e2e.mjs`；同一目标应设置 `globalThis.OPSTWIN_MOCK_SPACE` 复用已有TaskSpace。脚本使用公开fixture，并在finally恢复原Mock存储，不读取真实业务。

### 真实模型追问

当前本地原型使用 Magpie 的 `deepseek/deepseek-flash` 路由，已验证实际回答。服务端非凭据选择保存在 `.local/mock-chat/model-selection.json`；网关凭据由已安装Magpie客户端从原私有卷读取，只在服务端运行。没有改动正式服务的模型角色或复制Key。此适配器缓冲完整模型回答，页面显示运行状态后展示正文，不伪装流式token。

完整会话历史（含此前引用）、本轮精确引用和当前问题一起提交。浏览器请求先落盘，服务端私有记录也先落盘；刷新只GET原ID，同ID不同内容409。失败不返回固定模板，未知/部分完成可回查或明确保留记录继续；没有业务工具。服务依赖现有 `/Users/steve/Projects/skills/magpie/scripts/magpie.py`、SSH别名与受信网关证书。

规格及真实/故障证据：[真实模型追问](../docs/design/mock-real-chat.md)。真实复验脚本会产生少量授权推理调用，只使用随机公开标记；受控故障和重启脚本分别记录，不作为实际模型成功证据。旧固定回复验收是历史冻结结果，不认证当前真实链路。

历史听写批注修复（已被最新移除决定替代）：当时页面只保留识别语言、直接发送开关与预览入口；修改后显示取消/保存。定向验收 `scripts/opstwins-mock-dictation-e2e.mjs` 覆盖保存、取消、刷新、真实本地存储失败保稿及布局，产物位于 `output/mock-dictation-fix-20261017/`。此预览不申请麦克风；测试结束恢复原始本地存储。
# 任务直接连接（2026-10-17）

46400任务详情现有真实 Codex app-server / Claude Code 执行区，不再仅保存预览。使用本机已安装CLI与现有登录，不使用Herdr；原生历史限定本项目，选择旧会话后通过native fork继续。脚本仍为 `node scripts/opstwins-mock-server.mjs`；已安装依赖中增加精确Claude Agent SDK。可由服务端环境显式指定 `OPSTWIN_CODEX_BIN` / `OPSTWIN_CLAUDE_BIN`，浏览器不能指定任意程序或cwd。

执行记录私有保存于 `.local/task-agents/requests/`；运行独立服务做验收时可用 `OPSTWIN_TASK_AGENT_DIR` 指向本项目.local下新目录，每个目录只允许一个进程owner。凭据继续由原生CLI管理；HTTP不返回邮箱/令牌/密钥。

默认只读，修改权限与单次模型可见；Claude本次界面模型为实测可用的 `claude-opus-5-5`，没有改全局默认。失败、unknown、partial保留原请求，刷新只GET；不要把模型执行结束等同业务任务完成。验证及真实/未验范围见 [直接接入旅程](../docs/journeys/task-agent-direct-20261017.md)。

2026-10-17 最新决定：当前原型移除语音输入、波形和听写设置；此前听写验收仅为历史记录。旧听写深链返回通用设置，文字草稿和资料引用保留。见 [移除语音输入](../docs/design/mock-remove-voice-20261017.md)。

## 任务/成果卡片与 Jev 选项（2026-10-23）

从预览台右侧「任务与选项」或 [直接预览](http://127.0.0.1:46400/?demo=work-cards#chat) 进入「评审准备 · 示例」侧会话。任务可展开状态，成果可预览与下载 Markdown，三项选择附来源；选择后旧面板失效。新消息直接停止旧演示回复，不排队；刷新保留成果，运行中刷新显示已停止并可明确继续。

该会话全部为本地公开演示，不调用真实 Jev、模型或任务执行器；普通聊天的既有真实接口保持原样。没有恢复 Inbox 分析卡片。实现为 `work-cards.js` / `work-cards.css`，复验 `ego-browser nodejs < scripts/opstwins-mock-work-cards-e2e.mjs`（同目标设置 `globalThis.OPSTWIN_MOCK_SPACE` 复用空间）。规格：[Mock 任务与选项](../docs/design/mock-work-cards-20261023.md)。

## 对话对齐 Mock v2（2026-10-25）

独立预览：**http://127.0.0.1:46424/**，入口 `mock/cyberme-chat-alignment-v2/index.html`。助手气泡左边缘、用户气泡右边缘分别与输入框两端对齐，单行输入框46px，多行自动增高。运行 `node scripts/cyberme-chat-alignment-mock.mjs`；只在内存演示输入与附件名称，无真实模型、外发或上传。原产品Mock与正式客户端保持原样。
