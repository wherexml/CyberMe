// Real late-policy GUI harness. Fixed public loopback upstream; never logs bodies.
import {createServer, request} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const UPSTREAM = 'http://127.0.0.1:46218';
const PORT = 46219;
const MAX_JSON = 1024 * 1024;
const id = process.argv.find(a => a.startsWith('--inbox-id='))?.slice(11);
if (!id || !/^OPSADV-QA-[A-Za-z0-9_-]{1,160}$/.test(id)) {
  throw Error('Explicit existing public --inbox-id=OPSADV-QA-... required');
}
const policyPath = `/api/inbox/${id}/policy`;
const draftPath = `/api/inbox/${id}/draft`;
let mode = 'pass', delayMs = 5000, sequence = 0;
const counts = {forwarded: 0, targetPolicies: 0, consumed: 0, released: 0, aborted: 0, upstreamErrors: 0, oversized: 0, deniedWrites: 0, generateForwarded: 0};
const events = [];
const sha = value => createHash('sha256').update(value).digest('hex');
function event(kind, metadata = {}) {
  const value = {sequence: ++sequence, at: new Date().toISOString(), kind, ...metadata};
  events.push(value);
  if (events.length > 2000) events.shift();
  console.log(JSON.stringify(value));
}
function reply(res, status, value) {
  if (res.destroyed) return;
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
}
async function guard() {
  const settingsResponse = await fetch(`${UPSTREAM}/api/settings`, {signal: AbortSignal.timeout(5000)});
  const settings = await settingsResponse.json();
  if (settingsResponse.status !== 200 || settings.identity?.name !== 'OPSADV-QA Public Partial Owner' || settings.autonomy?.holdSending !== true) {
    throw Error('Existing public isolated owner/holdSending guard rejected');
  }
  const targetResponse = await fetch(`${UPSTREAM}/api/inbox/${id}`, {signal: AbortSignal.timeout(5000)});
  const target = await targetResponse.json();
  if (targetResponse.status !== 200 || target.id !== id) throw Error('Exact existing public Inbox ID required');
  event('startup_guard', {publicId: id, ownerMatches: true, holdSending: true, targetMatches: true, port: PORT, upstreamPort: 46218});
}
await guard();
if (process.argv.includes('--smoke')) { await runSmoke(); process.exit(process.exitCode || 0); }
const server = createServer((incoming, outgoing) => {
  if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) return reply(outgoing, 400, {error: 'relative_path_required'});
  const url = new URL(incoming.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/__qa/state' && incoming.method === 'GET') {
    return reply(outgoing, 200, {mode, publicId: id, delayMs, port: PORT, upstreamPort: 46218, counts, events});
  }
  if (url.pathname === '/__qa/control' && incoming.method === 'POST') {
    const selected = url.searchParams.get('mode');
    const target = url.searchParams.get('id');
    const requestedDelay = Number(url.searchParams.get('delayMs') || '5000');
    incoming.resume();
    if (!['pass', 'delayNextPolicy'].includes(selected) || target !== id || !Number.isInteger(requestedDelay) || requestedDelay < 1 || requestedDelay > 10000) {
      return reply(outgoing, 400, {error: 'exact_public_control_required'});
    }
    mode = selected;
    delayMs = requestedDelay;
    event('control', {mode, publicId: id, delayMs});
    return reply(outgoing, 200, {mode, publicId: id, delayMs});
  }
  if (url.pathname.startsWith('/__qa/')) return reply(outgoing, 404, {error: 'control_not_found'});
  const read = incoming.method === 'GET' || incoming.method === 'HEAD';
  const generate = incoming.method === 'POST' && url.pathname === draftPath;
  if (!read && !generate) {
    counts.deniedWrites++;
    incoming.resume();
    event('write_denied', {method: incoming.method, status: 403});
    return reply(outgoing, 403, {error: 'public_proxy_write_denied'});
  }
  const selected = mode === 'delayNextPolicy' && incoming.method === 'GET' && url.pathname === policyPath && !url.search;
  const heldMs = delayMs;
  if (selected) { mode = 'pass'; counts.consumed++; }
  if (url.pathname === policyPath) counts.targetPolicies++;
  if (generate) counts.generateForwarded++;
  const started = Date.now();
  let timer, done = false, responseStatus;
  const upstream = request({hostname: '127.0.0.1', port: 46218, path: incoming.url, method: incoming.method, headers: {...incoming.headers, host: '127.0.0.1:46218'}}, response => {
    counts.forwarded++;
    responseStatus = response.statusCode;
    response.on('error', err => {
      if (done || outgoing.destroyed) return;
      done = true; counts.upstreamErrors++; clearTimeout(timer);
      event('response_error', {method: incoming.method, ...(selected ? {publicId: id} : {}), status: responseStatus || 502, codeHash: sha(String(err.code || 'response')), elapsedMs: Date.now() - started});
      if (!outgoing.headersSent) reply(outgoing, 502, {error: 'public_response_error'}); else outgoing.destroy();
    });
    if (!selected) {
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
      return;
    }
    if (!String(response.headers['content-type'] || '').includes('application/json')) {
      done = true; counts.upstreamErrors++; response.resume();
      event('policy_non_json', {method: 'GET', publicId: id, status: responseStatus || 502});
      return reply(outgoing, 502, {error: 'policy_json_required'});
    }
    const parts = [];
    let size = 0;
    response.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_JSON) {
        counts.oversized++;
        done = true;
        event('policy_buffer_limit', {method: 'GET', publicId: id, status: responseStatus, bytes: size, elapsedMs: Date.now() - started});
        response.destroy(); upstream.destroy();
        reply(outgoing, 502, {error: 'policy_response_too_large'});
      } else parts.push(chunk);
    });
    response.on('aborted', () => {
      if (done) return;
      done = true; counts.upstreamErrors++;
      event('policy_upstream_aborted', {method: 'GET', publicId: id, status: responseStatus, elapsedMs: Date.now() - started});
      reply(outgoing, 502, {error: 'policy_upstream_aborted'});
    });
    response.on('end', () => {
      if (done) return;
      event('policy_buffered', {method: 'GET', publicId: id, status: responseStatus, bytes: size, delayMs: heldMs});
      timer = setTimeout(() => {
        if (done || outgoing.destroyed) return;
        done = true; counts.released++;
        outgoing.writeHead(response.statusCode, response.headers);
        outgoing.end(Buffer.concat(parts));
        event('policy_released', {method: 'GET', publicId: id, status: responseStatus, bytes: size, elapsedMs: Date.now() - started});
      }, heldMs);
    });
  });
  upstream.on('error', err => {
    if (done || outgoing.destroyed) return;
    done = true; counts.upstreamErrors++;
    clearTimeout(timer);
    event('upstream_error', {method: incoming.method, ...(selected ? {publicId: id} : {}), status: 502, codeHash: sha(String(err.code || 'network')), elapsedMs: Date.now() - started});
    if (!outgoing.headersSent) reply(outgoing, 502, {error: 'public_upstream_error'}); else outgoing.destroy();
  });
  upstream.setTimeout(30000, () => upstream.destroy(Error('bounded_upstream_timeout')));
  incoming.on('aborted', () => upstream.destroy());
  outgoing.on('close', () => {
    if (outgoing.writableEnded || done) return;
    done = true; clearTimeout(timer); upstream.destroy();
    if (selected) {
      counts.aborted++;
      event('policy_client_aborted', {method: 'GET', publicId: id, status: responseStatus || 0, elapsedMs: Date.now() - started});
    }
  });
  incoming.pipe(upstream);
});
server.on('error', err => {
  event('listener_rejected', {port: PORT, codeHash: sha(String(err.code || 'listen_error'))});
  process.exitCode = 1;
});
server.listen(PORT, '127.0.0.1', () => event('listening', {port: PORT, upstreamPort: 46218, publicId: id, mode}));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

// Repeatable production HTTP/SSE smoke; never calls generate/send or writes upstream.
async function runSmoke() {
const base='http://127.0.0.1:46219', policy=policyPath;
const out=fileURLToPath(new URL('../output/native-parity-20261003/inbox-policy-race/'+new Date().toISOString().replaceAll(':','-')+'/',import.meta.url));await mkdir(out,{recursive:true});
const checks=[],measurements=[];let stateBefore,stateAfter;
const hash=b=>createHash('sha256').update(b).digest('hex');
const check=(name,value,detail={})=>checks.push({name,status:value?'PASS':'FAIL',detail});
async function get(path){let at=performance.now();let response=await fetch(base+path,{signal:AbortSignal.timeout(12000)});const body=Buffer.from(await response.arrayBuffer());const value={status:response.status,elapsedMs:Math.round(performance.now()-at),bytes:body.length,bodyHash:hash(body)};measurements.push({pathClass:path.startsWith('/__qa/')?'control_state':path===policy?'exact_public_policy':path.includes('/policy')?'other_policy_read':'other_read',...value});return {value,body};}
async function state(){return JSON.parse((await get('/__qa/state')).body.toString());}
async function control(mode,delay=5000,target=id){const response=await fetch(base+'/__qa/control?'+new URLSearchParams({mode,id:target,delayMs:String(delay)}),{method:'POST',signal:AbortSignal.timeout(5000)});await response.arrayBuffer();return response.status;}
try{
 stateBefore=await state();check('fixed ports and exact public ID',stateBefore.port===46219&&stateBefore.upstreamPort===46218&&stateBefore.publicId===id);
 check('baseline pass mode',stateBefore.mode==='pass');const baseline=await get(policy);check('actual baseline GET200 without artificial delay',baseline.value.status===200&&baseline.value.elapsedMs<2000,baseline.value);
 check('reject mismatched control target',await control('delayNextPolicy',5000,'OPSADV-QA-NONEXISTENT')===400);
 check('reject more than10sec delay',await control('delayNextPolicy',10001)===400);
 check('arm exact one5000ms delay',await control('delayNextPolicy')===200);
 const pending=get(policy);await new Promise(r=>setTimeout(r,100));const consumed=await state();check('mode consumes synchronously to pass',consumed.mode==='pass'&&consumed.counts.consumed===stateBefore.counts.consumed+1);
 const other=await get('/api/settings');check('unrelated actual GET is not delayed',other.value.status===200&&other.value.elapsedMs<2000,other.value);
 const next=await get(policy);check('second same-policy GET is not delayed',next.value.status===200&&next.value.elapsedMs<2000,next.value);
 const delayed=await pending;check('exact policy actual response delayed at least5000ms once',delayed.value.status===200&&delayed.value.elapsedMs>=5000&&delayed.value.elapsedMs<10000,delayed.value);check('buffer preserved true policy response',delayed.value.bodyHash===baseline.value.bodyHash&&next.value.bodyHash===baseline.value.bodyHash);
 const controller=new AbortController();const started=performance.now();const stream=await fetch(base+'/api/native/events',{signal:controller.signal,headers:{accept:'text/event-stream'}});const reader=stream.body.getReader();const first=await reader.read();check('real SSE starts streaming without buffering',stream.status===200&&stream.headers.get('content-type')?.includes('text/event-stream')&&first.value?.length>0&&performance.now()-started<2000,{status:stream.status,firstChunkBytes:first.value?.length||0,firstChunkHash:hash(first.value||Buffer.alloc(0)),elapsedMs:Math.round(performance.now()-started)});controller.abort();
 check('arm abort branch',await control('delayNextPolicy')===200);const aborter=new AbortController();const aborted=fetch(base+policy,{signal:aborter.signal}).then(r=>r.arrayBuffer()).then(()=>false,e=>e.name==='AbortError');await new Promise(r=>setTimeout(r,150));aborter.abort();check('client policy request actually aborted',await aborted);await new Promise(r=>setTimeout(r,150));stateAfter=await state();check('aborted delay has explicit metadata and never releases',stateAfter.counts.aborted===stateBefore.counts.aborted+1&&stateAfter.counts.released===stateBefore.counts.released+1&&stateAfter.events.some(x=>x.kind==='policy_client_aborted'));
 check('final mode auto pass and no replay/generate',stateAfter.mode==='pass'&&stateAfter.counts.consumed===stateBefore.counts.consumed+2&&stateAfter.counts.generateForwarded===stateBefore.counts.generateForwarded&&stateAfter.counts.upstreamErrors===stateBefore.counts.upstreamErrors);
}catch(e){checks.push({name:'smoke execution',status:'FAIL',errorClass:e.name,errorHash:hash(String(e.code||e.name))});}finally{await control('pass');stateAfter=await state();}
const script=new URL(import.meta.url);
const manifest={schema:'native.inbox.policy.proxy.smoke.v1',at:new Date().toISOString(),scope:'Only real GET/SSE plus local control. No GUI, model generation, external action or source edit.',publicId:id,upstreamPort:46218,proxyPort:46219,proxyScriptHash:hash(await readFile(script)),smokeScriptHash:hash(await readFile(fileURLToPath(import.meta.url))),checks,measurements,stateBefore,stateAfter,pass:checks.filter(x=>x.status==='PASS').length,fail:checks.filter(x=>x.status==='FAIL').length,guiStatus:'NOT_RUN'};await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify({artifact:out+'/manifest.json',pass:manifest.pass,fail:manifest.fail,mode:stateAfter.mode}));if(manifest.fail)process.exitCode=1;
}
