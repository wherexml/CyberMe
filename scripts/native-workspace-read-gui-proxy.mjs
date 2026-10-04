#!/usr/bin/env node
// Dedicated public workspace read recovery harness. No model, body/header logs, or writes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { Transform, pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url), ROOT = path.resolve(path.dirname(SELF), '..');
const OUT = path.join(ROOT, 'output/native-parity-20261003/workspace-read-gui-proxy');
const SCOPE = '01bba21f-1f1c-4d67-9e3f-71bf6fdc31b3';
const SOURCE_PATHS = ['scripts/native-workspace-read-gui-proxy.mjs', 'server/src/index.ts', 'server/src/store.ts', 'server/src/native-api.ts', 'server/src/integrations.ts', 'server/src/model-settings.ts', 'server/src/workspace-search.ts', 'server/src/policy.ts'];
const sha = x => createHash('sha256').update(x).digest('hex');
const utc = () => new Date().toISOString();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const loopback = addr => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
const MAX_DETAIL = 2 * 1024 * 1024, MAX_RAM = 8 * 1024 * 1024, MAX_RECORDS = 128, MAX_MS = 15000;
function safeLocalFile(file) {
  const full = path.resolve(file);
  if (!full.startsWith(ROOT + '/') || fs.realpathSync(full) !== full) throw Error('local_path_gate');
  for (let p = full; p !== ROOT; p = path.dirname(p)) if (fs.lstatSync(p).isSymbolicLink()) throw Error('local_path_gate');
  if (!fs.lstatSync(full).isFile()) throw Error('local_path_gate');
  return full;
}
function listeners(port) {
  try { return [...new Set(execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' }).split('\n').filter(s => /^p\d+$/.test(s)).map(s => Number(s.slice(1))))]; }
  catch (error) { if (error.status === 1) return []; throw Error('listener_gate'); }
}
function pidProof(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('pid_gate');
  return { argsSHA256: sha(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'args=']).toString().trim()), startedSHA256: sha(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=']).toString().trim()) };
}
function sourceProof(paths) { return Object.fromEntries(paths.map(p => [p, sha(fs.readFileSync(safeLocalFile(path.join(ROOT, p))))])); }
function runtimeGate(config) {
  if (JSON.stringify(listeners(config.upstreamPort)) !== JSON.stringify([config.upstreamPID])) throw Error('listener_pid_gate');
  const proof = pidProof(config.upstreamPID);
  if (proof.argsSHA256 !== config.upstreamArgsSHA256 || proof.startedSHA256 !== config.upstreamStartedSHA256) throw Error('pid_identity_gate');
  for (const [p, digest] of Object.entries(config.sourceHashes)) if (sha(fs.readFileSync(safeLocalFile(path.join(ROOT, p)))) !== digest) throw Error('source_hash_gate');
  if (config.mode === 'production') {
    const db = safeLocalFile(config.databaseFile);
    if (!db.startsWith(path.join(ROOT, '.local/acceptance/native-settings-gui-v12/') )) throw Error('database_scope_gate');
    const proof = execFileSync('/usr/sbin/lsof', ['-nP', '-a', '-p', String(config.upstreamPID), '-Fp', db], { encoding: 'utf8' });
    if (!proof.split('\n').includes('p' + config.upstreamPID)) throw Error('database_owner_gate');
  }
}
function validateConfig(config) {
  if (config.schema !== 1 || !UUID.test(config.scope) || !['production', 'http-fixture'].includes(config.mode)) throw Error('config_scope_gate');
  if (![config.port, config.upstreamPort].every(n => Number.isInteger(n) && n >= 10000 && n <= 65535) || config.port === config.upstreamPort) throw Error('ports_gate');
  if (config.mode === 'production' && (config.scope !== SCOPE || config.port !== 46242 || config.upstreamPort !== 46214)) throw Error('production_scope_gate');
  if (config.mode === 'http-fixture' && (config.port !== 46244 || config.upstreamPort !== 46243)) throw Error('fixture_ports_gate');
  if (!Array.isArray(config.allow) || !config.allow.length || config.allow.length > 24 || Object.keys(config.sourceHashes ?? {}).length > 8) throw Error('config_allow_gate');
  const keys = new Set(), routes = new Set();
  for (const item of config.allow) {
    if (!/^[a-z0-9-]{1,60}$/.test(item.key) || keys.has(item.key) || routes.has(item.route) || !['tasks', 'inbox', 'ideas', 'memories'].includes(item.kind)) throw Error('config_allow_gate');
    const exact = '/api/' + item.kind + '/' + item.entityId;
    if (!/^[\w-]{1,180}$/.test(item.entityId) || ![exact, exact + '?includeDeleted=true'].includes(item.route)) throw Error('exact_public_route_gate');
    if (config.mode === 'production' && !(item.entityId.startsWith('OPSADV-QA-WORKSPACE-' + SCOPE + '-') || ['memory-settings-gui-4530b843-ed06-44aa-b31b-f70a66eea2d0', 'memory-settings-gui-v12-second'].includes(item.entityId))) throw Error('public_id_gate');
    if (config.mode === 'http-fixture' && !item.entityId.startsWith('OPSADV-QA-READ-' + config.scope + '-')) throw Error('fixture_id_gate');
    keys.add(item.key); routes.add(item.route);
  }
  const expectedSources = config.mode === 'production' ? SOURCE_PATHS : ['scripts/native-workspace-read-gui-proxy.mjs', config.fixtureSource];
  if (Object.keys(config.sourceHashes).sort().join('|') !== expectedSources.sort().join('|')) throw Error('source_keys_gate');
  if (config.mode === 'http-fixture' && (!config.fixtureSource?.startsWith('output/native-parity-20261003/workspace-read-gui-proxy/http-e2e/') || !config.fixtureSource.endsWith('/fixture-entry.mjs'))) throw Error('fixture_source_gate');
  runtimeGate(config);
}
const cleanHeaders = headers => Object.fromEntries(Object.entries(headers).filter(([k]) => !['connection', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade'].includes(k.toLowerCase())));
function reply(res, status, value) { if (!res.destroyed && !res.writableEnded) { if (res.headersSent) res.destroy(); else res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value)); } }
async function boundedFetch(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(MAX_MS), redirect: 'manual' });
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > MAX_DETAIL) throw Error('qualification_size_gate'); chunks.push(chunk); }
  const buffer = Buffer.concat(chunks), hash = sha(buffer);
  let value; try { value = JSON.parse(buffer.toString('utf8')); } finally { buffer.fill(0); for (const chunk of chunks) chunk.fill(0); }
  return { status: response.status, bytes, hash, value };
}
async function startupQualification(config) {
  const health = await boundedFetch(`http://127.0.0.1:${config.upstreamPort}/api/health`);
  if (health.status !== 200 || health.value?.ok !== true || (config.mode === 'http-fixture' && health.value.scope !== config.scope)) throw Error('health_scope_gate');
  const entities = [];
  for (const item of config.allow) {
    const result = await boundedFetch(`http://127.0.0.1:${config.upstreamPort}${item.route}`);
    if (result.status !== 200 || result.value?.id !== item.entityId) throw Error('qualification_entity_gate');
    entities.push({ key: item.key, id: item.entityId, kind: item.kind, status: result.status, bytes: result.bytes, sha256: result.hash });
  }
  runtimeGate(config);
  return { health: { status: health.status, bytes: health.bytes, sha256: health.hash }, entities };
}
function metadata(value, item) {
  if (value?.id !== item.entityId) throw Error('response_entity_gate');
  const fields = {};
  for (const key of ['body', 'content', 'notes', 'description']) if (typeof value[key] === 'string') fields[key] = { characters: value[key].length, sha256: sha(value[key]) };
  return { id: item.entityId, kind: item.kind, fields, updatedAtSHA256: typeof value.updatedAt === 'string' ? sha(value.updatedAt) : null };
}
// Method alone cannot prove a read-only route: calendar/binding GETs mutate or invoke CLI.
// This pure-read allowlist is independent of the exact next-fault targets.
function safeReadRoute(config, url, rawRoute) {
  const staticPaths = new Set(['/api/health', '/api/bootstrap', '/api/settings', '/api/settings/models', '/api/settings/history', '/api/native/version', '/api/native/events']);
  if (staticPaths.has(url.pathname)) return !url.search && rawRoute === url.pathname;
  if (config.mode === 'http-fixture' && ['/api/events', '/api/public-large'].includes(rawRoute)) return true;
  // Reject aliases/duplicate query fields; only explicit public detail owners are permitted.
  const params = [...url.searchParams], keys = new Set(params.map(([key]) => key));
  if (keys.size !== params.length || rawRoute.split('?')[0] !== url.pathname || /%|\\|\/\/|\.\./.test(url.pathname)) return false;
  const numeric = (v, max, min = 0) => /^\d{1,7}$/.test(v) && Number(v) >= min && Number(v) <= max;
  function query(rules) { return params.every(([key, value]) => rules[key]?.(value) === true); }
  const listRules = { offset: v => numeric(v, 1000000), limit: v => numeric(v, 200, 1), query: v => v.length <= 500, status: v => /^[a-z_]{1,50}$/.test(v), deleted: v => ['true', 'false'].includes(v), includeDeleted: v => ['true', 'false'].includes(v) };
  if (config.allow.some(item => url.pathname === '/api/' + item.kind + '/' + item.entityId)) return query({ includeDeleted: v => ['true', 'false'].includes(v) });
  if (['/api/tasks', '/api/ideas', '/api/inbox', '/api/memories', '/api/connections'].includes(url.pathname)) return query(listRules);
  if (url.pathname === '/api/inbox/query') return query({ ...listRules, includeQuiet: v => ['true', 'false'].includes(v), includeDone: v => ['true', 'false'].includes(v) });
  if (url.pathname === '/api/workspace/search') return query({ q: v => v.length <= 500, kind: v => ['all', 'tasks', 'inbox', 'ideas', 'memories', 'conversations', 'messages', 'projects', 'artifacts', 'activities', 'automations'].includes(v), offset: v => numeric(v, 1000000), limit: v => numeric(v, 100, 1), revision: v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 });
  // Public Inbox policy/feedback only read audited local state; all other subroutes deny.
  if (!url.search && config.allow.some(item => item.kind === 'inbox' && ['/api/inbox/' + item.entityId + '/policy', '/api/inbox/' + item.entityId + '/feedback'].includes(rawRoute))) return true;
  return false;
}
async function startProxy(file) {
  const config = JSON.parse(fs.readFileSync(safeLocalFile(file), 'utf8'));
  validateConfig(config);
  if (listeners(config.port).length) throw Error('proxy_port_in_use');
  const qualification = await startupQualification(config);
  const byKey = new Map(config.allow.map(x => [x.key, x])), byRoute = new Map(config.allow.map(x => [x.route, x]));
  const receipts = [], timers = new Set(), sockets = new Set(), operations = new Set();
  let armed = null, held = null, sequence = 0, ram = 0;
  const stats = { startedAt: utc(), requests: 0, forwardedGET: 0, blockedWrites: 0, consumed: 0, rejected: 0, dropped: 0, cancelled: 0, expired: 0, errors: 0 };
  const timer = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const untimer = t => { if (t) { clearTimeout(t); timers.delete(t); } };
  const status = () => ({ scope: config.scope, mode: config.mode, port: config.port, upstreamPort: config.upstreamPort, upstreamPID: config.upstreamPID, configurationSHA256: sha(JSON.stringify(config)), qualification, stats, armed: armed ? { owner: armed.owner, target: armed.target, mode: armed.mode, delayMs: armed.delayMs, armedAt: armed.at } : null, held: held ? { owner: held.owner, target: held.item.key, ready: held.ready, sequence: held.record.sequence } : null, retainedBytes: ram, activeTimers: timers.size, activeOperations: operations.size, receipts });
  function record(value) { const row = { at: utc(), sequence: ++sequence, ...value }; receipts.push(row); if (receipts.length > MAX_RECORDS) receipts.shift(); return row; }
  function disarm() { if (armed) { untimer(armed.timer); armed = null; } }
  function clearOperation(op) {
    if (op.done) return false;
    op.done = true; untimer(op.deadline); untimer(op.holdTimer);
    if (op.buffer) { op.buffer.fill(0); op.buffer = null; ram -= MAX_DETAIL; }
    if (held === op) held = null;
    operations.delete(op); return true;
  }
  function fail(op, code, error) {
    if (!clearOperation(op)) return;
    op.record.outcome = error; op.record.finishedAt = utc(); stats.errors++;
    op.upstream?.destroy(); op.incoming?.destroy(); reply(op.res, code, { error });
  }
  function cancel(op, reason) {
    if (!clearOperation(op)) return;
    op.record.outcome = reason; op.record.finishedAt = utc(); stats.cancelled++;
    op.upstream?.destroy(); op.incoming?.destroy(); if (!op.res.destroyed) reply(op.res, 499, { error: 'qa_read_cancelled' });
  }
  function deliver(op) {
    if (op.done || op.delivering) return;
    op.delivering = true;
    try { runtimeGate(config); } catch { return fail(op, 503, 'qa_runtime_gate_changed'); }
    if (op.res.destroyed) return cancel(op, 'client_aborted');
    const data = op.buffer.subarray(0, op.used);
    op.res.writeHead(op.httpStatus, op.headers);
    op.res.end(data, () => {
      if (!clearOperation(op)) return;
      op.record.outcome = op.fault === 'hold' ? 'held_delivered' : 'delivered'; op.record.finishedAt = utc();
    });
  }
  async function control(req, res, url) {
    if (req.headers.origin || req.headers.referer || req.headers['sec-fetch-site']) { req.resume(); return reply(res, 403, { error: 'control_browser_origin_blocked' }); }
    if (url.pathname === '/__qa/status' && req.method === 'GET' && !url.search) { req.resume(); return reply(res, 200, status()); }
    if (url.pathname !== '/__qa/control' || req.method !== 'POST' || url.search) { req.resume(); return reply(res, 405, { error: 'control_route_or_method' }); }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) { req.resume(); return reply(res, 415, { error: 'control_json_required' }); }
    let raw = '', tooLarge = false; const timeout = timer(() => req.destroy(), 3000);
    try {
      for await (const chunk of req) { if (Buffer.byteLength(raw) + chunk.length > 4096) { tooLarge = true; raw = ''; } else if (!tooLarge) raw += chunk.toString('utf8'); }
      if (tooLarge) return reply(res, 413, { error: 'control_size_limit' });
      let value; try { value = JSON.parse(raw); } catch { return reply(res, 400, { error: 'control_invalid_json' }); }
      raw = '';
      if (!value || typeof value !== 'object' || !UUID.test(value.owner ?? '') || !['arm', 'release', 'cancel'].includes(value.action)) return reply(res, 400, { error: 'control_invalid_owner_or_action' });
      const keys = Object.keys(value).sort().join('|');
      if (value.action === 'arm') {
        if (keys !== 'action|delayMs|mode|owner|target' || !byKey.has(value.target) || !['reject', 'hold', 'drop'].includes(value.mode) || !Number.isInteger(value.delayMs) || value.delayMs < 1 || value.delayMs > MAX_MS) return reply(res, 400, { error: 'control_invalid_arm' });
        if (armed || held) return reply(res, 409, { error: 'control_operation_in_use' });
        try { runtimeGate(config); } catch { return reply(res, 503, { error: 'qa_runtime_gate_changed' }); }
        armed = { owner: value.owner, target: value.target, mode: value.mode, delayMs: value.delayMs, at: utc() };
        armed.timer = timer(() => { if (armed?.owner === value.owner) { record({ method: 'CONTROL', target: value.target, owner: value.owner, outcome: 'armed_expired' }); disarm(); stats.expired++; } }, MAX_MS);
        return reply(res, 200, status());
      }
      if (keys !== 'action|owner') return reply(res, 400, { error: 'control_invalid_fields' });
      const current = held ?? armed;
      if (!current || current.owner !== value.owner) return reply(res, 409, { error: 'control_owner_mismatch_or_idle' });
      if (value.action === 'cancel') { if (held) cancel(held, 'control_cancelled'); else disarm(); return reply(res, 200, status()); }
      if (!held?.ready || held.delivering) return reply(res, 409, { error: 'control_hold_not_ready' });
      deliver(held); return reply(res, 200, status());
    } catch { if (!res.destroyed) reply(res, 400, { error: 'control_request_aborted' }); }
    finally { untimer(timeout); }
  }
  const server = http.createServer((req, res) => {
    stats.requests++;
    if (!loopback(req.socket.remoteAddress) || req.headers.host !== `127.0.0.1:${config.port}`) { req.resume(); return reply(res, 403, { error: 'loopback_host_only' }); }
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || /[\r\n]/.test(req.url)) { req.resume(); return reply(res, 400, { error: 'relative_route_required' }); }
    const url = new URL(req.url, `http://127.0.0.1:${config.port}`);
    if (url.pathname.startsWith('/__qa/')) { void control(req, res, url); return; }
    if (req.method !== 'GET') { req.resume(); stats.blockedWrites++; record({ method: req.method, routeSHA256: sha(req.url), outcome: 'write_or_unknown_method_blocked', status: 403 }); return reply(res, 403, { error: 'qa_read_proxy_only_get' }); }
    if (!url.pathname.startsWith('/api/') || req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0) { req.resume(); return reply(res, 400, { error: 'api_get_without_body_required' }); }
    if (!safeReadRoute(config, url, req.url)) { req.resume(); record({ method: 'GET', routeSHA256: sha(req.url), outcome: 'unsafe_or_unknown_get_blocked', status: 403 }); return reply(res, 403, { error: 'qa_read_route_not_allowlisted' }); }
    const item = byRoute.get(req.url);
    try { runtimeGate(config); } catch { req.resume(); return reply(res, 503, { error: 'qa_runtime_gate_changed' }); }
    const fault = item && armed?.target === item.key ? armed : null;
    if (fault) { disarm(); stats.consumed++; }
    const row = record({ method: 'GET', ...(item ? { target: item.key, route: item.route, entityId: item.entityId } : { routeSHA256: sha(req.url) }), owner: fault?.owner ?? null, fault: fault?.mode ?? 'pass', forwarded: false });
    if (fault?.mode === 'reject') { req.resume(); stats.rejected++; row.outcome = 'rejected_once'; row.status = 503; row.finishedAt = utc(); return reply(res, 503, { error: 'qa_detail_read_rejected' }); }
    const op = { item, owner: fault?.owner ?? null, fault: fault?.mode ?? 'pass', record: row, res, upstream: null, incoming: null, buffer: null, used: 0, ready: false, done: false };
    operations.add(op);
    if (fault?.mode === 'hold') held = op;
    res.once('close', () => { if (!res.writableFinished) cancel(op, 'client_aborted'); });
    req.once('aborted', () => cancel(op, 'client_aborted'));
    const streamingSSE = !item && ['/api/native/events', '/api/events'].includes(url.pathname);
    if (!streamingSSE) op.deadline = timer(() => { stats.expired++; fail(op, 504, 'qa_read_timeout'); }, MAX_MS);
    req.resume();
    stats.forwardedGET++; row.forwarded = true;
    op.upstream = http.request({ hostname: '127.0.0.1', port: config.upstreamPort, path: req.url, method: 'GET', headers: { ...cleanHeaders(req.headers), host: `127.0.0.1:${config.upstreamPort}`, 'accept-encoding': 'identity' } }, incoming => {
      op.incoming = incoming;
      if (op.done) { incoming.destroy(); return; }
      row.upstreamStatus = incoming.statusCode; row.responseBytes = 0;
      const digest = createHash('sha256');
      if (item) {
        if (ram + MAX_DETAIL > MAX_RAM || Number(incoming.headers['content-length'] ?? 0) > MAX_DETAIL) return fail(op, 502, 'qa_detail_ram_limit');
        op.buffer = Buffer.alloc(MAX_DETAIL); ram += MAX_DETAIL;
        op.httpStatus = incoming.statusCode; op.headers = cleanHeaders(incoming.headers);
        incoming.on('data', chunk => {
          if (op.done) return;
          if (op.used + chunk.length > MAX_DETAIL) return fail(op, 502, 'qa_detail_ram_limit');
          digest.update(chunk); chunk.copy(op.buffer, op.used); op.used += chunk.length; row.responseBytes = op.used;
        });
        incoming.once('end', () => {
          if (op.done) return;
          row.responseSHA256 = digest.digest('hex'); row.upstreamCompletedAt = utc();
          if (op.httpStatus === 200) {
            try { row.metadata = metadata(JSON.parse(op.buffer.subarray(0, op.used).toString('utf8')), item); }
            catch { return fail(op, 502, 'qa_response_entity_or_json_mismatch'); }
          }
          op.ready = true;
          if (op.fault === 'drop') { stats.dropped++; row.outcome = 'response_dropped_once'; row.finishedAt = utc(); clearOperation(op); res.destroy(); return; }
          if (op.fault === 'hold') { op.holdTimer = timer(() => deliver(op), fault.delayMs); }
          else deliver(op);
        });
        incoming.once('error', () => fail(op, 502, 'qa_upstream_response_error'));
      } else {
        res.writeHead(incoming.statusCode, cleanHeaders(incoming.headers));
        const counter = new Transform({ transform(chunk, _, callback) { row.responseBytes += chunk.length; digest.update(chunk); callback(null, chunk); } });
        pipeline(incoming, counter, res, error => {
          if (op.done) return;
          row.responseSHA256 = digest.digest('hex');
          if (error) cancel(op, 'stream_closed');
          else { clearOperation(op); row.outcome = 'stream_delivered'; row.finishedAt = utc(); }
        });
      }
    });
    op.upstream.once('error', () => fail(op, 502, 'qa_upstream_unavailable'));
    op.upstream.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', (_, socket) => socket.destroy());
  server.on('upgrade', (_, socket) => socket.destroy());
  server.on('error', () => { console.error(JSON.stringify({ event: 'READ_PROXY_LISTEN_FAILED' })); process.exitCode = 1; });
  server.listen(config.port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'PUBLIC_WORKSPACE_READ_PROXY_READY', port: config.port, upstreamPort: config.upstreamPort, scope: config.scope, pid: process.pid, upstreamPID: config.upstreamPID, configurationSHA256: sha(JSON.stringify(config)) })));
  const stop = () => { disarm(); for (const op of operations) cancel(op, 'proxy_stopped'); for (const t of timers) clearTimeout(t); timers.clear(); receipts.splice(0); server.close(); for (const socket of sockets) socket.destroy(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
async function prepareProduction() {
  fs.mkdirSync(OUT, { recursive: true });
  const markerFile = path.join(ROOT, 'output/native-parity-20261003/workspace-gui/2026-10-03T16-21-14.813Z/manifest.json');
  const readyFile = path.join(ROOT, 'output/native-parity-20261003/settings-gui-v12/fixture-ready.json');
  const marker = JSON.parse(fs.readFileSync(safeLocalFile(markerFile), 'utf8')), ready = JSON.parse(fs.readFileSync(safeLocalFile(readyFile), 'utf8'));
  if (marker.marker !== 'OPSADV-QA-WORKSPACE-' + SCOPE || marker.api !== 'http://127.0.0.1:46214' || ready.api !== marker.api || marker.dataDirectory !== ready.serverData || ready.guards?.NO_BACKGROUND !== 1 || ready.guards?.AUTONOMOUS_DELIVERY !== 'off' || ready.guards?.NOTIFICATION_DELIVERY !== 'off') throw Error('production_public_fixture_gate');
  const pids = listeners(46214); if (pids.length !== 1) throw Error('production_listener_gate');
  const proof = pidProof(pids[0]);
  const allow = marker.objects.filter(o => ['tasks', 'inbox', 'ideas'].includes(o.type)).map(o => ({ key: o.type + '-' + o.role, kind: o.type, entityId: o.id, route: '/api/' + o.type + '/' + o.id }));
  allow.push(...allow.filter(item => item.kind === 'tasks').map(item => ({ ...item, key: item.key + '-including-deleted', route: item.route + '?includeDeleted=true' })));
  allow.push({ key: 'memory-long', kind: 'memories', entityId: 'memory-settings-gui-4530b843-ed06-44aa-b31b-f70a66eea2d0', route: '/api/memories/memory-settings-gui-4530b843-ed06-44aa-b31b-f70a66eea2d0' });
  allow.push({ key: 'memory-second', kind: 'memories', entityId: 'memory-settings-gui-v12-second', route: '/api/memories/memory-settings-gui-v12-second' });
  const config = { schema: 1, mode: 'production', scope: SCOPE, port: 46242, upstreamPort: 46214, upstreamPID: pids[0], upstreamArgsSHA256: proof.argsSHA256, upstreamStartedSHA256: proof.startedSHA256, databaseFile: path.join(ready.serverData, 'opstwin-advance.db'), sourceHashes: sourceProof(SOURCE_PATHS), allow };
  validateConfig(config);
  const primaryFile = path.join(OUT, 'production-prepared.json');
  const file = fs.existsSync(primaryFile) ? path.join(OUT, 'production-prepared-' + utc().replaceAll(':', '-') + '.json') : primaryFile;
  fs.writeFileSync(file, JSON.stringify({ ...config, preparedAt: utc(), startupState: 'NOT_STARTED', scopeBasisSHA256: sha(fs.readFileSync(markerFile)), readyBasisSHA256: sha(fs.readFileSync(readyFile)), gateMeaning: 'PID/start/args/open exact isolated SQLite/source disk hashes; formal public entity qualification on future explicit launch; not proof of loaded module hash or GUI' }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PRODUCTION_PROXY_PREPARED_NOT_STARTED', file: path.relative(ROOT, file), upstreamPID: config.upstreamPID, scope: SCOPE, allowed: allow.length, productionProxyPort: 46242, GET: 0, POST: 0 }));
}

// Full process HTTP acceptance runner is added after the failure inventory, never units.
async function httpE2E() {
  if (listeners(46243).length || listeners(46244).length) throw Error('owned_fixture_ports_busy');
  const scope = randomUUID(), stamp = utc().replaceAll(':', '-');
  const out = path.join(OUT, 'http-e2e', stamp), children = [], checks = [];
  fs.mkdirSync(out, { recursive: true });
  const report = { schema: 1, at: utc(), scope, kind: 'FULL_PROCESS_PUBLIC_HTTP_FIXTURE_NOT_GUI_OR_PRODUCTION', ports: [46243, 46244], checks, existingServiceChanges: 0, productionGET: 0, productionPOST: 0, GUI: 'NOT_RUN', modelCalls: 0, sourceBefore: sha(fs.readFileSync(SELF)) };
  const persist = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const check = (name, ok, extra = {}) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', at: utc(), ...extra }); persist(); if (!ok) throw Error(name); };
  async function get(origin, route, options = {}) {
    const response = await fetch(origin + route, { ...options, signal: options.signal ?? AbortSignal.timeout(20000), redirect: 'manual' });
    const raw = Buffer.from(await response.arrayBuffer());
    let value; try { value = JSON.parse(raw); } catch { value = null; }
    return { status: response.status, bytes: raw.length, hash: sha(raw), value };
  }
  async function rawHTTP(origin, route, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(origin + route);
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: options.method ?? 'GET', headers: options.headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.once('error', reject);
        res.once('end', () => { const raw = Buffer.concat(chunks); let value; try { value = JSON.parse(raw); } catch { value = null; } resolve({ status: res.statusCode, bytes: raw.length, hash: sha(raw), value }); });
      });
      req.setTimeout(20000, () => req.destroy(Error('raw_http_timeout'))); req.once('error', reject); req.end(options.body);
    });
  }
  const fixtureOrigin = 'http://127.0.0.1:46243', proxyOrigin = 'http://127.0.0.1:46244';
  const entry = path.join(out, 'fixture-entry.mjs');
  const id = `OPSADV-QA-READ-${scope}-task`, other = `OPSADV-QA-READ-${scope}-memory`;
  fs.writeFileSync(entry, `import http from 'node:http';\nconst scope=${JSON.stringify(scope)}, id=${JSON.stringify(id)}, other=${JSON.stringify(other)};\nlet mode='normal', writes=0, readEffects=0;const events=[];const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1:46243'); const send=(code,x)=>res.writeHead(code,{'content-type':'application/json','x-fixture-secret':'OPSADV-QA-PUBLIC-HEADER-NOT-LOGGED'}).end(JSON.stringify(x));\nif(req.method!=='GET'){writes++;req.resume();return send(200,{writes});}\nif(url.pathname==='/api/health')return send(200,{ok:true,scope});\nif(url.pathname==='/__fixture/status')return send(200,{scope,writes,readEffects,mode,requests:events});\nif(url.pathname==='/__fixture/mode'){mode=url.searchParams.get('mode');return send(200,{scope,mode});}\nevents.push({path:req.url,method:'GET'});\nif(['/api/calendar/status','/api/feishu/binding'].includes(url.pathname)){readEffects++;return send(200,{scope,readEffects});}\nif(['/api/bootstrap','/api/settings','/api/settings/models','/api/settings/history','/api/native/version','/api/tasks','/api/ideas','/api/inbox','/api/memories','/api/connections','/api/inbox/query','/api/workspace/search'].includes(url.pathname))return send(200,{scope,kind:'public-read-only-fixture',items:[]});\nif(url.pathname==='/api/events'||url.pathname==='/api/native/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: OPSADV-QA-PUBLIC-SSE\\n\\n');const t=setInterval(()=>res.write(': keepalive\\n\\n'),100);res.once('close',()=>clearInterval(t));return;}\nif(url.pathname==='/api/public-large'){res.writeHead(200,{'content-type':'application/octet-stream'});return res.end(Buffer.alloc(3*1024*1024,83));}\nif(url.pathname==='/api/tasks/'+id||url.pathname==='/api/memories/'+other){if(mode==='wrong-id')return send(200,{id:other,notes:'OPSADV-QA only public mismatch'});if(mode==='bad-json')return res.writeHead(200,{'content-type':'application/json'}).end('{');if(mode==='large')return send(200,{id,notes:'Q'.repeat(3*1024*1024)});const x={id:url.pathname.includes('/memories/')?other:id,notes:'OPSADV-QA public read recovery 😀 中文',body:'OPSADV-QA public memory only',status:'active',updatedAt:'2026-10-04T00:00:00.000Z'};if(mode==='slow'||mode==='timeout'){const t=setTimeout(()=>send(200,x),mode==='timeout'?17000:3000);res.once('close',()=>clearTimeout(t));return;}return send(200,x);}\nreturn send(404,{error:'public_not_found'});});server.listen(46243,'127.0.0.1',()=>console.log(JSON.stringify({event:'FIXTURE_READY',scope,pid:process.pid})));process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});\n`);
  function child(args) {
    const proc = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = { pid: proc.pid, stdout: '', stderr: '', exitCode: null, exited: false };
    proc.stdout.on('data', chunk => { record.stdout += chunk; }); proc.stderr.on('data', chunk => { record.stderr += chunk; });
    const finished = new Promise(resolve => proc.once('exit', (code, signal) => { record.exitCode = code; record.signal = signal; record.exited = true; resolve(record); }));
    const item = { proc, record, finished }; children.push(item); return item;
  }
  async function waitFor(fn, limit = 10000) { const start = Date.now(); while (!await fn()) { if (Date.now() - start > limit) throw Error('owned_wait_timeout'); await new Promise(resolve => setTimeout(resolve, 50)); } }
  const fixture = child([entry]);
  let proxy, pending;
  try {
    await waitFor(() => listeners(46243).includes(fixture.proc.pid));
    check('owned public fixture started actual process', (await get(fixtureOrigin, '/api/health')).value.scope === scope, { pid: fixture.proc.pid });
    const proof = pidProof(fixture.proc.pid), fixtureSource = path.relative(ROOT, entry);
    const config = { schema: 1, mode: 'http-fixture', scope, port: 46244, upstreamPort: 46243, upstreamPID: fixture.proc.pid, upstreamArgsSHA256: proof.argsSHA256, upstreamStartedSHA256: proof.startedSHA256, fixtureSource, sourceHashes: sourceProof(['scripts/native-workspace-read-gui-proxy.mjs', fixtureSource]), allow: [{ key: 'task', kind: 'tasks', entityId: id, route: '/api/tasks/' + id }, { key: 'task-query', kind: 'tasks', entityId: id, route: '/api/tasks/' + id + '?includeDeleted=true' }, { key: 'memory', kind: 'memories', entityId: other, route: '/api/memories/' + other }] };
    const configFile = path.join(out, 'fixture-gate.json'); fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    for (const [name, alter] of [['wrong scope', c => { c.scope = randomUUID(); }], ['wrong PID', c => { c.upstreamPID = process.pid; }], ['source hash mismatch', c => { c.sourceHashes[fixtureSource] = '0'.repeat(64); }], ['nonallowlisted public ID', c => { c.allow[0].entityId = 'PRIVATE-NOT-PUBLIC'; }]]) {
      const badFile = path.join(out, name.replaceAll(' ', '-') + '.json'), bad = structuredClone(config); alter(bad); fs.writeFileSync(badFile, JSON.stringify(bad));
      const rejected = child([SELF, '--manifest', badFile]); await rejected.finished;
      check('startup rejects ' + name + ' before listen', rejected.record.exitCode === 1 && !listeners(46244).length, { exitCode: rejected.record.exitCode, stderrSHA256: sha(rejected.record.stderr) });
    }
    proxy = child([SELF, '--manifest', configFile]); await waitFor(() => listeners(46244).includes(proxy.proc.pid));
    const status = async () => (await get(proxyOrigin, '/__qa/status')).value;
    check('proxy startup exact UUID/PID/source and entity qualification', (await status()).qualification.entities.length === 3, { pid: proxy.proc.pid });
    const route = '/api/tasks/' + id;
    const normal = await get(fixtureOrigin, route), transparent = await get(proxyOrigin, route);
    check('exact detail pass forwards original status/bytes/hash', transparent.status === normal.status && transparent.hash === normal.hash && transparent.bytes === normal.bytes);
    const headersControl = { 'content-type': 'application/json' };
    const control = value => get(proxyOrigin, '/__qa/control', { method: 'POST', headers: headersControl, body: JSON.stringify(value) });
    const arm = (mode, target = 'task', delayMs = 1000, owner = randomUUID()) => control({ action: 'arm', mode, target, delayMs, owner }).then(r => ({ ...r, owner }));
    check('control browser Origin rejected', (await get(proxyOrigin, '/__qa/control', { method: 'POST', headers: { ...headersControl, origin: 'http://example.invalid' }, body: '{}' })).status === 403);
    check('control nonJSON rejected', (await get(proxyOrigin, '/__qa/control', { method: 'POST', body: '{}' })).status === 415);
    check('control invalid JSON rejected', (await get(proxyOrigin, '/__qa/control', { method: 'POST', headers: headersControl, body: '{' })).status === 400);
    check('control oversized rejected', (await get(proxyOrigin, '/__qa/control', { method: 'POST', headers: headersControl, body: 'Q'.repeat(5000) })).status === 413);
    const owner = randomUUID();
    for (const value of [{ action: 'arm', owner, target: 'private', mode: 'reject', delayMs: 500 }, { action: 'arm', owner, target: 'task', mode: 'reject', delayMs: 15001 }, { action: 'arm', owner, target: 'task', mode: 'unknown', delayMs: 500 }, { action: 'arm', owner: 'not-owner', target: 'task', mode: 'reject', delayMs: 500 }, { action: 'arm', owner, target: 'task', mode: 'reject', delayMs: 500, unexpected: true }]) check('invalid arm fails closed #' + checks.length, (await control(value)).status === 400);
    const reject = await arm('reject'); check('one reject armed', reject.status === 200);
    check('concurrent arm409 preserves prior owner', (await arm('drop')).status === 409 && (await status()).armed.owner === reject.owner);
    check('wrong owner cancel409 preserves prior', (await control({ action: 'cancel', owner: randomUUID() })).status === 409 && (await status()).armed.owner === reject.owner);
    const upstreamBefore = (await get(fixtureOrigin, '/__fixture/status')).value.requests.length;
    const failure = await get(proxyOrigin, route);
    check('exact first GET rejects503 no upstream request', failure.status === 503 && (await get(fixtureOrigin, '/__fixture/status')).value.requests.length === upstreamBefore);
    check('following exact GET restores original success', (await get(proxyOrigin, route)).hash === normal.hash && (await status()).armed === null);
    const mismatch = await arm('reject', 'task-query');
    check('query mismatch forwards unchanged without consumption', (await get(proxyOrigin, route)).status === 200 && (await status()).armed.owner === mismatch.owner);
    check('duplicate query rejected403 does not consume exact operation', (await get(proxyOrigin, route + '?includeDeleted=true&includeDeleted=true')).status === 403 && (await status()).armed.owner === mismatch.owner);
    check('encoded ID alias rejected403 does not consume exact operation', (await get(proxyOrigin, '/api/tasks/' + id.replace('OPSADV', '%4fPSADV'))).status === 403 && (await status()).armed.owner === mismatch.owner);
    check('exact allowed query consumes once', (await get(proxyOrigin, route + '?includeDeleted=true')).status === 503 && (await status()).armed === null);
    const noWrite = await arm('reject');
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS', 'HEAD', 'TRACE']) check(method + ' blocked403 no consume', (await rawHTTP(proxyOrigin, route, { method, ...(method === 'HEAD' || method === 'TRACE' ? {} : { body: 'OPSADV-QA-WRITE-MUST-NOT-ARRIVE' }) })).status === 403 && (await status()).armed.owner === noWrite.owner);
    check('wrong Host control rejected403 without consumption', (await rawHTTP(proxyOrigin, '/__qa/status', { headers: { host: 'localhost:46244' } })).status === 403 && (await status()).armed.owner === noWrite.owner);
    check('GET with payload rejected400 without consumption', (await rawHTTP(proxyOrigin, route, { headers: { 'content-length': '1' }, body: 'Q' })).status === 400 && (await status()).armed.owner === noWrite.owner);
    for (const unsafe of ['/api/calendar/status', '/api/calendar/events/OPSADV-QA-public', '/api/feishu/binding', '/api/diagnostics', '/api/wechat/chats', '/api/wechat/messages?conversation=OPSADV-QA', '/api/settings/unknown', '/api/memories/PRIVATE-NOT-PUBLIC', '/api/tasks/' + id + '/refresh', '/api/bootstrap?unknown=true']) check('unsafe GET blocked403 no consumption: ' + unsafe, (await get(proxyOrigin, unsafe)).status === 403 && (await status()).armed.owner === noWrite.owner);
    check('fixture no GET side effects reached', (await get(fixtureOrigin, '/__fixture/status')).value.readEffects === 0);
    for (const safe of ['/api/bootstrap', '/api/settings', '/api/settings/models', '/api/settings/history', '/api/native/version', '/api/tasks?offset=0&limit=100', '/api/ideas?limit=200', '/api/inbox/query?offset=0&limit=50&includeDone=true', '/api/memories', '/api/connections', '/api/workspace/search?q=OPSADV-QA&kind=all&offset=0&limit=50']) { const upstream = await get(fixtureOrigin, safe), passed = await get(proxyOrigin, safe); check('necessary safe GET original hash no fault: ' + safe, passed.status === 200 && passed.hash === upstream.hash && (await status()).armed.owner === noWrite.owner); }
    for (const revision of ['0', '1', '9007199254740991']) { const safe = '/api/workspace/search?q=OPSADV-QA&kind=all&offset=1&limit=1&revision=' + revision; const upstream = await get(fixtureOrigin, safe), passed = await get(proxyOrigin, safe); check('safe integer revision forwarded original hash no consumption ' + revision, passed.status === 200 && passed.hash === upstream.hash && (await status()).armed.owner === noWrite.owner); }
    for (const revision of ['-1', '1.2', '9007199254740992', 'invalid', '1&revision=1']) check('bad or duplicate revision403 no consumption ' + revision, (await get(proxyOrigin, '/api/workspace/search?q=OPSADV-QA&kind=all&offset=1&limit=1&revision=' + revision)).status === 403 && (await status()).armed.owner === noWrite.owner);
    check('fixture backend receives zero write methods', (await get(fixtureOrigin, '/__fixture/status')).value.writes === 0);
    const sseController = new AbortController();
    const sse = await fetch(proxyOrigin + '/api/native/events', { signal: sseController.signal });
    const sseChunk = await sse.body.getReader().read();
    check('actual native SSE original first chunk and armed operation unchanged', sse.status === 200 && sha(sseChunk.value) === sha(Buffer.from('data: OPSADV-QA-PUBLIC-SSE\n\n')) && (await status()).armed.owner === noWrite.owner);
    sseController.abort(); await control({ action: 'cancel', owner: noWrite.owner });
    await waitFor(async () => (await status()).activeOperations === 0);
    check('SSE abort cleanup does not consume', (await status()).armed === null && (await status()).retainedBytes === 0);
    const hold = await arm('hold', 'task', 5000); pending = get(proxyOrigin, route);
    await waitFor(async () => (await status()).held?.ready === true);
    check('held body bounded RAM metadata ready', (await status()).retainedBytes === MAX_DETAIL && (await status()).held.owner === hold.owner);
    check('arm while held409', (await arm('reject')).status === 409);
    check('wrong owner release409', (await control({ action: 'release', owner: randomUUID() })).status === 409);
    check('owner explicit release succeeds', (await control({ action: 'release', owner: hold.owner })).status === 200);
    check('held delivered original bytes/hash', (await pending).hash === normal.hash); pending = null;
    await waitFor(async () => (await status()).retainedBytes === 0 && (await status()).activeTimers === 0);
    check('held completion fully releases RAM/timers/owner', (await status()).held === null && (await status()).activeOperations === 0);
    await get(fixtureOrigin, '/__fixture/mode?mode=slow');
    const notReady = await arm('hold', 'task', 5000); const abortController = new AbortController();
    pending = get(proxyOrigin, route, { signal: abortController.signal }).catch(() => null);
    await waitFor(async () => (await status()).held !== null);
    check('release before upstream ready409', (await control({ action: 'release', owner: notReady.owner })).status === 409);
    abortController.abort(); await pending; pending = null;
    await waitFor(async () => (await status()).held === null && (await status()).activeOperations === 0 && (await status()).activeTimers === 0);
    check('client abort during upstream wait clears operation/timer/RAM', (await status()).retainedBytes === 0);
    await get(fixtureOrigin, '/__fixture/mode?mode=normal');
    const late = await arm('hold', 'task', 5000); const lateAbort = new AbortController(); pending = get(proxyOrigin, route, { signal: lateAbort.signal }).catch(() => null);
    await waitFor(async () => (await status()).held?.ready);
    lateAbort.abort(); await pending; pending = null;
    await waitFor(async () => (await status()).held === null && (await status()).retainedBytes === 0);
    check('abort after held success drops retained body and stale release409', (await control({ action: 'release', owner: late.owner })).status === 409 && (await status()).activeTimers === 0);
    const cancel = await arm('hold', 'task', 5000); pending = get(proxyOrigin, route); await waitFor(async () => (await status()).held?.ready);
    check('owner control cancel clears held operation', (await control({ action: 'cancel', owner: cancel.owner })).status === 200 && (await pending).status === 499); pending = null;
    check('cancel fully frees retained RAM', (await status()).retainedBytes === 0 && (await status()).held === null);
    const timed = await arm('hold', 'task', 80); const started = Date.now(); const timedResult = await get(proxyOrigin, route);
    check('bounded timed hold auto delivers original', timedResult.hash === normal.hash && Date.now() - started >= 70, { elapsedMs: Date.now() - started });
    await waitFor(async () => (await status()).activeTimers === 0);
    await arm('drop'); let didDrop = false; try { await get(proxyOrigin, route); } catch { didDrop = true; }
    check('drop original response after real GET completion', didDrop && (await status()).receipts.some(r => r.fault === 'drop' && r.outcome === 'response_dropped_once' && r.upstreamStatus === 200 && r.responseSHA256 === normal.hash));
    check('drop restores next exact read no retries by proxy', (await get(proxyOrigin, route)).hash === normal.hash);
    await get(fixtureOrigin, '/__fixture/mode?mode=wrong-id');
    check('different response entity rejected502', (await get(proxyOrigin, route)).status === 502);
    await get(fixtureOrigin, '/__fixture/mode?mode=bad-json'); check('malformed successful JSON rejected502', (await get(proxyOrigin, route)).status === 502);
    await get(fixtureOrigin, '/__fixture/mode?mode=large'); check('matched oversized detail bounded and frees RAM', (await get(proxyOrigin, route)).status === 502 && (await status()).retainedBytes === 0);
    await get(fixtureOrigin, '/__fixture/mode?mode=normal');
    const originalFixtureBytes = fs.readFileSync(entry);
    const driftOwner = await arm('reject');
    try {
      fs.appendFileSync(entry, '\n// OPSADV-QA-only runtime hash drift probe\n');
      check('runtime source drift rejects503 without consumption', (await get(proxyOrigin, route)).status === 503 && (await status()).armed.owner === driftOwner.owner);
      check('runtime drift concurrent arm still409 protects existing owner', (await arm('reject')).status === 409); // existing owner always protected first
    } finally { fs.writeFileSync(entry, originalFixtureBytes); }
    check('exact source restoration allows prior once fault then read', (await get(proxyOrigin, route)).status === 503 && (await get(proxyOrigin, route)).hash === normal.hash);
    try {
      fs.appendFileSync(entry, '\n// OPSADV-QA-only idle source drift probe\n');
      check('runtime source drift idle arm rejects503', (await arm('reject')).status === 503 && (await status()).armed === null);
    } finally { fs.writeFileSync(entry, originalFixtureBytes); }
    await get(fixtureOrigin, '/__fixture/mode?mode=timeout');
    const deadlineStart = Date.now(), deadlineResult = await get(proxyOrigin, route), deadlineElapsed = Date.now() - deadlineStart;
    check('actual upstream wait bounded by 15sec operation deadline', deadlineResult.status === 504 && deadlineElapsed >= 14500 && deadlineElapsed < 17500, { elapsedMs: deadlineElapsed });
    await waitFor(async () => (await status()).activeOperations === 0 && (await status()).activeTimers === 0);
    check('deadline releases RAM/timer/owner', (await status()).retainedBytes === 0 && (await status()).held === null);
    await get(fixtureOrigin, '/__fixture/mode?mode=normal');
    const expiry = await arm('reject'), expiryStart = Date.now();
    await waitFor(async () => (await status()).armed === null, 17500);
    check('unused one-shot arm expires by 15sec no upstream consumption', Date.now() - expiryStart >= 14500 && (await status()).receipts.some(r => r.outcome === 'armed_expired' && r.owner === expiry.owner), { elapsedMs: Date.now() - expiryStart });
    const large = await get(proxyOrigin, '/api/public-large'); check('unmatched large GET streams without detail RAM cap', large.status === 200 && large.bytes === 3 * 1024 * 1024 && large.hash === sha(Buffer.alloc(3 * 1024 * 1024, 83)));
    const finalStatus = await status();
    check('metadata receipts contain no source bodies/headers/secrets', !JSON.stringify(finalStatus).includes('OPSADV-QA public read recovery') && !JSON.stringify(finalStatus).includes('OPSADV-QA-PUBLIC-HEADER-NOT-LOGGED') && !JSON.stringify(finalStatus).includes('notes":"') && finalStatus.receipts.length <= MAX_RECORDS);
    check('all settled operations cleanup RAM/timers/owners', finalStatus.retainedBytes === 0 && finalStatus.activeTimers === 0 && finalStatus.activeOperations === 0 && finalStatus.held === null && finalStatus.armed === null);
    report.safeFinalStatus = finalStatus;
    const shutdown = await arm('hold', 'task', 5000); pending = get(proxyOrigin, route).catch(() => null); await waitFor(async () => (await status()).held?.ready);
    proxy.proc.kill('SIGTERM'); await proxy.finished; await pending; pending = null;
    check('normal SIGTERM during held success closes owned proxy process', proxy.record.exitCode === 0 && !listeners(46244).length, { exitCode: proxy.record.exitCode });
    check('fixture received zero business writes for whole E2E', (await get(fixtureOrigin, '/__fixture/status')).value.writes === 0);
    report.status = 'PASS_HTTP_FIXTURE_GUI_NOT_RUN';
  } catch (error) { report.status = 'FAIL_HTTP_FIXTURE'; report.error = String(error.message); process.exitCode = 1; }
  finally {
    if (pending) { try { await pending; } catch {} }
    for (const child of children.reverse()) if (!child.record.exited) { child.proc.kill('SIGTERM'); await child.finished; }
    report.children = children.map(c => ({ pid: c.record.pid, exitCode: c.record.exitCode, signal: c.record.signal, stdoutSHA256: sha(c.record.stdout), stderrSHA256: sha(c.record.stderr) }));
    report.portsFreeAfter = !listeners(46243).length && !listeners(46244).length;
    report.sourceAfter = sha(fs.readFileSync(SELF));
    report.pass = checks.filter(x => x.status === 'PASS').length; report.fail = checks.filter(x => x.status === 'FAIL').length;
    persist();
    const files = fs.readdirSync(out).filter(x => x !== 'manifest.json').map(name => ({ path: path.relative(ROOT, path.join(out, name)), bytes: fs.statSync(path.join(out, name)).size, sha256: sha(fs.readFileSync(path.join(out, name))) }));
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ schema: 1, at: utc(), status: report.status, scope, pass: report.pass, fail: report.fail, sourceStable: report.sourceBefore === report.sourceAfter, portsFreeAfter: report.portsFreeAfter, GUI: 'NOT_RUN', productionStarted: false, scriptSHA256: report.sourceAfter, files }, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, pass: report.pass, fail: report.fail, manifest: path.relative(ROOT, path.join(out, 'manifest.json')), portsFreeAfter: report.portsFreeAfter }));
  }
}
const action = process.argv[2];
try {
  if (action === '--prepare-production') await prepareProduction();
  else if (action === '--manifest' && process.argv.length === 4) await startProxy(process.argv[3]);
  else if (action === '--http-e2e') await httpE2E();
  else throw Error('Use --prepare-production, --manifest <exact public gate file>, or --http-e2e');
} catch { console.error(JSON.stringify({ event: 'PUBLIC_WORKSPACE_READ_PROXY_GATE_FAILED' })); process.exitCode = 1; }
