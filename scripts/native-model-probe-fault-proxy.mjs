// Bounded fault control for one newly prepared public model-probe GUI scope.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer,request} from 'node:http';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'output/native-parity-20261003/model-probe-faults-20261004');
if(process.argv.length!==2)throw Error('no_runtime_overrides');
const assert=(v,e)=>{if(!v)throw Error(e);},sha=b=>createHash('sha256').update(b).digest('hex');
function contained(p){for(let a=p;a!==root;a=path.dirname(a)){assert(a.startsWith(root+path.sep),'outside_project');const s=fs.lstatSync(a);assert(!s.isSymbolicLink()&&fs.realpathSync(a)===a&&s.uid===process.getuid()&&(s.mode&0o022)===0,'unsafe_path');}}
contained(path.join(out,'ready.json'));const ready=JSON.parse(fs.readFileSync(path.join(out,'ready.json')));assert(ready.status==='READY','api_not_ready');
for(const p of [ready.work,ready.sql,ready.native,ready.entry])contained(p);
assert(ready.work===path.join(root,'.local/acceptance/model-probe-faults-20261004',ready.scope)&&ready.entry===path.join(ready.work,'entry.mjs'),'scope_mismatch');
function currentOwnerGate(){
 contained(path.join(out,'ready.json'));const current=JSON.parse(fs.readFileSync(path.join(out,'ready.json')));
 assert(current.status==='READY'&&current.scope===ready.scope&&current.apiPID===ready.apiPID&&current.managerPID===ready.managerPID&&current.entry===ready.entry&&current.entrySHA256===ready.entrySHA256&&JSON.stringify(current.sourceHashes)===JSON.stringify(ready.sourceHashes),'ready_changed');
 for(const p of [ready.work,ready.sql,ready.native,ready.entry])contained(p);
 for(const suffix of ['', '-wal', '-shm']){const p=path.join(ready.sql,'opstwin-advance.db'+suffix);if(fs.existsSync(p)||(()=>{try{fs.lstatSync(p);return true;}catch{return false;}})()){contained(p);const st=fs.lstatSync(p);assert(st.isFile()&&st.nlink===1,'sql_not_regular');}}
 assert(sha(fs.readFileSync(ready.entry))===ready.entrySHA256,'entry_drift');for(const [file,h]of Object.entries(ready.sourceHashes))assert(sha(fs.readFileSync(path.join(root,file)))===h,'source_drift');
 const pids=execFileSync('/usr/sbin/lsof',['-tiTCP:46254','-sTCP:LISTEN','-nP'],{encoding:'utf8'}).trim().split(/\s+/).map(Number);assert(pids.length===1&&pids[0]===ready.apiPID,'listener_mismatch');
 const argv=execFileSync('/bin/ps',['-p',String(ready.apiPID),'-o','command='],{encoding:'utf8'}).trim(),ppid=Number(execFileSync('/bin/ps',['-p',String(ready.apiPID),'-o','ppid='],{encoding:'utf8'}));assert(argv.endsWith('--import tsx '+ready.entry)&&ppid===ready.managerPID,'owner_mismatch');
}
currentOwnerGate();
const health=await fetch('http://127.0.0.1:46254/api/health',{signal:AbortSignal.timeout(2000)});assert(health.ok&&(await health.json()).database==='independent','health_mismatch');
const modelResponse=await fetch('http://127.0.0.1:46254/api/settings/models',{signal:AbortSignal.timeout(2000)});assert(modelResponse.ok,'model_config_unavailable');const models=await modelResponse.json();assert(typeof models.version==='string'&&models.version.length<=256,'invalid_model_version');
const file=path.join(out,'proxy-'+ready.scope+'.json');let stats={scope:ready.scope,apiPID:ready.apiPID,entrySHA256:ready.entrySHA256,sourceHashes:ready.sourceHashes,postCount:0,forwardedPostCount:0,droppedResponses:0,testGetCount:0,blockedCount:0,requestIds:[],events:[]};
if(fs.existsSync(file)){contained(file);const old=JSON.parse(fs.readFileSync(file));assert(old.scope===ready.scope&&old.apiPID===ready.apiPID&&old.entrySHA256===ready.entrySHA256&&JSON.stringify(old.sourceHashes)===JSON.stringify(ready.sourceHashes)&&Array.isArray(old.requestIds)&&old.requestIds.length<=8,'old_stats_mismatch');stats=old;}
const ids=new Set(stats.requestIds),upstreams=new Set();let mode='pass',delayMs=15000,queued=null,stopping=false;
const save=()=>{try{fs.writeFileSync(file,JSON.stringify(stats,null,2),{mode:0o600});return true;}catch{console.error('{"status":"QA_STATS_PERSIST_FAILED"}');return false;}};
const record=(kind,status,extra={})=>{stats.events.push({at:new Date().toISOString(),kind,status,...extra});stats.events=stats.events.slice(-64);save();};
const json=(res,status,value)=>{if(!res.destroyed&&!res.headersSent){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}};
const reads=new Set(['/api/health','/api/bootstrap','/api/settings/models','/api/conversations/primary','/api/tasks','/api/inbox','/api/ideas','/api/chat/conversations','/api/voice/status','/api/native/version','/api/native/events','/api/settings']);
function forward(method,route,payload,res,drop=false){
 const requestId=payload?JSON.parse(payload).requestId:undefined;
 if(stopping)return;currentOwnerGate();if(method==='POST'){stats.forwardedPostCount++;assert(save(),'stats_persist_failed');}
 const upstream=request({hostname:'127.0.0.1',port:46254,method,path:route,headers:method==='POST'?{'content-type':'application/json'}:{}},incoming=>{
  if(drop){const hash=createHash('sha256');let count=0;incoming.on('data',b=>{count+=b.length;hash.update(b);});incoming.on('error',()=>{record('response','upstream_stream_failed');if(!res.writableFinished)res.destroy();});incoming.on('end',()=>{stats.droppedResponses++;record('post','completed_response_discarded',{http:incoming.statusCode,bytes:count,sha256:hash.digest('hex')});if(!res.writableFinished)res.destroy();});}
  else if(!res.destroyed){incoming.on('error',()=>{if(!res.writableFinished)res.destroy();});res.writeHead(incoming.statusCode||502,incoming.headers);incoming.pipe(res);}
  else incoming.resume();
 });upstreams.add(upstream);upstream.on('close',()=>upstreams.delete(upstream));upstream.setTimeout(60000,()=>upstream.destroy(Error('timeout')));upstream.on('error',()=>{record('upstream','request_failed',{requestId,drop});if(drop){if(!res.writableFinished)res.destroy();}else json(res,502,{error:'qa_upstream_unavailable'});});upstream.end(payload ? Buffer.from(payload) : undefined);
 if(!drop)res.once('close',()=>{if(!res.writableFinished)upstream.destroy();});
}
const server=createServer(async(req,res)=>{
 try {
 if(stopping)return json(res,503,{error:'qa_stopping'});
 if(req.headers.origin||!req.url?.startsWith('/')||req.url.startsWith('//')){stats.blockedCount++;save();return json(res,403,{error:'qa_origin_or_url_blocked'});}
 const url=new URL(req.url,'http://127.0.0.1:46255'),route=url.pathname;
 if(route.startsWith('/__qa/')){
  if(req.method==='GET'&&route==='/__qa/stats')return json(res,200,{...stats,mode,delayMs,queued:queued?{requestId:queued.id,expiresAt:queued.expiresAt}:null});
  if(req.method!=='POST'||route!=='/__qa/mode')return json(res,403,{error:'qa_control_blocked'});
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024)return json(res,413,{error:'qa_control_too_large'});chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{return json(res,400,{error:'qa_invalid_json'});}
  if(Object.keys(value).some(k=>!['mode','delayMs'].includes(k))||!['pass','dropEarlyAfterForward','dropAfterForward','delayBeforeForward'].includes(value.mode)||value.delayMs!==undefined&&(!Number.isInteger(value.delayMs)||value.delayMs<1||value.delayMs>30000))return json(res,400,{error:'qa_invalid_mode'});
  if(queued&&value.mode!=='pass')return json(res,409,{error:'qa_queue_owned'});mode=value.mode;delayMs=value.delayMs??15000;return json(res,200,{mode,delayMs});
 }
 if(req.method==='GET'&&(reads.has(route)||/^\/api\/settings\/models\/tests\/[\w-]{1,128}$/.test(route)&&ids.has(route.split('/').pop()))){if(route.startsWith('/api/settings/models/tests/')){stats.testGetCount++;save();}return forward('GET',req.url,undefined,res);}
 if(req.method!=='POST'||route!=='/api/settings/models/test'||url.search){stats.blockedCount++;save();return json(res,403,{error:'qa_route_blocked'});}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192)return json(res,413,{error:'qa_payload_too_large'});chunks.push(chunk);}
 let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{return json(res,400,{error:'qa_invalid_json'});}
 if(Object.keys(value).some(k=>!['requestId','role','version'].includes(k))||typeof value.requestId!=='string'||!/^(native-|OPSADV-QA-)[\w-]{1,100}$/.test(value.requestId)||!['standard','deep'].includes(value.role)||value.version!==models.version)return json(res,403,{error:'qa_exact_probe_only'});
 currentOwnerGate();
 if(!ids.has(value.requestId)){if(ids.size>=8)return json(res,429,{error:'qa_request_limit'});ids.add(value.requestId);stats.requestIds.push(value.requestId);}
 stats.postCount++;assert(save(),'stats_persist_failed');const payload=Buffer.from(JSON.stringify(value)),selected=mode;mode='pass';
 if(selected==='delayBeforeForward'){
  if(queued)return json(res,409,{error:'qa_queue_owned'});
  const id=value.requestId,expiresAt=new Date(Date.now()+delayMs).toISOString();const timer=setTimeout(()=>{const owner=queued;if(!owner||owner.id!==id||stopping)return;queued=null;try{forward('POST',route,owner.payload,res,true);record('post','original_delayed_forwarded',{requestId:id});}catch{record('post','delayed_owner_gate_rejected',{requestId:id});}finally{owner.payload.fill(0);}},delayMs);queued={id,expiresAt,payload,timer};record('post','original_queued',{requestId:id});return json(res,503,{error:'qa_original_response_unavailable'});
 }
 if(selected==='dropEarlyAfterForward'){forward('POST',route,payload,res,true);record('post','response_dropped_before_completion',{requestId:value.requestId});return json(res,503,{error:'qa_original_response_unavailable'});}
 if(selected==='dropAfterForward')return forward('POST',route,payload,res,true);
 forward('POST',route,payload,res);
 } catch { record('control','request_failed');json(res,503,{error:'qa_request_failed'}); }
});
server.on('error',()=>{console.error('{"status":"QA_PROXY_START_FAILED"}');process.exitCode=1;});
server.listen(46255,'127.0.0.1',()=>{assert(save(),'stats_persist_failed');console.log(JSON.stringify({status:'PUBLIC_MODEL_FAULT_PROXY_READY',scope:ready.scope,pid:process.pid,apiPID:ready.apiPID}));});
const stop=()=>{stopping=true;mode='pass';if(queued){clearTimeout(queued.timer);queued.payload.fill(0);queued=null;}for(const req of upstreams)req.destroy();server.close();server.closeAllConnections();save();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
