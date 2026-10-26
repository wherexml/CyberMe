// Repeatable production HTTP + SDK + SQLite journey, isolated synthetic sources only.
// Run: node --import tsx scripts/chat-insight-quality-e2e.mjs [--real] [--serve]
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,cp,realpath} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
const real=process.argv.includes('--real'),keep=process.argv.includes('--serve'),port=real?46744:46740;
const scope=resolve('.local/acceptance/chat-insight-'+randomUUID()),out=resolve('output/chat-insight-quality-20261025');
await mkdir(scope,{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port),OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'});
if(!real){process.env.OPSTWIN_PRIVATE_DIR=scope;await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:'http://127.0.0.1:46741/v1',apiKey:'public-fixture-key',api:'openai-completions',model:'public-research'}}),{mode:0o600})}
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开验收',language:'zh-CN'},autonomy:{holdSending:true}});
S.put('conversations',{id:'primary',title:'对话排版验收'});S.setMeta('primaryConversationId','primary');
S.setMeta('ideas-chat-v1',{enabledAt:new Date(Date.now()-60000).toISOString(),alerts:{},ideas:{},withdrawn:{},withdrawnAt:{}});
S.put('tasks',{id:'research-latest',title:'晨光产品反馈',notes:'公开客户评价：晨光产品界面简洁，适合非技术用户。请据此判断我们的产品应先改进什么。',status:'active'});
S.put('memories',{id:'research-older',title:'晨光体验观察',body:'公开研究记录：新用户第一次只需要完成一个目标，不需要先配置连接器。试点访谈指出，目前配置入口过多，首个结果不清楚。',eventAt:'2026-10-01T00:00:00Z'});
S.put('connections',{id:'revoked',status:'disconnected',permissions:[]});
S.put('memories',{id:'research-private',title:'晨光不可读资料',body:'NEVER_READ_PRIVATE',connectionId:'revoked'});
for(let i=0;i<27;i++)S.put('tasks',{id:'noise-'+i,title:'无关公开项目 '+i,notes:'本条为无关公开事项。',eventAt:new Date(Date.now()+i).toISOString(),status:'active'});
const initialTasks=S.hash(S.list('tasks')),checks=[],runs=[];let mode='normal',calls=0,toolCatalogs=[];
const description='我建议先简化首次使用流程。已有访谈把问题指向配置入口过多、首个结果不清楚；“界面简洁”的评价本身不能证明产品能力更强。\n\n1. 首屏只保留一个目标输入，把连接配置推迟到确实需要时。\n2. 先做一条从输入到结果的完整流程，用新用户能否独立完成来检验。\n3. 官网尚未核验，暂不据此判断功能差异。';
const model=!real?createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);calls++;toolCatalogs.push((input.tools||[]).map(t=>t.function.name));
 const tools=input.messages.filter(m=>m.role==='tool'),n=tools.length;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta,finish=null)=>res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-research',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 if(mode!=='no-research'&&n<(mode==='limit'?5:1)){
  chunk({role:'assistant',tool_calls:[{index:0,id:'read-'+n,type:'function',function:{name:'search_idea_sources',arguments:JSON.stringify({query:'晨光'})}}]});chunk({},'tool_calls');
 }else{
  if(mode==='drift')S.put('memories',{...S.get('memories','research-older'),body:'来源已改变，请勿采用旧结论。'});
  if(mode==='revoke')S.put('connections',{id:'readable',status:'disconnected',permissions:[]});
  const existing=S.list('ideas').find(i=>i.status==='new');
  const result={ideas:[{title:'先简化首次使用',description,topicKey:'晨光首次使用体验',sourceIds:['research-latest','research-older'],...(existing?{existingId:existing.id}:{}),evidence:[{sourceId:'research-older',quote:mode==='forged'?'不存在的引用':'新用户第一次只需要完成一个目标，不需要先配置连接器。'}]}],retire:[]};
  chunk({role:'assistant',content:JSON.stringify(result)});chunk({},'stop');
 }
 res.end('data: [DONE]\n\n');
}):null;
if(model)await new Promise(r=>model.listen(46741,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts'),B=await import('../server/src/ideas-background.ts'),C=await import('../server/src/ideas-chat.ts');
const server=serve({fetch:app.fetch,port,hostname:'127.0.0.1'});
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
async function refresh(){const r=await fetch(`http://127.0.0.1:${port}/api/ideas/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'请调查晨光的相关资料，再给出你自己的判断和具体建议，多个独立要点请编号；无需研究无关项目。'}),signal:AbortSignal.timeout(180000)});const data=await r.json();const run=S.get('runs',data.run?.id||B.ideasBackgroundStatus().runId);runs.push({http:r.status,model:run?.model,tools:run?.tools?.filter(t=>t.name==='search_idea_sources'),error:data.error});return {http:r.status,data,run}}
try{
 check('related research source starts outside latest batch',!B.sources().slice(0,24).some(s=>s.id==='research-older'));
 const first=await refresh();check('production generation succeeds',first.http===200);
 check('model actually searches related sources',first.run.tools.some(t=>t.name==='search_idea_sources'&&t.status==='succeeded'));
 check('research is the only available tool',JSON.stringify(first.run.availableTools)==='["search_idea_sources"]');
 check('revoked sources never returned',first.run.tools.filter(t=>t.name==='search_idea_sources').every(t=>!JSON.stringify(t.output).includes('research-private')));
 const ideas=S.list('ideas').filter(i=>i.status==='new');check('retrieved evidence supports saved judgment',ideas.some(i=>i.sourceIds.includes('research-older')));
 if(!real)check('numbered recommendations survive storage',ideas[0].description.includes('\n1. ')&&ideas[0].description.includes('\n2. '));
 // Public preview of the exact production Markdown and action controls.
 S.put('messages',{id:'public-reply',conversationId:'primary',role:'assistant',content:ideas[0].description});
 S.put('messages',{id:'public-short',conversationId:'primary',role:'assistant',content:'先简化第一次使用。'});
 S.put('messages',{id:'public-user',conversationId:'primary',role:'user',content:'给我一个具体判断，以及两三个可验证的改进点。'});
 // Verify legacy reminder formatting migrates in place, without fabricating a new event.
 const fresh=B.sources().find(s=>s.id==='research-latest');
 S.put('ideas',{id:'projection-check',title:'公开编号建议',description,topicKey:'projection-check',status:'new',autoGenerated:true,refreshedAt:S.now(),sourceIds:[fresh.id],sourceFingerprints:{[fresh.id]:fresh.fingerprint},evidence:[{sourceId:fresh.id,quote:fresh.body}]});
 C.syncIdeasChat();const msg=S.list('messages').find(m=>m.ideaAnalysis?.currentIdeaId==='projection-check');check('numbered list preserved in reminder',msg?.content.includes('\n1. '));
 S.put('messages',{...msg,content:'旧版提醒',ideaAnalysis:{...msg.ideaAnalysis,presentationVersion:2}});C.syncIdeasChat();const migrated=S.get('messages',msg.id);check('migration preserves ID and time',migrated.createdAt===msg.createdAt&&migrated.content.includes('\n1. '));
 C.syncIdeasChat();check('resync does not duplicate reminder',S.list('messages').filter(m=>m.ideaAnalysis?.currentIdeaId==='projection-check').length===1);
 if(!real){
  mode='limit';const bounded=await refresh();check('fifth search is refused',bounded.run.tools.some(t=>t.name==='search_idea_sources'&&t.output?.code==='research_limit'));
  mode='no-research';check('unresearched suggestion is rejected',(await refresh()).data.error==='idea_research_required');
  mode='forged';check('invented citation rejected',(await refresh()).data.error==='invalid_evidence');
  const saved=S.get('memories','research-older');mode='drift';check('source drift rejects late analysis',(await refresh()).data.error==='sources_changed');S.put('memories',saved);
  S.put('connections',{id:'readable',status:'connected',permissions:['read']});S.put('memories',{...saved,connectionId:'readable'});mode='revoke';check('revocation rejects late analysis',(await refresh()).data.error==='sources_changed');S.put('memories',saved);
 }
 check('no business task writes',S.hash(S.list('tasks'))===initialTasks);check('primary conversation unchanged',S.meta('primaryConversationId')==='primary');
 if(real){await writeFile(out+'/real-response.md',ideas.map(i=>i.description).join('\n\n'));check('real output includes actionable numbered points',ideas.some(i=>/(?:^|\n)\s*1[.、]/.test(i.description)))}
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}
const hashes=Object.fromEntries(await Promise.all(['server/src/agent.ts','server/src/ideas-background.ts','server/src/ideas-chat.ts','web/src/desktop/full/product.css'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
await writeFile(out+(real?'/real-model.json':'/http.json'),JSON.stringify({scope:real?'isolated synthetic sources with configured real model':'production HTTP/SDK/SQLite with controlled model',checks,runs,hashes},null,2));console.log(JSON.stringify({checks,calls}));
if(keep&&!process.exitCode){
 const assets=resolve(scope,'assets');await cp(resolve('native/mygo/assets'),assets,{recursive:true});const {fullAssets}=await import('./mygo-full-assets.mjs');await fullAssets(resolve('.'),assets);
 await writeFile(assets+'/narrow.html','<!doctype html><meta charset="utf-8"><title>CyberMe 390px 验收</title><iframe title="390px 对话" src="/" style="display:block;width:390px;height:844px;border:0;margin:20px auto"></iframe>');
 const preview=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:46742');if(url.pathname.startsWith('/api/')){const r=await fetch(`http://127.0.0.1:${port}`+url.pathname+url.search);res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});return res.end(Buffer.from(await r.arrayBuffer()))}const path=resolve(assets,'.'+decodeURIComponent(url.pathname==='/'?'/desktop.html':url.pathname));if(!path.startsWith(assets+'/')||await realpath(path)!==path)throw Error('path');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404);res.end('not found')}});preview.listen(46742,'127.0.0.1',()=>console.log('Public UI preview http://127.0.0.1:46742'));
}else{server.close();model?.close()}
