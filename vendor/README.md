# PI SDK 固定发行物

本目录的 PI coding-agent 0.86.1 tarball 来源为官方 npm 发行物，同名包的 SDK 源码、资源、版本与许可证声明保持原样，仅移除发行物里的 `npm-shrinkwrap.json`。原 shrinkwrap 在本项目的 npm overrides 下仍锁定有公开 DoS 漏洞的 brace-expansion 5.0.9，使 npm update/audit fix 无法更新。

依赖仍由本项目 package-lock 固定，brace-expansion 与 undici 应用根 overrides 的已修复版本。此处不是修改 Agent 实现或自行升级 API。原始官方 tarball保留在 output/dependency-inspection，构建和真实 PI E2E需在处理依赖后重跑。

重新产生：官方 `npm pack @earendil-works/pi-coding-agent@0.86.1`，在本项目 output 内解包，仅删除 package/npm-shrinkwrap.json，再用 `npm pack --ignore-scripts` 打包至 vendor。本发行物仅用于本项目本地依赖安装，没有发布到外部注册表。
