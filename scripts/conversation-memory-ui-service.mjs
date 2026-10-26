// Isolated public HTTP surface running the unchanged production memory UI module.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
let pending=false,done=false,posts=0;
const state=()=>({enabled:true,summary:done?{text:'公开摘要已恢复',coveredCount:12}:null,summaryStale:!done,jobs:done?[]:[...(pending?[{id:'pending',status:'running'}]:[]),...['public-job-1','public-job-2','public-job-3'].map(id=>({id,status:'failed',error:'整理未完成，原聊天和已有记忆保留'}))],memories:[],recentChanges:[]});
const server=createServer(async(req,res)=>{
 const json=v=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(v))};
 if(req.url==='/memory.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(new URL('../web/src/desktop/full/memory.js',import.meta.url)))}
 if(req.url==='/evidence')return json({posts,pending,done});
 if(req.url==='/finish'&&req.method==='POST'){pending=false;done=true;return json(state())}
 if(req.url?.endsWith('/context/retry')){posts++;pending=true;return json(state())}
 if(req.url?.endsWith('/context'))return json(state());
 const late=req.url?.includes('late=1');res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="zh"><style>:root{--bg:white;--text:#272b35;--muted:#657080;--line:#e4e6eb;--blue:#3878ff}body{font:15px system-ui}button{border:0;background:none;cursor:pointer}</style><main id="view-chat" class="active">${late?'':'<div class="session-chat-header">公开记忆恢复验收</div>'}</main><script>window.OpsTwinsChatSessions={selected:()=> 'public-ui'};window.OpsTwinsDesktop={translate:t=>t,api:async(method,path,body)=>{const r=await fetch(path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('公开故障');return r.json()}};</script><script src="/memory.js"></script>${late?'<script>setTimeout(()=>{const header=document.createElement("div");header.className="session-chat-header";header.textContent="公开延迟入口验收";document.querySelector("main").prepend(header)},1000)</script>':''}</html>`);
});server.listen(46479,'127.0.0.1',()=>console.log('public UI ready 46479'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
