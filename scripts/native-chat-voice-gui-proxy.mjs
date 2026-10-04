// Public native GUI voice recovery proxy; no audio, credentials or bodies are logged.
// OPSTWIN_API=http://127.0.0.1:46218 OPSTWIN_QA_VOICE_PROXY_PORT=46219 node scripts/native-chat-voice-gui-proxy.mjs
// POST /__qa/control {action:pass|reject-next|hold-next|release}; GET /__qa/status.
// Only POST /api/voice/transcribe consumes a one-shot fault. Other routes are streamed unchanged.
import {createServer, request} from 'node:http';
import {createHash} from 'node:crypto';

const port=Number(process.env.OPSTWIN_QA_VOICE_PROXY_PORT||46219);
const target=new URL(process.env.OPSTWIN_API||'http://127.0.0.1:46218');
if(!Number.isInteger(port)||port<10000||port>65535||target.protocol!=='http:'||target.hostname!=='127.0.0.1'||!/^\d{5}$/.test(target.port)||target.pathname!=='/'||target.search||target.username||target.password||Number(target.port)===port)throw Error('Use distinct five-digit loopback HTTP ports');
const MAX_REQUEST=13*1024*1024, MAX_HELD=256*1024, MAX_RECORDS=256, HOLD_MS=90000;
const hash=()=>createHash('sha256'), utc=()=>new Date().toISOString();
let mode='pass',sequence=0,held=null;
const records=[],sockets=new Set();
const cleanHeaders=headers=>Object.fromEntries(Object.entries(headers).filter(([key])=>!['connection','transfer-encoding','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade'].includes(key.toLowerCase())));
const reply=(res,status,value)=>{if(!res.destroyed&&!res.headersSent){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}};
const status=()=>({port,upstream:target.origin,mode,held:held?{id:held.record.id,ready:held.ready,clientGone:held.clientGone,retainedBytes:held.buffer?.length||0}:null,records});
function release(){
  if(!held||!held.ready)return null;
  const item=held;held=null;clearTimeout(item.timer);
  item.record.releasedAt=utc();
  if(item.clientGone||item.res.destroyed){item.record.releaseOutcome='discarded-client-gone';item.buffer=null;return item.record.id;}
  if(item.buffer){item.res.writeHead(item.status,cleanHeaders(item.headers));item.res.end(item.buffer);item.record.releaseOutcome='delivered-original';item.record.deliveredAt=utc();item.buffer=null;}
  else {item.record.releaseOutcome='discarded-no-body';reply(item.res,502,{error:'qa_voice_response_unavailable'});}
  return item.record.id;
}
const server=createServer((req,res)=>{
  if(!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)){req.resume();return reply(res,403,{error:'loopback_only'});}
  if(!req.url?.startsWith('/')||req.url.startsWith('//')){req.resume();return reply(res,400,{error:'invalid_relative_route'});}
  let url;try{url=new URL(req.url,`http://127.0.0.1:${port}`);}catch{req.resume();return reply(res,400,{error:'invalid_route'});}
  if(url.pathname.startsWith('/__qa/')){
    if(req.headers.origin){req.resume();return reply(res,403,{error:'control_origin_not_allowed'});}
    if(url.pathname==='/__qa/status'&&req.method==='GET'){req.resume();return reply(res,200,status());}
    if(url.pathname!=='/__qa/control'||req.method!=='POST'){req.resume();return reply(res,405,{error:'control_method_or_route'});}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){req.resume();return reply(res,415,{error:'control_json_required'});}
    const parts=[];let size=0,tooLarge=false;
    req.on('data',chunk=>{size+=chunk.length;if(size>4096){tooLarge=true;parts.length=0;}else if(!tooLarge)parts.push(chunk);});
    req.on('end',()=>{
      if(tooLarge)return reply(res,413,{error:'control_too_large'});
      let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return reply(res,400,{error:'invalid_control_json'});}
      if(!value||Object.keys(value).length!==1||!['pass','reject-next','hold-next','release'].includes(value.action))return reply(res,400,{error:'invalid_control_action'});
      if(value.action==='release'){const id=release();return reply(res,id===null?409:200,{releasedId:id,...status()});}
      if(value.action!=='pass'&&(mode!=='pass'||held))return reply(res,409,{error:'fault_already_armed_or_held'});
      mode=value.action==='pass'?'pass':value.action;
      reply(res,200,status());
    });return;
  }
  const eligible=req.method==='POST'&&url.pathname==='/api/voice/transcribe';
  const fault=eligible?mode:'pass';if(eligible)mode='pass';
  const record={id:++sequence,route:url.pathname,method:req.method,startedAt:utc(),fault,forwarded:false,request:{bytes:0,sha256:null,complete:false},upstreamResponse:null};
  records.push(record);if(records.length>MAX_RECORDS)records.shift();
  const requestHash=hash();let tooLarge=false,upstream;
  req.on('data',chunk=>{record.request.bytes+=chunk.length;requestHash.update(chunk);if(eligible&&record.request.bytes>MAX_REQUEST&&!tooLarge){tooLarge=true;record.request.limitExceeded=true;upstream?.destroy();req.unpipe();req.resume();reply(res,413,{error:'qa_request_too_large'});}});
  req.on('end',()=>{record.request.sha256=requestHash.digest('hex');record.request.complete=true;record.request.endedAt=utc();});
  req.on('aborted',()=>{if(!record.request.complete){record.request.sha256=requestHash.digest('hex');record.request.endedAt=utc();record.request.aborted=true;}});
  if(fault==='reject-next'){
    req.on('end',()=>{if(!tooLarge){record.proxyStatus=503;record.deliveredAt=utc();reply(res,503,{error:'qa_voice_transcribe_rejected'});}});req.resume();return;
  }
  let slot;
  if(fault==='hold-next'){
    slot={record,res,ready:false,clientGone:false,buffer:null,parts:[],status:null,headers:null,timer:null};held=slot;
    slot.timer=setTimeout(()=>{if(held===slot){held=null;slot.buffer=null;slot.parts=[];record.holdExpiredAt=utc();upstream?.destroy();reply(res,504,{error:'qa_voice_hold_expired'});}},HOLD_MS);
  }
  res.on('close',()=>{
    if(res.writableEnded)return;
    record.clientClosedAt=utc();
    if(slot){slot.clientGone=true;slot.buffer=null;slot.parts=[];record.discardedAt=utc();}
    else upstream?.destroy();
  });
  record.forwarded=true;
  upstream=request({hostname:'127.0.0.1',port:target.port,path:req.url,method:req.method,headers:{...cleanHeaders(req.headers),host:target.host}},response=>{
    const responseHash=hash();let bytes=0;
    record.upstreamResponse={status:response.statusCode,bytes:0,sha256:null,complete:false,startedAt:utc()};
    if(slot){slot.status=response.statusCode;slot.headers=response.headers;}
    else if(!res.destroyed&&!tooLarge)res.writeHead(response.statusCode,cleanHeaders(response.headers));
    response.on('data',chunk=>{
      bytes+=chunk.length;responseHash.update(chunk);record.upstreamResponse.bytes=bytes;
      if(slot&&!slot.clientGone&&held===slot){
        if(bytes>MAX_HELD){slot.parts=[];slot.buffer=null;record.upstreamResponse.limitExceeded=true;response.destroy();if(held===slot)held=null;clearTimeout(slot.timer);reply(res,502,{error:'qa_voice_response_too_large'});}
        else slot.parts.push(chunk);
      }
    });
    response.on('end',()=>{
      record.upstreamResponse.sha256=responseHash.digest('hex');record.upstreamResponse.complete=true;record.upstreamResponse.endedAt=utc();
      if(slot){slot.ready=true;slot.buffer=slot.clientGone||held!==slot?null:Buffer.concat(slot.parts);slot.parts=[];record.heldReadyAt=utc();}
      else {record.deliveredAt=utc();}
    });
    response.on('error',()=>{record.upstreamResponse.aborted=true;if(slot){slot.buffer=null;slot.parts=[];clearTimeout(slot.timer);if(held===slot)held=null;}reply(res,502,{error:'qa_upstream_response_error'});});
    if(!slot)response.pipe(res);
  });
  upstream.on('error',error=>{record.upstreamErrorCode=String(error.code||'network');if(slot){slot.buffer=null;clearTimeout(slot.timer);if(held===slot)held=null;}if(!tooLarge)reply(res,502,{error:'qa_upstream_unavailable'});});
  req.pipe(upstream);
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
server.on('error',error=>{console.error(JSON.stringify({event:'proxy-error',code:String(error.code||'network')}));process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'ready',port,upstream:target.origin})));
function stop(){if(held){clearTimeout(held.timer);held.buffer=null;held.parts=[];held=null;}server.close(()=>process.exit(0));for(const socket of sockets)socket.destroy();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
