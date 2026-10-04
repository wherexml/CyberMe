// Only the public isolated autonomy group, held test writes, or exact baseline restoration.
import fs from 'node:fs';
import {createServer,request} from 'node:http';
import {createHash} from 'node:crypto';
const dir='output/native-parity-20261003/autonomy-resume-20261004';
const scope=JSON.parse(fs.readFileSync(dir+'/scope.json'));
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const equal=(a,b)=>canonical(a)===canonical(b);
const stats={attempts:0,forwarded:0,successes:0,rejected:0,blocked:0,receipts:[]};
let rejectNext=false;
const persist=()=>fs.writeFileSync(dir+'/proxy-stats.json',JSON.stringify(stats,null,2));
const safeGet=p=>['/api/health','/api/native/version','/api/native/events','/api/conversations/primary','/api/inbox/query','/api/bootstrap','/api/settings','/api/settings/models','/api/feishu/sync','/api/feishu/sync/records','/api/connections','/api/tasks','/api/ideas','/api/inbox','/api/chat/conversations','/api/voice/status'].includes(p)||/^\/api\/(memories|chat\/conversations)\/[\w-]+(?:\/messages|\/unresolved)?$/.test(p);
const valid=a=>object(a)&&equal(Object.keys(a).sort(),Object.keys(scope.baseline).sort())&&object(a.levels)&&equal(Object.keys(a.levels).sort(),['ack','boss','commit','docs','meet','sensitive'])&&['ack','meet','docs'].every(k=>['observe','draft','send_undo','autonomous'].includes(a.levels[k]))&&a.levels.commit==='draft'&&a.levels.boss==='draft'&&a.levels.sensitive==='observe'&&Array.isArray(a.deepThink)&&a.deepThink.length<=5&&new Set(a.deepThink).size===a.deepThink.length&&a.deepThink.every(x=>['vip','customers','manager','stakes','everyone'].includes(x))&&equal(a.files,scope.baseline.files)&&['quietFrom','quietUntil'].every(k=>/^([01]\d|2[0-3]):[0-5]\d$/.test(a[k]))&&['urgent_digest','every','digest'].includes(a.alerts)&&typeof a.transparency==='boolean'&&(a.holdSending===true||equal(a,scope.baseline));
createServer((req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.headers.origin)return reply(403,{error:'qa_origin_blocked'});
 if(req.method==='GET'&&p==='/__qa/stats')return reply(200,stats);
 const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size>65536){req.destroy();return;}chunks.push(b);});
 req.on('end',()=>{
  const body=Buffer.concat(chunks);let allowed=req.method==='GET'&&safeGet(p),input;
  if(req.method==='POST'&&p==='/__qa/reject-next-save'&&body.toString()==='{}'){rejectNext=true;return reply(200,{armed:true});}
  if(req.method==='PATCH'&&p==='/api/settings'){
   try{input=JSON.parse(body);}catch{return reply(400,{error:'invalid_json'});}
   allowed=object(input)&&Object.keys(input).length===1&&valid(input.autonomy);
   if(allowed){stats.attempts++;if(rejectNext){rejectNext=false;stats.rejected++;persist();return reply(503,{error:'qa_public_autonomy_unavailable'});}stats.forwarded++;}
  }
  if(!allowed){stats.blocked++;persist();return reply(403,{error:'qa_scope_blocked'});}persist();
  const upstream=request({hostname:'127.0.0.1',port:scope.upstream,path:req.url,method:req.method,headers:body.length?{'Content-Type':'application/json'}:{}},response=>{
   if(req.method==='PATCH'){if(response.statusCode>=200&&response.statusCode<300)stats.successes++;stats.receipts.push({status:response.statusCode,inputSha256:hash(input),holdSending:input.autonomy.holdSending});stats.receipts=stats.receipts.slice(-16);persist();}
   res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/json'});response.pipe(res);
  });upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'qa_upstream_unavailable'});else res.destroy();});upstream.end(body);
 });
}).listen(scope.api,'127.0.0.1',()=>{persist();console.log('Scoped public autonomy proxy ready on '+scope.api);});
