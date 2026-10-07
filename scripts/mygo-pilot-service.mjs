// Isolated production HTTP service. No sibling data, background jobs or external-send routes.
import {mkdir,writeFile,readFile,lstat,realpath} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {DatabaseSync} from 'node:sqlite';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),scope=resolve(root,'.local/mygo-pilot-public-v2');
await mkdir(scope,{recursive:true,mode:0o700});
if(await realpath(scope)!==scope||(await lstat(scope)).mode%512!==0o700)throw Error('Private scope boundary invalid');
const runtime=resolve(scope,'runtime');await mkdir(runtime,{recursive:true,mode:0o700});
for(const dir of [runtime])if(await realpath(dir)!==dir||(await lstat(dir)).mode%512!==0o700)throw Error('Private runtime boundary invalid');
if(process.argv.includes('--reuse-model-config')){
 const source=JSON.parse(await readFile(resolve(root,'.local/config.json'),'utf8'));
 // Only server-private model config; never profile/Feishu binding or source content.
 const dest=resolve(runtime,'config.json');
 try{await lstat(dest)}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(dest,JSON.stringify({llm:source.llm}),{mode:0o600,flag:'wx'})}
}
const dataRoot=resolve(scope,'public-data-v2');await mkdir(dataRoot,{recursive:true,mode:0o700});
if(await realpath(dataRoot)!==dataRoot||(await lstat(dataRoot)).mode%512!==0o700)throw Error('Private data boundary invalid');
try{const st=await lstat(resolve(dataRoot,'opstwin-advance.db'));if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid())throw Error('Invalid pilot database')}catch(e){if(e.code!=='ENOENT')throw e}
const seed=new DatabaseSync(resolve(dataRoot,'opstwin-advance.db'));seed.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');seed.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('initialized','true');seed.close();
const denyCLI=resolve(scope,'deny-external.mjs');await writeFile(denyCLI,"#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ok:false,error:{message:'Pilot external CLI disabled'}}));process.exitCode=1;\n",{mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:dataRoot,OPSTWIN_LARK_CLI:denyCLI,OPSTWIN_WECHAT_CLI:denyCLI,OPSTWIN_PRIVATE_DIR:runtime,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46310',OPSTWIN_WEB_PORT:'46300',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
const {app}=await import('../server/src/index.ts');
const {put,get,setMeta,patchSettings,db}=await import('../server/src/store.ts');
if(!get('conversations','mygo-public-primary')){
 put('conversations',{id:'mygo-public-primary',title:'公开先导会话'});setMeta('primaryConversationId','mygo-public-primary');
 put('messages',{id:'mygo-public-welcome',conversationId:'mygo-public-primary',role:'assistant',content:'这是 MyGO 隔离工作区。\n\n这里使用真实业务 API，测试数据与日常工作区分开。\n\n- 支持中文、Emoji 和长文本\n- 请求未确认时先回查\n- 发送不会触碰日常主会话'});
 for(let n=1;n<=3;n++)put('inbox',{id:'mygo-public-inbox-'+n,title:'公开验收事项 '+n,sender:'测试同事 '+n,channel:'manual',category:'沟通',status:'pending',body:'OPSADV-QA 公开资料：请核对下一次产品演示的准备情况。\n消息正文尾标 END-'+n,draft:'我会先核对演示环境，确认后回复',priority:'medium',attentionOverride:true});
 patchSettings({identity:{name:'公开先导',language:'zh-CN'}});
}
const token=randomBytes(32).toString('hex');
const gate=new Hono();
gate.use('*',async(c,next)=>{const supplied=c.req.header('X-OpsTwins-Pilot')||'';if(Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return c.json({error:'pilot_auth_required'},403);await next()});
gate.all('*',async c=>{
 if(c.req.method==='GET'&&/^\/api\/pilot\/drafts\/[A-Za-z0-9_-]+$/.test(c.req.path)){const row=db.prepare('SELECT state,data FROM draft_requests WHERE id=?').get(c.req.path.split('/').at(-1));if(!row)return c.json({error:'not_found'},404);const data=JSON.parse(row.data);if(!get('inbox',data.itemId))return c.json({error:'pilot_route_denied'},403);return c.json({status:row.state,itemId:data.itemId,runId:data.runId,item:get('inbox',data.itemId)});}

 const isolatedDenied=/^\/api\/(import\/sibling|notifications\/(tick|[^/]+\/(retry|reconcile))|autonomous-dispatches\/(tick|[^/]+\/(retry|reconcile)))$/.test(c.req.path)||/\/(send|undo|calendar|call-tool)(\/|$)/.test(c.req.path);
 if(isolatedDenied)return c.json({error:'isolated_workspace',message:'当前为隔离工作区，外发与日程写入不可执行'},403);
 const allowed=app.routes.some(route=>route.method===c.req.method&&!route.path.includes('*')&&new RegExp('^'+route.path.split('/').map(part=>part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'$').test(c.req.path));
 if(!allowed)return c.json({error:'route_not_allowed'},403);
 return app.fetch(c.req.raw)});
const server=serve({fetch:gate.fetch,port:46310,hostname:'127.0.0.1'},async()=>{await writeFile(resolve(scope,'connection.json'),JSON.stringify({port:46310,token}),{mode:0o600});console.log(JSON.stringify({ready:true,port:46310,scope:'mygo-pilot-public-v2',externalSend:false}));});
server.on('error',()=>{console.error('pilot_listener_failed');process.exitCode=1});
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
