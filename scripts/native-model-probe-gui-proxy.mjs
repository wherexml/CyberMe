// Loopback acceptance only: drop exactly one model-test response after the
// actual service completed it. Never log bodies, headers, credentials/output.
import {createServer,request} from 'node:http';
import fs from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('output/native-parity-20261003/model-probe-recovery-20261004/proxy-stats.json');
const stats={postCount:0,droppedResponses:0,testGetCount:0,requestIds:[]};
const save=()=>fs.writeFileSync(out,JSON.stringify(stats,null,2));
const safeGet=p=>/^\/api\/(health|bootstrap|settings\/models|settings\/models\/tests\/[\w-]+|feishu\/sync|feishu\/sync\/records|feishu\/binding|voice\/status|conversations\/primary|tasks|inbox|ideas|runs|chat\/conversations(?:\/[\w-]+(?:\/messages|\/unresolved)?)?)$/.test(p);
createServer((req,res)=>{
 // This proxy is for native clients only; never bypass API browser-origin checks.
 if(req.headers.origin){res.writeHead(403);res.end('{"error":"qa_origin_blocked"}');return;}
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const test=req.method==='POST'&&path==='/api/settings/models/test';
 if(!test&&!(req.method==='GET'&&safeGet(path))){res.writeHead(403);res.end('{"error":"qa_proxy_blocked"}');return;}
 if(path.startsWith('/api/settings/models/tests/')){stats.testGetCount++;save();}
 const chunks=[];let size=0;
 req.on('data',b=>{size+=b.length;if(size>8192){req.destroy();return;}chunks.push(b);});
 req.on('end',()=>{
  const payload=Buffer.concat(chunks);
  if(test){let input;try{input=JSON.parse(payload);}catch{res.writeHead(400);res.end();return;}stats.postCount++;stats.requestIds.push(input.requestId);save();}
  const upstream=request({hostname:'127.0.0.1',port:46254,path:req.url,method:req.method,headers:test?{'Content-Type':'application/json'}:{}},response=>{
   if(test&&stats.droppedResponses===0){response.resume();response.on('end',()=>{stats.droppedResponses++;save();res.destroy();});}
   else{res.writeHead(response.statusCode,{'Content-Type':'application/json'});response.pipe(res);}
  });
  upstream.on('error',()=>{res.writeHead(502);res.end('{"error":"qa_upstream_unavailable"}');});
  upstream.end(payload);
 });
}).listen(46255,'127.0.0.1',()=>{save();console.log('Model-test response-drop proxy ready on 46255');});
