// Authenticated loopback bridge for the user-authorized HTML Chat. No static serving.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=resolve(root,'.local/design'),keyFile=resolve(dir,'chat-bridge-key');
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
const token=existsSync(keyFile)?readFileSync(keyFile,'utf8').trim():randomBytes(32).toString('hex');
if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid local capability');
writeFileSync(keyFile,token+'\n',{mode:0o600});chmodSync(keyFile,0o600);
const capabilityFile=resolve(dir,'chat-capability.js');
writeFileSync(capabilityFile,'window.OPSTWINS_CHAT_CAPABILITY='+JSON.stringify({url:'http://127.0.0.1:46114',token})+';\n',{mode:0o600});chmodSync(capabilityFile,0o600);
const origins=new Set(['null','http://localhost:46100','http://127.0.0.1:46100']);
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
const server=createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(origin&&!origins.has(origin)){reply(res,403,{error:'origin_denied'});return}
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
 res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-OpsTwins-Chat');
 if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
 if(req.method==='GET'&&req.url==='/health'){reply(res,200,{ready:true,scope:'authorized_local_chat',port:46114});return}
 const supplied=String(req.headers['x-opstwins-chat']||'');
 if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){reply(res,403,{error:'capability_required'});return}
 if((req.method==='GET'&&req.url==='/voice/status')||(req.method==='POST'&&req.url==='/voice/transcribe')){
  const abort=new AbortController(),disconnected=()=>{if(!res.writableEnded)abort.abort()};res.on('close',disconnected);
  try{
   let form;
   if(req.method==='POST'){
    const type=String(req.headers['content-type']||'');if(!/^multipart\/form-data;.*boundary=/i.test(type)){reply(res,400,{error:'voice_form_required'});return}
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024+8192){reply(res,413,{error:'voice_size'});return}chunks.push(chunk)}
    try{form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':type}}).formData()}catch{reply(res,400,{error:'voice_form_required'});return}
    const file=form.get('file');if([...form.keys()].length!==1||!file||typeof file==='string'){reply(res,400,{error:'voice_file_required'});return}
    if(!file.size||file.size>12*1024*1024){reply(res,413,{error:'voice_size'});return}
   }
   const response=await fetch('http://127.0.0.1:46110/api'+req.url,{method:req.method,...(form?{body:form}:{}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(65000)])});
   const result=await response.json();if(!res.destroyed)reply(res,response.status,result);
  }catch{if(!res.destroyed)reply(res,502,{error:'voice_unavailable'})}finally{res.off('close',disconnected)}
  return;
 }
 const sessionCreate=req.method==='POST'&&req.url==='/sessions';
 const sessionRead=req.method==='GET'&&req.url?.match(/^\/sessions\/(ui-side-[a-f0-9-]{36})$/);
 const status=req.url?.match(/^\/requests\/([\w-]{1,128})$/);
 if(!((req.method==='POST'&&req.url==='/chat')||(req.method==='GET'&&status)||sessionCreate||sessionRead)){reply(res,404,{error:'not_found'});return}
 try{
  let input;
  if(req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>350000){reply(res,413,{error:'request_too_large'});return}}
   try{input=JSON.parse(body)}catch{reply(res,400,{error:'invalid_json'});return}
   if(sessionCreate){
    if(!input||typeof input.id!=='string'||!/^ui-side-[a-f0-9-]{36}$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>120||Object.keys(input).some(k=>!['id','title'].includes(k))){reply(res,400,{error:'invalid_session'});return}
   }else{
   const keys=['message','requestId','conversationId','contextIds','readOnly','preservePrimary'];
   if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!keys.includes(k))||typeof input.message!=='string'||!input.message.trim()||input.message.length>80000||typeof input.requestId!=='string'||!/^[\w-]{1,128}$/.test(input.requestId)||input.conversationId!==undefined&&(typeof input.conversationId!=='string'||input.conversationId.length>200)||input.preservePrimary!==undefined&&typeof input.preservePrimary!=='boolean'||input.readOnly!==undefined&&typeof input.readOnly!=='boolean'||input.contextIds!==undefined&&(!Array.isArray(input.contextIds)||input.contextIds.length>50||input.contextIds.some(x=>typeof x!=='string'||x.length>200))){reply(res,400,{error:'invalid_request'});return}
   }
  }
  const target='http://127.0.0.1:46110/api/'+(sessionCreate?'conversations/side':sessionRead?'conversations/'+sessionRead[1]:status?'chat/requests/'+status[1]:'chat');
  const upstream=await fetch(target,{method:req.method,headers:{'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(165000)});
  // API already redacts secrets. Do not log prompts, responses, tokens or provider errors.
  const data=await upstream.json();reply(res,upstream.status,data);
 }catch{reply(res,502,{error:'bridge_unavailable'})}
});
server.listen(46114,'127.0.0.1',()=>console.log('Design Chat bridge listening on 127.0.0.1:46114'));
