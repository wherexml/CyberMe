import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,readdirSync,renameSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {resolve,dirname,sep,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readMockModelConfig,streamMockReply} from './opstwins-mock-model.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const errorMessages={model_configuration:'当前服务端模型配置不可用，请检查模型设置',model_unavailable:'模型服务暂时不可用，请稍后明确重试',model_failed:'模型未能完成回答',model_interrupted:'连接中断，原请求结果尚未确认',model_incomplete:'回答尚未完整，请先查看已返回内容',server_restarted:'服务已重启，原请求结果尚未确认',save_failed:'结果保存失败，请回查原请求',empty_model_reply:'模型没有返回可读正文'};
function directory(root,path){
 root=resolve(root);const base=resolve(root,'.local'),target=resolve(path);if(!target.startsWith(base+sep))throw Error('private_boundary');
 let part=root;for(const name of target.slice(root.length+1).split(sep)){part=join(part,name);try{mkdirSync(part,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}const s=lstatSync(part);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||realpathSync(part)!==part)throw Error('private_boundary')}
 const s=lstatSync(target);if(s.mode&0o077)throw Error('private_boundary');return target;
}
export function createMockChatAPI({root,port,ledgerDir=resolve(root,'.local/mock-chat/requests')}){
 const dir=directory(root,ledgerDir),active=new Map();
 function file(id){return resolve(dir,id+'.json')}
 function read(id){try{const p=file(id),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>3000000||realpathSync(p)!==p)throw Error('private_boundary');return JSON.parse(readFileSync(p,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
 function save(row){const p=file(row.requestId),temp=p+'.'+randomUUID()+'.tmp';let fd;try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,JSON.stringify(row));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,p);const d=openSync(dir,'r');try{fsyncSync(d)}finally{closeSync(d)}}finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temp)}catch{}}}
 for(const name of readdirSync(dir)){if(!name.endsWith('.json')||!uuid.test(name.slice(0,-5)))continue;const row=read(name.slice(0,-5));if(['queued','running'].includes(row.status)){row.status=row.text?'partial':'unknown';row.code='server_restarted';row.updatedAt=Date.now();save(row)}}
 function dto(r){return {requestId:r.requestId,sessionId:r.input.sessionId,status:r.status,text:r.text||'',code:r.code,error:r.code?errorMessages[r.code]||'模型请求未完成':undefined,model:r.model,upstreamCalls:r.upstreamCalls,httpStatus:r.httpStatus,historyMessageCount:r.input.history.length,quoteCount:r.input.quotes.length,payloadHash:r.payloadHash,updatedAt:r.updatedAt}}
 function validQuote(q){return q&&Object.keys(q).every(k=>['id','text','type','sourceId','sessionId','sourceTitle'].includes(k))&&typeof q.text==='string'&&q.text.trim()&&[...q.text].length<=6000&&['id','type','sourceId','sessionId','sourceTitle'].every(k=>q[k]===undefined||typeof q[k]==='string'&&q[k].length<=300)}
 function valid(input){return input&&Object.keys(input).every(k=>['requestId','clientId','sessionId','history','question','quotes'].includes(k))&&uuid.test(input.requestId)&&uuid.test(input.clientId)&&typeof input.sessionId==='string'&&input.sessionId.length>0&&input.sessionId.length<=200&&typeof input.question==='string'&&input.question.trim()&&input.question.length<=20000&&Array.isArray(input.history)&&input.history.length<=120&&input.history.every(m=>m&&Object.keys(m).every(k=>['role','text','quotes'].includes(k))&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&m.text.length<=30000&&Array.isArray(m.quotes)&&m.quotes.length<=4&&m.quotes.every(validQuote))&&Array.isArray(input.quotes)&&input.quotes.length<=4&&input.quotes.every(validQuote)&&JSON.stringify(input).length<=180000}
 async function run(row){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),90000);active.set(row.requestId,abort);let lastSave=0;
  try{
   const config=readMockModelConfig(root);row.model=config.model;row.status='running';row.updatedAt=Date.now();save(row);
   const result=await streamMockReply({config,input:row.input,signal:abort.signal,onRequest(){if(abort.signal.aborted||row.upstreamCalls)throw Error('model_interrupted');row.upstreamCalls=1;row.dispatchedAt=Date.now();save(row)},onHeaders(status){row.httpStatus=status;save(row)},onText(text){row.text=text;row.updatedAt=Date.now();if(row.updatedAt-lastSave>400){save(row);lastSave=row.updatedAt}}});
   row.text=result.text;row.usage=result.usage;row.status='succeeded';delete row.code;
  }catch(e){
   row.code=['model_configuration','model_incomplete','empty_model_reply'].includes(e.message)?e.message:row.httpStatus>=400?'model_unavailable':row.upstreamCalls?'model_interrupted':'model_failed';
   row.status=row.text?'partial':row.code==='model_configuration'||row.httpStatus>=400||!row.upstreamCalls?'failed':'unknown';
  }finally{
   clearTimeout(timer);row.updatedAt=Date.now();try{save(row)}catch{row.status=row.text?'partial':'unknown';row.code='save_failed'}active.delete(row.requestId);
  }
 }
 function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
 async function handle(req,res){
  if(!req.url?.startsWith('/api/mock-chat/'))return false;
  const host=req.headers.host,origin=req.headers.origin,site=req.headers['sec-fetch-site'];
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||origin&&origin!==`http://${host}`||site&&!['same-origin','none'].includes(site)||req.headers['x-opstwins-mock']!=='chat'||!uuid.test(String(req.headers['x-opstwins-client']||''))){reply(res,403,{error:'origin_denied'});return true}
  const match=req.url.match(/^\/api\/mock-chat\/requests\/([a-f0-9-]{36})$/);if(!match||!uuid.test(match[1])||!['GET','POST'].includes(req.method)){reply(res,404,{error:'not_found'});return true}
  try{
   const id=match[1],clientId=req.headers['x-opstwins-client'];let row=read(id);
   if(row&&row.input.clientId!==clientId){reply(res,404,{error:'not_found'});return true}
   if(req.method==='GET'){if(!row)reply(res,404,{error:'request_not_found'});else reply(res,200,dto(row));return true}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(res,415,{error:'json_required'});return true}
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>750000){reply(res,413,{error:'request_too_large'});return true}chunks.push(chunk)}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{reply(res,400,{error:'invalid_json'});return true}
   if(!valid(input)||input.requestId!==id||input.clientId!==clientId){reply(res,400,{error:'invalid_context'});return true}
   const payloadHash=hash(input);
   if(row){if(row.payloadHash!==payloadHash)reply(res,409,{error:'request_conflict'});else reply(res,200,dto(row));return true}
   if(active.size>=2){reply(res,429,{error:'model_busy'});return true}
   row={requestId:id,input,payloadHash,status:'queued',text:'',upstreamCalls:0,createdAt:Date.now(),updatedAt:Date.now()};save(row);
   // Commit the receipt before dispatch. No retry or abort on browser disconnect.
   void run(row);reply(res,202,dto(row));return true;
  }catch{reply(res,503,{error:'local_service_unavailable'});return true}
 }
 return {handle,close(){for(const c of active.values())c.abort()}};
}
