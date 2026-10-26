import {Readable} from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { realpathSync as realPath } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLedger } from './ledger';
import { accesses, checkId, engineEfforts, engineStatus, engines, executeNative, modelIds, sessionInfo, sessionList, type Engine } from './native';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const terminal = ['succeeded', 'failed', 'partial', 'unknown', 'stopped'];
const errors: Record<string, string> = { native_failed: '执行未完成，请查看原记录', native_stopped: '已停止',
  native_model_unavailable: '原生默认或所选模型不可用，可明确指定本次任务模型后另建执行',
  native_stop_unconfirmed: '停止尚未确认，请回查原记录', native_timeout: '执行超时，先查看原记录', server_restarted: '服务已重启，原结果尚未确认', save_failed: '本机记录保存失败',
  native_unavailable: '原生服务不可用，请检查 CLI 登录与连接', session_outside_project: '会话不属于当前项目',
  approval_expired: '此操作已结束或授权已过期', output_limit: '输出达到当前上限，已停止' };
function cleanText(value: string, limit = 16000) { return value.slice(0, limit).replace(/\b(?:sk-|sk-ant-|ghp_)[a-zA-Z0-9_-]{12,}/g, '[redacted]'); }
function safe(value: any, depth = 0): any {
  if (depth > 5) return '[bounded]';
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(x => safe(x, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [k, /token|secret|password|api.?key|authorization|credential/i.test(k) ? '[redacted]' : safe(v, depth + 1)]));
  return value;
}
export function createTaskAgentAPI({ root, port, ledgerDir = join(root, '.local/task-agents/requests') }: { root: string; port: number; ledgerDir?: string }) {
  root = realPath(root); const ledger = createLedger(root, ledgerDir);
  const active = new Map<string, { abort: AbortController; row: any; settle?: (allow: boolean) => void }>();
  let closing = false;
  function dto(r: any) { return { requestId: r.requestId, taskId: r.input.taskId, engine: r.input.engine,
    access: r.input.access, model: r.input.model, effort: r.input.effort,
    status: r.status, text: r.text, code: r.code, error: errors[r.code] || (r.code ? errors.native_unavailable : undefined),
    nativeSessionId: r.nativeSessionId, nativeTurnId: r.nativeTurnId, sourceSessionId: r.input.sourceSessionId,
    continuation: r.input.sourceSessionId ? 'native-fork' : 'new', dispatch: r.dispatch, events: r.events, approval: r.approval,
    updatedAt: r.updatedAt, nativeCalls: r.nativeCalls, payloadHash: r.payloadHash } }
  function change(r: any, patch: any) { Object.assign(r, patch, { updatedAt: Date.now() }); ledger.save(r); }
  async function run(r: any) {
    const owner = { abort: new AbortController(), row: r, settle: undefined as ((x: boolean) => void) | undefined };
    active.set(r.requestId, owner);
    try {
      change(r, { status: 'running' });
      await executeNative(root, r.input, {
        dispatched() { change(r, { dispatch: 'possibly_sent', nativeCalls: r.nativeCalls + 1 }); },
        session(id) { change(r, { nativeSessionId: id }); },
        turn(id) { change(r, { nativeTurnId: id, dispatch: 'accepted' }); },
        text(text) {
          if (owner.abort.signal.aborted) return;
          change(r, { text: cleanText(text, 120000), dispatch: 'accepted' });
          if (text.length >= 120000) { change(r, { code: 'output_limit' }); owner.abort.abort(); }
        },
        tool(name, status) { if (!owner.abort.signal.aborted) change(r, { events: [...r.events, { name, status, at: Date.now() }].slice(-60) }); },
        approve(tool, detail) {
          if (owner.abort.signal.aborted) return Promise.resolve(false);
          return new Promise<boolean>((resolve, reject) => {
            const id = randomUUID(), expiresAt = Date.now() + 120000;
            let settled = false;
            const timer = setTimeout(() => settle(false), 120000);
            const settle = (allow: boolean) => {
              if (settled) return; settled = true; clearTimeout(timer); owner.settle = undefined;
              try { change(r, { status: owner.abort.signal.aborted ? 'stopping' : 'running', approval: null }); resolve(allow); }
              catch (e) { owner.abort.abort(); reject(e); }
            };
            owner.settle = settle;
            try { change(r, { status: 'awaiting_approval', approval: { id, tool, detail: safe(detail), expiresAt } }); }
            catch (e) { clearTimeout(timer); owner.settle = undefined; reject(e); }
          });
        },
      }, owner.abort.signal);
      change(r, { status: owner.abort.signal.aborted ? 'stopped' : 'succeeded', approval: null });
    } catch (e: any) {
      const stopped = owner.abort.signal.aborted,stopConfirmed=stopped&&e.message==='native_stopped';
      const code = stopped ? (stopConfirmed?(r.code || 'native_stopped'):'native_stop_unconfirmed') : ['session_outside_project', 'native_timeout', 'native_failed', 'native_stopped', 'native_model_unavailable'].includes(e.message) ? e.message : 'native_unavailable';
      try { change(r, { status: stopped ? (stopConfirmed?'stopped':'unknown') : r.text ? 'partial' : r.dispatch === 'pending' || code === 'session_outside_project' ? 'failed' : 'unknown', code, approval: null }); }
      catch { Object.assign(r, { status: 'unknown', code: 'save_failed' }); }
    } finally { owner.settle?.(false); active.delete(r.requestId); }
  }
  function reply(res: ServerResponse, status: number, value: any) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
  async function body(req: IncomingMessage) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw Error('invalid_input');
    const chunks: Buffer[] = []; let n = 0;
    for await (const b of req) { n += b.length; if (n > 50000) throw Error('invalid_input'); chunks.push(b); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('invalid_input'); }
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!req.url?.startsWith('/api/task-agents/')) return false;
    const host = req.headers.host, origin = req.headers.origin, site = req.headers['sec-fetch-site'], clientId = String(req.headers['x-opstwins-client'] || '');
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host!) || origin && origin !== `http://${host}` || site && !['same-origin', 'none'].includes(String(site)) || req.headers['x-opstwins-agent'] !== 'direct' || !uuid.test(clientId)) { reply(res, 403, { error: 'origin_denied' }); return true; }
    const url = new URL(req.url, `http://${host}`), parts = url.pathname.split('/').slice(3);
    try {
      if (closing) { reply(res, 503, { error: 'service_closing' }); return true; }
      if (req.method === 'GET' && parts[0] === 'status' && parts.length === 1) {
        const results = await Promise.all(engines.map(async engine => { try { return await engineStatus(root, engine); } catch { return { engine, available: false, authenticated: false, error: errors.native_unavailable }; } }));
        reply(res, 200, { executors: results, project: 'opstwin-advance', historyMode: 'native-fork', accessModes: accesses }); return true;
      }
      if (req.method === 'GET' && parts[0] === 'sessions' && engines.includes(parts[1] as Engine)) {
        const engine = parts[1] as Engine;
        if (parts.length === 2) reply(res, 200, await sessionList(root, engine, url.searchParams.get('cursor') || undefined));
        else if (parts.length === 3) reply(res, 200, await sessionInfo(root, engine, checkId(parts[2])));
        else reply(res, 404, { error: 'not_found' });
        return true;
      }
      if (parts[0] === 'requests' && uuid.test(parts[1] || '')) {
        const id = parts[1]; let row = ledger.read(id);
        if (row && row.clientId !== clientId) { reply(res, 404, { error: 'not_found' }); return true; }
        if (req.method === 'GET' && parts.length === 2) { reply(res, row ? 200 : 404, row ? dto(row) : { error: 'not_found' }); return true; }
        if (req.method === 'POST' && parts.length === 2) {
          const raw = await body(req);
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid_input');
          if (Object.keys(raw).some(k => !['engine', 'taskId', 'prompt', 'sourceSessionId', 'access', 'model', 'effort'].includes(k)) || !engines.includes(raw.engine) || typeof raw.taskId !== 'string' || !/^[\w-]{1,128}$/.test(raw.taskId) || typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 24000 || !accesses.includes(raw.access) || raw.sourceSessionId !== undefined && (typeof raw.sourceSessionId !== 'string' || !/^[\w-]{1,128}$/.test(raw.sourceSessionId)) || raw.model !== undefined && (typeof raw.model !== 'string' || !modelIds.test(raw.model)) || raw.effort !== undefined && (typeof raw.effort !== 'string' || !engineEfforts[raw.engine as Engine].includes(raw.effort))) throw Error('invalid_input');
          // Optional fields are omitted when empty so pre-existing request fingerprints stay identical.
          const input = { engine: raw.engine, taskId: raw.taskId, prompt: raw.prompt, access: raw.access, ...(raw.sourceSessionId ? { sourceSessionId: raw.sourceSessionId } : {}), ...(raw.model ? { model: raw.model } : {}), ...(raw.effort ? { effort: raw.effort } : {}) };
          const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
          if (row) { reply(res, row.payloadHash === payloadHash ? 200 : 409, row.payloadHash === payloadHash ? dto(row) : { error: 'request_conflict' }); return true; }
          if (input.sourceSessionId) await sessionInfo(root, input.engine, input.sourceSessionId);
          // History verification is async. Recheck the durable ID before committing/start.
          row = ledger.read(id);
          if (row) { reply(res, row.clientId !== clientId ? 404 : row.payloadHash === payloadHash ? 200 : 409,
            row.clientId !== clientId ? { error: 'not_found' } : row.payloadHash === payloadHash ? dto(row) : { error: 'request_conflict' }); return true; }
          if (active.size >= 2) { reply(res, 429, { error: 'executor_busy' }); return true; }
          row = { requestId: id, clientId, input, payloadHash, status: 'queued', dispatch: 'pending', nativeCalls: 0, text: '', events: [], createdAt: Date.now(), updatedAt: Date.now() };
          ledger.save(row); void run(row); reply(res, 202, dto(row)); return true;
        }
        if (req.method === 'POST' && row && parts[2] === 'stop' && parts.length === 3) {
          await body(req); const owner = active.get(id);
          if (owner) { change(owner.row, { status: 'stopping' }); owner.abort.abort(); owner.settle?.(false); }
          reply(res, 200, owner ? { ...dto(row), status: 'stopping' } : dto(row)); return true;
        }
        if (req.method === 'POST' && row && parts[2] === 'approvals' && parts.length === 4) {
          const input = await body(req), owner = active.get(id);
          if (!owner?.settle || row.approval?.id !== parts[3] || row.approval.expiresAt <= Date.now() || !['allow', 'deny'].includes(input.decision)) { reply(res, 409, { error: 'approval_expired' }); return true; }
          owner.settle(input.decision === 'allow'); reply(res, 200, { requestId: id, resolved: true }); return true;
        }
      }
      reply(res, 404, { error: 'not_found' });
    } catch (e: any) { const bad = ['invalid_input', 'invalid_id', 'invalid_cursor', 'session_outside_project'].includes(e.message); reply(res, bad ? 400 : 503, { error: bad ? e.message : 'native_unavailable', message: errors[e.message] || errors.native_unavailable }); }
    return true;
  }
  return { handle, async fetch(request:Request){const url=new URL(request.url),raw=Readable.from([Buffer.from(await request.arrayBuffer())]) as any;raw.method=request.method;raw.url=url.pathname+url.search;raw.headers={...Object.fromEntries(request.headers),host:url.host};return new Promise<Response>(resolve=>{let status=200,headers:any={};const response:any={writeHead(code:number,h:any){status=code;headers=h;},end(data:any){resolve(new Response(data,{status,headers}))}};void handle(raw,response).catch(()=>{resolve(new Response(JSON.stringify({error:'native_unavailable'}),{status:503,headers:{'content-type':'application/json'}}))})})}, async close() { closing = true; for (const owner of active.values()) { owner.abort.abort(); owner.settle?.(false); }
    const deadline = Date.now() + 5000; while (active.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 50)); ledger.close(); } };
}
