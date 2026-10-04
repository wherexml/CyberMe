// Scoped native E2E fault proxy. Only this public no-auth REST row may mutate.
import fs from 'node:fs';
import {createServer,request} from 'node:http';
import {resolve} from 'node:path';
const out=resolve('output/native-parity-20261003/connections-recovery-20261004');
const scope=JSON.parse(fs.readFileSync(out+'/scope.json'));
const statsPath=out+'/proxy-stats.json';
const stats=fs.existsSync(statsPath)?JSON.parse(fs.readFileSync(statsPath)):{connectionId:null,mode:'pass',createAttempts:0,createForwarded:0,createDropped:0,testForwarded:0,deleteAttempts:0,deleteForwarded:0,deleteRejected:0,exactGets:0,blocked:0};
const save=()=>fs.writeFileSync(statsPath,JSON.stringify(stats,null,2));
const safeGet=p=>/^\/api\/(bootstrap|health|version|sync|events|settings\/models|feishu\/sync|feishu\/sync\/records|feishu\/binding|voice\/status|conversations\/primary|tasks|inbox|ideas|runs|connections(?:\/[\w-]+)?|memories\/[\w-]+|chat\/conversations(?:\/[\w-]+(?:\/messages|\/unresolved)?)?)$/.test(p);
createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:46257'),p=url.pathname;
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.headers.origin)return reply(403,{error:'qa_origin_blocked'});
 if(p==='/__qa/stats'&&req.method==='GET')return reply(200,stats);
 if(p==='/__qa/mode'&&req.method==='POST'){
  const mode=url.searchParams.get('mode');if(!['pass','dropNextCreate','rejectNextDelete','delayNextDelete'].includes(mode))return reply(400,{error:'invalid_mode'});
  stats.mode=mode;save();return reply(200,{mode});
 }
 const chunks=[];let size=0;
 req.on('data',b=>{size+=b.length;if(size>32768){req.destroy();return;}chunks.push(b);});
 req.on('end',async()=>{
  const body=Buffer.concat(chunks);let allowed=req.method==='GET'&&safeGet(p),drop=false,delay=false;
  if(req.method==='POST'&&p==='/api/connections'){
   let input;try{input=JSON.parse(body);}catch{return reply(400,{error:'invalid_public_input'});}
   if(!input||typeof input!=='object'||Array.isArray(input))return reply(400,{error:'invalid_public_input'});
   allowed=Object.keys(input).every(k=>['id','name','type','endpoint','permissions','config','provider'].includes(k))&&(!input.provider||input.provider==='Custom')&&Object.keys(input.config||{}).every(k=>k==='authMethod')&&input.name===scope.marker&&input.endpoint===scope.endpoint&&String(input.type).toLowerCase()==='rest'&&input.config?.authMethod==='none'&&JSON.stringify(input.permissions)===JSON.stringify(['read'])&&/^connection-native-[\w-]+$/.test(input.id)&&(!stats.connectionId||stats.connectionId===input.id);
   if(allowed){stats.connectionId=input.id;stats.createAttempts++;drop=stats.mode==='dropNextCreate';if(drop)stats.mode='pass';}
  }else if(stats.connectionId&&p==='/api/connections/'+stats.connectionId+'/test'&&req.method==='POST'){
   let input;try{input=JSON.parse(body);}catch{return reply(400,{error:'invalid_test'});}
   if(!input||typeof input!=='object'||Array.isArray(input))return reply(400,{error:'invalid_test'});
   allowed=Object.keys(input).length===1&&typeof input.baseUpdatedAt==='string';
   if(allowed){
    try{const check=await fetch('http://127.0.0.1:46214/api/connections/'+stats.connectionId,{redirect:'error',signal:AbortSignal.timeout(5000)});const saved=await check.json();allowed=check.ok&&input.baseUpdatedAt===saved.updatedAt&&saved.id===stats.connectionId&&saved.provider==='Custom'&&saved.name===scope.marker&&saved.endpoint===scope.endpoint&&String(saved.type).toLowerCase()==='rest'&&saved.config?.authMethod==='none'&&Object.keys(saved.config||{}).every(k=>['authMethod','credentialReady'].includes(k))&&JSON.stringify(saved.permissions)===JSON.stringify(['read']);}catch{allowed=false;}
   }
   if(allowed)stats.testForwarded++;
  }else if(stats.connectionId&&p==='/api/connections/'+stats.connectionId&&req.method==='DELETE'){
   allowed=true;stats.deleteAttempts++;
   if(stats.mode==='rejectNextDelete'){stats.mode='pass';stats.deleteRejected++;save();return reply(503,{error:'OPSADV_QA_DELETE_REJECTED',message:'公开验收：删除失败，原连接保留'});}
   if(stats.mode==='delayNextDelete'){stats.mode='pass';delay=true;}
  }
  if(!allowed){stats.blocked++;save();return reply(403,{error:'qa_scope_blocked'});}
  if(req.method==='GET'&&stats.connectionId&&p==='/api/connections/'+stats.connectionId)stats.exactGets++;
  if(req.method==='POST'&&p==='/api/connections')stats.createForwarded++;
  if(req.method==='DELETE')stats.deleteForwarded++;
  save();
  const upstream=request({hostname:'127.0.0.1',port:46214,path:req.url,method:req.method,headers:body.length?{'Content-Type':'application/json'}:{}},response=>{
   if(drop){response.resume();response.on('end',()=>{stats.createDropped++;save();res.destroy();});}
   else if(delay){let bytes=0;const parts=[];response.on('data',b=>{bytes+=b.length;if(bytes>65536){response.destroy();res.destroy();return;}parts.push(b);});response.on('end',()=>setTimeout(()=>{if(!res.destroyed){res.writeHead(response.statusCode,{'Content-Type':'application/json'});res.end(Buffer.concat(parts));}},12000));}
   else{res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/json'});response.pipe(res);}
  });
  upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'qa_upstream_unavailable'});else res.destroy();});upstream.end(body);
 });
}).listen(46257,'127.0.0.1',()=>{save();console.log('Scoped public REST recovery proxy ready on 46257');});
