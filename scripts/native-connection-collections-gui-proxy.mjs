// Native collections E2E proxy: one public row PATCH only, no test/send/create.
import fs from 'node:fs';
import {createServer,request} from 'node:http';
import {createHash} from 'node:crypto';
const dir='output/native-parity-20261003/connections-collections-20261004';
const scope=JSON.parse(fs.readFileSync(dir+'/scope.json'));
const path='/api/connections/'+scope.id;
const hash=b=>createHash('sha256').update(b).digest('hex');
const statsPath=dir+'/proxy-stats.json';
const stats=fs.existsSync(statsPath)?JSON.parse(fs.readFileSync(statsPath)):{mode:'pass',patchAttempts:0,forwarded:0,rejected:0,conflicts:0,successes:0,blocked:0,receipts:[]};
const persist=()=>fs.writeFileSync(statsPath,JSON.stringify(stats,null,2));
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const safeGet=p=>['/api/bootstrap','/api/settings/models','/api/feishu/sync','/api/feishu/sync/records','/api/feishu/binding','/api/connections','/api/tasks','/api/ideas','/api/inbox','/api/chat/conversations','/api/voice/status'].includes(p)||/^\/api\/(memories|chat\/conversations)\/[\w-]+(?:\/messages|\/unresolved)?$/.test(p)||p===path;
const configValid=c=>object(c)&&Object.keys(c).every(k=>['authMethod','credentialReady','scopes','importantPeople','urgentWords','workingHoursOnly','workFrom','workUntil','timezone','filter'].includes(k))&&c.authMethod==='none'&&c.credentialReady!==true&&Array.isArray(c.scopes)&&c.scopes.length<=8&&c.scopes.every(s=>object(s)&&Object.keys(s).every(k=>['id','name','mode','enabled'].includes(k))&&String(s.name).startsWith(scope.marker)&&['draft','send_undo','summary','deep'].includes(s.mode)&&typeof s.enabled==='boolean')&&Array.isArray(c.importantPeople)&&c.importantPeople.length<=8&&c.importantPeople.every(p=>object(p)&&Object.keys(p).every(k=>['name','role'].includes(k))&&String(p.name).startsWith(scope.marker)&&['VIP','Manager','Customer','Teammate'].includes(p.role))&&Array.isArray(c.urgentWords)&&c.urgentWords.length<=8&&c.urgentWords.every(w=>typeof w==='string'&&w.startsWith(scope.marker))&&(!c.filter||typeof c.filter==='string'&&c.filter.startsWith(scope.marker))&&(c.workingHoursOnly===undefined||typeof c.workingHoursOnly==='boolean')&&['workFrom','workUntil'].every(k=>c[k]===undefined||/^\d{2}:\d{2}$/.test(c[k]))&&(c.timezone===undefined||c.timezone==='Asia/Singapore');
createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+scope.api),p=url.pathname;
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.headers.origin)return reply(403,{error:'qa_origin_blocked'});
 if(req.method==='GET'&&p==='/__qa/stats')return reply(200,stats);
 if(req.method==='POST'&&p==='/__qa/mode'){const mode=url.searchParams.get('mode');if(!['pass','rejectNextPatch'].includes(mode))return reply(400,{error:'invalid_mode'});stats.mode=mode;persist();return reply(200,{mode});}
 const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size>32768){req.destroy();return;}chunks.push(b);});
 req.on('end',async()=>{
  const body=Buffer.concat(chunks);let allowed=req.method==='GET'&&safeGet(p),input;
  if(req.method==='PATCH'&&p===path){
   try{input=JSON.parse(body);}catch{return reply(400,{error:'invalid_json'});}
   // The native client sends exactly six public fields (including its lease).
   allowed=object(input)&&Object.keys(input).length===6&&Object.keys(input).every(k=>['name','type','endpoint','permissions','config','baseUpdatedAt'].includes(k))&&input.name===scope.marker&&input.type==='rest'&&input.endpoint===scope.endpoint&&JSON.stringify(input.permissions)===JSON.stringify(['read'])&&typeof input.baseUpdatedAt==='string'&&input.baseUpdatedAt.trim().length>0&&configValid(input.config);
   if(allowed){try{const response=await fetch('http://127.0.0.1:'+scope.upstream+path,{redirect:'error',signal:AbortSignal.timeout(5000)});const canonical=await response.json();allowed=response.ok&&canonical.id===scope.id&&canonical.name===scope.marker&&canonical.provider==='Custom'&&canonical.type==='rest'&&canonical.endpoint===scope.endpoint&&JSON.stringify(canonical.permissions)===JSON.stringify(['read'])&&canonical.config?.authMethod==='none';}catch{allowed=false;}}
   if(allowed){stats.patchAttempts++;if(stats.mode==='rejectNextPatch'){stats.mode='pass';stats.rejected++;persist();return reply(503,{error:'OPSADV_QA_COLLECTIONS_REJECTED',message:'公开验收：保存失败，请保留完整草稿重试'});}stats.forwarded++;}
  }
  if(!allowed){stats.blocked++;persist();return reply(403,{error:'qa_scope_blocked'});}persist();
  const upstream=request({hostname:'127.0.0.1',port:scope.upstream,path:req.url,method:req.method,headers:body.length?{'Content-Type':'application/json'}:{}},response=>{
   if(req.method==='PATCH'){if(response.statusCode===409)stats.conflicts++;if(response.statusCode>=200&&response.statusCode<300)stats.successes++;stats.receipts.push({status:response.statusCode,inputHash:hash(body),configHash:hash(JSON.stringify(input.config)),baseUpdatedAt:input.baseUpdatedAt});stats.receipts=stats.receipts.slice(-32);persist();}
   res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/json'});response.pipe(res);
  });upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'qa_upstream_unavailable'});else res.destroy();});upstream.end(body);
 });
}).listen(scope.api,'127.0.0.1',()=>{persist();console.log('Scoped public collection PATCH proxy ready on '+scope.api);});
