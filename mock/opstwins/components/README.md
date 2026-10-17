# OpsTwins共享Mock组件

本层从 `/Users/steve/Projects/voice-input/mock/` 复用本用户项目组件，源目录只读；本项目独立维护副本。没有复制业务数据、配置、凭据或语音服务。

| 控件 | 来源与本项目适配 |
| --- | --- |
| 下拉 | `components/select.js` / `select.css` 原样复制，保留分组、选中勾、键盘/关闭/焦点行为；`adapter.js`让原生select继续参与FormData和原change保存逻辑 |
| 输入、开关 | `auto-send.html`语义token与控件样式：40px输入、8px圆角、36×22开关、16px复选；适配现有原生input/checkbox语义 |
| 按钮 | 来源普通/主要/安静按钮的中性表面、边线、8px圆角与hover/disabled；不更改业务data-action |
| 分段、弹窗、提示 | 同源分段灰底/选中阴影，16px弹窗和中性toast；原关闭、保稿与确认行为保留 |

`common.css` 将来源语义token映射到现有浅/深色主题。独立1000×700产品预览缩小时，adapter调整portalled菜单尺寸、坐标和边界，不修改上游选择器。原生select只隐藏显示，不移除name、value、disabled或表单关系。每次重绘先关闭旧菜单，选择通过vm-select-change映射原select的change。

已接入所有现有下拉：顶部页面导航、通用主题/语言、当前模型/供应商、供应商协议、采集窗口、连接类型/权限、六类自主权限及听写语言。新增select通过render中的upgradeSelects自动接入；不得为绕过权限使用自定义选项写状态。

入口：`mock/README.md`；设计：[共享组件和主会话](../../../docs/design/mock-shared-components-main-inbox.md)。复验脚本：`scripts/opstwins-mock-components-main-e2e.mjs` 和完整Mock E2E。复制一致性摘要位于本项目忽略目录 `output/mock-components-main-20261017/component-provenance.json`。
