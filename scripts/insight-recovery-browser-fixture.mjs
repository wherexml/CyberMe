// Isolated production HTTP/SQLite with synthetic sources and a controlled model. Never uses production credentials.
// Build: npx vite build --config web/mygo.vite.config.ts --outDir ../.local/insight-recovery-web
// Run: node --import tsx scripts/insight-recovery-browser-fixture.mjs
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
const scope=resolve('.local/acceptance/insight-recovery-browser-'+randomUUID()),assets=resolve('.local/insight-recovery-web'),port=46880,modelPort=46881;
await mkdir(scope,{recursive:true,mode:0o700});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_LISTEN:'1',OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off',OPSTWIN_API_PORT:String(port),OPSTWIN_WEB_PORT:String(port)});
await writeFile(scope+'/config.json',JSON.stringify({llm:{baseUrl:`http://127.0.0.1:${modelPort}/v1`,apiKey:'public-fixture-key',api:'openai-completions',model:'public-context'}}),{mode:0o600});
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'公开验收',language:'zh-CN'}});
S.put('conversations',{id:'main',title:'洞察动作验收'});S.setMeta('primaryConversationId','main');
S.put('conversations',{id:'side',title:'另一段对话',sideChat:true});
const title='主要瓶颈已从导入转向导出';
S.put('inbox',{id:'closed-chat',title:'公开进展',channel:'Email',origin:'human',status:'dismissed',messages:[{id:'progress',text:'导入失败率降至5%，导出仍为25%。',sentAt:new Date().toISOString(),isMine:false}]});
S.put('tasks',{id:'source-checklist',title:'发布前核对原始资料',notes:'公开来源全文：保留现有数据，核对重启恢复。'+('这部分是来源细节。'.repeat(60))+'来源末尾标记 SOURCE_END_6842。',status:'active'});
S.put('ideas',{id:'recommended',title,description:'先核对兼容性，再安排本机更新。\n\n'+('这条洞察的详细理由需要完整传给对话。'.repeat(22))+'\n\n洞察末尾标记 INSIGHT_END_9517。',status:'new',intent:'information',occurredAt:new Date(Date.now()-3600000).toISOString(),category:'insight',sourceIds:['closed-chat','source-checklist'],evidence:[{sourceId:'source-checklist',quote:'保留现有数据，核对重启恢复。'}],recommendation:{label:'整理兼容性核对清单',prompt:'整理发布前的兼容性核对清单，覆盖现有数据保留、草稿恢复和重启验证；先给我可审阅的方案。'}});
S.put('ideas',{id:'legacy',title:'交办进展：负责人正在验证',description:'没有推荐字段的旧记录，仍可携带完整内容进入对话。',category:'insight',intent:'delegation',status:'new',sourceIds:['closed-chat']});
// Public observations from a resolved source; neither one creates owner work.
S.db.prepare("DELETE FROM entities WHERE type='tasks'").run();
S.put('ideas',{...S.get('ideas','recommended'),description:'导入失败率从30%降至5%，导出仍为25%。主要瓶颈已经转移，团队将重点转向导出优化，由负责人继续推进。\n\n导入侧保持监测；这条变化不需要你新增待办。',recommendation:{label:'分析瓶颈变化',prompt:'分析试点瓶颈从导入转向导出的影响，以及后续值得关注的指标，不创建任务。'}});
S.put('ideas',{...S.get('ideas','legacy'),description:'负责人已接手场景验证，当前无需你补材料或做决定。交付结果仍待验证。'});
const calls=[],requests=[];
const model=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish] of [[{role:'assistant',content:'已收到这条洞察及完整来源。公开受控验收响应。'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'public',object:'chat.completion.chunk',created:1,model:'public-context',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');res.end('data: [DONE]\n\n');});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
const {app}=await import('../server/src/index.ts');const gate=new Hono();
gate.get('/__fixture/evidence',c=>c.json({calls,requests,tasks:S.list('tasks').length,messages:S.list('messages').length}));
gate.post('/api/chat',async c=>{const body=await c.req.json();requests.push(body);return app.fetch(new Request(c.req.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,readOnly:true})}));});
gate.all('/api/*',c=>app.fetch(c.req.raw));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
gate.get('*',async c=>{const path=resolve(assets,'.'+decodeURIComponent(c.req.path==='/'?'/cyberme.html':c.req.path));if(!path.startsWith(assets+'/'))return c.notFound();try{return new Response(await readFile(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream'}})}catch{return c.notFound()}});
serve({fetch:gate.fetch,hostname:'127.0.0.1',port});console.log(JSON.stringify({ready:true,url:`http://127.0.0.1:${port}/cyberme.html`}));
