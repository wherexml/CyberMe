// Public isolated language E2E: only the unchanged identity's language may be written.
import fs from 'node:fs';
import {createServer,request} from 'node:http';
import {createHash} from 'node:crypto';
const dir='output/native-parity-20261003/language-resume-20261004';
const scope=JSON.parse(fs.readFileSync(dir+'/scope.json'));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identityHash=i=>hash(Object.fromEntries(Object.entries(i).filter(([k])=>k!=='language').sort(([a],[b])=>a.localeCompare(b))));
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const stats={patchAttempts:0,forwarded:0,successes:0,blocked:0,receipts:[]};
const persist=()=>fs.writeFileSync(dir+'/proxy-stats.json',JSON.stringify(stats,null,2));
const safeGet=p=>['/api/health','/api/native/version','/api/native/events','/api/conversations/primary','/api/inbox/query','/api/bootstrap','/api/settings','/api/settings/models','/api/feishu/sync','/api/feishu/sync/records','/api/connections','/api/tasks','/api/ideas','/api/inbox','/api/chat/conversations','/api/voice/status'].includes(p)||/^\/api\/(memories|chat\/conversations)\/[\w-]+(?:\/messages|\/unresolved)?$/.test(p);
createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+scope.api),p=url.pathname;
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.headers.origin)return reply(403,{error:'qa_origin_blocked'});
 if(req.method==='GET'&&p==='/__qa/stats')return reply(200,stats);
 const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size>65536){req.destroy();return;}chunks.push(b);});
 req.on('end',async()=>{
  const body=Buffer.concat(chunks);let allowed=req.method==='GET'&&safeGet(p),input;
  if(req.method==='PATCH'&&p==='/api/settings'){
   try{input=JSON.parse(body);}catch{return reply(400,{error:'invalid_json'});}
   allowed=object(input)&&Object.keys(input).length===1&&object(input.identity)&&JSON.stringify(Object.keys(input.identity).sort())===JSON.stringify(scope.identityKeys)&&['en','zh-CN'].includes(input.identity.language)&&identityHash(input.identity)===scope.nonLanguageIdentitySha256;
   if(allowed){try{const r=await fetch('http://127.0.0.1:'+scope.upstream+'/api/settings',{redirect:'error',signal:AbortSignal.timeout(5000)});const canonical=await r.json();allowed=r.ok&&identityHash(canonical.identity)===scope.nonLanguageIdentitySha256;}catch{allowed=false;}}
   if(allowed){stats.patchAttempts++;stats.forwarded++;}
  }
  if(!allowed){stats.blocked++;persist();return reply(403,{error:'qa_scope_blocked'});}persist();
  const upstream=request({hostname:'127.0.0.1',port:scope.upstream,path:req.url,method:req.method,headers:body.length?{'Content-Type':'application/json'}:{}},response=>{
   if(req.method==='PATCH'){if(response.statusCode>=200&&response.statusCode<300)stats.successes++;stats.receipts.push({status:response.statusCode,language:input.identity.language,inputHash:hash(input)});stats.receipts=stats.receipts.slice(-16);persist();}
   res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/json'});response.pipe(res);
  });upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'qa_upstream_unavailable'});else res.destroy();});upstream.end(body);
 });
}).listen(scope.api,'127.0.0.1',()=>{persist();console.log('Scoped public language proxy ready on '+scope.api);});
