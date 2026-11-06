# Memory retrieval experiment v2: preregistered plan

Recorded before the v2 harness was written. The case data is frozen in `scripts/memory-vector-cases.json`, and the harness refuses to run if its SHA-256 differs from the value pinned in `scripts/memory-vector-compare.mjs`. Do not tune thresholds or rewrite expectations after seeing outputs. If a case is wrong, record it as a defect and create a new versioned case file.

## Observed failure after the first local run (recorded before any fusion change)

Reported by the local coordinator from the first end-to-end run. Harness, full restart and safety gates passed, and the five collision probes failed per order as predicted.

`mv-04` failed its required `hybrid` arm in both seed orders. The unindexed memory `cape-oncall` was `scopedLexical` rank 1 (score 16). RRF then promoted `cape-release`, `cape-owner` and `cape-budget`, each of which appears in both the keyword and semantic lists, and that pushed the correct keyword hit out of the top 3.

Cause: RRF rewards appearing in both lists and uses only rank, not keyword score. An unindexed item can only ever appear in one list, so it can lose to three weaker items that appear in both. This is the F5 failure surfacing at the fusion stage, after eligibility had already been fixed.

### Fusion amendment, chosen after seeing this result

The next run applies the retention policy below. The case file, its hash, the threshold, topK and RRF k are unchanged.

`retain-scoped-lexical-rank-1-v1`: if the rank 1 candidate of the scoped keyword list is not in the RRF top K, it replaces the last item of that top K and keeps that last position. No case ID, gold label, score floor or new tuned parameter is involved, and an ineligible candidate can never be retained because the list is already gated.

This amendment is not preregistered. It was chosen after seeing a failure on the same frozen cases, so results from that run cannot count as independent validation of it. A separate unseen case set is needed for that.

Possible precision costs, which the report must keep visible:
- A weak keyword hit, even a single shared bigram, can displace a better candidate from position K. There is deliberately no score floor, because one would be a new tuned threshold.
- Near negatives and cross-project-only queries can return an in-scope irrelevant item that RRF alone had dropped. This can only happen when the result set is already full, so it does not by itself turn an empty result into a false return, but it can change which irrelevant item is returned.
- Retention can push out an expected item at position K and lower `hitAt3` or `precisionAt3`.
- The retained item stays at position K, so the policy cannot improve `hitAt1`.
- When keyword scores tie, production orders by time, so which item is rank 1 can depend on seed order.

To measure this, `hybridRrfOnly` is reported beside `hybrid` as a comparison arm and goes through the same safety checks. Each result records `lexicalRetention`.

## Frozen parameters

threshold 0.55, topK 3, RRF k 60, model `Qwen3-Embedding-0.6B-8bit` (1024 dimensions, cosine), sqlite-vec `v0.1.6`, seed orders `forward` and `reverse`.

## Failure cases and how each is verified

| # | Failure case | Verification | Report location |
|---|---|---|---|
| F1 | Keyword eligibility depends on `index_meta` | Eligibility comes from authoritative active source plus `experiment-scope.db`, a separate file that holds no vector data. Fallback probes run with embedding unavailable and with a vector DB that has no tables. | `criteria: fallback-*` |
| F2 | Scope silently becomes global when no vector exists | Scope is required. An item with no scope row is excluded (`manual-unscoped`), and project items without vectors must not cross scopes (`mv-scope-guard-*`). | `criteria: unscoped-excluded, scope-leak-gated` |
| F3 | A correction in a shared slot in project A replaces project B | Probes the unmodified `rememberFact` over HTTP in both directions, with status snapshots after every step. Slots carry no project name. An observed collision is a capability FAIL, and the probe is not changed to pass. | `lifecycle.collisions`, `criteria: collision-*` |
| F4 | Forgetting A also forgets B | Probes the unmodified `revokeMemory` in both directions, plus forgetting the older, already superseded row of the other project. | same as F3 |
| F5 | The corpus assumes every item is indexed | Known keyword items and handwritten memories have no vectors, yet scoped lexical and hybrid must return them. | `criteria: missing-vector-*` |
| F6 | Vector-only invalidity suppresses a valid keyword candidate | Tampers with `content_hash`, `model`, the `index_meta` row and the vector row. The semantic path is rejected for the stated reason, and the keyword path must still return the item. | `lifecycle.gates`, `criteria: gate-*` |
| F7 | Genuinely stale data is revived | Source changes and handwritten-memory removal must exclude the item from every arm. | `criteria: gate-*` |
| F8 | Negatives are trivial | 8 near negatives in the same topics, 6 queries answered only by another project, and the 2 v1 trivial negatives kept in their own group. | `metrics.*.byGroup` |
| F9 | Time ties decide ranking | Two opposite seed orders in separate data roots, reported as per-arm rank differences. | `orderStability` |
| F10 | A correction is proven only by exclusion | Multiple query variants record the rank of the current memory and of the retained old vector. A wrong-slot correction is reported as a coverage gap. | `lifecycle.corrections`, `lifecycle.incorrectSlot` |
| F11 | A forget test has no relevant raw candidate | Raw similarity of retained vectors is recorded. No raw candidate at or above the threshold is MISSING_EVIDENCE. Raw-neighbor retention is by design and is not a deletion bug. | `lifecycle.forget` |
| F12 | The restart check covers only `/automatic` lists | The worker process closes its HTTP server and all DB handles, then exits. A new process reopens the persisted data and runs the same `search` over every registered query using persisted query vectors. It has no embedding code path and no credentials. Failure, nonzero exit or invalid output is a harness FAIL. | `restart.*` |
| F13 | An overall PASS hides negative results | Harness status, criteria and decision are separate fields, and the decision is never a plain PASS. | `harness`, `criteria`, `decision` |

## Criteria classes

- `safety`: forgotten, superseded and out-of-scope IDs returned must be zero in gated arms. A FAIL means NO_GO.
- `capability`: project isolation for writes and forgets, keyword fallback without vectors, and restart equality. A FAIL means NO_GO.
- `quality`: the current memory is retrieved after a correction. Reported, and does not by itself mean NO_GO.
- `evidence`: MISSING_EVIDENCE means the check could not prove anything, for example no raw candidate above the threshold. The decision is INCONCLUSIVE if nothing else is NO_GO.
- `gap`: known coverage gap observed, such as a wrong-slot correction.

Effectiveness metrics are descriptive. No numeric target was preregistered, so no statistical claim follows from them.

## Metric definitions

- `hitAt1` and `hitAt3`: answerable queries with an expected key at rank 1 or within the top 3.
- `precisionAt3`: mean over answerable queries of relevant results in the top 3 divided by 3. The denominator stays 3 for short result sets. Because most queries have one answer, `maxPrecisionAt3` is reported beside it.
- `returnedRelevant` and `returnedIrrelevant`: item counts over answerable queries.
- `emptyReturnFailures`: answerable queries that returned nothing, kept separate from `missWithResults`.
- `falseReturnRate`: no-answer queries that returned anything, divided by all no-answer queries.
- `outOfScopeLeaks`, `unscopedReturned`, `inScopeIrrelevant`: item classification across all queries, kept separate.

## Known limits, reported and not worked around

- Production has no project scope contract. Scope exists only in the experiment's own database.
- A shared slot cannot hold two active rows through `rememberFact`, so the forget probes reach the slot-wide branch only after a collision has already happened. Rows are not written directly into `automatic_memories` to fake coexistence.
- `recalledMemories` truncates to 8 candidates before the scope filter, so scoped lexical can lose an in-scope item. Each result records `lexicalTruncated`.
- Corpus slots such as `work:cape-db` and `work:dawn-db` are artificially separated, as in v1. Only the collision probes are evidence about isolation.
- The embedding-failure probe passes a null query vector and does not fail a live endpoint.
- Not covered: undo in a shared slot, model extraction quality, packaged macOS dylib loading and signing, and filtering before top-k at scale.
