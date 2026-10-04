// Public read-only native typography fixture; failure inventory in the design spec.
import http from 'node:http';
const port = 46272, id = 'public-checkbox-chat';
const stamp = '2026-10-04T00:00:00.000Z';
const connection = { id: 'public-checkbox-connection', name: '公开排版验收', provider: 'custom', type: 'rest', status: 'disconnected', endpoint: 'https://public-fixture.invalid', permissions: ['read', 'draft', 'send'], config: { authMethod: 'none', importantPeople: [], urgentWords: [], workingHoursOnly: false }, createdAt: stamp, updatedAt: stamp };
const settings = { identity: { name: '公开验收', language: 'zh-CN' }, autonomy: { holdSending: true, levels: { ack: 'draft', meet: 'draft', docs: 'draft', commit: 'draft', boss: 'draft', sensitive: 'observe' }, deepThink: ['vip'], quietFrom: '23:00', quietUntil: '07:00', alerts: 'urgent_digest', transparency: true } };
const conversations = [{ id, title: '公开排版验收', createdAt: stamp, updatedAt: stamp }];
const page = items => ({ items, total: items.length, hasMore: false });
const data = { revision: 1, settings, conversations, connections: [connection], messages: [], inbox: [], ideas: [], tasks: [], memories: [], activities: [], artifacts: [], automations: [] };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  let status = 200, value;
  if (req.headers.origin) { status = 403; value = { error: 'origin_blocked' }; }
  else if (req.method !== 'GET') { status = 405; value = { error: 'read_only_fixture' }; }
  else if (p === '/api/health') value = { ok: true, revision: 1 };
  else if (p === '/api/native/version') value = { apiVersion: 1, revision: 1, features: ['messages.page'] };
  else if (p === '/api/bootstrap') value = data;
  else if (p === '/api/settings') value = settings;
  else if (p === '/api/settings/models') value = { providers: [], standard: {}, deep: {} };
  else if (p === '/api/feishu/sync') value = { settings: { meetingEnabled: true, mailEnabled: false, includeAttachments: false }, history: page([]) };
  else if (p === '/api/feishu/binding') value = { status: 'unbound' };
  else if (p === '/api/connections') value = page([connection]);
  else if (p === `/api/connections/${connection.id}`) value = connection;
  else if (p === '/api/conversations') value = page(conversations);
  else if (p === '/api/conversations/primary') value = { conversationId: id, conversation: conversations[0] };
  else if (p === `/api/conversations/${id}/messages`) value = { ...page([]), nextBefore: null };
  else if (p === '/api/chat/conversations/state') value = { items: [{ id, found: true, running: false, partial: false, pending: 0 }] };
  else if (p.endsWith('/unresolved')) value = { ...page([]), conversationId: id, revision: 1, partialCount: 0, nextBefore: null };
  else if (p.startsWith('/api/chat/continuation/')) value = { running: false, items: [] };
  else if (['/api/tasks', '/api/inbox/query', '/api/ideas', '/api/activities'].includes(p)) value = page([]);
  else { status = 404; value = { error: 'not_found' }; }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
});
server.listen(port, '127.0.0.1', () => console.log(`PUBLIC_CHECKBOX_FIXTURE ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
