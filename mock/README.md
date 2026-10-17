# OpsTwins 产品 Mock

统一入口：**http://127.0.0.1:46400/**。

这是当前 MyGO 产品的独立可点击原型，以中文文案为基准。首页集中展示 32 个页面缩略图，各页顶部「返回导航」回到同一入口；下拉菜单可以直接跳转。旧设计稿留在 `docs/design/`，本次迭代只维护 `mock/opstwins/`。

## 启动

在本项目运行：

```sh
node scripts/opstwins-mock-server.mjs
```

服务固定监听本机五位端口 46400，只提供本 Mock 的静态资源。如果已运行，直接复用；不要关闭占用端口的其他服务。没有 API 代理；CSP 禁止 fetch、XHR、WebSocket 连接。

## 页面入口

路径均附在统一入口后，例如 `/#inbox`。

| 模块 | 深链 |
| --- | --- |
| 对话、收件箱、灵感、任务 | `#chat`、`#inbox`、`#ideas`、`#tasks` |
| 搜索、会话记忆、执行记录 | `#search`、`#memory`、`#record` |
| 任务、灵感详情 | `#task-detail`、`#idea-detail` |
| 通用、模型、连接 | `#settings/general`、`#settings/models`、`#settings/connections` |
| 文件访问、听写、身份与记忆 | `#settings/filesystem`、`#settings/dictation`、`#settings/identity` |
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
- 听写只预览波形及示例转写，不申请麦克风。发送、模型测试、连接检测、同步和 OAuth 均有明确预览说明，不会调用真实模型、发信或读取私人资料。

`app.js` 管理路由、事件和持久化；`pages.js` 是四个工作页面；`settings.js` 是设置与子页；`data.js` 是公开示例和页面目录；`ui.js` 提供转义及组件；`styles.css` 管理主题、布局和响应式。新增入口同步更新目录、本文与设计规格。

## 浏览器验收

```sh
ego-browser nodejs < scripts/opstwins-mock-browser-e2e.mjs
```

脚本创建一个验收 TaskSpace。继续同一空间时，在脚本前加入 `globalThis.OPSTWIN_MOCK_SPACE=空间编号;`，不要重复创建。Ego CLI 不保证透传 shell 环境变量。脚本只通过本原型明确的重置入口恢复初始示例，保留重复执行结果，不清浏览器其他存储。

产物位于 `output/mock-product-20261017/<运行时间>/`：32 页截图与 AX、异常场景和三个窄窗尺寸截图、迭代包、断言结果和源码 SHA256。脚本保留原型页供继续检查；工作完成后由调用者 finish 保留结果页。

设计范围与边界见 [产品 Mock 规格](../docs/design/opstwins-product-mock.md)。Mock 验收不改变真实产品、85 项功能或原生评分的状态。
