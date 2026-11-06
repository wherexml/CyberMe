// Isolated E2E lab for unmodified pi-memory 0.4.2 on Pi 1.3.0. See scripts/pi-memory-lab-plan.md.
// Run from the repo root:
//   QMD_BIN=/abs/qmd PI_MEMORY_UPSTREAM=/abs/pi-memory/index.ts node --import tsx scripts/pi-memory-lab.mjs
// Exit: 0 harness complete (FAIL results may be present), 1 frozen-case mismatch, 2 harness incomplete.
import {execFile, fork} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import {delimiter, dirname, join, resolve} from 'node:path';
import {runSupplement} from './pi-memory-lab-supplement.mjs';
import {ADAPTER_GUARANTEES, ADAPTER_NON_GUARANTEES, GLOBAL_SCOPE, ProjectMemoryAdapter, ScopeError} from './pi-memory-lab-adapter.mjs';

const FROZEN_CASES_SHA256 = '2044e43ad02305b7fdb597619606da976dc4b59b51edaf0c8020438537e476fb';
const LAB_BASE_MARKER = 'LAB_BASE_PROMPT';
const FIXTURE_PORT = 46837;
const RPC_TIMEOUT_MS = 90_000;
const MEMORY_TOOLS = ['memory_write', 'memory_read', 'memory_forget', 'memory_restore', 'memory_search', 'scratchpad', 'memory_status'];
const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

const ROOT = process.cwd();
const sha256 = data => createHash('sha256').update(data).digest('hex');
const casesPath = join(ROOT, 'scripts/pi-memory-lab-cases.json');
if (!existsSync(casesPath) || !existsSync(join(ROOT, 'scripts/pi-memory-lab-plan.md'))) {
  console.error('Run from the repository root.');
  process.exit(1);
}
const casesRaw = readFileSync(casesPath);
if (sha256(casesRaw) !== FROZEN_CASES_SHA256) {
  console.error(`Frozen cases digest mismatch: ${sha256(casesRaw)}`);
  process.exit(1);
}
const frozen = JSON.parse(casesRaw);
const S = frozen.synthetic;
const Q = S.queries;
const canaryOf = text => text.match(/PMLCANARY[A-Z0-9]+/)[0];
const CANARY = Object.fromEntries(['A1', 'B1', 'A2', 'G1', 'OLD', 'NEW', 'UNRELATED', 'SCRATCH'].map(key => [key, canaryOf(S[key])]));

const expected = frozen.cases.flatMap(entry => (entry.orders || [null]).map(order => ({...entry, resultId: order ? `${entry.id}:${order}` : entry.id, order})));
const supplementRaw = readFileSync(join(ROOT, 'scripts/pi-memory-lab-supplement-cases.json'));
const supplement = JSON.parse(supplementRaw);
expected.push(...supplement.cases.map(entry => ({...entry, resultId: entry.id, order: null})));
const results = new Map();
const harnessErrors = [];
const runId = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
const stateRoot = join(ROOT, '.local/acceptance', `pi-memory-lab-${runId}`);
const evidenceRoot = join(ROOT, 'output/pi-memory-evaluation-20261105', runId);
mkdirSync(stateRoot, {recursive: true, mode: 0o700});
mkdirSync(evidenceRoot, {recursive: true});

const upstreamInput = process.env.PI_MEMORY_UPSTREAM ? resolve(process.env.PI_MEMORY_UPSTREAM) : '';
const upstreamIndex = upstreamInput && existsSync(upstreamInput) && statSync(upstreamInput).isDirectory() ? join(upstreamInput, 'index.ts') : upstreamInput;
const qmdBin = process.env.QMD_BIN ? resolve(process.env.QMD_BIN) : '';
const qmdOk = !!qmdBin && existsSync(qmdBin);
const requestedTransport = process.env.PI_MEMORY_LAB_TRANSPORT || 'auto';
let transport = requestedTransport === 'core' ? 'core' : 'sdk';

function record(resultId, status, observed, evidence) {
  if (results.has(resultId)) {
    harnessErrors.push(`Duplicate result for ${resultId}`);
    return;
  }
  results.set(resultId, {status, observed, evidence: evidence || (transport === 'core' ? 'core-probe' : 'sdk-turn')});
}
const check = (resultId, condition, observed, evidence) => record(resultId, condition ? 'PASS' : 'FAIL', observed, evidence);

// ---- Deterministic fixture model. Never a real LLM; labelled in every report. ----
const fixture = {queues: new Map(), requests: new Map(), server: undefined};
const sseChunk = delta => ({id: 'lab-fixture', object: 'chat.completion.chunk', model: 'lab-fixture-1', choices: [delta]});
function fixtureFrames(step) {
  if (step.tool) {
    return [
      {index: 0, delta: {role: 'assistant', tool_calls: [{index: 0, id: `call_${randomBytes(4).toString('hex')}`, type: 'function', function: {name: step.tool.name, arguments: JSON.stringify(step.tool.args)}}]}, finish_reason: null},
      {index: 0, delta: {}, finish_reason: 'tool_calls'},
    ];
  }
  return [
    {index: 0, delta: {role: 'assistant', content: step.text}, finish_reason: null},
    {index: 0, delta: {}, finish_reason: 'stop'},
  ];
}
function startFixture() {
  fixture.server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      const key = /^\/w\/([^/]+)\//.exec(req.url || '')?.[1] || 'unknown';
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {unparsed: raw};
      }
      const serialized = JSON.stringify(body);
      const exitSummary = serialized.includes('session recap assistant');
      (fixture.requests.get(key) ?? fixture.requests.set(key, []).get(key)).push({body, exitSummary});
      const queue = fixture.queues.get(key) || [];
      // Worst-case stand-in for extraction, labelled: echoes canaries actually sent in this request.
      const step = exitSummary
        ? {text: `### Notes\n- [LAB FIXTURE, NOT AN LLM] ${[...new Set(serialized.match(/PMLCANARY[A-Z0-9]+/g) || [])].join(' ') || 'nothing'}`}
        : queue.shift() || {text: 'lab-fixture-done'};
      res.writeHead(200, {'content-type': 'text/event-stream'});
      for (const frame of fixtureFrames(step)) res.write(`data: ${JSON.stringify(sseChunk(frame))}\n\n`);
      res.write(`data: ${JSON.stringify({id: 'lab-fixture', object: 'chat.completion.chunk', model: 'lab-fixture-1', choices: [], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}})}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((ok, fail) => {
    fixture.server.once('error', fail);
    fixture.server.listen(FIXTURE_PORT, '127.0.0.1', ok);
  });
}
const messageText = message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''));
const systemText = body => (body.messages || []).filter(m => m.role === 'system' || m.role === 'developer').map(messageText).join('\n');
const contextText = body => JSON.stringify((body.messages || []).filter(m => m.role !== 'system' && m.role !== 'developer'));

// ---- Isolated stores and workers ----
const ambientPath = (process.env.PATH || '').split(delimiter).filter(Boolean).filter(dir => !existsSync(join(dir, 'qmd')));
let storeCounter = 0;
const workers = new Set();
let workerCounter = 0;

function newStore(name, {createMemoryDir = true} = {}) {
  const dir = join(stateRoot, `${String(++storeCounter).padStart(2, '0')}-${name}`);
  return prepareStore(dir, {createMemoryDir});
}
function prepareStore(dir, {createMemoryDir = true} = {}) {
  const store = {
    dir,
    memory: join(dir, 'memory'),
    cwd: join(dir, 'cwd'),
    agentDir: join(dir, 'agent'),
    cache: join(dir, 'xdg/cache'),
    config: join(dir, 'xdg/config'),
    data: join(dir, 'xdg/data'),
    state: join(dir, 'xdg/state'),
    bin: join(dir, 'bin'),
  };
  for (const path of [store.cwd, store.agentDir, join(store.cache, 'qmd'), join(store.config, 'qmd'), store.data, store.state, store.bin, join(store.cwd, '.pi/extensions'), join(store.agentDir, 'extensions')]) mkdirSync(path, {recursive: true});
  if (createMemoryDir) mkdirSync(store.memory, {recursive: true});
  const markerDir = join(stateRoot, 'discovery-trap');
  mkdirSync(markerDir, {recursive: true});
  const trap = `import {writeFileSync} from 'node:fs';\nexport default function () { writeFileSync(${JSON.stringify(join(markerDir, `loaded-${storeCounter}`))}, 'loaded'); }\n`;
  writeFileSync(join(store.cwd, '.pi/extensions/lab-trap.ts'), trap);
  writeFileSync(join(store.agentDir, 'extensions/lab-trap.ts'), trap);
  if (qmdOk) {
    // Pass-through to the real QMD_BIN, so upstream's literal "qmd" resolves only to it.
    writeFileSync(join(store.bin, 'qmd'), `#!/bin/sh\nPATH=${JSON.stringify(dirname(process.execPath))}:"$PATH"\nexport PATH\nexec ${JSON.stringify(qmdBin)} "$@"\n`, {mode: 0o755});
  }
  return store;
}
function storeEnv(store, {noQmd = false, extra = {}} = {}) {
  const passthrough = Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  return {
    ...passthrough,
    PATH: [...(qmdOk && !noQmd ? [store.bin] : []), ...ambientPath].join(delimiter),
    PI_CODING_AGENT_DIR: store.agentDir,
    PI_MEMORY_DIR: store.memory,
    PI_MEMORY_QMD_UPDATE: 'manual',
    PI_MEMORY_EXIT_SUMMARY: '0',
    PI_MEMORY_SNAPSHOT: 'stable',
    XDG_CACHE_HOME: store.cache,
    XDG_CONFIG_HOME: store.config,
    XDG_DATA_HOME: store.data,
    XDG_STATE_HOME: store.state,
    QMD_CONFIG_DIR: join(store.config, 'qmd'),
    INDEX_PATH: join(store.cache, 'qmd/index.sqlite'),
    NO_COLOR: '1',
    PML_UPSTREAM_INDEX: upstreamIndex,
    ...extra,
  };
}
function runQmd(store, args) {
  return new Promise(ok => {
    execFile(join(store.bin, 'qmd'), args, {env: storeEnv(store), timeout: 60_000}, (error, stdout, stderr) => ok({ok: !error, stdout: String(stdout), stderr: String(stderr), error: error ? String(error.message) : undefined}));
  });
}
async function refreshIndex(store) {
  const result = await runQmd(store, ['update']);
  if (!result.ok) throw new Error(`Real qmd update failed: ${result.stderr || result.error}`);
  return result;
}
const spawnWorker = (label, store, envOptions = {}) =>
  new Promise((ok, fail) => {
    const key = `${label}-${++workerCounter}`;
    const log = openSync(join(evidenceRoot, `worker-${key}.log`), 'a');
    const child = fork(join(ROOT, 'scripts/pi-memory-lab-worker.mjs'), [], {cwd: ROOT, env: storeEnv(store, envOptions), execArgv: ['--import', 'tsx'], stdio: ['ignore', log, log, 'ipc']});
    const pending = new Map();
    let sequence = 0;
    const worker = {
      key,
      store,
      rpc: (op, args) =>
        new Promise((done, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Worker ${key} timed out on ${op}`));
          }, RPC_TIMEOUT_MS);
          pending.set(id, {done, reject, timer});
          child.send({id, op, args});
        }),
      open: options => openSession(worker, options),
      stop: async () => {
        workers.delete(worker);
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise(resolveExit => {
          child.once('exit', resolveExit);
          worker.rpc('exit').catch(() => child.kill('SIGKILL'));
          setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        });
      },
    };
    child.on('message', message => {
      if (message.type === 'ready') {
        workers.add(worker);
        ok(worker);
      } else if (message.type === 'fatal') {
        child.kill('SIGKILL');
        fail(new Error(`Worker import failed: ${message.error}`));
      } else if (pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.done(message.result);
        else entry.reject(new Error(message.error));
      }
    });
    child.once('error', fail);
    child.once('exit', code => {
      fail(new Error(`Worker ${key} exited before ready (${code})`));
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Worker ${key} exited (${code})`));
      }
      pending.clear();
    });
  });

async function openSession(worker, {tools = MEMORY_TOOLS, policy} = {}) {
  const info = await worker.rpc('open', {
    transport,
    cwd: worker.store.cwd,
    agentDir: worker.store.agentDir,
    fixtureBaseUrl: `http://127.0.0.1:${FIXTURE_PORT}/w/${worker.key}/v1`,
    tools,
    policy,
  });
  const sessionId = info.sessionId;
  const requests = () => fixture.requests.get(worker.key) || [];
  const session = {
    info,
    worker,
    requestCount: () => requests().length,
    exitSummaryRequests: () => requests().filter(r => r.exitSummary),
    tool: async (name, args, {allowMissing = false} = {}) => {
      fixture.queues.set(worker.key, [{tool: {name, args}}, {text: 'lab-tool-turn-done'}]);
      const turn = await worker.rpc('turn', {sessionId, prompt: `LAB scripted call ${name}`, toolName: name, args});
      const call = turn.tools.find(entry => entry.name === name);
      if (!call && !allowMissing) throw new Error(`Tool ${name} did not execute: ${JSON.stringify({stopReason: turn.stopReason, errorMessage: turn.errorMessage})}`);
      return call || {name, missing: true, isError: true, text: '', turn};
    },
    write: (target, content, mode) => session.tool('memory_write', {target, content, ...(mode ? {mode} : {})}),
    read: async (target, date) => (await session.tool('memory_read', {target, ...(date ? {date} : {})})).text,
    forget: (match, target, date) => session.tool('memory_forget', {match, ...(target ? {target} : {}), ...(date ? {date} : {})}),
    restore: recoveryId => session.tool('memory_restore', {recoveryId}),
    search: query => session.tool('memory_search', {query, mode: 'keyword'}),
    // Returns the system prompt the model would receive plus the rest of the request context.
    injected: async (prompt = 'LAB prompt probe') => {
      fixture.queues.set(worker.key, [{text: 'lab-prompt-turn-done'}]);
      const before = requests().length;
      const turn = await worker.rpc('turn', {sessionId, prompt});
      if (transport === 'core') return {system: turn.injected, context: null, evidence: 'core-probe'};
      const captured = requests().slice(before).find(r => !r.exitSummary);
      if (!captured) throw new Error(`Fixture saw no request: ${JSON.stringify({stopReason: turn.stopReason, errorMessage: turn.errorMessage})}`);
      const system = systemText(captured.body);
      if (!system.includes(LAB_BASE_MARKER)) throw new Error('Base system prompt not observed in the fixture request, so injection cannot be judged');
      return {system, context: contextText(captured.body), tools: (captured.body.tools || []).map(t => t.function?.name), evidence: 'sdk-turn'};
    },
    emit: (event, payload = {}) => worker.rpc('emit', {sessionId, event, payload}),
    close: () => worker.rpc('close', {sessionId}),
  };
  return session;
}

// ---- Observation helpers ----
const readSafe = path => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};
function walk(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path, predicate) : predicate(path) ? [path] : [];
  });
}
const memoryMarkdown = store => walk(store.memory, path => path.endsWith('.md')).map(readSafe).join('\n');
const recoveryText = store => walk(join(store.memory, 'recovery')).map(readSafe).join('\n');
const memoryDigest = store => sha256(walk(store.memory).sort().map(path => `${path}\n${readSafe(path)}`).join('\n'));
const count = (text, needle) => (text ? text.split(needle).length - 1 : 0);
const stamped = text => `<!-- 2000-01-01 00:00:00 [seedfile] -->\n${text}`;
function seedDaily(store, date, content) {
  mkdirSync(join(store.memory, 'daily'), {recursive: true});
  writeFileSync(join(store.memory, 'daily', `${date}.md`), stamped(content));
}
async function freshPrompt(worker, prompt) {
  const session = await worker.open();
  const injected = await session.injected(prompt);
  await session.close();
  return injected;
}
// Judges a real keyword search. A hit showing no known canary cannot prove exclusion, so it is a GAP.
function judgeSearch(result, {want = [], forbid = []}) {
  const hits = result.details?.count ?? 0;
  const seen = new Set(result.text.match(/PMLCANARY[A-Z0-9]+/g) || []);
  const observed = {hits, seen: [...seen], isError: result.isError, text: result.text.slice(0, 600)};
  if (result.isError) return {status: 'GAP', observed: {...observed, reason: 'search errored, so exclusion is unproven'}};
  if (hits > 0 && seen.size === 0) return {status: 'GAP', observed: {...observed, reason: 'hits showed no canary, so inconclusive'}};
  const ok = want.every(c => seen.has(c)) && !forbid.some(c => seen.has(c));
  return {status: ok ? 'PASS' : 'FAIL', observed};
}
const recordSearch = (id, result, spec) => {
  const verdict = judgeSearch(result, spec);
  record(id, verdict.status, verdict.observed, 'qmd');
};
const writeInOrder = async (order, sessions, entries) => {
  for (const key of order) await sessions[key].write('long_term', entries[key]);
};

// ---- Scenario runner: a scenario error yields GAP on that scenario's unrecorded IDs. ----
const blockErrors = [];
async function scenario(name, ids, fn) {
  const started = Date.now();
  try {
    await fn();
    if (blockErrors.length) throw new Error(blockErrors.splice(0).join('\n'));
  } catch (error) {
    const message = String(error?.stack || error);
    harnessErrors.push(`${name}: ${message.slice(0, 500)}`);
    for (const id of ids) if (!results.has(id)) results.set(id, {status: 'GAP', observed: {scenarioError: message.slice(0, 800)}, evidence: 'harness'});
  } finally {
    for (const worker of [...workers]) await worker.stop().catch(() => {});
    console.log(`[lab] ${name}: ${Date.now() - started}ms`);
  }
}
const canRun = entry => (!entry.requiresQmd || qmdOk) && !entry.notRun;
const idsFor = (...ids) => expected.filter(entry => ids.includes(entry.id) || ids.includes(entry.resultId)).filter(canRun).map(entry => entry.resultId);

// ---- Scenarios ----
async function scenarioSmoke() {
  const store = newStore('smoke');
  const worker = await spawnWorker('smoke', store);
  const session = await worker.open();
  const {activeTools, bound, sessionStartFired, extensionErrors} = session.info;
  const write = await session.write('long_term', S.UNRELATED);
  const prompt = await freshPrompt(worker);
  const closed = await session.close();
  const missing = MEMORY_TOOLS.filter(name => !(activeTools || []).includes(name));
  const builtins = BUILTIN_TOOLS.filter(name => (activeTools || []).includes(name));
  const observed = {activeTools, missing, builtins, bound, sessionStartFired, extensionErrors, wroteFile: readSafe(join(store.memory, 'MEMORY.md')).includes(CANARY.UNRELATED), writeIsError: write.isError, declaredTools: prompt.tools};
  const ok = transport === 'sdk' && !missing.length && !builtins.length && observed.wroteFile && sessionStartFired > 0 && prompt.system.includes(CANARY.UNRELATED);
  if (transport === 'sdk') {
    check('ENV-02', ok, observed);
    check('ENV-05', closed.shutdownFiredByDispose > 0, {...closed, note: 'Lifecycle probes therefore invoke handlers directly where needed.'}, 'sdk-turn');
  } else {
    record('ENV-02', 'GAP', {...observed, reason: 'Core-probe transport: no real SDK turn ran.'}, 'core-probe');
    record('ENV-05', 'NOT_RUN', {reason: 'Needs an SDK session.'}, 'core-probe');
  }
}

async function scenarioIsolationRaw(order) {
  const id = base => `${base}:${order}`;
  const entries = {A: S.A1, B: S.B1};
  const seeded = async name => {
    const store = newStore(`raw-${name}-${order}`);
    const workerA = await spawnWorker('rawa', store);
    const workerB = await spawnWorker('rawb', store);
    const sessions = {A: await workerA.open(), B: await workerB.open()};
    await writeInOrder(order, sessions, entries);
    return {store, workerA, workerB, ...sessions};
  };
  const main = await seeded('shared');
  const readA = await main.A.read('long_term');
  const readB = await main.B.read('long_term');
  check(id('ISO-RAW-READ'), readA.includes(CANARY.A1) && !readA.includes(CANARY.B1) && readB.includes(CANARY.B1) && !readB.includes(CANARY.A1), {aSeesB: readA.includes(CANARY.B1), bSeesA: readB.includes(CANARY.A1)});
  const promptA = await freshPrompt(main.workerA);
  const promptB = await freshPrompt(main.workerB);
  check(id('ISO-RAW-PROMPT'), !promptA.system.includes(CANARY.B1) && !promptB.system.includes(CANARY.A1), {aPromptHasB: promptA.system.includes(CANARY.B1), bPromptHasA: promptB.system.includes(CANARY.A1)}, promptA.evidence);
  if (qmdOk) {
    await refreshIndex(main.store);
    recordSearch(id('ISO-RAW-SEARCH'), await main.A.search(Q.slotHan), {want: [CANARY.A1], forbid: [CANARY.B1]});
  }
  await main.workerA.stop();
  await main.workerB.stop();

  const forget = await seeded('forget');
  await forget.A.forget(S.slotMatch);
  const afterForget = readSafe(join(forget.store.memory, 'MEMORY.md'));
  check(id('ISO-RAW-FORGET'), afterForget.includes(CANARY.B1) && !afterForget.includes(CANARY.A1), {aRemains: afterForget.includes(CANARY.A1), bRemains: afterForget.includes(CANARY.B1)}, 'file');
  await forget.workerA.stop();
  await forget.workerB.stop();

  const correct = await seeded('correct');
  await correct.A.write('long_term', S.A2, 'overwrite');
  const afterCorrect = readSafe(join(correct.store.memory, 'MEMORY.md'));
  check(id('ISO-RAW-CORRECT'), afterCorrect.includes(CANARY.B1) && afterCorrect.includes(CANARY.A2), {newPresent: afterCorrect.includes(CANARY.A2), bRemains: afterCorrect.includes(CANARY.B1)}, 'file');
}

function newAdapter(name, projects = ['project-a', 'project-b']) {
  const root = join(stateRoot, `${String(++storeCounter).padStart(2, '0')}-adapter-${name}`);
  const stores = new Map();
  const opened = [];
  const adapter = new ProjectMemoryAdapter({
    root,
    projects,
    openScope: async (scope, dir, options) => {
      opened.push(scope);
      const store = prepareStore(dir);
      stores.set(scope, store);
      const worker = await spawnWorker(`adp${scope.replace(/[^a-z0-9]/g, '')}`, store);
      return worker.open(options);
    },
  });
  return {adapter, stores, opened, root};
}

async function scenarioIsolationAdapter(order) {
  const id = base => `${base}:${order}`;
  const {adapter, stores} = newAdapter(`iso-${order}`);
  const scopes = {A: await adapter.project('project-a'), B: await adapter.project('project-b')};
  for (const key of order) await scopes[key].write({content: key === 'A' ? S.A1 : S.B1});
  const readA = await scopes.A.session.read('long_term');
  const readB = await scopes.B.session.read('long_term');
  check(id('ISO-ADP-READ'), readA.includes(CANARY.A1) && !readA.includes(CANARY.B1) && readB.includes(CANARY.B1) && !readB.includes(CANARY.A1), {aSeesB: readA.includes(CANARY.B1), bSeesA: readB.includes(CANARY.A1)});
  const promptA = await freshPrompt(scopes.A.session.worker);
  const promptB = await freshPrompt(scopes.B.session.worker);
  check(id('ISO-ADP-PROMPT'), promptA.system.includes(CANARY.A1) && !promptA.system.includes(CANARY.B1) && promptB.system.includes(CANARY.B1) && !promptB.system.includes(CANARY.A1), {aOwn: promptA.system.includes(CANARY.A1), aHasB: promptA.system.includes(CANARY.B1), bOwn: promptB.system.includes(CANARY.B1), bHasA: promptB.system.includes(CANARY.A1)}, promptA.evidence);
  if (qmdOk) {
    await refreshIndex(stores.get('project-a'));
    await refreshIndex(stores.get('project-b'));
    const a = judgeSearch(await scopes.A.session.search(Q.slotHan), {want: [CANARY.A1], forbid: [CANARY.B1]});
    const b = judgeSearch(await scopes.B.session.search(Q.slotHan), {want: [CANARY.B1], forbid: [CANARY.A1]});
    const status = [a.status, b.status].includes('FAIL') ? 'FAIL' : [a.status, b.status].includes('GAP') ? 'GAP' : 'PASS';
    record(id('ISO-ADP-SEARCH'), status, {a: a.observed, b: b.observed}, 'qmd');
  }
  await scopes.A.forget({match: S.slotMatch});
  const fileA = readSafe(join(stores.get('project-a').memory, 'MEMORY.md'));
  const fileB = readSafe(join(stores.get('project-b').memory, 'MEMORY.md'));
  check(id('ISO-ADP-FORGET'), !fileA.includes(CANARY.A1) && fileB.includes(CANARY.B1), {aRemains: fileA.includes(CANARY.A1), bRemains: fileB.includes(CANARY.B1)}, 'file');
  await scopes.A.write({content: S.A1});
  const {today, yesterday} = await scopes.A.session.worker.rpc('dates');
  const digestB = memoryDigest(stores.get('project-b'));
  await scopes.A.correct({oldMatch: CANARY.A1, content: S.A2, today, yesterday});
  const correctedA = memoryMarkdown(stores.get('project-a'));
  check(id('ISO-ADP-CORRECT'), correctedA.includes(CANARY.A2) && !correctedA.includes(CANARY.A1) && memoryDigest(stores.get('project-b')) === digestB, {oldRemains: correctedA.includes(CANARY.A1), newPresent: correctedA.includes(CANARY.A2), bUnchanged: memoryDigest(stores.get('project-b')) === digestB}, 'file');
}

async function scenarioAdapterScopes() {
  const {adapter, stores, opened, root} = newAdapter('scopes');
  const refused = [];
  for (const bad of ['project-x', '', null, undefined, '../project-a', 'project-a/../project-b', GLOBAL_SCOPE]) {
    try {
      await adapter.project(bad);
      refused.push({bad, refused: false});
    } catch (error) {
      refused.push({bad, refused: error instanceof ScopeError, code: error.code});
    }
  }
  check('ISO-ADP-UNKNOWN', refused.every(entry => entry.refused) && opened.length === 0 && !existsSync(root), {refused, workersOpened: opened.length, rootCreated: existsSync(root)}, 'file');

  const global = await adapter.global();
  await global.write({content: S.G1});
  const project = await adapter.project('project-a');
  await project.write({content: S.A1});
  const prompt = await freshPrompt(project.session.worker);
  const explicit = await global.session.read('long_term');
  check('ISO-ADP-GLOBAL', !prompt.system.includes(CANARY.G1) && explicit.includes(CANARY.G1), {projectPromptHasGlobal: prompt.system.includes(CANARY.G1), explicitReadHasGlobal: explicit.includes(CANARY.G1)}, prompt.evidence);

  const forgotten = await project.forget({match: S.slotMatch});
  const recoveryId = forgotten.result.details?.recoveryId;
  const other = await adapter.project('project-b');
  const crossRestore = await other.session.restore(recoveryId);
  const fileA = readSafe(join(stores.get('project-a').memory, 'MEMORY.md'));
  const fileB = readSafe(join(stores.get('project-b').memory, 'MEMORY.md'));
  check('ISO-ADP-RESTORE', !!recoveryId && crossRestore.isError && !fileA.includes(CANARY.A1) && !fileB.includes(CANARY.A1), {recoveryIdPresent: !!recoveryId, crossRestoreError: crossRestore.isError, text: crossRestore.text.slice(0, 200)});
}

async function scenarioConcurrency() {
  const storeA = newStore('conc-a');
  const storeB = newStore('conc-b');
  const worker = await spawnWorker('conc', storeA);
  await worker.rpc('setBaseDir', {dir: storeA.memory});
  const sessionA = await worker.open();
  await sessionA.injected();
  await worker.rpc('setBaseDir', {dir: storeB.memory});
  const sessionB = await worker.open();
  await sessionA.write('long_term', S.A1);
  const landedInA = readSafe(join(storeA.memory, 'MEMORY.md')).includes(CANARY.A1);
  const landedInB = readSafe(join(storeB.memory, 'MEMORY.md')).includes(CANARY.A1);
  check('CONC-RAW-WRITE', landedInA && !landedInB, {landedInA, landedInB, seam: '_setBaseDir (upstream test seam): last caller wins'}, 'file');
  await sessionB.write('long_term', S.B1);
  const reopened = await worker.open();
  const promptA = await sessionA.injected();
  check('CONC-RAW-SNAPSHOT', !promptA.system.includes(CANARY.B1), {sessionAPromptHasB: promptA.system.includes(CANARY.B1), note: 'The snapshot is a module global (index.ts:1429).'}, promptA.evidence);
  await reopened.close();
  await worker.stop();

  const {adapter, stores} = newAdapter('conc');
  const [a, b] = await Promise.all([adapter.project('project-a'), adapter.project('project-b')]);
  await Promise.all([a.write({content: S.A1}), b.write({content: S.B1})]);
  const [promptPA, promptPB] = await Promise.all([freshPrompt(a.session.worker), freshPrompt(b.session.worker)]);
  const mdA = memoryMarkdown(stores.get('project-a'));
  const mdB = memoryMarkdown(stores.get('project-b'));
  check('CONC-ADP', mdA.includes(CANARY.A1) && !mdA.includes(CANARY.B1) && mdB.includes(CANARY.B1) && !mdB.includes(CANARY.A1) && !promptPA.system.includes(CANARY.B1) && !promptPB.system.includes(CANARY.A1), {aFileHasB: mdA.includes(CANARY.B1), bFileHasA: mdB.includes(CANARY.A1), aPromptHasB: promptPA.system.includes(CANARY.B1), bPromptHasA: promptPB.system.includes(CANARY.A1)});
}

async function withRaw(name, fn, envOptions, storeOptions) {
  let worker;
  try {
    const store = newStore(name, storeOptions);
    worker = await spawnWorker(name.replace(/[^a-z0-9]/gi, '').toLowerCase(), store, envOptions);
    const session = await worker.open();
    await fn({store, worker, session});
  } catch (error) {
    // Later blocks still run; the enclosing scenario turns unrecorded IDs into GAP.
    blockErrors.push(`${name}: ${String(error?.stack || error)}`);
  } finally {
    await worker?.stop().catch(() => {});
  }
}

async function scenarioCorrectionRaw() {
  await withRaw('cor01', async ({session}) => {
    await session.write('long_term', S.OLD);
    await session.write('long_term', S.NEW);
    const text = await session.read('long_term');
    check('COR-01', text.includes(CANARY.NEW) && !text.includes(CANARY.OLD), {semantics: text.includes(CANARY.OLD) ? 'append: both records retained' : 'replace', oldPresent: text.includes(CANARY.OLD), newPresent: text.includes(CANARY.NEW)});
  });
  await withRaw('cor02', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    await session.write('long_term', S.UNRELATED);
    await session.write('long_term', S.NEW, 'overwrite');
    const text = readSafe(join(store.memory, 'MEMORY.md'));
    const recoveries = walk(join(store.memory, 'recovery')).length;
    check('COR-02', !text.includes(CANARY.OLD) && text.includes(CANARY.UNRELATED) && recoveries > 0, {oldPresent: text.includes(CANARY.OLD), unrelatedPresent: text.includes(CANARY.UNRELATED), recoveryRecords: recoveries}, 'file');
  });
  await withRaw('cor03', async ({worker, session}) => {
    await session.write('long_term', S.OLD);
    await session.write('daily', S.OLD);
    await session.forget(S.correctionMatch);
    await session.write('long_term', S.NEW);
    const prompt = await freshPrompt(worker);
    check('COR-03', !prompt.system.includes(CANARY.OLD), {freshPromptHasOld: prompt.system.includes(CANARY.OLD), reason: 'memory_forget defaults to long_term only (index.ts:2123)'}, prompt.evidence);
  });
  await withRaw('cor04', async ({store, worker, session}) => {
    await session.write('long_term', S.OLD);
    await session.write('daily', S.OLD);
    if (qmdOk) await refreshIndex(store);
    await session.forget(S.correctionMatch, 'long_term');
    await session.forget(S.correctionMatch, 'daily');
    await session.write('long_term', S.NEW);
    const prompt = await freshPrompt(worker);
    const read = await session.read('long_term');
    check('COR-04', prompt.system.includes(CANARY.NEW) && !prompt.system.includes(CANARY.OLD) && read.includes(CANARY.NEW) && !read.includes(CANARY.OLD), {promptNew: prompt.system.includes(CANARY.NEW), promptOld: prompt.system.includes(CANARY.OLD), readNew: read.includes(CANARY.NEW), readOld: read.includes(CANARY.OLD)}, prompt.evidence);
    if (qmdOk) {
      await refreshIndex(store);
      recordSearch('COR-04-SEARCH', await session.search(Q.correctionHan), {want: [CANARY.NEW], forbid: [CANARY.OLD]});
    }
  });
  await withRaw('cor05', async ({store, worker, session}) => {
    const {yesterday} = await worker.rpc('dates');
    seedDaily(store, yesterday, S.OLD);
    const removed = await session.forget(S.correctionMatch, 'daily');
    const prompt = await freshPrompt(worker);
    check('COR-05', !prompt.system.includes(CANARY.OLD), {forgetTodayText: removed.text.slice(0, 160), freshPromptHasOld: prompt.system.includes(CANARY.OLD), seed: "yesterday's log written directly as a labelled file fixture"}, prompt.evidence);
  });
  await withRaw('cor06', async ({session}) => {
    await session.write('long_term', S.OLD);
    await session.forget(S.correctionMatch);
    await session.write('long_term', S.NEW);
    const prompt = await session.injected();
    if (prompt.context === null) record('COR-06', 'GAP', {reason: 'Needs an SDK request capture.'}, 'core-probe');
    else check('COR-06', !prompt.context.includes(CANARY.OLD), {nextRequestContextHasOld: prompt.context.includes(CANARY.OLD), note: 'CyberMe sessions are in-memory per run, so host history owns this in production.'});
  });
  await withRaw('cor07', async ({session}) => {
    await session.write('long_term', S.OLD);
    await session.injected();
    await session.write('long_term', S.NEW);
    const prompt = await session.injected();
    check('COR-07', prompt.system.includes(CANARY.NEW), {injectedHasNew: prompt.system.includes(CANARY.NEW), mode: 'stable'}, prompt.evidence);
  });
  await withRaw('cor08', async ({store, session}) => {
    await session.write('long_term', S.NEW);
    await session.write('long_term', S.NEW);
    const occurrences = count(readSafe(join(store.memory, 'MEMORY.md')), CANARY.NEW);
    check('COR-08', occurrences === 1, {occurrences}, 'file');
  });
  await withRaw('cor09', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    await session.forget(S.correctionMatch);
    await session.write('long_term', S.NEW);
    const late = await session.write('long_term', S.OLD);
    const text = readSafe(join(store.memory, 'MEMORY.md'));
    check('COR-09', !text.includes(CANARY.OLD), {lateWriteError: late.isError, oldResurrected: text.includes(CANARY.OLD)}, 'file');
  });
  await withRaw('cor10', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    const removed = await session.forget(S.paraphraseMatch);
    const text = readSafe(join(store.memory, 'MEMORY.md'));
    check('COR-10', !text.includes(CANARY.OLD), {removed: removed.details?.removed, oldRemains: text.includes(CANARY.OLD)}, 'file');
  });
  await withRaw('cor11', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    await session.write('long_term', S.NEW);
    const removed = await session.forget(S.overbroadMatch);
    const text = readSafe(join(store.memory, 'MEMORY.md'));
    check('COR-11', text.includes(CANARY.NEW), {removed: removed.details?.removed, newRemains: text.includes(CANARY.NEW), match: S.overbroadMatch}, 'file');
  });
}

async function scenarioCorrectionAdapter() {
  const {adapter, stores} = newAdapter('cor');
  let scope = await adapter.project('project-a');
  const worker = scope.session.worker;
  const store = stores.get('project-a');
  const {today, yesterday} = await worker.rpc('dates');
  seedDaily(store, yesterday, S.OLD);
  await scope.write({content: S.OLD});
  await scope.write({target: 'daily', content: S.OLD});
  const staleEpoch = scope.epoch;
  await scope.correct({operationId: 'correct-1', oldMatch: S.correctionMatch, content: S.NEW, today, yesterday});
  const prompt = await freshPrompt(worker);
  const markdown = memoryMarkdown(store);
  check('COR-ADP-01', prompt.system.includes(CANARY.NEW) && !prompt.system.includes(CANARY.OLD) && !markdown.includes(CANARY.OLD), {promptNew: prompt.system.includes(CANARY.NEW), promptOld: prompt.system.includes(CANARY.OLD), markdownOld: markdown.includes(CANARY.OLD)}, prompt.evidence);

  const same = await scope.session.injected();
  if (same.context === null) record('COR-ADP-04', 'GAP', {reason: 'Needs an SDK request capture.'}, 'core-probe');
  else check('COR-ADP-04', !same.context.includes(CANARY.OLD), {nextRequestContextHasOld: same.context.includes(CANARY.OLD), note: 'Adapter does not scrub session transcripts; the host owns history.'});

  await scope.write({operationId: 'op-dup', content: S.UNRELATED});
  const repeat = await scope.write({operationId: 'op-dup', content: S.UNRELATED});
  const occurrences = count(readSafe(join(store.memory, 'MEMORY.md')), CANARY.UNRELATED);
  check('COR-ADP-02', repeat.duplicate === true && occurrences === 1, {duplicate: repeat.duplicate, occurrences}, 'file');

  const attempt = async () => {
    try {
      await scope.write({epoch: staleEpoch, content: S.OLD});
      return {rejected: false};
    } catch (error) {
      return {rejected: error instanceof ScopeError && error.code === 'memory_changed', code: error.code};
    }
  };
  const live = await attempt();
  await worker.stop();
  adapter.forgetHandles();
  scope = await adapter.project('project-a');
  const afterRestart = await attempt();
  check('COR-ADP-03', live.rejected && afterRestart.rejected && !memoryMarkdown(store).includes(CANARY.OLD), {live, afterRestart, oldInMarkdown: memoryMarkdown(store).includes(CANARY.OLD)}, 'file');
}

async function scenarioForgetLifecycle() {
  const store = newStore('fgt-main');
  let worker = await spawnWorker('fgtmain', store);
  const session = await worker.open();
  await session.write('long_term', S.OLD);
  await session.write('long_term', S.UNRELATED);
  await session.write('daily', S.OLD);
  await session.injected();
  let baselineHit = false;
  let probeQuery = Q.correctionHan;
  if (qmdOk) {
    await refreshIndex(store);
    // Use the first query proven to hit, so a Han tokenizer miss (RET-01) cannot void the stale probe.
    for (const query of [Q.correctionHan, Q.correctionAscii]) {
      if (judgeSearch(await session.search(query), {want: [CANARY.OLD]}).status === 'PASS') {
        baselineHit = true;
        probeQuery = query;
        break;
      }
    }
  }
  await session.forget(S.correctionMatch, 'long_term');
  const forgetDaily = await session.forget(S.correctionMatch, 'daily');
  const recoveryId = forgetDaily.details?.recoveryId;

  const same = await session.injected();
  const fresh = await freshPrompt(worker);
  const read = await session.read('long_term');
  const markdown = memoryMarkdown(store);
  check('FGT-01', !markdown.includes(CANARY.OLD) && !read.includes(CANARY.OLD) && !same.system.includes(CANARY.OLD) && !fresh.system.includes(CANARY.OLD), {sourceHasOld: markdown.includes(CANARY.OLD), readHasOld: read.includes(CANARY.OLD), sameSessionPromptHasOld: same.system.includes(CANARY.OLD), freshPromptHasOld: fresh.system.includes(CANARY.OLD)}, same.evidence);

  if (qmdOk) {
    const stale = judgeSearch(await session.search(probeQuery), {forbid: [CANARY.OLD]});
    if (!baselineHit) record('FGT-03', 'GAP', {reason: 'Baseline search before forget had no hit, so the stale window cannot be observed.', stale: stale.observed}, 'qmd');
    else record('FGT-03', stale.status, stale.observed, 'qmd');
    const perTurn = await spawnWorker('fgtperturn', store, {extra: {PI_MEMORY_SNAPSHOT: 'per-turn'}});
    const perTurnSession = await perTurn.open();
    const perTurnPrompt = await perTurnSession.injected(probeQuery);
    if (!baselineHit) record('FGT-03-PROMPT', 'GAP', {reason: 'Baseline search had no hit.'}, 'qmd');
    else check('FGT-03-PROMPT', !perTurnPrompt.system.includes(CANARY.OLD), {injectedHasOld: perTurnPrompt.system.includes(CANARY.OLD), mode: 'per-turn'}, 'qmd');
    await perTurn.stop();

    await refreshIndex(store);
    const afterUpdate = judgeSearch(await session.search(probeQuery), {forbid: [CANARY.OLD]});
    const keep = judgeSearch(await session.search('发布窗口决定'), {want: [CANARY.UNRELATED]});
    const status = [afterUpdate.status, keep.status].includes('FAIL') ? 'FAIL' : [afterUpdate.status, keep.status].includes('GAP') ? 'GAP' : 'PASS';
    record('FGT-04', status, {forgotten: afterUpdate.observed, unrelated: keep.observed}, 'qmd');
    const recoveryHit = await session.search(CANARY.OLD);
    check('FGT-06', !recoveryHit.isError && (recoveryHit.details?.count ?? 0) === 0 && recoveryText(store).includes(CANARY.OLD), {hits: recoveryHit.details?.count, recoveryStillHoldsPayload: recoveryText(store).includes(CANARY.OLD)}, 'qmd');
  }

  const retained = recoveryText(store).includes(CANARY.OLD);
  record('FGT-07', retained ? 'GAP' : 'PASS', {retainedPlaintextInRecoveryJson: retained, files: walk(join(store.memory, 'recovery')).length, note: 'Forget is reversible deletion, not erasure. Retention period and purge are unspecified upstream.'}, 'file');

  await session.close();
  await worker.stop();
  worker = await spawnWorker('fgtrestart', store);
  const reopened = await worker.open();
  const restartPrompt = await reopened.injected();
  const restartRead = await reopened.read('long_term');
  const restartMarkdown = memoryMarkdown(store);
  const recoveryRecord = recoveryId ? JSON.parse(readSafe(join(store.memory, 'recovery', `${recoveryId}.json`)) || '{}') : {};
  check('FGT-05', !restartMarkdown.includes(CANARY.OLD) && !restartRead.includes(CANARY.OLD) && !restartPrompt.system.includes(CANARY.OLD) && !recoveryRecord.restoredAt, {fileHasOld: restartMarkdown.includes(CANARY.OLD), readHasOld: restartRead.includes(CANARY.OLD), promptHasOld: restartPrompt.system.includes(CANARY.OLD), restoredAt: recoveryRecord.restoredAt ?? null}, restartPrompt.evidence);
  if (qmdOk) recordSearch('FGT-05-SEARCH', await reopened.search(probeQuery), {forbid: [CANARY.OLD]});

  const beforeShutdown = reopened.requestCount();
  await reopened.emit('session_shutdown', {reason: 'quit'});
  check('FGT-08', reopened.requestCount() === beforeShutdown && !memoryMarkdown(store).includes(CANARY.OLD), {modelRequests: reopened.requestCount() - beforeShutdown, oldInMarkdown: memoryMarkdown(store).includes(CANARY.OLD)}, 'direct-handler');
}

async function scenarioForgetEcho() {
  const run = async (id, open) => {
    const {store, session} = await open();
    const prompt = await session.injected();
    if (prompt.context === null) record(id, 'GAP', {reason: 'Needs an SDK request capture.'}, 'core-probe');
    else check(id, !prompt.context.includes(CANARY.OLD), {nextRequestContextHasForgotten: prompt.context.includes(CANARY.OLD), memoryClean: !memoryMarkdown(store).includes(CANARY.OLD)});
  };
  await run('FGT-02', async () => {
    const store = newStore('fgt-echo');
    const writer = await spawnWorker('fgtechow', store);
    const first = await writer.open();
    await first.write('long_term', S.OLD);
    await writer.stop();
    const worker = await spawnWorker('fgtecho', store);
    const session = await worker.open();
    await session.forget(S.correctionMatch);
    return {store, session};
  });
  if (transport === 'core') {
    record('FGT-02-ADP', 'GAP', {reason: 'Adapter hooks need a real SDK session.'}, 'core-probe');
    return;
  }
  await run('FGT-02-ADP', async () => {
    const {adapter, stores} = newAdapter('echo');
    const writer = await adapter.project('project-a');
    await writer.write({content: S.OLD});
    await writer.session.worker.stop();
    adapter.forgetHandles();
    const scope = await adapter.project('project-a', {policy: {redactForgetPreview: true}});
    await scope.forget({match: S.correctionMatch});
    return {store: stores.get('project-a'), session: scope.session};
  });
}

async function scenarioForgetExitSummary() {
  if (transport === 'core') {
    record('FGT-09', 'GAP', {reason: 'Needs an SDK session and model.'}, 'core-probe');
    return;
  }
  const store = newStore('fgt-exit');
  const worker = await spawnWorker('fgtexit', store, {extra: {PI_MEMORY_EXIT_SUMMARY: '1', PI_MEMORY_EXIT_SUMMARY_TIMEOUT_MS: '8000'}});
  const session = await worker.open();
  await session.write('long_term', S.OLD);
  await session.forget(S.correctionMatch);
  await session.emit('session_shutdown', {reason: 'quit'});
  const requests = session.exitSummaryRequests();
  const persisted = memoryMarkdown(store).includes(CANARY.OLD);
  if (requests.length === 0) {
    record('FGT-09', 'GAP', {reason: 'The exit summary never reached the fixture model on Pi 1.3.0 (likely API key or complete() path, index.ts:370-388). Re-extraction through it is unproven either way.', persisted}, 'direct-handler');
  } else {
    const sent = JSON.stringify(requests[0].body).includes(CANARY.OLD);
    check('FGT-09', !sent && !persisted, {forgottenSentToModel: sent, persistedAfterLabelledFixtureSummary: persisted, label: 'Fixture summary echoes canaries. It shows pipeline reachability, not LLM behaviour.'}, 'direct-handler');
  }
}

async function scenarioForgetEdges() {
  await withRaw('fgt10', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    await session.write('daily', S.OLD);
    await session.forget(S.correctionMatch, 'long_term');
    await session.forget(S.correctionMatch, 'daily');
    await session.injected();
    await session.emit('session_before_compact');
    const markdown = memoryMarkdown(store);
    check('FGT-10', !markdown.includes(CANARY.OLD), {oldInMarkdown: markdown.includes(CANARY.OLD)}, 'direct-handler');
  });
  await withRaw('fgt11', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    await session.write('daily', S.OLD);
    await session.forget(S.correctionMatch);
    await session.injected();
    const before = count(memoryMarkdown(store), CANARY.OLD);
    await session.emit('session_before_compact');
    const after = count(memoryMarkdown(store), CANARY.OLD);
    check('FGT-11', after === before, {occurrencesBefore: before, occurrencesAfter: after}, 'direct-handler');
  });
  await withRaw('fgt12', async ({store, worker, session}) => {
    await session.tool('scratchpad', {action: 'add', text: S.SCRATCH});
    const removed = await session.forget('回复字体偏好待办');
    const prompt = await freshPrompt(worker);
    const inFile = memoryMarkdown(store).includes(CANARY.SCRATCH);
    check('FGT-12', !inFile || !prompt.system.includes(CANARY.SCRATCH), {removed: removed.details?.removed ?? 0, inScratchpadFile: inFile, inFreshPrompt: prompt.system.includes(CANARY.SCRATCH)}, prompt.evidence);
  });
  if (transport === 'core') {
    for (const id of ['FGT-13', 'FGT-13-ALLOW', 'FGT-13-ADP']) record(id, 'GAP', {reason: 'Needs real SDK tool gating.'}, 'core-probe');
  } else {
    await withRaw('fgt13', async ({store, session}) => {
      await session.write('long_term', S.OLD);
      const before = memoryDigest(store);
      await session.forget(S.correctionMatch);
      check('FGT-13', memoryDigest(store) === before, {mutated: memoryDigest(store) !== before, note: 'Upstream has no read-only mode to enable; the default session is the only native state.'}, 'file');
    });
    const store = newStore('fgt13-allow');
    const seedWorker = await spawnWorker('fgt13seed', store);
    const seed = await seedWorker.open();
    await seed.write('long_term', S.OLD);
    await seedWorker.stop();
    const allowWorker = await spawnWorker('fgt13allow', store);
    const allowed = await allowWorker.open({tools: ['memory_read', 'memory_search']});
    const before = memoryDigest(store);
    const attempt = await allowed.tool('memory_forget', {match: S.correctionMatch}, {allowMissing: true});
    const prompt = await allowed.injected();
    if (!(allowed.info.activeTools || []).includes('memory_read')) record('FGT-13-ALLOW', 'GAP', {reason: 'Allowlisted extension tool was not active.', activeTools: allowed.info.activeTools}, 'sdk-turn');
    else check('FGT-13-ALLOW', memoryDigest(store) === before && !(prompt.tools || []).includes('memory_forget'), {mutated: memoryDigest(store) !== before, activeTools: allowed.info.activeTools, declaredTools: prompt.tools, attempt: {isError: attempt.isError, text: attempt.text?.slice(0, 200)}});
    await allowWorker.stop();

    const {adapter, stores} = newAdapter('readonly');
    const writer = await adapter.project('project-a');
    await writer.write({content: S.OLD});
    await writer.session.worker.stop();
    adapter.forgetHandles();
    const readOnly = await adapter.project('project-a', {policy: {readOnly: true}});
    const roStore = stores.get('project-a');
    const roBefore = memoryDigest(roStore);
    const blocked = await readOnly.session.tool('memory_forget', {match: S.correctionMatch}, {allowMissing: true});
    check('FGT-13-ADP', memoryDigest(roStore) === roBefore, {mutated: memoryDigest(roStore) !== roBefore, blocked: {isError: blocked.isError, text: blocked.text?.slice(0, 200)}});
  }
  await withRaw('fgt14', async ({store, session}) => {
    await session.write('long_term', S.UNRELATED);
    const before = memoryDigest(store);
    const attempts = [];
    for (const id of ['not-a-uuid', '../../MEMORY', '00000000-0000-4000-8000-000000000000']) {
      const result = await session.restore(id);
      attempts.push({id, isError: result.isError});
    }
    check('FGT-14', attempts.every(entry => entry.isError) && memoryDigest(store) === before, {attempts, unchanged: memoryDigest(store) === before});
  });
  await withRaw('fgt15', async ({store, session}) => {
    await session.write('long_term', S.OLD);
    const forgotten = await session.forget(S.correctionMatch);
    const recoveryId = forgotten.details?.recoveryId;
    const first = await session.restore(recoveryId);
    const second = await session.restore(recoveryId);
    const occurrences = count(readSafe(join(store.memory, 'MEMORY.md')), CANARY.OLD);
    check('FGT-15', !first.isError && !second.isError && occurrences === 1, {occurrences, secondText: second.text.slice(0, 120)});
  });
}

async function scenarioRetrieval() {
  if (qmdOk) {
    await withRaw('ret', async ({store, session}) => {
      await session.write('long_term', S.OLD);
      await session.write('long_term', S.A1);
      await refreshIndex(store);
      recordSearch('RET-01', await session.search(Q.correctionHan), {want: [CANARY.OLD]});
      recordSearch('RET-02', await session.search(Q.correctionSubstring), {want: [CANARY.OLD]});
      recordSearch('RET-03', await session.search(Q.correctionAscii), {want: [CANARY.OLD]});
      const unrelated = await session.search(Q.negativeUnrelated);
      const absent = await session.search(Q.negativeToken);
      const negativeHits = (unrelated.details?.count ?? 0) + (absent.details?.count ?? 0);
      if (unrelated.isError || absent.isError) record('RET-04', 'GAP', {unrelatedError: unrelated.isError, absentError: absent.isError, text: unrelated.text.slice(0, 200)}, 'qmd');
      else check('RET-04', negativeHits === 0, {negativeHits}, 'qmd');
      const near = await session.search(Q.negativeNearTopic);
      if (near.isError) record('RET-05', 'GAP', {text: near.text.slice(0, 200)}, 'qmd');
      else check('RET-05', (near.details?.count ?? 0) === 0, {hits: near.details?.count ?? 0, text: near.text.slice(0, 300)}, 'qmd');
      const argv = await session.search(Q.argvInjection);
      const alternate = walk(store.dir, path => path.includes('pmlargvprobe'));
      check('RET-06', !argv.isError && alternate.length === 0, {isError: argv.isError, alternateIndexFiles: alternate.length, text: argv.text.slice(0, 300)}, 'qmd');
    });
    const firstRun = newStore('ret08-first-run', {createMemoryDir: false});
    const worker = await spawnWorker('ret08', firstRun);
    await worker.open();
    const listed = await runQmd(firstRun, ['collection', 'list']);
    check('RET-08', listed.ok && listed.stdout.includes('pi-memory'), {listed: listed.stdout.slice(0, 300), stderr: listed.stderr.slice(0, 200), note: 'All other stores pre-create the memory directory, so this surface is measured only here.'}, 'qmd');
    await worker.stop();
  }
  await withRaw('ret07', async ({worker, session}) => {
    const write = await session.write('long_term', S.UNRELATED);
    const read = await session.read('long_term');
    const search = await session.search(Q.correctionHan);
    const prompt = await freshPrompt(worker);
    check('RET-07', !write.isError && read.includes(CANARY.UNRELATED) && search.isError && /requires qmd/i.test(search.text) && prompt.system.includes(CANARY.UNRELATED), {writeError: write.isError, readOk: read.includes(CANARY.UNRELATED), searchError: search.isError, searchText: search.text.slice(0, 120), promptOk: prompt.system.includes(CANARY.UNRELATED)});
  }, {noQmd: true});
}

// ---- Sentinels (stat only) and final reporting ----
const sentinelPaths = ['.pi/agent/memory', '.pi/agent/memory/MEMORY.md', '.pi/agent/settings.json', '.cache/qmd/index.sqlite', '.config/qmd/index.yml'].map(rel => join(homedir(), rel));
const sentinels = () =>
  Object.fromEntries(
    sentinelPaths.map(path => {
      const stat = statSync(path, {throwIfNoEntry: false});
      return [path, stat ? {size: stat.size, mtimeMs: stat.mtimeMs} : null];
    }),
  );
const qmdVersion = async () => {
  const result = await runQmd(newStore('qmd-version'), ['--version']);
  return result.ok ? result.stdout.trim() : `unavailable: ${result.stderr || result.error}`;
};
const packageVersion = name => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return 'unavailable';
  }
};

function pinCheck() {
  if (!upstreamIndex || !existsSync(upstreamIndex)) return {ok: false, reason: 'PI_MEMORY_UPSTREAM is missing or does not exist.'};
  const digest = sha256(readFileSync(upstreamIndex));
  const packagePath = join(dirname(upstreamIndex), 'package.json');
  const version = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')).version : null;
  return {ok: digest === frozen.pin.indexSha256 && (version === null || version === frozen.pin.version), digest, version, path: upstreamIndex, insideRepo: upstreamIndex.startsWith(`${ROOT}/`)};
}

function finalize(meta) {
  const rows = expected.map(entry => {
    const found = results.get(entry.resultId);
    const fallback = entry.notRun
      ? {status: 'NOT_RUN', observed: {reason: entry.notRun}, evidence: 'none'}
      : entry.requiresQmd && !qmdOk
        ? {status: 'NOT_RUN', observed: {reason: 'QMD_BIN not provided or missing.'}, evidence: 'none'}
        : {status: 'NOT_RUN', observed: {reason: 'Scenario not reached.'}, evidence: 'none'};
    return {id: entry.resultId, group: entry.group, scope: entry.scope, requirement: entry.requirement, predicted: entry.predicted, ...(found || fallback)};
  });
  const tally = list => list.reduce((sum, row) => ({...sum, [row.status]: (sum[row.status] || 0) + 1}), {PASS: 0, FAIL: 0, GAP: 0, NOT_RUN: 0});
  const envRows = rows.filter(row => row.group === 'environment' && row.id !== 'ENV-05');
  const unreached = rows.filter(row => row.status === 'NOT_RUN' && row.observed.reason === 'Scenario not reached.');
  const scenarioGaps = rows.filter(row => row.evidence === 'harness');
  const complete = !meta.aborted && !unreached.length && !scenarioGaps.length && !harnessErrors.length && envRows.every(row => row.status === 'PASS');
  const decide = list => (!complete ? 'NO_DECISION_HARNESS_INCOMPLETE' : list.some(row => row.status === 'FAIL') ? 'NO_GO' : list.some(row => row.status === 'GAP') ? 'INCONCLUSIVE' : 'NO_BLOCKER_OBSERVED_NOT_PRODUCTION_APPROVAL');
  const behaviour = rows.filter(row => row.group !== 'environment');
  const report = {
    runId,
    harness: {status: complete ? 'COMPLETE' : 'INCOMPLETE', errors: harnessErrors, note: 'Harness status says whether the experiment ran. It is not product readiness.'},
    decision: {raw: decide(behaviour.filter(row => row.scope === 'raw')), adapter: decide(behaviour.filter(row => row.scope === 'adapter')), production: 'NOT_APPROVED_BY_THIS_LAB'},
    summary: {all: tally(rows), raw: tally(rows.filter(row => row.scope === 'raw')), adapter: tally(rows.filter(row => row.scope === 'adapter'))},
    surprises: rows.filter(row => row.predicted !== row.status).map(row => ({id: row.id, predicted: row.predicted, status: row.status})),
    meta,
    labels: {
      model: 'Deterministic HTTP fixture on 127.0.0.1:46837. No live LLM. Model capability is NOT tested.',
      directHandler: 'direct-handler evidence invokes the real upstream handler with the context captured from the real session.',
      semantic: 'qmd vsearch, qmd query, qmd embed and memory_status were never invoked.',
      seam: 'CONC-RAW-* uses upstream _setBaseDir, a test seam, solely to demonstrate shared-process hazards.',
    },
    adapter: {guarantees: ADAPTER_GUARANTEES, nonGuarantees: ADAPTER_NON_GUARANTEES},
    results: rows,
  };
  writeFileSync(join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const cell = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const markdown = [
    `# pi-memory lab ${runId}`,
    '',
    `Harness: **${report.harness.status}** · Raw: **${report.decision.raw}** · Adapter: **${report.decision.adapter}** · Production: **${report.decision.production}**`,
    '',
    report.labels.model,
    '',
    '| ID | Scope | Status | Predicted | Evidence | Requirement |',
    '|---|---|---|---|---|---|',
    ...rows.map(row => `| ${row.id} | ${row.scope} | ${row.status} | ${row.predicted} | ${row.evidence} | ${cell(row.requirement)} |`),
    '',
  ].join('\n');
  writeFileSync(join(evidenceRoot, 'report.md'), markdown);
  const requestLog = [...fixture.requests].flatMap(([key, list]) => list.map(entry => JSON.stringify({worker: key, exitSummary: entry.exitSummary, body: entry.body})));
  writeFileSync(join(evidenceRoot, 'fixture-requests.jsonl'), requestLog.join('\n'));
  console.log(JSON.stringify({runId, harness: report.harness.status, decision: report.decision, summary: report.summary.all, evidence: evidenceRoot}, null, 2));
  return complete;
}

async function main() {
  const before = sentinels();
  const meta = {
    node: process.version,
    piCodingAgent: packageVersion('@earendil-works/pi-coding-agent'),
    qmd: qmdOk ? await qmdVersion() : 'not provided',
    requestedTransport,
    casesSha256: FROZEN_CASES_SHA256,
    supplementCasesSha256: sha256(supplementRaw),
    stateRoot,
    aborted: false,
  };
  const pin = pinCheck();
  meta.pin = pin;
  check('ENV-01', pin.ok, pin, 'file');
  if (!upstreamIndex || !existsSync(upstreamIndex)) {
    meta.aborted = true;
    return finalize(meta);
  }
  await startFixture();
  try {
    const smokeIds = ['ENV-02', 'ENV-05'];
    await scenario('smoke', smokeIds, scenarioSmoke);
    if (results.get('ENV-02')?.evidence === 'harness') {
      if (requestedTransport === 'sdk') {
        meta.aborted = true;
        return finalize(meta);
      }
      // Explicit fallback: the spec allows core probes plus a stated gap, never a claimed SDK run.
      transport = 'core';
      meta.sdkFailure = results.get('ENV-02').observed;
      results.get('ENV-02').evidence = 'gap-sdk-infeasible';
      results.get('ENV-05').evidence = 'gap-sdk-infeasible';
      harnessErrors.length = 0;
    }
    meta.transportUsed = transport;
    for (const order of ['AB', 'BA']) {
      await scenario(`isolation-raw-${order}`, idsFor(...['ISO-RAW-READ', 'ISO-RAW-PROMPT', 'ISO-RAW-SEARCH', 'ISO-RAW-FORGET', 'ISO-RAW-CORRECT'].map(id => `${id}:${order}`)), () => scenarioIsolationRaw(order));
      await scenario(`isolation-adapter-${order}`, idsFor(...['ISO-ADP-READ', 'ISO-ADP-PROMPT', 'ISO-ADP-SEARCH', 'ISO-ADP-FORGET', 'ISO-ADP-CORRECT'].map(id => `${id}:${order}`)), () => scenarioIsolationAdapter(order));
    }
    await scenario('adapter-scopes', ['ISO-ADP-UNKNOWN', 'ISO-ADP-GLOBAL', 'ISO-ADP-RESTORE'], scenarioAdapterScopes);
    await scenario('concurrency', ['CONC-RAW-WRITE', 'CONC-RAW-SNAPSHOT', 'CONC-ADP'], scenarioConcurrency);
    await scenario('correction-raw', idsFor('COR-01', 'COR-02', 'COR-03', 'COR-04', 'COR-04-SEARCH', 'COR-05', 'COR-06', 'COR-07', 'COR-08', 'COR-09', 'COR-10', 'COR-11'), scenarioCorrectionRaw);
    await scenario('correction-adapter', ['COR-ADP-01', 'COR-ADP-02', 'COR-ADP-03', 'COR-ADP-04'], scenarioCorrectionAdapter);
    await scenario('forget-lifecycle', idsFor('FGT-01', 'FGT-03', 'FGT-03-PROMPT', 'FGT-04', 'FGT-05', 'FGT-05-SEARCH', 'FGT-06', 'FGT-07', 'FGT-08'), scenarioForgetLifecycle);
    await scenario('forget-echo', ['FGT-02', 'FGT-02-ADP'], scenarioForgetEcho);
    await scenario('forget-exit-summary', ['FGT-09'], scenarioForgetExitSummary);
    await scenario('forget-edges', ['FGT-10', 'FGT-11', 'FGT-12', 'FGT-13', 'FGT-13-ALLOW', 'FGT-13-ADP', 'FGT-14', 'FGT-15'], scenarioForgetEdges);
    await scenario('retrieval', idsFor('RET-01', 'RET-02', 'RET-03', 'RET-04', 'RET-05', 'RET-06', 'RET-07', 'RET-08'), scenarioRetrieval);

    if (qmdOk) await scenario('supplement', idsFor(...supplement.cases.map(entry => entry.id)), () => runSupplement({newAdapter, S, CANARY, refreshIndex, judgeSearch, record, check, spawnWorker, memoryMarkdown}));

    const after = sentinels();
    const changed = Object.keys(before).filter(path => JSON.stringify(before[path]) !== JSON.stringify(after[path]));
    const indexes = walk(stateRoot, path => path.endsWith('.sqlite')).length;
    check('ENV-03', changed.length === 0 && (!qmdOk || indexes > 0), {changedSentinels: changed, isolatedIndexes: indexes, qmdProvided: qmdOk}, 'file');
    if (transport === 'sdk') {
      const loaded = walk(join(stateRoot, 'discovery-trap'));
      check('ENV-04', loaded.length === 0, {trapsExecuted: loaded.length}, 'file');
    } else {
      record('ENV-04', 'GAP', {reason: 'Core-probe transport does not exercise resource discovery.'}, 'core-probe');
    }
  } finally {
    for (const worker of [...workers]) await worker.stop().catch(() => {});
    await new Promise(done => {
      fixture.server.close(done);
      fixture.server.closeAllConnections?.();
    });
  }
  return finalize(meta);
}

main().then(
  complete => process.exit(complete ? 0 : 2),
  error => {
    console.error(error);
    try {
      harnessErrors.push(String(error?.stack || error));
      finalize({aborted: true, fatal: String(error?.message || error)});
    } catch {
      // Evidence writing failed too; the non-zero exit still reports the failure.
    }
    process.exit(2);
  },
);
