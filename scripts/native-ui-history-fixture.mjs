// Isolated, read-only native GUI history benchmark. Never contacts the real API.
import http from 'node:http';

const conversationId = 'conversation-OPSADV-QA-NATIVE-PERF-1000';
const messages = Array.from({length: 1000}, (_, i) => ({
  id: `message-qa-perf-${String(i).padStart(4, '0')}`,
  conversationId, role: i % 2 ? 'assistant' : 'user',
  createdAt: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(),
  content: `OPSADV-QA-NATIVE-PERF-${String(i).padStart(4, '0')} 中文消息🙂\n\n` +
    (i % 10 === 9 ? '## 隔离性能数据\n\n- 一级列表\n  - 二级列表\n\n```python\nprint("qa")\n```\n\n| 列A | 列B |\n|---|---|\n| 合成 | 只读 |\n\n' : '') +
    '此内容仅用于原生列表滚动性能验收，不是真实聊天或模型回复。',
}));
const seen = new Set();
let pageRequests = 0;
const send = (res, value, status = 200) => {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(value));
};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:46192');
  if (req.method !== 'GET') return send(res, {error: 'qa_read_only'}, 405);
  if (url.pathname === '/api/native/version') return send(res, {apiVersion: 1, revision: 1, server: 'QA-ISOLATED-HISTORY', features: ['messages.page']});
  if (url.pathname === '/api/health') return send(res, {ok: true, revision: 1});
  if (url.pathname === '/api/conversations/primary') return send(res, {conversationId, conversation: {id: conversationId, title: 'QA 合成历史 1000 条（隔离，只读）'}});
  if (url.pathname === `/api/conversations/${conversationId}/messages`) {
    const before = url.searchParams.get('before');
    const end = before ? messages.findIndex(m => m.id === before) : messages.length;
    const limit = Number(url.searchParams.get('limit') || 50);
    if (end < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) return send(res, {error: 'qa_invalid_page'}, 400);
    const start = Math.max(0, end - limit); const items = messages.slice(start, end);
    pageRequests++; items.forEach(m => seen.add(m.id));
    console.log(JSON.stringify({pageRequests, start, end, seen: seen.size}));
    return send(res, {items, hasMore: start > 0, nextBefore: start > 0 ? items[0].id : null});
  }
  if (url.pathname === '/__qa/status') return send(res, {fixture: true, total: messages.length, seen: seen.size, pageRequests});
  send(res, {error: 'not_found'}, 404);
}).listen(46192, '127.0.0.1', () => console.log('QA read-only history fixture: 127.0.0.1:46192'));
