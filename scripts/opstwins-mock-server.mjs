import {createMockChatAPI} from './lib/opstwins-mock-chat-api.mjs';
import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {tsImport} from 'tsx/esm/api';
const port=Number(process.env.OPSTWIN_MOCK_PORT||46400);if(!Number.isInteger(port)||port<10000||port>65535)throw Error('Five-digit port required');
const project=fileURLToPath(new URL('..',import.meta.url));
const {createTaskAgentAPI}=await tsImport('../server/src/executors/http.ts',import.meta.url);
const taskAgents=createTaskAgentAPI({root:project,port,...(process.env.OPSTWIN_TASK_AGENT_DIR?{ledgerDir:process.env.OPSTWIN_TASK_AGENT_DIR}:{})});
const chat=createMockChatAPI({root:project,port,...(process.env.OPSTWIN_MOCK_CHAT_DIR?{ledgerDir:process.env.OPSTWIN_MOCK_CHAT_DIR}:{})});
const root=fileURLToPath(new URL('../mock/opstwins/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{try{if(await taskAgents.handle(req,res))return;if(await chat.handle(req,res))return;if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}const url=new URL(req.url,'http://127.0.0.1:46400');const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));const canonical=await realpath(path);if(!canonical.startsWith(root.endsWith(sep)?root:root+sep)||canonical!==path||!(await stat(path)).isFile()){res.writeHead(403);res.end('Denied');return}res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; frame-ancestors 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:await readFile(path))}catch{res.writeHead(404);res.end('Not found')}});
server.listen(port,'127.0.0.1',()=>console.log('OpsTwins product mock: http://127.0.0.1:'+port));
let shuttingDown=false;async function stop(){if(shuttingDown)return;shuttingDown=true;server.close();chat.close();await taskAgents.close();server.closeAllConnections();process.exit(0)}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
