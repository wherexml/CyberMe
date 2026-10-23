// Public business data, actual configured model; no credential copies or production data writes.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
const scope=resolve('.local/acceptance/ideas-real-'+randomUUID()),out=resolve('output/mygo-ideas-auto-20261023');await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0'});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开验收用户',language:'zh-CN',instructions:'仅用本轮公开资料，禁止外发'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'公开主会话'});S.setMeta('primaryConversationId','primary');
S.put('tasks',{id:'public-pilot',title:'公开项目阿尔法试点',status:'active',notes:'最新资料：阿尔法试点的设备与场地均已就绪。需要在明天上午10点或下午2点中选择试点时间。仅需确定试点时间，不需要另建准备、提醒或汇报事项。'});
for(const [id,title] of [['idea-a','确认阿尔法试点日期'],['idea-b','安排阿尔法试点时间']])S.put('ideas',{id,title,description:'确定阿尔法试点的具体开始时间。',runId:'historical-public',status:'new',sourceIds:['public-pilot']});
const {app}=await import('../server/src/index.ts');const server=serve({fetch:app.fetch,port:46614,hostname:'127.0.0.1'}),checks=[],runs=[];
const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
async function refresh(){const r=await fetch('http://127.0.0.1:46614/api/ideas/refresh',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(180000)});const result=await r.json();runs.push({http:r.status,id:result.run?.id,status:result.run?.status,model:result.run?.model,toolCount:result.run?.tools?.length||0,error:result.error});check('real model request '+runs.length+' succeeds',r.ok);return result;}
try{
 await refresh();let a=S.list('ideas');check('same decision has one active suggestion',a.filter(x=>x.status==='new').length===1);check('duplicate moved to history',a.some(x=>x.status==='merged'));check('canonical old ID retained',a.find(x=>x.status==='new').id.startsWith('idea-'));
 S.put('tasks',{...S.get('tasks','public-pilot'),status:'completed',notes:'最新正式结论：阿尔法试点已于今天上午10点完成验收，验收结果通过。试点日期已确定且活动已结束，不需要再次选择时间。'});
 await refresh();a=S.list('ideas');check('completed decision removed from current',a.every(x=>x.status!=='new'));check('completion keeps source evidence',a.some(x=>x.retirementReason==='resolved'&&x.retirementEvidence?.[0]?.sourceId==='public-pilot'));check('primary unchanged',S.meta('primaryConversationId','')==='primary');check('no chat messages or business writes',S.list('messages').length===0&&S.list('tasks').length===1&&S.list('inbox').length===0);
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}finally{server.close();await mkdir(out,{recursive:true});await writeFile(resolve(out,'real-model.json'),JSON.stringify({scope:'isolated public data with actual configured model',sourceHash:createHash('sha256').update(await readFile('server/src/ideas-background.ts')).digest('hex'),checks,runs,ideas:S.list('ideas')},null,2));console.log(JSON.stringify({checks,runs}));}
