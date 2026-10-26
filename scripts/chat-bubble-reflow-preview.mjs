// Public synthetic browser E2E fixture for bubble inner spacing. No model or production data.
import {mkdir,cp,readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {fullAssets} from './mygo-full-assets.mjs';
const scope=resolve('.local/acceptance/bubble-reflow-'+randomUUID()),port=46746;
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port)});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'气泡内边距验收'});S.setMeta('primaryConversationId','primary');
const text='今天的公开演示有两件事可以一起处理，先把第一次使用的路径理顺。\n用户输入目标后，应能直接看到一个具体结果，\n需要连接资料时再显示配置入口，不必在开始前一次性填完全部设置。\n\n下午可以用三名新用户做一次短走查：给每个人同一个目标，观察他们是否能独立完成，记录在哪一步停住。界面的文字应当自然排到气泡右侧，只留下和左侧一致的内边距。\n\n1. 先完成一条清楚的使用路径。\n2. 把必要的设置放在实际需要的位置。';
for(const [id,role,content] of [['long','assistant',text],['short','assistant','先把第一步做好。'],['user','user','保留我的手动换行\n第二行内容'],['markdown','assistant','普通软换行\n继续同一段。\n\n明确换行  \n保留下一行。\n\n```text\nfirst line\nsecond line\n```']])S.put('messages',{id,role,content,conversationId:'primary'});
const {app}=await import('../server/src/index.ts');
const assets=resolve(scope,'assets');await cp(resolve('native/mygo/assets'),assets,{recursive:true});await fullAssets(resolve('.'),assets);
await writeFile(assets+'/narrow.html','<!doctype html><meta charset="utf-8"><title>390px 气泡验收</title><iframe title="390px 对话" src="/" style="display:block;width:390px;height:844px;border:0;margin:20px auto"></iframe>');
createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end('denied')}
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname.startsWith('/api/')){if(req.method!=='GET'){res.writeHead(405);return res.end('read only fixture')}const r=await app.fetch(new Request(url));res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});return res.end(Buffer.from(await r.arrayBuffer()))}
 const p=resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/desktop.html':url.pathname));if(!p.startsWith(assets+'/')||await realpath(p)!==p)throw Error('path');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));
}catch{res.writeHead(404);res.end('not found')}}).listen(port,'127.0.0.1',()=>console.log(`Public bubble fixture http://127.0.0.1:${port}`));
