// Public acceptance workspace only. Capability is read server-side, never returned to the browser.
import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),assets=resolve(root,'native/mygo/assets'),origin='http://127.0.0.1:46300';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
createServer(async(req,res)=>{try{
 if(req.headers.host!=='127.0.0.1:46300'||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);return res.end('origin_denied')}
 const url=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/files/')){
  const link=JSON.parse(await readFile(resolve(root,'.local/mygo-pilot-public-v2/connection.json'),'utf8'));const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw Error('request_limit');chunks.push(chunk)}
  const headers={'X-OpsTwins-Pilot':link.token};for(const h of ['content-type','range'])if(req.headers[h])headers[h]=req.headers[h];
  const upstream=await fetch('http://127.0.0.1:46310'+url.pathname+url.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(180000)});
  res.statusCode=upstream.status;for(const h of ['content-type','content-range','accept-ranges','content-disposition'])if(upstream.headers.has(h))res.setHeader(h,upstream.headers.get(h));return res.end(Buffer.from(await upstream.arrayBuffer()));
 }
 const path=resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/desktop.html':url.pathname));if(!path.startsWith(assets+'/')||await realpath(path)!==path)throw Error('path_denied');res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:'desktop_preview_failed'}))}}).listen(46300,'127.0.0.1',()=>console.log('MyGO full preview on 46300'));
