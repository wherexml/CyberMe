# Mock 灵感图标

复用本项目已有的 [灵感图标资源](../../../../docs/design/assets/idea-icons/README.md)，保留 SVG 和 manifest 的原始内容。本次没有生成新图片。

Mock 通过独立 `<img>` 使用 `workflow.svg`、`briefing.svg`、`files.svg`，其余图标留作同系列迭代。图标为装饰，标题承担语义；窄窗缩小图标，不改变来源或操作。

原设计资源和历史验收结论不因这份副本改变。当前 Mock 的页面及浏览器验收见 [维护入口](../../../README.md)。


2026-10-23：已扩展至48枚SVG，由 `scripts/idea-icon-library.mjs` 同步；Mock使用 `ideaIconKey` 优先呈现合法 `iconKey`，兼容旧 `icon`。服务端生成目录见 `shared/idea-icon-catalog.json`。
