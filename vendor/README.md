# PI SDK 发行物

当前使用官方 npm `@earendil-works/pi-coding-agent@1.3.0`，精确版本与完整依赖树由根 package.json / package-lock.json 固定；不再使用本目录的 0.86.1 tarball。1.3.0 的 pi-agent-core 与 pi-ai 同为精确 1.3.0。

历史 0.86.1 tarball 保留以便核验：其来源为官方 npm 发行物，仅移除 `npm-shrinkwrap.json`，用于解除有漏洞的 brace-expansion 5.0.9 锁定；没有修改 SDK 源码。新版本可直接从官方 registry 安装，不沿用旧包重打包方式。根 overrides 仍由 npm 审计验证。

升级、真实模型/工具/打断/恢复与安装包证据见 [Pi 1.3.0 升级旅程](../docs/journeys/pi-sdk-upgrade-20261017.md)。
