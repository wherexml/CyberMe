// Connect the desktop to the existing workspace API. Does not import, copy, or open its database.
import {homedir} from 'node:os';
import {createServer} from 'node:http';
import {mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=process.env.OPSTWIN_STANDALONE==='1'?resolve(homedir(),'Library/Application Support/OpsTwins'):resolve(dirname(fileURLToPath(import.meta.url)),'..'),scope=resolve(root,'.local/mygo-desktop');
await mkdir(scope,{recursive:true,mode:0o700});const st=await lstat(scope);if(await realpath(scope)!==scope||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw Error('Invalid desktop scope');
const token=randomBytes(32).toString('hex'),allowed=/^\/(api\/(health|bootstrap|diagnostics|agent|chat|conversations|inbox|inbox-source-rules|ideas|tasks|projects|memories|settings|connections|feishu|wechat|sources|source-message-assets|runs|messages|activities|activity|artifacts|files|voice|calendar|automations|autonomous-dispatches|notifications|workspace|native)(\/|$)|files\/[A-Za-z0-9_-]+$)/;
const server=createServer(async(req,res)=>{try{
 const supplied=req.headers['x-opstwins-pilot']||'';if(typeof supplied!=='string'||supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){res.writeHead(403);return res.end('{"error":"desktop_auth_required"}')}
 const u=new URL(req.url,'http://127.0.0.1:46312');if(!allowed.test(u.pathname)||u.pathname==='/api/native/events'||u.pathname.includes('..')){res.writeHead(403);return res.end('{"error":"route_denied"}')}
 const headers={};for(const h of ['content-type','range','if-none-match'])if(req.headers[h])headers[h]=req.headers[h];const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw Error('limit');chunks.push(chunk)}
 const response=await fetch('http://127.0.0.1:46110'+u.pathname+u.search,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(180000)});
 res.statusCode=response.status;for(const h of ['content-type','content-range','accept-ranges','content-disposition'])if(response.headers.has(h))res.setHeader(h,response.headers.get(h));res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 let received=0;for await(const chunk of response.body||[]){received+=chunk.length;if(received>64*1024*1024)throw Error('response_limit');res.write(chunk)}res.end();
 }catch{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"workspace_unavailable","message":"现有工作区服务暂不可用，请启动 46110 后重试"}')}else res.destroy()}});
server.listen(46312,'127.0.0.1',async()=>{const file=resolve(scope,'connection.json');try{const s=await lstat(file);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o777)!==0o600)throw Error('Invalid binding')}catch(e){if(e.code!=='ENOENT')throw e}await writeFile(file,JSON.stringify({port:46312,token}),{mode:0o600});console.log('Desktop gateway ready: 46312 -> existing 46110')});
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
