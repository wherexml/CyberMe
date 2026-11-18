# CyberMe contributor instructions

- Product name is CyberMe. MyGO is the desktop framework; retain existing application identifiers and data compatibility.
- Read `docs/public/README.md` and the affected module specification before changes.
- Keep credentials, environment files, business data and private acceptance artifacts out of Git and logs.
- Do not create worktrees or branches without an explicit request. Preserve concurrent working changes.
- Record failure cases before implementation. Prefer repeatable HTTP/browser E2E evidence; do not add unit tests after implementation.
- Use five-digit ports: Web 46100 and API 46110. Isolated acceptance uses its own ports and synthetic data.
- Use shared select controls. Keep UI concise, and do not treat mock behavior as real execution.
- Scope console controls under `#ideas-console`; verify installed-app screenshots as legacy dialog styles can override browser fixture layouts.
- For V6 reply cards, use the current inbox judgment and exact request to offer drafting. Preserve drafts and recovery receipts, and read fresh judgment data after rechecking. See `docs/public/intent-handling.md`.
- Apply V6 dismissal and undo receipts to the exact item immediately. Reconcile the workspace in the background and guard against older snapshots. See `docs/public/intent-handling.md`.
- For V6 models, follow the [selection, provider and test receipt contract](docs/public/v6-model-settings.md).
- Keep the V6 memory overview navigable before reads finish. Detail loading and retry belong to the relevant resource. See [记忆资料库](docs/public/memory-library.md).
- The ideas console is read-only. Registration, configuration, worker enablement and actual execution are separate facts; never infer completion from generation or conversion alone.
- Update module specifications and provide precise validation boundaries in Chinese commit descriptions.
- Workspace-local guidance, when present, remains private at `.local/private-project-instructions/AGENTS.md`; read it without publishing its contents.

- For V6 changes, follow `docs/public/cyberme-v6.md` and `docs/public/v6-data-contract.md`; distinguish source preview from the installed app. Follow the module links in `docs/public/README.md` for attention, execution, memory, and insight contracts.

## Claude / Opus 项目约定（2026-11-11）

- 用户提到 Opus 或 Claude 模型时，默认按本机 `m2max-claude-remote` 技能使用 M2 Max Claude Code。用户指定入口时以当次要求为准。
- 远端 Claude 主要负责规划与编码，不运行测试、演示、lint、构建、类型检查或其他验收；这些工作由本机协调 Agent 负责，按项目规范完成并提供证据。
- 交接任务须明确上述职责，并保留 skill 要求的任务结尾：`Do not run builds, tests, or typechecks. Submit changes early and return promptly.` 本节取代历史指导中冲突的 Claude / Opus 入口及验收分工；仅更新约定不授权启动模型任务。
