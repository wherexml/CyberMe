import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('../mock/opstwins/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{try{if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}const url=new URL(req.url,'http://127.0.0.1:46400');const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));const canonical=await realpath(path);if(!canonical.startsWith(root.endsWith(sep)?root:root+sep)||canonical!==path||!(await stat(path)).isFile()){res.writeHead(403);res.end('Denied');return}res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:await readFile(path))}catch{res.writeHead(404);res.end('Not found')}});
server.listen(46400,'127.0.0.1',()=>console.log('OpsTwins product mock: http://127.0.0.1:46400'));
