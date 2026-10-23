# 能力与意图

失败面先见 [验收说明](validation.md)。入口：设置 → 通用 → 能力与意图。

`server/src/ideas-console.ts` 挂载五个只读接口：`GET /api/ideas-console/capabilities`、`intents`、`intents/:id`、`runs`、`runs/:id`。列表分页 offset/limit（默认 40、最大 100）和 query（最长 200）。来源最多 64、历史/关联运行最多 50、工具步骤最多 200，超出显式标记。

能力目录复用应用注册表；模型仅报告配置是否存在，健康不探测；worker 启用、当前状态与历史成功独立显示。GET 不调用模型或业务写操作。仅允许字段公开，工具输入输出和策略路径不返回。

意图来源是已有 ideas，不声称具备尚未实现的长期目标模型。捕获 run 与后续执行分离：按 result 精确 ID 读取当前 task/inbox/automation/artifact。active 待办等待处理，pending 草稿等待审批，禁用自动化未启动；缺关联记录显示未知。文件只显示已生成，不推断工作完成。历史/trace 缺失保持显式缺失。

前端独立模块 `ideas-console.js/css`；设置入口由 `ideas-console-entry.js` 包装通用页。关闭、搜索、切换列表及详情以代次隔离异步回调；所有业务内容使用 textContent。后台每 5 秒仅在面板可见时刷新当前列表/详情；读取失败可重试，不创建执行。
