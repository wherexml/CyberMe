// Native GUI recovery E2E: real API forwarding with a controlled outage.
// node scripts/native-ui-proxy.mjs; OPSTWIN_API=http://127.0.0.1:46191 <native app>
// POST /__qa/offline or /__qa/online; GET /__qa/status exposes IDs/counts only.
import http from 'node:http';

const port = Number(process.env.OPSTWIN_QA_PROXY_PORT || 46191);
if (!Number.isInteger(port) || port < 10000 || port > 65535) throw new Error('Use a five-digit proxy port');
const target = new URL(process.env.OPSTWIN_API || 'http://127.0.0.1:46110');
if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('QA proxy target must be local HTTP');
let offline = false;
const attempts = [];
const server = http.createServer((req, res) => {
  if (req.url === '/__qa/status' || (req.method === 'POST' && ['/__qa/offline', '/__qa/online'].includes(req.url))) {
    if (req.url !== '/__qa/status') offline = req.url === '/__qa/offline';
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({offline, attempts}));
    return;
  }
  const send = (body) => {
    let attempt;
    if (req.method === 'POST' && req.url === '/api/chat') {
      let requestId;
      try { requestId = JSON.parse(body.toString()).requestId; } catch {}
      attempt = {requestId, at: Date.now(), offline};
      attempts.push(attempt);
    }
    if (offline) {
      if (attempt) attempt.status = 503;
      res.writeHead(503, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'qa_offline', message: '本地验收代理暂时离线'}));
      return;
    }
    const upstream = http.request(new URL(req.url, target), {
      method: req.method, headers: {...req.headers, host: target.host},
    }, response => {
      if (attempt) attempt.status = response.statusCode;
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (attempt) attempt.status = 502;
      if (!res.headersSent) res.writeHead(502, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'qa_upstream_unavailable', message: '本地服务不可用'}));
    });
    res.on('close', () => upstream.destroy());
    upstream.end(body);
  };
  if (req.method === 'POST' && req.url === '/api/chat') {
    const chunks = []; let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => send(Buffer.concat(chunks)));
  } else {
    send(undefined);
  }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({port, target: target.origin, offline})));
