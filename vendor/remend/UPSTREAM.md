# remend来源

来源：<https://github.com/vercel/streamdown/tree/main/packages/remend>，固定commit `fea4ef5baada951c0f907e29669d1cba1f8beec1`，包版本1.4.0。

原始src、package.json及README逐字保留，仓库Apache-2.0 LICENSE一并保留；上游路径与SHA256见`../mock-upstream-manifest.json`。

通过`node scripts/opstwins-mock-vendor.mjs`生成当前Mock使用的本地ES模块，无CDN、React或运行时网络依赖。只用于显式`streaming:true`的assistant消息显示，不改写原消息、用户消息或文档正文。
