# pi-memory 接入评估与隔离实验（2026-11-05）

## 结论与范围

**当前不建议把 pi-memory 直接接入 CyberMe 正式 Agent。** 已完成 M2 Max Claude 的实现评估和实验脚本编写、本机真实 Pi SDK / qmd 验收，以及远端复审。原版和实验适配器均为 `NO_GO`。本任务没有修改正式 Agent、生产数据库、根依赖或安装版，也没有启用语义召回。

实验固定为 `jayzeng/pi-memory 0.4.2`，提交 `1e276a762a666a7031459fdf7af018cc7966663e`，`index.ts` SHA256 为 `535a7ce239c80244c7853ed4da093d0a3c176a37af96aea10746a66a12faedaf`；使用当前 Pi SDK `@earendil-works/pi-coding-agent 1.3.0` 和独立安装的 qmd `2.8.3 (facd35e)`。这是固定版本的实验结果，不代表其他版本。

## 现有 Agent 如何接入

CyberMe 通过 `server/src/agent.ts` 创建 SDK 会话，使用 `DefaultResourceLoader`、`SessionManager.inMemory()` 和显式工具白名单；资源自动发现关闭。它不是依赖 Pi CLI 配置自动加载扩展的运行方式。

实验已验证以下加载方式可行：

1. 保持 `noExtensions/noSkills/noPromptTemplates/noThemes/noContextFiles` 为 true；只通过 `extensionFactories` 显式注册固定版本的 pi-memory。
2. 创建会话时显式选择记忆工具，然后调用 `session.bindExtensions()`，触发扩展的 `session_start`。
3. 在导入扩展前设置隔离目录与 qmd 索引路径。扩展存在模块级目录/快照状态，因此实验为每个项目使用独立 OS 进程、目录和索引，全局记忆使用独立且显式选择的作用域。
4. 只读任务通过 SDK 工具白名单或 `tool_call` 钩子阻止写入。单独 `session.dispose()` 在当前 SDK 实验中没有触发扩展的 shutdown，不能假设 CLI 生命周期行为会自动出现在嵌入式宿主里。

SDK 加载成功只证明技术上能调用工具，不代表满足产品记忆契约。实验不构成安装或启用步骤。

## 三个重点的实测结论

| 重点 | 原版 | 实验适配器 |
| --- | --- | --- |
| 跨项目隔离 | 共享目录时，读取与提示注入串项目；同槽忘记/纠正会影响另一个项目 | 独立进程、目录和索引通过 AB/BA 顺序检查；未知作用域、路径穿越与隐式全局访问被拒绝。隔离来自宿主分区 |
| 偏好纠正 | 默认追加会保留新旧值；整文件覆盖会损失无关记录；忘记只处理指定文件 | 可以清理长期记忆和最近两天日志后写入新值，但同一会话历史仍含旧偏好；纠正非原子操作，且直接调用原版写工具可绕过适配器账本 |
| 忘记后不再召回 | 文件和直接读取可以干净，但搜索、逐轮注入和历史上下文是另外的路径；空文件索引缺陷会在更新和重启后持续返回旧内容 | 进程隔离、删除预览遮盖和 API 级 epoch 检查不足以证明彻底停止召回；必须覆盖每个输出路径 |

原始冻结用例共 68 项，AB/BA 展开为 78 个结果：38 PASS、36 FAIL、1 GAP、3 NOT_RUN；原版 15 PASS / 35 FAIL / 1 GAP / 3 NOT_RUN，适配器 19 PASS / 1 FAIL，其余 4 项为共同环境检查。`ENV-05` 计入原版分类，但不参与行为决策。这些数量不是产品就绪率，多数原版失败表示不满足 CyberMe 的要求，并非都属于上游缺陷。

特别是适配器首轮 19/20 不能解读为接近可用：原用例没有在适配器忘记/纠正后再次搜索，且幂等与代次检查仅覆盖串行的适配器 API 调用。M2 复审指出该缺口后，本机新增独立补充用例，保留原有用例与预期不变。

## 补充验收结果

补充判定器修正后，最终完整运行 `20261105131544-dde804` 共 85 个结果：**40 PASS、41 FAIL、1 GAP、3 NOT_RUN**。原 78 项状态与首轮完全相同；新增 7 项为 2 PASS / 5 FAIL，原版与适配器依然均为 `NO_GO`。

| 补充检查 | 结果 | 观察 |
| --- | --- | --- |
| SUP-01：适配器忘记后更新索引 | FAIL | 仍返回旧偏好 |
| SUP-02：再重启 OS 进程搜索 | FAIL | 仍返回旧偏好 |
| SUP-03：更新后逐轮系统提示 | FAIL | SDK 实际请求再次注入旧偏好 |
| SUP-04：原文件写入非空新内容再更新 | PASS | 旧命中消失，新内容可检索 |
| SUP-05：删除空文件再更新 | PASS | 删除前残留可复现，删除后命中消失 |
| SUP-06：适配器纠正长期记忆和日志后搜索 | FAIL | 新偏好可找到，但已清空的 daily 文件仍返回旧偏好 |
| SUP-07：直接调用原版 memory_write | FAIL | 适配器拒绝旧代次写入，但直接工具调用仍能把旧值写回 |

SUP-04/05 只证明这两种动作在小样本中清除了对应索引命中，不等于已实现可靠重建、崩溃恢复或完整忘记机制。未将它们作为生产修复。

第二次运行 `20261105131317-d600fb` 的 SUP-04/05 被判定器误报：上游零命中提示回显查询词，不能算作召回。该原始报告保留；新增判定规则先记录失败面，再修正补充判定器，第三次完整重跑通过这两项。冻结主用例文件和预期未改。

## 已确认的 qmd 空文件索引缺陷

当 pi-memory 忘记文件最后一条内容时，会把文件写为 0 字节。qmd 2.8.3 的更新逻辑先把路径加入 `seenPaths`，再跳过空文本；因此旧索引行仍是 active，旧内容继续可搜索。实测再次运行 `qmd update` 和重启 OS 进程都不能清除此残留。

独立数据库只读诊断确认：返回旧内容的路径为 `daily/YYYY-MM-DD.md`，不是恢复记录 JSON。原用例 `FGT-06` 把“没有任何旧内容命中”与“恢复记录仍存在”合并判断，其 FAIL 不能证明恢复 JSON 被索引；这个断言缺陷保留记录，不修改冻结结果。

恢复 JSON 确实保留明文，因而“忘记”不等于物理擦除。现有 CyberMe 的契约也是停止模型使用被忘记的记忆及可追溯来源，需要分别处理用户可见历史、模型上下文和存储保留策略。

## 接入建议

保留 CyberMe SQLite 作为唯一权威记忆源，继续利用已有来源排除、记忆代次和撤销机制；先单独解决现有写入/纠正/忘记路径的项目作用域问题。不要引入第二套 Markdown 记忆库承担同样的权威状态。

如果后续继续研究 pi-memory，可借鉴显式工具接口和可审阅文件的交互方式。任何派生搜索索引都必须在结果进入工具返回或模型提示前，再按权威记录检查项目、有效版本和忘记状态。仅“更新索引”不足以履行忘记契约。qmd 暂不进入有忘记要求的正式召回路径。

## 可重复验收

先记录失败面，再实现实验。主实验及补充实验均为 SDK / CLI 端到端场景，不是新增单元测试。模型端点为 `127.0.0.1:46837` 的确定性 SSE fixture，工具调用、文件、索引和 SDK 请求捕获是真实执行；没有验证真实 LLM 自主选择工具或中文理解能力。少数退出摘要、压缩生命周期案例直接调用真实扩展 handler，报告单独标注 `direct-handler`。

```sh
QMD_BIN=/absolute/path/to/qmd \
PI_MEMORY_UPSTREAM=/absolute/path/to/pinned/pi-memory \
PI_MEMORY_LAB_TRANSPORT=sdk \
node --import tsx scripts/pi-memory-lab.mjs
```

状态保存在 `.local/acceptance/pi-memory-lab-<run>`，证据保存在 `output/pi-memory-evaluation-20261105/<run>`。前者不进入 Git。`report.json` 是逐例状态依据，`fixture-requests.jsonl` 可核对实际进入模型的合成内容。退出码 0 表示实验完整执行，不表示用例全部通过；退出码 2 表示实验不完整。

- 主失败面与冻结用例：`scripts/pi-memory-lab-plan.md`、`scripts/pi-memory-lab-cases.json`。
- 主执行器、SDK worker、适配器：`scripts/pi-memory-lab.mjs`、`scripts/pi-memory-lab-worker.mjs`、`scripts/pi-memory-lab-adapter.mjs`。
- 补充失败面/用例先于代码创建：`scripts/pi-memory-lab-supplement-cases.json`、`scripts/pi-memory-lab-supplement.mjs`。

## 未验证边界

未运行 qmd 的 `embed/vsearch/query`、`memory_status` 或默认后台刷新耗时；`PI_MEMORY_QMD_UPDATE=manual` 避免自动下载模型。未验证语义召回、真实模型提取质量、macOS 打包、每项目进程的性能成本、纠正中途崩溃与并发账本写入。没有调用真实业务 API、修改真实记忆或重新安装/启动 App。
