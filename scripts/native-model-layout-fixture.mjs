// Public, controlled native GUI responses. Does not call a model or production API.
// Failure inventory: docs/design/native-model-settings-layout.md.
import http from 'node:http';
import fs from 'node:fs';
import { resolve } from 'node:path';
const port = 46270, cid = 'public-model-layout';
const out = resolve('output/native-model-layout-20261004');
fs.mkdirSync(out, { recursive: true });
const def = id => ({ id, smart: true, contextWindow: 64000, maxTokens: 4096, reasoning: true, vision: true });
const providers = [
  { id: 'public-opencode', name: 'OpenCode Go', models: ['deepseek-v4.1-flash', 'claude-opus-5-5'] },
  { id: 'public-long', name: '公开验收供应商 · Long provider name for narrow settings windows', models: ['public-long-model-name-for-narrow-window-layout-verification', 'claude-opus-5-5'] },
].map(p => ({ ...p, enabled: true, configured: true, baseUrl: 'https://public-fixture.invalid/v1', api: 'openai-completions', definitions: p.models.map(def) }));
let models = { version: 'public-1', standard: { providerId: providers[0].id, model: providers[0].models[0] }, deep: { providerId: providers[0].id, model: providers[0].models[0] }, providers };
let saveFails = false, probeMode = 'unknown', revision = 1;
const events = [], probes = new Map();
const settings = { identity: { name: '公开布局验收', language: 'zh-CN' }, autonomy: { holdSending: true } };
const data = { revision, settings, conversations: [{ id: cid, title: '公开模型设置验收' }], messages: [], inbox: [], tasks: [], ideas: [], memories: [], connections: [], activities: [], artifacts: [], automations: [] };
const page = items => ({ items, total: items.length, hasMore: false });
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  let status = 200, value, body = {};
  try {
    let bytes = '';
    for await (const b of req) { bytes += b; if (bytes.length > 8192) throw Error('body_too_large'); }
    if (bytes) body = JSON.parse(bytes);
    if (req.headers.origin) { status = 403; value = { error: 'origin_blocked' }; }
    else if (p === '/__qa/state' && req.method === 'GET') value = { scope: 'public synthetic GUI only', models, events };
    else if (p === '/__qa/mode' && req.method === 'POST') {
      if (typeof body.saveFails === 'boolean') saveFails = body.saveFails;
      if (['unknown', 'succeeded', 'failed', 'running'].includes(body.probeMode)) probeMode = body.probeMode;
      value = { saveFails, probeMode };
    } else if (p === '/api/settings/models' && req.method === 'PATCH') {
      if (saveFails) { status = 503; value = { error: 'public_save_unavailable', message: '公开验收：保存暂时失败，请重试' }; }
      else if (body.version !== models.version) { status = 409; value = { error: 'version_conflict', message: '配置已更新，请重新读取' }; }
      else if (![body.standard, body.deep].every(r => providers.some(p => p.id === r?.providerId && p.models.includes(r.model)))) { status = 400; value = { error: 'invalid_selection' }; }
      else { models = { ...models, version: `public-${++revision}`, standard: body.standard, deep: body.deep }; value = models; }
      events.push({ method: req.method, path: p, status, version: models.version });
    } else if (p === '/api/settings/models/test' && req.method === 'POST') {
      if (probeMode === 'unknown') { status = 503; value = { error: 'public_test_unavailable', message: '公开验收：测试响应暂时不可用，请回查' }; }
      else { value = { requestId: body.requestId, status: probeMode }; probes.set(body.requestId, value); }
      events.push({ method: req.method, path: p, status, requestId: body.requestId });
    } else if (p.startsWith('/api/settings/models/tests/') && req.method === 'GET') {
      const id = p.split('/').at(-1); value = probes.get(id);
      if (!value) { status = 404; value = { error: 'not_found', message: '公开验收：未找到原测试' }; }
      events.push({ method: req.method, path: '/api/settings/models/tests/:id', status, requestId: id });
    } else if (req.method !== 'GET') { status = 405; value = { error: 'public_fixture_write_blocked' }; }
    else if (p === '/api/health') value = { ok: true, revision };
    else if (p === '/api/native/version') value = { apiVersion: 1, revision, features: ['messages.page'] };
    else if (p === '/api/bootstrap') value = { ...data, revision };
    else if (p === '/api/settings') value = settings;
    else if (p === '/api/settings/models') value = models;
    else if (p === '/api/conversations/primary') value = { conversationId: cid, conversation: data.conversations[0] };
    else if (p === '/api/conversations') value = page(data.conversations);
    else if (p === `/api/conversations/${cid}/messages`) value = { ...page([]), nextBefore: null };
    else if (p === '/api/chat/conversations/state') value = { items: [{ id: cid, found: true, running: false, partial: false, pending: 0 }] };
    else if (p.endsWith('/unresolved')) value = { ...page([]), conversationId: cid, revision, partialCount: 0, nextBefore: null };
    else if (p.startsWith('/api/chat/continuation/')) value = { running: false, items: [] };
    else if (['/api/tasks', '/api/inbox/query', '/api/ideas', '/api/connections'].includes(p)) value = page([]);
    else { status = 404; value = { error: 'not_found' }; }
  } catch { status = 400; value = { error: 'invalid_public_fixture_request' }; }
  fs.writeFileSync(resolve(out, 'fixture-events.json'), JSON.stringify({ scope: 'controlled responses; no upstream model calls', models, events }, null, 2));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
});
server.listen(port, '127.0.0.1', () => console.log(`PUBLIC_MODEL_LAYOUT_FIXTURE ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
