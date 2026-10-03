import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const port=Number(process.env.OPSTWIN_WEB_PORT||46100),apiPort=Number(process.env.OPSTWIN_API_PORT||46110);
for(const value of [port,apiPort])if(!Number.isInteger(value)||value<10000||value>65535)throw new Error('Use five-digit service ports');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,'http://127.0.0.1:'+port);
  if(url.pathname==='/api'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/files/')){
   const headers={...request.headers,host:'127.0.0.1:'+apiPort};delete headers.connection;
   const abort=new AbortController();response.once('close',()=>{if(!response.writableEnded)abort.abort()});
   const body=['GET','HEAD'].includes(request.method)?undefined:request;
   const upstream=await fetch('http://127.0.0.1:'+apiPort+url.pathname+url.search,{method:request.method,headers,body,duplex:'half',signal:abort.signal});
   response.statusCode=upstream.status;for(const [name,value] of upstream.headers)if(!['connection','transfer-encoding','content-encoding','content-length'].includes(name))response.setHeader(name,value);
   if(upstream.body&&request.method!=='HEAD')await pipeline(Readable.fromWeb(upstream.body),response);else response.end();return;
  }
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
  const filename=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(filename!==root&&!filename.startsWith(root.endsWith(sep)?root:root+sep)){response.writeHead(403).end();return;}
  let file=filename,info;try{info=await stat(file)}catch{}
  if(!info?.isFile()){if(extname(url.pathname)){response.writeHead(404).end();return;}file=resolve(root,'index.html');info=await stat(file);}
  response.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');response.setHeader('Content-Length',info.size);
  response.setHeader('Cache-Control',file.includes(sep+'assets'+sep)?'public, max-age=31536000, immutable':'no-cache');
  if(request.method==='HEAD')response.end();else await pipeline(createReadStream(file),response);
 }catch(error){if(!response.headersSent){response.writeHead(502,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'service_unavailable',message:'The local service is unavailable. Retry after it restarts.'}));}else response.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log('OpsTwin Advance Web http://127.0.0.1:'+port));
process.once('SIGINT',()=>server.close());process.once('SIGTERM',()=>server.close());
