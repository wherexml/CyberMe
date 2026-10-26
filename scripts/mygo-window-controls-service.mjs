// Isolated product-page E2E fixture. Native transport is simulated, never production data.
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
const scope=resolve('.local/window-controls-e2e'),assets=resolve(process.argv[2]||'native/mygo/assets'),port=46780;
for(const dir of [scope+'/data',scope+'/private'])await mkdir(dir,{recursive:true,mode:0o700});
await writeFile(scope+'/private/config.json','{}',{mode:0o600});
const seed=new DatabaseSync(scope+'/data/opstwin-advance.db');seed.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('initialized','true');seed.close();
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope+'/data',OPSTWIN_PRIVATE_DIR:scope+'/private',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46781',OPSTWIN_WEB_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const {app}=await import('../server/src/index.ts');const S=await import('../server/src/store.ts');
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
S.put('conversations',{id:'window-controls-main',title:'公开验收',status:'active',mode:'chat'});S.setMeta('primaryConversationId','window-controls-main');
const bridge=`window.__chromeFixture={calls:[],position:{x:100,y:100},delay:0};window.mygo={call:async(name,...args)=>{const f=window.__chromeFixture;f.calls.push({name,args});if(name==='WindowChrome.Position'){if(f.delay)await new Promise(r=>setTimeout(r,f.delay));return {...f.position}}if(name==='WindowChrome.Move'){f.position={x:args[0],y:args[1]};return}throw Error('Unexpected fixture bridge: '+name)},window:{toggleMaximize:async()=>window.__chromeFixture.calls.push({name:'maximize'})}};`;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,`http://127.0.0.1:${port}`);res.setHeader('Cache-Control','no-store');
 if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);return res.end('origin_denied')}
 if(u.pathname.startsWith('/api/')){if(req.method!=='GET'){res.writeHead(403);return res.end('read_only')}const response=await app.request(u.pathname+u.search);res.writeHead(response.status,{'Content-Type':'application/json'});return res.end(await response.text())}
 const path=resolve(assets,'.'+decodeURIComponent(u.pathname==='/'?'/desktop.html':u.pathname));if(!path.startsWith(assets+'/')||await realpath(path)!==path)throw Error('invalid_path');res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');const raw=await readFile(path);res.end(u.pathname==='/full/window-chrome.js'?bridge+raw.toString():raw);
 }catch{res.writeHead(500);res.end('fixture_error')}});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,port,publicFixture:true,simulatedNativeBridge:true})));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{server.close();S.db.close();process.exit(0)});
