// Isolated HTTP failure journey; failure scenarios were specified before implementation.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
const out=resolve('output/wechat-sync-20261003/failure');mkdirSync(out,{recursive:true});
process.env.OPSTWIN_DATA_DIR=out;
process.env.OPSTWIN_WECHAT_CLI=resolve(out,'missing-greenbubbles');
const {connectWechat,wechatChats}=await import('../server/src/wechat-sync');
const app=new Hono();app.post('/connect',async c=>c.json(await connectWechat()));app.get('/chats',async c=>c.json(await wechatChats()));app.onError((e:any,c)=>c.json({error:e.code},e.status||500));
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:46129});
try{
 const r=await fetch('http://127.0.0.1:46129/connect',{method:'POST'});const value=await r.json();
 if(value.ok||value.connection.status!=='error'||value.connection.capabilities.length)throw Error('Missing CLI falsely connected');
 const blocked=await fetch('http://127.0.0.1:46129/chats');if(blocked.status!==409)throw Error('Failed connection allowed reads');
 const report={kind:'isolated real HTTP/SQLite, missing CLI',cases:[{name:'Missing CLI is persisted as failed, without capabilities',status:'PASS'},{name:'Failed connection rejects reading',status:'PASS'}]};
 writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(report);
}finally{server.close();}
