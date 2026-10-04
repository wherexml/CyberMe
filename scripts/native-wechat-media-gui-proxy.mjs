// Dedicated public-media GUI harness. No arbitrary upstream, credentials, or body logs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Transform, pipeline } from 'node:stream';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCOPE = 'b8bd7f05-ab31-4efe-b0be-599ade946ee3';
if (process.argv.slice(2).some(a => a !== '--qualified-v43')) throw Error('unknown_qualification');
const currentQualification = process.argv.includes('--qualified-v43');
const qualificationDir = currentQualification ? 'gui-v43-recovery' : 'gui-v25';
const PORT = 46229;
const UPSTREAM_PORT = 46228;
const MAX_RAM = 64 * 1024 * 1024;
const MAX_METADATA = 64 * 1024;
const TTL = 10 * 60 * 1000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let publicReady, qualified;
const entry = path.join(ROOT, '.local/acceptance/wechat-valid-media', SCOPE, currentQualification ? 'public-api-entry-v43.mjs' : 'public-api-entry.mjs');
const sourceHashes = () => Object.fromEntries(Object.keys(qualified.sourceHashes).map(p => [p, sha(fs.readFileSync(path.join(ROOT, p)))]));
let mode = 'pass', holdMs = 5000, sequence = 0, activeOwner = null, reserved = 0;
const receipts = [], events = [];
const stats = { startedAt: new Date().toISOString(), requests: 0, forwarded: 0, metadataCaptured: 0, consumed: 0, held: 0, rejected: 0, cancelled: 0, errors: 0 };
function trim() {
  const cutoff = Date.now() - TTL;
  while (receipts.length && receipts[0].atMs < cutoff) receipts.shift();
  while (events.length && events[0].atMs < cutoff) events.shift();
  while (receipts.length > 32) receipts.shift();
  while (events.length > 32) events.shift();
}
function event(kind, status, meta = {}) {
  events.push({ at: new Date().toISOString(), atMs: Date.now(), kind, status, ...meta }); trim();
}
function json(res, code, value) {
  if (res.headersSent) { res.destroy(); return; }
  if (!res.destroyed && !res.writableEnded) res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value));
}
const loopback = addr => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
function safeFile(file) {
  if (!file.startsWith(ROOT + '/.local/') || fs.realpathSync(file) !== file) throw Error('public_scope_entry_invalid');
  for (let p = file; p !== ROOT; p = path.dirname(p)) if (fs.lstatSync(p).isSymbolicLink()) throw Error('public_scope_entry_invalid');
}
async function startupGate() {
  publicReady = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/native-parity-20261003/wechat-valid-media/ready.json')));
  qualified = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/native-parity-20261003/wechat-valid-media', qualificationDir, 'ready.json')));
  if (currentQualification) {
    const preflight = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/native-parity-20261003/wechat-valid-media/gui-v43-recovery/http-preflight.json')));
    if (qualified.status !== 'READY' || qualified.entry !== entry || preflight.status !== 'PASS' || preflight.scope !== SCOPE || preflight.records.length !== 3 || preflight.apiPID !== qualified.apiPID || preflight.entrySHA256 !== qualified.runtimeHashes.entrySHA256 || JSON.stringify(preflight.sourceHashes) !== JSON.stringify(qualified.sourceHashes)) throw Error('fresh_public_preflight_not_ready');
  }
  if (publicReady.scope !== SCOPE || qualified.scope !== SCOPE || qualified.api !== 'http://127.0.0.1:46228') throw Error('public_scope_mismatch');
  safeFile(entry);
  if (sha(fs.readFileSync(entry)) !== qualified.runtimeHashes.entrySHA256) throw Error('public_entry_drift');
  if (JSON.stringify(sourceHashes()) !== JSON.stringify(qualified.sourceHashes)) throw Error('qualified_source_drift');
  const listeners = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP:46228', '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' }).split('\n').filter(s => /^p\d+$/.test(s)).map(s => Number(s.slice(1)));
  if (listeners.length !== 1) throw Error('public_listener_not_unique');
  if (currentQualification && qualified.apiPID !== listeners[0]) throw Error('qualified_pid_changed');
  const args = execFileSync('/bin/ps', ['-p', String(listeners[0]), '-o', 'args='], { encoding: 'utf8' }).trim();
  if (!( !currentQualification && args.endsWith(`node --import tsx .local/acceptance/wechat-valid-media/${SCOPE}/public-api-entry.mjs`)) && !args.endsWith(`node --import tsx ${entry}`)) throw Error('public_listener_wrong_scope');
  const response = await fetch('http://127.0.0.1:46228/api/health', { signal: AbortSignal.timeout(5000) });
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_METADATA) throw Error('health_oversized');
  const health = JSON.parse(body);
  if (!response.ok || health.ok !== true || health.database !== 'independent' || health.name !== 'OpsTwin Advance') throw Error('public_health_failed');
  return { scope: SCOPE, upstreamPID: listeners[0], entrySHA256: sha(fs.readFileSync(entry)), sourceHashes: sourceHashes(), healthHTTP: response.status, healthBytes: body.length, healthSHA256: sha(body), scopeProof: 'read-only exact listener entry and qualified hashes; health has no UUID field' };
}
function buffered(stream, limit, declaredLength, signal) {
  return new Promise((resolve, reject) => {
    const declared = declaredLength === undefined ? NaN : Number(declaredLength);
    const capacity = Number.isSafeInteger(declared) && declared >= 0 ? declared : limit;
    if (capacity > limit || reserved + capacity > MAX_RAM) { stream.destroy(); reject(Error('buffer_limit')); return; }
    reserved += capacity;
    let data = Buffer.alloc(capacity), used = 0, finished = false, disposed = false;
    const dispose = () => { if (!disposed) { disposed = true; data?.fill(0); data = null; reserved -= capacity; } };
    const fail = error => { if (!finished) { finished = true; cleanup(); dispose(); stream.destroy(); reject(error); } };
    const onAbort = () => fail(Error('client_cancelled'));
    const onData = chunk => { if (used + chunk.length > capacity) return fail(Error('buffer_limit')); chunk.copy(data, used); used += chunk.length; };
    const onEnd = () => { if (!finished) { finished = true; cleanup(); resolve({ bytes: data.subarray(0, used), dispose }); } };
    const cleanup = () => { stream.off('data', onData); stream.off('end', onEnd); stream.off('error', fail); signal.removeEventListener('abort', onAbort); };
    stream.on('data', onData); stream.once('end', onEnd); stream.once('error', fail); signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
function consume(kind, bindingHash) {
  const eligible = (kind === 'metadata' && mode === 'holdNextMetadata') || (kind === 'content' && ['holdNextContent', 'rejectNextContent'].includes(mode));
  if (!eligible) return null;
  const owner = { sequence: ++sequence, mode, holdMs, kind, bindingHash, at: new Date().toISOString() };
  mode = 'pass'; activeOwner = owner; stats.consumed++; event(kind, 'mode_consumed', { count: owner.sequence }); return owner;
}
function clearOwner(owner) { if (owner && activeOwner === owner) activeOwner = null; }
function projection(value, bindingHash, owner, bytes, status) {
  if (!value || typeof value.attachmentId !== 'string' || !/^[\w-]{1,128}$/.test(value.attachmentId) || value.url !== '/api/wechat/attachments/' + value.attachmentId || !['voice', 'video', 'document'].includes(value.kind) || !/^[a-z-]+\/[a-z0-9.+-]+$/.test(value.mime) || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > 25000000 || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isFinite(Date.parse(value.expiresAt)) || typeof value.formatValidation !== 'string' || value.formatValidation.length > 64) throw Error('metadata_shape');
  return { at: new Date().toISOString(), atMs: Date.now(), routeKind: 'metadata', status, responseBytes: bytes.length, responseSHA256: sha(bytes), idBindingHash: bindingHash, ownerSequence: owner?.sequence ?? null, delivery: 'pending', attachmentId: value.attachmentId, url: value.url, kind: value.kind, mime: value.mime, bytes: value.bytes, sha256: value.sha256, expiresAt: value.expiresAt, formatValidation: value.formatValidation };
}

let gate;
try { gate = await startupGate(); }
catch { console.error(JSON.stringify({ status: 'PUBLIC_SCOPE_PREFLIGHT_FAILED' })); process.exit(1); }
const server = http.createServer(async (req, res) => {
  stats.requests++;
  if (!loopback(req.socket.remoteAddress)) return json(res, 403, { error: 'loopback_only' });
  if (!req.url?.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'relative_path_required' });
  const route = new URL(req.url, 'http://127.0.0.1:46229').pathname;
  if (route.startsWith('/__qa/')) {
    const origin = req.headers.origin;
    if (origin && !['http://127.0.0.1:46229', 'http://localhost:46229'].includes(origin)) return json(res, 403, { error: 'control_origin_rejected' });
    trim();
    if (req.method === 'GET' && route === '/__qa/stats') return json(res, 200, { ...stats, mode, holdMs, activeOwner: activeOwner ? { kind: activeOwner.kind, mode: activeOwner.mode, sequence: activeOwner.sequence } : null, reservedBytes: reserved, receiptCount: receipts.length, scope: SCOPE, gate, events });
    if (req.method === 'GET' && route === '/__qa/receipts') return json(res, 200, { scope: SCOPE, receipts });
    if (req.method === 'POST' && route === '/__qa/mode') {
      const controller = new AbortController(); req.once('aborted', () => controller.abort());
      let collected;
      try {
        collected = await buffered(req, 4096, req.headers['content-length'], controller.signal);
        if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
        const value = JSON.parse(collected.bytes);
        if (!['pass', 'holdNextMetadata', 'holdNextContent', 'rejectNextContent'].includes(value.mode) || (value.holdMs !== undefined && (!Number.isInteger(value.holdMs) || value.holdMs < 1 || value.holdMs > 15000))) return json(res, 400, { error: 'invalid_mode' });
        if (activeOwner && value.mode !== 'pass') return json(res, 409, { error: 'owner_inflight' });
        mode = value.mode; holdMs = value.holdMs ?? 5000;
        return json(res, 200, { mode, holdMs, existingOwnerContinues: !!activeOwner });
      } catch { return json(res, 400, { error: 'invalid_control' }); }
      finally { collected?.dispose(); }
    }
    return json(res, 404, { error: 'control_not_found' });
  }
  const kind = req.method === 'POST' && route === '/api/wechat/attachment' ? 'metadata' : req.method === 'GET' && /^\/api\/wechat\/attachments\/[\w-]{1,128}$/.test(route) ? 'content' : 'ordinary';
  const controller = new AbortController();
  let requestBody, responseBody, upstream, upstreamResponse, owner, receipt, bindingHash, timer;
  let complete = false, cancelled = false;
  const inactive = () => cancelled || complete || controller.signal.aborted;
  const dropInactive = () => {
    if (!inactive()) return false;
    clearTimeout(timer); responseBody?.dispose(); requestBody?.dispose(); clearOwner(owner);
    return true;
  };
  const abort = () => {
    if (complete || cancelled) return;
    cancelled = true; stats.cancelled++; controller.abort(); clearTimeout(timer); upstream?.destroy(); upstreamResponse?.destroy(); responseBody?.dispose(); requestBody?.dispose(); clearOwner(owner);
    if (receipt) receipt.delivery = 'cancelled'; event(kind, 'client_cancelled');
  };
  req.once('aborted', abort); res.once('close', () => { if (!res.writableFinished) abort(); });
  const fail = error => {
    if (cancelled || complete) return;
    stats.errors++; controller.abort(); clearTimeout(timer); upstream?.destroy(); upstreamResponse?.destroy(); requestBody?.dispose(); responseBody?.dispose(); clearOwner(owner);
    if (receipt) receipt.delivery = 'failed'; event(kind, 'proxy_error'); json(res, 502, { error: 'public_proxy_failed' }); complete = true;
  };
  try {
    if (kind === 'metadata') {
      requestBody = await buffered(req, MAX_METADATA, req.headers['content-length'], controller.signal);
      if (dropInactive()) return;
      const value = JSON.parse(requestBody.bytes);
      if (value.conversation !== publicReady.conversationId || !publicReady.records.some(r => r.messageId === value.message)) { requestBody.dispose(); return json(res, 403, { error: 'exact_public_media_only' }); }
      bindingHash = sha(JSON.stringify({ conversation: value.conversation, message: value.message }));
    } else if (kind === 'content') bindingHash = sha(route.split('/').pop());
    owner = consume(kind, bindingHash);
    if (owner?.mode === 'rejectNextContent') { stats.rejected++; clearOwner(owner); complete = true; event(kind, 'controlled_reject', { status: 503, count: owner.sequence }); return json(res, 503, { error: 'public_content_rejected' }); }
    const headers = { ...req.headers, host: '127.0.0.1:46228' };
    delete headers.connection;
    upstream = http.request({ hostname: '127.0.0.1', port: UPSTREAM_PORT, method: req.method, path: req.url, headers }, async incoming => {
      upstreamResponse = incoming;
      if (dropInactive()) return incoming.destroy();
      const status = incoming.statusCode ?? 502;
      const holding = owner?.mode.startsWith('hold') && status >= 200 && status < 300;
      const deadline = holding ? Date.now() + owner.holdMs : 0;
      if (holding) { stats.held++; timer = setTimeout(() => fail(Error('hold_deadline')), owner.holdMs); }
      try {
        if (kind === 'metadata' || holding) {
          responseBody = await buffered(incoming, kind === 'metadata' ? MAX_METADATA : MAX_RAM, incoming.headers['content-length'], controller.signal);
          if (dropInactive()) return;
          if (kind === 'metadata' && status >= 200 && status < 300) {
            receipt = projection(JSON.parse(responseBody.bytes), bindingHash, owner, responseBody.bytes, status);
            receipts.push(receipt); stats.metadataCaptured++; trim();
          }
          if (holding) {
            clearTimeout(timer);
            await new Promise(resolve => {
              const finish = () => { controller.signal.removeEventListener('abort', finish); resolve(); };
              timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
              controller.signal.addEventListener('abort', finish, { once: true });
              if (controller.signal.aborted) finish();
            });
            clearTimeout(timer);
          }
          if (dropInactive()) return;
          res.writeHead(status, incoming.headers);
          const bytes = responseBody.bytes.length, digest = sha(responseBody.bytes);
          res.end(responseBody.bytes, () => { if (dropInactive()) return; complete = true; responseBody.dispose(); clearOwner(owner); if (receipt) receipt.delivery = 'delivered'; event(kind, holding ? 'held_delivered' : 'delivered', { http: status, responseBytes: bytes, responseSHA256: digest, count: owner?.sequence ?? null }); });
        } else {
          res.writeHead(status, incoming.headers);
          let bytes = 0; const digest = createHash('sha256');
          const counter = new Transform({ transform(chunk, _, callback) { bytes += chunk.length; digest.update(chunk); callback(null, chunk); } });
          pipeline(incoming, counter, res, error => { if (dropInactive()) return; if (error) return fail(error); complete = true; clearOwner(owner); event(kind, owner ? 'consumed_not_held' : 'delivered', { http: status, responseBytes: bytes, responseSHA256: digest.digest('hex'), count: owner?.sequence ?? null }); });
        }
      } catch (error) { fail(error); }
    });
    stats.forwarded++;
    upstream.setTimeout(60000, () => fail(Error('upstream_timeout'))); upstream.on('error', fail);
    if (requestBody) upstream.end(requestBody.bytes, () => requestBody.dispose()); else req.pipe(upstream);
  } catch (error) { fail(error); }
});
server.on('connect', (_, socket) => socket.destroy());
server.listen(PORT, '127.0.0.1', () => console.log(JSON.stringify({ status: 'PUBLIC_MEDIA_PROXY_READY', port: PORT, upstreamPort: UPSTREAM_PORT, scope: SCOPE, upstreamPID: gate.upstreamPID, pid: process.pid, entrySHA256: gate.entrySHA256 })));
server.on('error', () => { console.error(JSON.stringify({ status: 'PUBLIC_MEDIA_PROXY_START_FAILED' })); process.exitCode = 1; });
const cleanup = setInterval(trim, 60000); cleanup.unref();
process.on('SIGTERM', () => { mode = 'pass'; server.close(); server.closeAllConnections(); receipts.splice(0); events.splice(0); clearInterval(cleanup); });
