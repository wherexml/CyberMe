// Native GUI recovery E2E: real API forwarding with a controlled outage.
// node scripts/native-ui-proxy.mjs; OPSTWIN_API=http://127.0.0.1:46191 <native app>
// POST /__qa/offline or /__qa/online; GET /__qa/status exposes IDs/counts only.
import http from 'node:http';

const port = Number(process.env.OPSTWIN_QA_PROXY_PORT || 46191);
if (!Number.isInteger(port) || port < 10000 || port > 65535) throw new Error('Use a five-digit proxy port');
const target = new URL(process.env.OPSTWIN_API || 'http://127.0.0.1:46110');
if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('QA proxy target must be local HTTP');
let offline = false;
let dropChatResponse = false;
let dropTaskResponse = false;
let dropInboxSendResponse = false;
const attempts = [];
const readbacks = [];
const server = http.createServer((req, res) => {
  if (req.url === '/__qa/status' || (req.method === 'POST' && ['/__qa/offline', '/__qa/online','/__qa/drop-chat-response', '/__qa/drop-task-response', '/__qa/drop-inbox-send-response'].includes(req.url))) {
    if (req.url === '/__qa/drop-chat-response') dropChatResponse = true;
    else if(req.url === '/__qa/drop-task-response') dropTaskResponse = true;
    else if(req.url === '/__qa/drop-inbox-send-response') dropInboxSendResponse = true;
    else if (req.url !== '/__qa/status') offline = req.url === '/__qa/offline';
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({offline, dropChatResponse, dropTaskResponse, dropInboxSendResponse, attempts, readbacks}));
    return;
  }
  const send = (body) => {
    if (req.method === 'GET' && (/^\/api\/chat\/requests\//.test(req.url) || /^\/api\/tasks\//.test(req.url)||/^\/api\/inbox\/[^/?]+(?:\?.*)?$/.test(req.url))) readbacks.push({path:req.url, requestId: decodeURIComponent(req.url.split('/').pop()), at:Date.now(), offline});
    let attempt;
    if (req.method === 'POST' && (req.url === '/api/chat'||req.url === '/api/tasks'||/^\/api\/inbox\/[^/?]+\/send$/.test(req.url))) {
      let requestId;
      try { const parsed=JSON.parse(body.toString());requestId=parsed.requestId||parsed.id||parsed.idempotencyKey; } catch {}
      attempt = {requestId,path:req.url, at: Date.now(), offline};
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
      const shouldDrop=attempt && ((req.url==='/api/chat' && dropChatResponse && response.statusCode===200)||(req.url==='/api/tasks' && dropTaskResponse && response.statusCode===201)||(req.url.endsWith('/send')&&dropInboxSendResponse&&response.statusCode===200));
      if (shouldDrop) {
        if(req.url==='/api/chat')dropChatResponse=false;
        if(req.url==='/api/tasks')dropTaskResponse=false;
        if(req.url.endsWith('/send'))dropInboxSendResponse=false;
        attempt.responseDropped = true;
        response.resume();
        response.on('end', () => res.destroy());
        return;
      }
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
  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = []; let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 26 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => send(Buffer.concat(chunks)));
  } else {
    send(undefined);
  }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({port, target: target.origin, offline})));
