// Controlled PARTIAL protocol only. Never mutates a real request or forwards a write.
import http from 'node:http';
const requestId=process.env.OPSTWIN_QA_PARTIAL_REQUEST;
const conversationId=process.env.OPSTWIN_QA_PARTIAL_CONVERSATION;
if(!/^OPSADV-QA-PARTIAL-[\w-]{6,100}$/.test(requestId||'')||!/^ui-side-[\w-]{6,100}$/.test(conversationId||''))throw Error('Explicit public QA IDs required');
const requests=[];
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:46195');
 requests.push({method:req.method,path:url.pathname,at:Date.now()});
 const finish=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method!=='GET'){req.resume();return finish(403,{error:'synthetic_partial_read_only',message:'受控partial协议验收禁止写入'});}
 if(url.pathname==='/__qa/status')return finish(200,{kind:'SYNTHETIC-PARTIAL-PROTOCOL',requestId,conversationId,requests,writesForwarded:0});
 if(url.pathname===`/api/chat/requests/${requestId}`)return finish(200,{requestId,conversationId,status:'partial',result:null,runId:null});
 const upstream=http.request(new URL(req.url,'http://127.0.0.1:46110'),{method:'GET',headers:{...req.headers,host:'127.0.0.1:46110'}},response=>{
  if(url.pathname==='/api/chat/conversations/state'){
   let body='';response.on('data',c=>body+=c);response.on('end',()=>{try{const state=JSON.parse(body);for(const item of state.items||[])if(item.id===conversationId){item.partial=true;item.locked=true;}finish(response.statusCode,state);}catch{finish(502,{error:'invalid_upstream'});}});return;
  }
  res.writeHead(response.statusCode,response.headers);response.pipe(res);
 });upstream.on('error',()=>finish(502,{error:'upstream_unavailable'}));upstream.end();
}).listen(46195,'127.0.0.1',()=>console.log('SYNTHETIC-PARTIAL-PROTOCOL read-only 46195'));
