// Public HTTP/browser E2E fixture. No production data, external sends or actual installation.
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/chat-update-'+randomUUID()),root=resolve('.local/chat-update-web');
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46786',OPSTWIN_WEB_PORT:'46786',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46787/v1',apiKey:'public-fixture',api:'openai-completions',model:'public-chat'}}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);
S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'连续发送验收'});S.setMeta('primaryConversationId','primary');
S.put('conversations',{id:'side',title:'独立侧对话'});
let modelCalls=0,chatPosts=0,failSave=false,installCalls=0,downloadCalls=0,checkCalls=0,waitInstall=false,downloadMode='ready',holdNext=false;
let state={revision:0,drafts:{},requests:{},theme:'light'},up={status:'idle',current:{version:'0.1.3'},ready:false};
const model=createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);modelCalls++;
 const slow=holdNext;holdNext=false;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-chat',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 chunk({role:'assistant',content:'公开响应'});
 const t=setTimeout(()=>{chunk({content:'已完成。'});chunk({},'stop');res.end('data: [DONE]\n\n')},slow?30000:100);
 res.on('close',()=>clearTimeout(t));
});await new Promise(r=>model.listen(46787,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.post('/__fixture/control',async c=>{const v=await c.req.json();if(v.up)up=v.up;if('holdNext'in v)holdNext=v.holdNext;if('failSave'in v)failSave=v.failSave;if('waitInstall'in v)waitInstall=v.waitInstall;if(v.downloadMode)downloadMode=v.downloadMode;return c.json({ok:true})});
gate.get('/__fixture/evidence',c=>c.json({modelCalls,chatPosts,installCalls,downloadCalls,checkCalls,up,state,requests:S.db.prepare('SELECT id,state FROM chat_requests').all(),sends:S.db.prepare('SELECT count(*) n FROM send_intents').get().n}));
gate.post('/__fixture/bridge',async c=>{const {method,args}=await c.req.json();let value=null;
 if(method==='Bridge.Scope')value='public-chat-update';
 else if(method==='Bridge.ReadState')value=state;
 else if(method==='Bridge.SaveState'){if(failSave)return c.json({error:'fixture_save_failed'},500);state={...args[0],revision:state.revision+1};value=state}
 else if(method==='DesktopUpdate.Status')value=up;
 else if(method==='DesktopUpdate.Check'){checkCalls++;up={...up,status:'checking'};setTimeout(()=>{up={...up,status:'available',available:{version:'0.1.4',build:'public-next'},ready:false}},100);value=up}
 else if(method==='DesktopUpdate.Download'){downloadCalls++;up={...up,status:'downloading',downloaded:1,total:10};setTimeout(()=>{if(up.status==='downloading'&&downloadMode==='ready')up={...up,status:'ready',ready:true,downloaded:10};if(up.status==='downloading'&&downloadMode==='error')up={...up,status:'error',error:'archive_digest_rejected'}},1000);value=up}
 else if(method==='DesktopUpdate.Cancel'){up={...up,status:'available',ready:false};value=up}
 else if(method==='DesktopUpdate.Install'){installCalls++;up={...up,status:waitInstall?'waiting':'prepared'};value=up}
 else if(method==='WindowChrome.Close')value=null;
 else return c.json({error:'unsupported_fixture_bridge'},400);
 return c.json({value});
});
gate.all('/api/*',c=>{if(c.req.method==='POST'&&c.req.path==='/api/chat')chatPosts++;if(c.req.method!=='GET'&&c.req.path!=='/api/chat')return c.json({error:'fixture_write_disabled'},403);return app.fetch(c.req.raw)});
gate.get('/fixture-native.js',c=>c.body(`window.mygo={call:async(method,...args)=>{const r=await fetch('/__fixture/bridge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})});const b=await r.json();if(!r.ok)throw Error(b.error);return b.value}};`,200,{'Content-Type':'text/javascript'}));
gate.get('*',async c=>{const p=resolve(root,c.req.path==='/'?'cyberme.html':c.req.path.slice(1));if(!p.startsWith(root+'/'))return c.notFound();try{let b=await readFile(p);if(p.endsWith('.html')&&c.req.query('native')==='1')b=Buffer.from(b.toString().replace('<head>','<head><script src="/fixture-native.js"></script>'));c.header('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');return c.body(b)}catch{return c.notFound()}});
const server=serve({fetch:gate.fetch,hostname:'127.0.0.1',port:46786});console.log('Public fixture: http://127.0.0.1:46786');
process.on('SIGTERM',()=>{server.close();model.close();S.db.close();process.exit(0)});
