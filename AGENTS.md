# CyberMe contributor instructions

- Product name is CyberMe. MyGO is the desktop framework; retain existing application identifiers and data compatibility.
- Read `docs/public/README.md` and the affected module specification before changes.
- Keep credentials, environment files, business data and private acceptance artifacts out of Git and logs.
- Do not create worktrees or branches without an explicit request. Preserve concurrent working changes.
- Record failure cases before implementation. Prefer repeatable HTTP/browser E2E evidence; do not add unit tests after implementation.
- Use five-digit ports: Web 46100 and API 46110. Isolated acceptance uses its own ports and synthetic data.
- Use shared select controls. Keep UI concise, and do not treat mock behavior as real execution.
- The ideas console is read-only. Registration, configuration, worker enablement and actual execution are separate facts; never infer completion from generation or conversion alone.
- Update module specifications and provide precise validation boundaries in Chinese commit descriptions.
- Workspace-local guidance, when present, remains private at `.local/private-project-instructions/AGENTS.md`; read it without publishing its contents.
