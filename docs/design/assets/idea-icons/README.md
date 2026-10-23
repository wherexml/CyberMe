# 灵感 SVG 图标库

48枚原创矢量小物件，沿用 Mock 的低饱和渐变、纸张质感、轻微厚度和落影。保留原12枚，新增36枚；SVG源可编辑，未使用位图描摹。

- [图板](../../idea-icons-preview.html)：56px和24px、彩色/柔和彩色/单色预览。
- [统一目录](../../../../shared/idea-icon-catalog.json)：标识、用途、关键词、文件名。供生成灵感的模型按语义选择 `iconKey`。
- [`scripts/lib/idea-icon-artwork.mjs`](../../../../scripts/lib/idea-icon-artwork.mjs)：新增36枚的矢量源；`node scripts/idea-icon-library.mjs` 同步 HTML 与 Mock，`--check` 核对目录和副本。
- 48×48 viewBox、透明背景；实际卡片44px，窄屏36px。通过独立 `<img>` 使用；图片只作装饰，`alt=""`、`aria-hidden="true"`。
- 内部渐变ID在独立图片中隔离；内联多个SVG时需加独立前缀。
- 手动 think 与后台 refresh 在同一次模型调用中给出目录；只接收白名单 key，不接收模型生成的 SVG/URL/路径。
- 合法 key 优先。更新漏选/选错时保留原有效 key；没有有效旧值则按 ID 稳定回退。旧数据不批量迁移、不额外调用模型。
- 图片加载失败仍回退线形图标，不阻断讨论/忽略等交互。导航和设置图标不变。

实现与验收：[灵感语义图标库](../../../journeys/idea-icon-library-20261023.md)。
