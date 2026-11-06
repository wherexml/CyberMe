// EXPERIMENTAL lab adapter for pi-memory 0.4.2. Not a production memory system.
// It wraps the unmodified extension and never rewrites its tools, labels or slots.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const ADAPTER_GUARANTEES = [
  'One OS process and one directory/qmd index per registered scope, so upstream module globals cannot cross scopes.',
  'Unknown, empty or traversal project IDs fail closed before any store or process exists.',
  'Global memory is a separate scope, reachable only through an explicit global() call.',
  'operationId idempotency and epoch rejection of late stale writes, persisted outside the indexed memory directory.',
  'correct(): ordered forget across long_term, today and yesterday, then write the new value.',
  'Read-only sessions block mutating memory tools at the tool_call hook.',
  'memory_forget tool results have the removed-content preview stripped before they enter the transcript.',
];
export const ADAPTER_NON_GUARANTEES = [
  'correct() is not atomic: a crash between forget and write leaves the slot empty until retried.',
  'No slot model: matching is still upstream substring matching, so paraphrases miss and short matches are overbroad.',
  'Prior-session and transcript context is not scrubbed. The host owns history (CyberMe: memory_exclusions).',
  'The stale qmd window after forget is not closed unless the host refreshes before searching.',
  'Recovery JSON still retains plaintext. Forget is not physical erasure.',
  'The ledger only covers calls made through this adapter. A model calling memory_write directly bypasses it.',
  'Scratchpad entries and daily logs older than yesterday are not covered by correct().',
  'One process per project has a resource cost, unmeasured here.',
];

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const GLOBAL_SCOPE = 'global';
const MUTATING = new Set(['memory_write', 'memory_forget', 'memory_restore']);

export class ScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function resolveScope(registered, projectId) {
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId) || projectId === GLOBAL_SCOPE || !registered.includes(projectId)) {
    throw new ScopeError('project_unknown', `Refusing unregistered project scope: ${JSON.stringify(projectId)}`);
  }
  return projectId;
}

// Runs inside the worker, on the real ExtensionAPI, after upstream registration.
export function applyAdapterPolicy(pi, {readOnly = false, redactForgetPreview = false} = {}) {
  if (readOnly) {
    pi.on('tool_call', async event => {
      const scratchWrite = event.toolName === 'scratchpad' && event.input?.action !== 'list';
      if (MUTATING.has(event.toolName) || scratchWrite) return {block: true, reason: 'adapter_read_only'};
      return undefined;
    });
  }
  if (redactForgetPreview) {
    pi.on('tool_result', async event => {
      if (event.toolName !== 'memory_forget') return undefined;
      const content = (event.content || []).map(part =>
        part.type === 'text'
          ? {...part, text: `${part.text.split('Removed content preview:')[0]}Removed content preview: [redacted by adapter]`}
          : part,
      );
      const {removedPreview: _removed, ...details} = event.details || {};
      return {content, details};
    });
  }
}

export class OperationLedger {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : {epoch: 0, operations: {}};
  }
  get epoch() {
    return this.state.epoch;
  }
  persist() {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.filePath);
  }
  seen(operationId) {
    return this.state.operations[operationId];
  }
  assertEpoch(epoch) {
    if (epoch !== undefined && epoch !== this.state.epoch) {
      throw new ScopeError('memory_changed', `Stale epoch ${epoch}; current ${this.state.epoch}`);
    }
  }
  commit(operationId, {bump = false} = {}) {
    if (bump) this.state.epoch += 1;
    if (operationId) this.state.operations[operationId] = {epoch: this.state.epoch};
    this.persist();
  }
}

// openScope(scope, stateDir, sessionOptions) is host-supplied and returns a session with tool().
export class ProjectMemoryAdapter {
  constructor({root, projects, openScope}) {
    if (projects.includes(GLOBAL_SCOPE)) throw new ScopeError('project_reserved', 'global is reserved');
    this.root = root;
    this.projects = projects;
    this.openScope = openScope;
    this.open = new Map();
  }
  async #session(scope, options) {
    const key = `${scope}:${JSON.stringify(options || {})}`;
    if (!this.open.has(key)) {
      const stateDir = join(this.root, scope, 'adapter-state');
      mkdirSync(stateDir, {recursive: true, mode: 0o700});
      this.open.set(key, {
        session: await this.openScope(scope, join(this.root, scope), options),
        ledger: new OperationLedger(join(stateDir, 'ledger.json')),
      });
    }
    return this.open.get(key);
  }
  async project(projectId, options) {
    const entry = await this.#session(resolveScope(this.projects, projectId), options);
    return this.#bind(entry);
  }
  async global(options) {
    return this.#bind(await this.#session(GLOBAL_SCOPE, options));
  }
  // Drops cached handles so the next project() call starts a new worker and rereads the ledger.
  forgetHandles() {
    this.open.clear();
  }
  #bind({session, ledger}) {
    return {
      session,
      get epoch() {
        return ledger.epoch;
      },
      write: async ({operationId, epoch, target = 'long_term', content}) => {
        if (operationId && ledger.seen(operationId)) return {duplicate: true};
        ledger.assertEpoch(epoch);
        const result = await session.tool('memory_write', {target, content});
        ledger.commit(operationId);
        return {duplicate: false, result};
      },
      forget: async ({operationId, match, target = 'long_term', date}) => {
        if (operationId && ledger.seen(operationId)) return {duplicate: true};
        const result = await session.tool('memory_forget', {match, target, ...(date ? {date} : {})});
        ledger.commit(operationId, {bump: true});
        return {duplicate: false, result};
      },
      correct: async ({operationId, oldMatch, content, today, yesterday}) => {
        if (operationId && ledger.seen(operationId)) return {duplicate: true};
        const removals = [];
        removals.push(await session.tool('memory_forget', {match: oldMatch, target: 'long_term'}));
        for (const date of [today, yesterday]) {
          removals.push(await session.tool('memory_forget', {match: oldMatch, target: 'daily', date}));
        }
        const written = await session.tool('memory_write', {target: 'long_term', content});
        ledger.commit(operationId, {bump: true});
        return {duplicate: false, removals, written};
      },
    };
  }
}
