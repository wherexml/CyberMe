# 验证与公开范围

2026-10-23 灵感后台：类型检查通过；隔离真实产品 HTTP 8 项、浏览器交互 9 项通过。涵盖精确关联的 active 待办、缺失来源/运行、partial、工具步骤、分页、无业务写入、HTML 安全呈现、失败重试和迟到请求隔离。

复现入口：先准备桌面静态资源，再运行 `node --import tsx scripts/ideas-console-service.mjs`；执行 `node scripts/ideas-console-http-e2e.mjs`，并通过 ego-browser 运行 `scripts/ideas-console-browser-e2e.mjs`。fixture 使用 46760/46761，输出保留在忽略的 `output/ideas-console-20261023/`。

截图接口曾连续超时，不能把页面结构验收当成视觉截图通过。本次观察面板未执行真实模型或外发消息；安装包与生产执行另行验收。

公开历史已移除内部文档、运行记录、截图和业务链接；凭据、用户数据与本机私有备份不在仓库内。秘密扫描仅余测试脚本中幂等键字符串的误报，已按实际代码核对。
