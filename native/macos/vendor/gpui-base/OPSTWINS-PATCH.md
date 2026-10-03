# OpsTwins Markdown 样式补丁

来源：crates.io `gpui-base = 0.7.0`，上游 `https://github.com/longbridge/gpui-kit`，原 `.crate` SHA-256 `64bb52b29a8dcdc8d3f595b8b0839c076f237572ab601ba4577d3da8ae085728`；保留原归档的 `LICENSE-APACHE`（Apache-2.0）。从本机已下载的原始归档解包至本仓库；未修改 Cargo registry。工作区显式 `[patch.crates-io]` 引用 `vendor/gpui-base`，版本保持 0.7.0。

实现前故障矩阵：默认列表前缀只有实际文字宽度，列表正文没有 HTML 的 22px hanging indent；strong 硬编码 700，无法继承 HTML 的 600；自定义替换整个列表会损失已有跨段选择、复制或可访问文本；全局更改默认值会改变非 Chat 页面；省略样式比较会使更新后沿用旧缓存。

仅在 `src/text/style.rs` 与 `src/text/node.rs` 添加可选样式能力：`with_list_prefix_width(Pixels)` 固定列表前缀栏宽度并右对齐标记；`with_strong_weight(FontWeight)` 控制 Markdown strong。默认前缀宽度为 `None`，仍保持上游文字宽度；默认 strong 为 `FontWeight::BOLD`（700），保持上游行为。新增字段参与 `PartialEq`；不改变解析、selection、canonical copy、链接安全或 Markdown AST。

Chat 显式设置按正文缩放的 22px 与 `SEMIBOLD`（600）。渲染路径仍是原 TextView，避免另写列表解析器。可编译与原生截图证据由整体原生验收补充；不补写单元测试，不把编码或旧包截图宣称 PASS。

v11追加两个 opt-in 样式：`with_list_item_gap(Pixels)`让同组列表第二项开始有4px间距；`with_first_heading_flush(true)`让根层首段标题不额外留顶距，后续标题仍继承14px总段距。默认None/false不改其他页面，上述字段/getter参与PartialEq；不以负padding裁剪正文修复截图。
