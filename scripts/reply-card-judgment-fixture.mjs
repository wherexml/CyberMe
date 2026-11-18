// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/reply-card-web
// Start from the repository root: node --import tsx scripts/reply-card-judgment-fixture.mjs
import {mkdtemp, mkdir, readFile} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';

const port = Number(process.env.CYBERME_REPLY_FIXTURE_PORT || 47941);
const modelPort = port + 1;
const assets = resolve('.local/reply-card-web');
const parent = resolve('.local/acceptance');
await mkdir(parent, {recursive: true});
const scope = await mkdtemp(parent + '/reply-card-');
Object.assign(process.env, {
  OPSTWIN_WEB_PORT: String(port), OPSTWIN_API_PORT: String(port),
  OPSTWIN_DATA_DIR: scope, OPSTWIN_PRIVATE_DIR: scope, OPSTWIN_NO_LISTEN: '1',
  OPSTWIN_NO_BACKGROUND: '1', OPSTWIN_INBOX_BACKGROUND: '0', OPSTWIN_CONNECTION_BACKGROUND: '0',
  OPSTWIN_NOTIFICATION_DELIVERY: 'off', OPSTWIN_AUTONOMOUS_DELIVERY: 'off',
  OPSTWIN_OMLX_BASE_URL: 'http://127.0.0.1:' + modelPort + '/v1', OPSTWIN_OMLX_KEY: 'synthetic',
});
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (new URL(url instanceof Request ? url.url : url).origin !== 'http://127.0.0.1:' + modelPort)
    throw Error('Non-fixture network request');
  return nativeFetch(url, options);
};

const store = await import('../server/src/store.ts');
store.setMeta('initialized', true);
const {app} = await import('../server/src/index.ts');
const {peopleContext} = await import('../server/src/people-context.ts');
store.patchSettings({identity: {name: '公开验收', language: 'zh-CN'}, autonomy: {holdSending: true}});
store.put('conversations', {id: 'main', title: '公开验收'});
store.setMeta('primaryConversationId', 'main');

const source = '本周演示预计三点开始，你方便参加吗？';
const draft = '请稍等，我核对三点的安排后答复。';
const sentAt = new Date(Date.now() - 600000).toISOString();
const open = {status:'succeeded', route:'quick_reply', priority:'medium', actionType:'reply',
  resolution:'open', reason:'direct_request', needsReply:.9, missingContext:0, risk:.1};
const failed = {status:'failed', route:'review', attempt:3, error:'合成判断失败'};
function seed(id, title, triage, text, time = sentAt, extra = {}) {
  const message = {id:id+'-q', text, senderName:'公开同事', sentAt:time, isMine:false};
  const item = store.put('inbox', {id, title, body:text, origin:'human', status:'pending', sender:'公开同事',
    channel:'Feishu', chatMode:'p2p', receivedAt:sentAt, messages:[message], ...extra});
  store.db.prepare("UPDATE entities SET data=json_set(data,'$.copilot.notBefore',?) WHERE type='inbox' AND id=?").run(sentAt,id);
  store.put('inbox_triages', {id, ...triage, policyVersion:store.TRIAGE_POLICY_VERSION,
    sourceVersion:store.inboxTriageVersion(item), peopleFingerprint:peopleContext().fingerprint});
}
seed('meeting', '演示协调群', {...failed, priorOpenRequest:{requestMessageId:'meeting-q'}}, source);
seed('unbound', '项目联络人', {...open, route:'review', resolution:'unknown', missingContext:.82},
  '这只是聊天中的一句背景消息。');
seed('bad-time', '时间缺失的请求', {...open, requestMessageId:'bad-time-q'}, '请确认样稿的颜色。', 'unknown');
seed('backoff', '安排评审时间', {...failed, attempt:1, nextRetryAt:new Date(Date.now()+1800000).toISOString(),
  priorOpenRequest:{requestMessageId:'backoff-q'}}, '评审可以提前吗？');
seed('saved', '设计联络组', {...open, requestMessageId:'saved-q'}, '能发一下资料吗？', sentAt, {draft:'我整理后发你资料。'});

seed('decision', '样稿评审', {...open, route:'review', actionType:'decision', requestMessageId:'decision-q'}, '需要你决定保留哪一版样稿。');
const {messageRevision} = await import('../shared/inbox-surfacing.ts');
const sourceMessage = store.get('inbox','meeting').messages[0];
store.put('messages',{id:'previous-meeting',conversationId:'main',role:'assistant',content:'上一次判断留下的演示安排提醒。',
  inboxAnalysis:{itemId:'meeting',deliveryId:'synthetic-meeting',actions:['draft_reply','snooze'],
    requestMessageId:sourceMessage.id,requestRevision:messageRevision(sourceMessage)}});
const requests = [];
const model = new Hono();
model.post('/v1/chat/completions', async c => {
  const input = await c.req.json();
  const content = input.messages.at(-1).content;
  let response = draft;
  if (content.startsWith('{')) {
    const {questions} = JSON.parse(content);
    const choices = {request:'m0', replyEvidence:'none', priority:'medium', action:'reply', resolution:'open', reason:'direct_request'};
    const answers = Object.fromEntries(Object.entries(questions).map(([k,q])=>[k,
      q.type === 'noul' ? (k === 'reply' ? .95 : 0) : choices[k] || Object.keys(q.criteria)[0]]));
    response = JSON.stringify({answers});
  }
  return c.json({model:'local-fixture',choices:[{finish_reason:'stop',message:{content:response}}]});
});
serve({fetch:model.fetch, hostname:'127.0.0.1', port:modelPort});
const gate = new Hono();
gate.get('/__fixture/evidence', c=>c.json({requests, sends:store.db.prepare('SELECT COUNT(*) AS n FROM send_intents').get().n}));
gate.all('/api/*', async c=>{
  if(c.req.method === 'POST'){
    const path = c.req.path;
    const input = await c.req.raw.clone().json().catch(()=>({}));
    requests.push({path, force:input.force, type:input.type});
    if(!['/api/inbox/meeting/triage','/api/attention/actions'].includes(path))return c.json({error:'fixture_read_only'},403);
  }
  return app.fetch(c.req.raw);
});
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*', async c=>{
  const file=resolve(assets,'.'+(c.req.path==='/'?'/cyberme.html':c.req.path));
  if(!file.startsWith(assets+'/'))return c.notFound();
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'}})}
  catch{return c.notFound()}
});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});
console.log('http://127.0.0.1:'+port+'/cyberme.html');
