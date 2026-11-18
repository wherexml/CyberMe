// Chat phase budgets and the POST /api/chat transport envelope (docs/public/chat-time-budgets.md).
// Server budgets are clamped to these maxima so no client/proxy can end a valid two-stage run first.
export const CHAT_PREPARE_BUDGET_MS=150000;
export const CHAT_ANSWER_BUDGET_MS=110000;
export const CHAT_DEEP_ANSWER_BUDGET_MS=150000;
/** Session lock wait (15s) + interrupt confirmation (10s) + abort settle/persist (5s) + headroom. */
export const CHAT_ENVELOPE_OVERHEAD_MS=45000;
/** 150 + 150 + 45 = 345s; mirrored literally in scripts/mygo-workspace-gateway.mjs and native/mygo/proxy.go.
 *  Applies only to synchronous POST /api/chat (no queueCurrent). Durable queued requests return 202 at once and are
 *  bounded server-side by the idle window, hard cap and provider-request ceiling below. */
export const CHAT_TRANSPORT_TIMEOUT_MS=CHAT_PREPARE_BUDGET_MS+CHAT_DEEP_ANSWER_BUDGET_MS+CHAT_ENVELOPE_OVERHEAD_MS;
export const clampBudget=(value:unknown,fallback:number,max:number)=>{const n=Number(value);return Number.isFinite(n)&&n>0?Math.min(n,max):fallback;};
// Durable queued persistent chat only (POST /api/chat with queueCurrent; HTTP returns 202, so the 345s envelope above does not bound it).
// The 110/150s answer budget becomes an idle window renewed by server-observed progress; these caps never renew.
export const CHAT_DURABLE_HARD_CAP_MS=600000;
export const CHAT_DURABLE_DEEP_HARD_CAP_MS=900000;
export const CHAT_DURABLE_HARD_CAP_MAX_MS=900000;
/** Answer-phase provider requests per durable run; env may lower it, never raise it. */
export const CHAT_DURABLE_MAX_PROVIDER_REQUESTS=60;
// Phase windows for durable queued chat (server/src/chat-phase-watchdog.ts). Server env may only LOWER these.
// Headers: the provider timeout already configured for the session (45s normal / 60s deep) plus this grace, per model
// step, for at most CHAT_PHASE_MAX_ATTEMPTS_PER_STEP attempts (one SDK retry, 2s initial backoff).
export const CHAT_PROVIDER_TIMEOUT_MS=45000;
export const CHAT_DEEP_PROVIDER_TIMEOUT_MS=60000;
export const CHAT_PHASE_HEADERS_GRACE_MS=5000;
export const CHAT_PHASE_MAX_ATTEMPTS_PER_STEP=2;
/** After 2xx headers, until the first non-empty text/thinking/tool-argument delta. */
export const CHAT_PHASE_FIRST_CONTENT_MS=60000;
/** Maximum silence between non-empty deltas once content has started. */
export const CHAT_PHASE_STREAM_SILENCE_MS=30000;
/** Per-call allowance for tools without an own deadline; own-deadline tools get their limit plus the grace below. */
export const CHAT_PHASE_TOOL_FALLBACK_MS=120000;
export const CHAT_PHASE_TOOL_GRACE_MS=5000;
/** Identical tool + arguments + error returned this many times in a row stops the run (no progress). */
export const CHAT_PHASE_REPEAT_ERROR_LIMIT=3;
