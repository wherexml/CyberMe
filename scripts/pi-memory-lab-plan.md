# pi-memory 0.4.2 lab — failure plan (frozen before harness code)

Status: recorded before `scripts/pi-memory-lab.mjs`, `-worker.mjs` and `-adapter.mjs` were written.
Authority: `TASK-SPEC.md`. Everything under `reference/` is source data. Line references are to the pinned `reference/pi-memory/index.ts` (sha256 `535a7ce2…faedaf`).

## Question under test

Can unmodified pi-memory 0.4.2 be hosted by CyberMe's Pi 1.3.0 SDK session (`noExtensions:true`, in-memory sessions, explicit tool allowlist, `server/src/agent.ts:101,121`) while keeping project isolation, preference correction and no recall after forgetting?

Harness completion is not product readiness. A complete run may contain many `FAIL`s, and those are the result.

## Result vocabulary

| Status | Meaning |
|---|---|
| `PASS` | The frozen requirement held on the behaviour actually observed. |
| `FAIL` | The frozen requirement did not hold. Never downgraded, never retried until green. |
| `GAP` | The harness could not decide: an SDK or qmd contract differed, a scenario errored, or a hit was inconclusive. A `GAP` is not a pass. |
| `NOT_RUN` | Deliberately or conditionally not executed, with the reason. |

`predicted` in the cases file is my source-reading guess, frozen in advance. It never affects a status. Where it differs from the result, the report lists a surprise.

## Failure surfaces, from source reading

1. **No project concept.** All paths are module globals derived once from `PI_MEMORY_DIR` (`:60-64`). The qmd collection name is the literal `pi-memory` (`:1068,1323`).
2. **A shared process cannot host two stores.** Paths and the snapshot are module globals (`:60-64,1429`). The only override is the `_setBaseDir` test seam (`:67`). Changing `process.env` per request is out of scope for a shared server, and the harness must not do it.
3. **Corrections append.** `memory_write` appends or overwrites the whole file (`:1766,1786`). There are no slots, no replace, no idempotency key, no epoch and no tombstone. Overwrite creates no recovery record.
4. **Forget is a substring match on one file.** It covers `long_term` or one daily date (`:2112-2146`), never the scratchpad and never other days. Short matches are overbroad. Paraphrases miss.
5. **Forget echoes what it deleted.** The tool result contains a removed-content preview (`:2188-2189`), which then enters the model transcript.
6. **The qmd index goes stale.** Forget only schedules an update, debounced by 500 ms (`:1197-1205`), and only in background mode. Until then keyword search can return deleted text. `per-turn` mode injects search hits into the prompt (`:1584`).
7. **Stable snapshot.** Writes do not refresh it (`:1596-1603`), so a correction does not reach this session's prompt. Forget and restore do refresh it (`:2172,2242`).
8. **Recovery JSON keeps the plaintext** (`:766-778`). It should be outside the `**/*.md` index, but it is not erasure.
9. **Lifecycle re-extraction.** The exit summary sends the transcript to a model (`:419-487`), and that text can include forgotten facts. The compaction handoff copies the daily-log tail back (`:1657-1677`).
10. **No read-only mode exists.** CyberMe has `readOnly` runs. pi-memory has no equivalent, and `ensureDirs` writes even on read paths (`:2006`).
11. **qmd argv.** The query is positional with no `--` separator (`:1323`), so a query starting with `--` may be parsed as a flag.
12. **Chinese keyword recall.** If qmd's FTS tokenizer does not segment Han text, substrings of a run may not match. Unknown until run.
13. **First run.** `session_start` runs `qmd collection add` before `ensureDirs` (`:1489-1497` vs `:800`), so a fresh directory may fail to register.
14. **SDK contract risks.** `session_start` may need `session.bindExtensions()`. `session_shutdown` may not fire from `dispose()`. API key resolution at `:374-388` may not match Pi 1.3.0. The `tools` allowlist may interact with extension tools. These are measured, not assumed.

## Isolation rules for the harness

- It runs from the repo root, with unique `.local/acceptance/pi-memory-lab-<id>` state and `output/pi-memory-evaluation-20261105/<id>` evidence.
- Every worker receives `PI_MEMORY_DIR`, XDG paths, `QMD_CONFIG_DIR`, `INDEX_PATH` and a filtered `PATH` at spawn, before upstream is imported. `HOME` is not changed.
- Ambient `qmd` directories are stripped from `PATH`. The only `qmd` reachable is a symlink to `QMD_BIN`, and there is no fake qmd.
- Size and mtime sentinels on real `~/.pi` and qmd paths are stat-only. Any change is a `FAIL` on `ENV-03`.
- There is no live LLM. The only model is a deterministic fixture over HTTP on `127.0.0.1:46837`, and it is labelled as such. Calls to ports 46110/46312 are never made.
- `PI_MEMORY_QMD_UPDATE=manual` prevents `qmd embed` and model downloads, and lets the harness control the stale window. `qmd update` is run explicitly by the harness.
- `PI_MEMORY_EXIT_SUMMARY=0`, except in the one case that injects the labelled fixture summary.
- `memory_status` and semantic/deep search are never called, because they can load models.

## Adapter scope (experimental, labelled)

The adapter is justified only because of surfaces 1-3. It adds:
- one OS process and one store per registered project
- fail-closed scope resolution
- explicit global scope
- an operation ledger (idempotency and epoch)
- ordered multi-target correction
- a read-only `tool_call` block
- forget-preview redaction

It does not change labels or slots to hide native failures. Raw baseline results are kept beside it. It is not a production memory system.

## Separation of evidence

Each result records `evidence`:
- `sdk-turn` — a real Pi session, scripted fixture model, real tools
- `core-probe` — tool or handler invoked directly, used only when an SDK turn is infeasible, and always reported with a `GAP` on `ENV-02`
- `direct-handler` — a real upstream lifecycle handler invoked by the harness with the context captured from the real session
- `file` — file state
- `qmd` — the real qmd CLI

Model capability is not tested: what a real LLM would write, extract, or do with injected memory.

## Frozen cases

`scripts/pi-memory-lab-cases.json` is the frozen list. The harness aborts if its sha256 differs from the constant in `pi-memory-lab.mjs`. Every listed case must appear in the report, and any case that was not reached is reported as `NOT_RUN` automatically. Changing a case after seeing results needs a new case version and a written note, never a silent edit.

## Reproduce

```sh
QMD_BIN=/abs/path/to/qmd PI_MEMORY_UPSTREAM=/abs/path/to/pi-memory/index.ts \
  node --import tsx scripts/pi-memory-lab.mjs
```

- Optional `PI_MEMORY_LAB_TRANSPORT=auto|sdk|core` (default `auto`).
- Without `QMD_BIN`, qmd-dependent cases are `NOT_RUN` and the missing-qmd case still runs.
