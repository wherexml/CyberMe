// Failure inventory written first in memory-create-late-v47-20261004/failure-inventory.md.
// Public isolated native-created memory only; one original successful201 held15s.
import fs from 'node:fs';
import {createServer, request} from 'node:http';
import {createHash} from 'node:crypto';
const dir=process.argv[2]||'output/native-parity-20261003/memory-create-late-v47-20261004';
if(!/^output\/native-parity-20261003\/memory-create-late-v(?:47|48)-20261004(?:-[a-z0-9-]+)?$/.test(dir))throw new Error('Public evidence scope required');
for(const path of ['output','output/native-parity-20261003',dir,dir+'/scope.json']){
 const st=fs.lstatSync(path);if(st.isSymbolicLink())throw new Error('Scope links forbidden');
}
try{fs.lstatSync(dir+'/proxy-stats.json');throw new Error('Existing evidence must not be overwritten; use a fresh scope');}
catch(error){if(error.code!=='ENOENT')throw error;}
const scope=JSON.parse(fs.readFileSync(dir+'/scope.json'));
if(JSON.stringify(Object.keys(scope).sort())!==JSON.stringify(['api','marker','readIds','upstream'])
 ||!Number.isInteger(scope.api)||scope.api<46262||scope.api>46269||scope.upstream!==46214
 ||!/^OPSADV-QA-MEMORY-CREATE-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(scope.marker)
 ||!Array.isArray(scope.readIds)||scope.readIds.length!==0)throw new Error('Invalid public memory scope');
const statsFd=fs.openSync(dir+'/proxy-stats.json',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
const stats={id:null,createPosts:0,patches:0,snapshots:0,exactGets:0,drops:0,blocked:0,delayed:0,createDelayed:0,created:false,receipts:[]};
let delayNextPatch=false;
const upstreams=new Set(),timers=new Set(),sockets=new Set();
const persist=()=>{const bytes=Buffer.from(JSON.stringify(stats,null,2));fs.ftruncateSync(statsFd,0);fs.writeSync(statsFd,bytes,0,bytes.length,0);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const safeGet=p=>['/api/health','/api/native/version','/api/native/events','/api/conversations/primary','/api/inbox/query','/api/bootstrap','/api/settings','/api/settings/models','/api/feishu/sync','/api/feishu/sync/records','/api/connections','/api/tasks','/api/ideas','/api/inbox','/api/chat/conversations','/api/voice/status'].includes(p)||/^\/api\/chat\/conversations\/[\w-]+(?:\/messages|\/unresolved)?$/.test(p);
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1'),p=u.pathname;
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.headers.origin)return reply(403,{error:'qa_origin_blocked'});
 if(req.method==='GET'&&p==='/__qa/stats')return reply(200,stats);
 const chunks=[];let size=0;
 req.on('data',b=>{size+=b.length;if(size>65536){req.destroy();return;}chunks.push(b);});
 req.on('end',()=>{
  const body=Buffer.concat(chunks);let allowed=req.method==='GET'&&safeGet(p),input,candidateId=null;
  if(req.method==='POST'&&p==='/__qa/hold-next-patch'&&body.toString()==='{}'){
   delayNextPatch=true;return reply(200,{armed:true,delayMs:15000});
  }
  const exact=p.match(/^\/api\/memories\/([\w-]+)$/);
  if(req.method==='GET'&&exact&&u.search===''){
   const id=exact[1];allowed=scope.readIds.includes(id)||id===stats.id;
   if(!stats.id&&/^memory-native-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)){candidateId=id;allowed=true;}
   if(id===stats.id&&allowed)stats.exactGets++;
  }
  const create=req.method==='POST'&&p==='/api/memories';
  const patch=req.method==='PATCH'&&exact&&exact[1]===stats.id&&stats.created;
  const snapshot=req.method==='POST'&&p==='/api/memories/snapshot';
  if(create||patch||snapshot){
   try{input=JSON.parse(body);}catch{return reply(400,{error:'qa_invalid_json'});}
   if(snapshot)allowed=!!stats.id&&object(input)&&Object.keys(input).length===0;
   else {
    const keys=Object.keys(input||{}).sort();
    const expected=(create?['title','body','content','category','baseUpdatedAt','id']:['title','body','content','category','baseUpdatedAt']).sort();
    allowed=!!stats.id&&object(input)&&JSON.stringify(keys)===JSON.stringify(expected)&&typeof input.body==='string'
     &&input.body.startsWith(scope.marker)&&input.content===input.body&&input.body.length<=24000
     &&input.title===Array.from(input.body.split('\n')[0]).slice(0,100).join('')&&input.category==='Learned'
     &&(create?input.id===stats.id&&input.baseUpdatedAt===null:typeof input.baseUpdatedAt==='string'&&input.baseUpdatedAt.trim().length>0);
   }
  }
  if(!allowed){stats.blocked++;persist();return reply(403,{error:'qa_scope_blocked'});}
  if(create)stats.createPosts++;if(patch)stats.patches++;if(snapshot)stats.snapshots++;persist();
  const upstream=request({hostname:'127.0.0.1',port:scope.upstream,path:req.url,method:req.method,headers:body.length?{'Content-Type':'application/json'}:{}},response=>{
   if(candidateId){
    if(response.statusCode!==404||stats.id&&stats.id!==candidateId){response.resume();stats.blocked++;persist();return reply(409,{error:'qa_memory_id_not_new'});}
    stats.id=candidateId;stats.exactGets++;persist();
   }
   if(create||patch||snapshot){stats.receipts.push({method:req.method,path:p,status:response.statusCode,bodySha256:hash(body),receivedAt:Date.now()});stats.receipts=stats.receipts.slice(-32);persist();}
   if(create&&response.statusCode===201){stats.created=true;persist();}
   if(create&&stats.createDelayed===0&&response.statusCode===201){ stats.createDelayed++; stats.delayed++; persist(); const timer=setTimeout(()=>{ timers.delete(timer); if(res.destroyed){response.destroy();return;} res.writeHead(201,{'Content-Type':'application/json'}); response.pipe(res); },15000); timers.add(timer); res.on('close',()=>{clearTimeout(timer);timers.delete(timer);response.destroy();}); }
   else {
    const delayed=patch&&delayNextPatch;
    const forward=()=>{if(delayed)stats.lastHeldPatchForwardAt=Date.now();stats.lastForwardAt=Date.now();persist();if(res.destroyed){response.destroy();return;}res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/json'});response.pipe(res);};
    if(delayed){delayNextPatch=false;stats.delayed++;persist();
     const timer=setTimeout(forward,15000);res.on('close',()=>{clearTimeout(timer);response.destroy();});
    }else forward();
   }
  });
  upstreams.add(upstream); upstream.on('close',()=>upstreams.delete(upstream)); res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
  upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'qa_upstream_unavailable'});else res.destroy();});upstream.end(body);
 });
}).listen(scope.api,'127.0.0.1',()=>{persist();console.log('Scoped public memory proxy ready on '+scope.api);});

server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
function stop(){for(const timer of timers)clearTimeout(timer);for(const upstream of upstreams)upstream.destroy();for(const socket of sockets)socket.destroy();server.close(()=>{fs.closeSync(statsFd);process.exit(0);});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
