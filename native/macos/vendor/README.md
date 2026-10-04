# GPUI macOS 帧唤醒修复

## v31 shown-window owner（候选）

`gpui-pre`0.3.7的当前锁定active源码完整快照置于本项目`vendor/gpui-pre`，保留Apache许可、原有布局/文字行为；其platform/window/context新增shown-owner API。Mac后端用`isVisible && !isMiniaturized && !NSApp.isHidden && !closed`，独立于像素遮挡信号，Settings改用此订阅。原renderer occlusion/displaylink/demandwake、Chat和Inbox不改。mini/demini、apphide/unhide通知与orderOut触发主线程owner重查，销毁清理观察者；其他平台保留默认visibility谓词，不新增其事件实现。条件`OPSTWIN_QA_OWNER_TRACE=1`仅boolean与generation，默认无诊断输出。原317文件与新增core来源/hash逐项归档；Cargo.lock仅0.3.7同版source转换，registry不写。实际NSSavePanelCancel/RAM及Hide安全边界待GUI复验，详见`docs/spec/native-product-pages.md`。

`gpui-pre-macos` 来自 crates.io `0.3.7`（GPUI snapshot zed `1a28cff4b409169bac058bca40dfbfeb7621d19b`），原 `.crate` SHA-256 为 `5a43af845b260b09393e923c4f1e1a67a10fcfc847b4815192bbfd02ed9fe725`。保留归档中的 Apache-2.0 许可；未修改本机 cargo registry。工作区通过 `[patch.crates-io]` 显式引用本目录，使其他机器能够复现。

原生独立截图验收发现：异步数据与 AX 状态已更新，画面仍停首帧；只有系统 zoom/restore 触发重绘。Mac backend 没有实现 `PlatformWindow::frame_waker` / `schedule_frame`，只依靠 CoreVideo tick，tick 未到达时应用变化没有唤醒途径。

仅修改两个源文件：

- `display_link.rs`：`WindowFrameSource::wake` 合并一个 GCD dispatch-source frame demand。
- `window.rs`：实现 frame waker 与 schedule_frame；以 Weak 访问窗口状态，关闭时不调度；被遮挡但状态改变的窗口仍接收一次合并唤醒，使用既有 main-queue dispatch source，不进行后台轮询或强制持续绘制。保留原 CVDisplayLink pacing、去重和关闭时取消逻辑。

实现前故障清单：首帧之后没有更新；从后台恢复仍显示旧内容；失去窗口后回调访问释放内存；重复唤醒排队爆增；隐身窗口耗电；同步重入导致死锁；平台计时仅 fixture 却被宣称实机性能。验收使用真实 CUA 原生截图、实际点击/异步结果可见与退出重启；不补写单元测试。

GUI、帧间隔、输入延迟与真实 SQL 压测分别记录。禁止将强制重绘样本或只读合成历史等同真实数据库吞吐。

当前 CUA 截图环境会把仍能截图的窗口报告为 occluded。以可见性阻止 demand 会丢掉 dirty latch 的首个唤醒，所以按状态变化唤醒不受 occlusion 限制；闲置窗口不新增持续刷新。真实 v8 截图在不执行 zoom 的情况下立即展示页面切换和异步图标。

## v13 导航键与文本间距

`window.rs`增加非组合且ASCII输入源下escape/up/down先交GPUI；未处理时清除doCommand的重复派发状态再走原AppKit fallback。活动IME输入源或marked text保留原路由，不能因没有marked text而吞掉候选导航。`OPSTWIN_KEY_TRACE`只记导航键与路由布尔值。实际v13搜索/菜单/录音Escape及Shift-F10重开子范围通过；中文候选仍须当前包实际验收。

`gpui-base/src/text/style.rs`新增可选list_block_gap，默认None沿用原paragraph gap；`node.rs`只在列表块外间距消费。Chat显式8px列表块间距，列表项4px、普通paragraph10px与其它页默认保持。对应标题margin与HTML一致，完整像素对比另由独立评分记录。上文“仅两个源文件”指原帧唤醒批次，不指后续所有补丁。
