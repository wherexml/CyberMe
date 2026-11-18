# GitHub Issue 与 Apple 日历/提醒事项只读

## GitHub Issue

Chat 工具 `read_github_issue {repository,number,evidence}` 复用 `read_github_pull_request` 的受限 `gh api --hostname github.com --method GET`。`owner/repo` 和编号都必须出现在用户本轮直接请求中。接口返回 PR 对象时拒绝（`github_issue_is_pull_request`）；转移或换址后链接不一致时拒绝（`github_issue_mismatch`）；超时、404、权限错误以 `github_*` 错误码返回，不作成功。正文截断为 4000 字，是资料不是指令。

这是本机 CLI 登录的读取，不等于设置页已连接 GitHub。

## Apple 日历与提醒事项

系统权限和应用内连接是两个独立事实，两项数据也各自独立；读取必须同时满足。

- 状态：`GET /api/connections/apple/status`，返回 `supported`、`source` 及每项的 `status/os/read/updatedAt`。只查询，不弹窗；系统已关闭时把已连接记录改为 `reauth`。
- 授权：只有设置页点击会调用原生 `AppleAccess.Authorize(kind)` 请求系统权限，之后 `POST /api/connections/apple/{calendar|reminders}/authorize`，服务端用读取模式复核 `full` 才写入连接。`write_only`、拒绝、受限均不算已连接。
- 断开：`POST /api/connections/apple-{calendar|reminders}-local/disconnect`，停止 CyberMe 读取；macOS 权限需在系统设置中更改。
- 读取：`app_read` 的 `apple_calendar_events {start,end,limit}`（带时区 ISO，跨度不超过 31 天）与 `apple_reminders {list?,limit}`（未完成项，`list` 为列表 ID 或唯一名称）。`limit` 为 1–50，默认 20；无 HTTP 路由，只在 `kind=chat` 的运行中按用户本轮直接请求执行，每轮最多 8 次。
- 数据：全天日程返回日期，结束日期为排他的下一天或后续日期；单日全天事件按日历所在时区识别。定时日程返回带时区的时间；提醒事项无到期日时 `due` 为 `null`，仅有日期时不补时间。不读取备注、Notes 或 Mail，不写入，不做后台采集。
- 回执与持久会话只保留动作、参数哈希、条数和错误码。

## 原生路径

`native/mygo/eventkit*` 以 cgo 链接到 MyGO 主程序。服务端执行本 App 包内同一可执行文件的 `--cyberme-eventkit-read` 模式（路径由 `runtime/` 位置推导，仅 standalone 包支持），该模式在应用启动前退出，只查询状态和读取，永不请求权限。其他运行环境返回 `apple_unsupported`，界面不显示可连接。

`run_command` 是主机终端能力，不是 OS 沙箱；它可以调用本机 API 和同一读取模式，受 macOS 权限约束。

## 验证边界

2026-11-09：类型检查、V6 构建及 macOS standalone 构建通过。GitHub Issue 的隔离 HTTP/Chat 验收 8 项通过，另有 2 项使用真实公开 GitHub API 的验收通过。Apple 的隔离 HTTP/Chat 验收 13 项通过；`OPSTWIN_EVENTKIT_HELPER_FIXTURE` 仅非 standalone 生效，结果标记 `fixture_eventkit`。

本机已安装签名构建 `1794234364762`。两个独立系统授权均确认可读；通过安装版的实际 Chat 模型读取了 1 条日程、1 条未完成提醒事项和一个公开 GitHub Issue，均无写入。提醒事项的一次参数校验错误被拒绝，同轮随后成功。安装版系统权限撤销未实测，未公证或发布。复验方式见本机证据目录 `output/apple-github-connections-20261109/`。
