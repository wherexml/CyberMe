// Configured real model; synthetic isolated business data; never sends messages.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {serve} from '@hono/node-server';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {homedir} from 'node:os';
const scope=resolve('.local/acceptance/identity-time-real-'+randomUUID()),out=resolve('output/analysis-identity-time');
await mkdir(scope+'/people/team',{recursive:true,mode:0o700});await mkdir(out,{recursive:true});
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46864',OPSTWIN_WEB_PORT:'46864',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
// Optional memory-only relay to the installed app's configured model. Secrets never
// enter the isolated config, stdout or artifacts; only synthetic prompts cross it.
let relay;
if(process.argv.includes('--installed-model')){
 const {llm}=JSON.parse(await readFile(resolve(homedir(),'Library/Application Support/OpsTwins/.local/config.json'),'utf8'));
 const target=new URL(llm.baseUrl);
 process.env.OPSTWIN_PRIVATE_DIR=scope;
 await writeFile(scope+'/config.json',JSON.stringify({llm:{api:llm.api,model:llm.model,modelOptions:llm.modelOptions,baseUrl:'http://127.0.0.1:46865'+target.pathname,apiKey:'local-relay-placeholder'}}),{mode:0o600});
 relay=createServer(async(req,res)=>{try{
  const parts=[];for await(const part of req)parts.push(part);
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v&&!['host','content-length','connection','authorization','x-api-key'].includes(k))headers.set(k,String(v));
  headers.set('authorization','Bearer '+llm.apiKey);headers.set('x-api-key',llm.apiKey);
  const upstream=await fetch(target.origin+req.url,{method:'POST',headers,body:Buffer.concat(parts),signal:AbortSignal.timeout(120000)});
  console.log(JSON.stringify({relayStatus:upstream.status,path:new URL(target.origin+req.url).pathname}));
  if(!upstream.ok){const err=await upstream.clone().json().catch(()=>({}));console.log(JSON.stringify({providerError:err.error?.type||err.type,detail:String(err.error?.message||'').replaceAll(llm.apiKey,'[redacted]').slice(0,800)}));}
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json'});Readable.fromWeb(upstream.body).pipe(res);
 }catch{res.writeHead(502);res.end('{}')}});
 await new Promise(r=>relay.listen(46865,'127.0.0.1',r));
}
await writeFile(scope+'/people/TEMPLATE.md','## 基本信息');
await writeFile(scope+'/people/team/陈青.md','# 陈青\n\n> 资料更新时间：2026-11-06\n\n## 基本信息\n\n| 中文名 | 陈青 | 已确认 |\n| 当前角色 | 公开试点负责人 | 已确认 |\n| 与 Steve 的关系 | 直属员工 | 已确认 |');
const S=await import('../server/src/store.ts');S.setMeta('initialized',true);S.patchSettings({identity:{name:'许茂林',role:'管理者'},autonomy:{holdSending:true},knowledgePaths:[{id:'people-wiki',path:scope+'/people'}]});
const {app}=await import('../server/src/index.ts');const api=serve({fetch:app.fetch,port:46864,hostname:'127.0.0.1'}),checks=[],runs=[];
const at=h=>new Date(Date.now()-h*3600000).toISOString();
const message=(id,text,isMine,h=1)=>({id,text,isMine,senderName:isMine?'许茂林':'陈青',senderId:isMine?'self':'chen',sentAt:at(h)});
const cases=[
 {name:'delegation',messages:[message('assign','陈青，请把公开试点用真实场景跑通后交我验收。执行与文档由你负责。',true),message('ack','收到，我负责实施和文档，周五给你结果，当前不需要你补材料或做决定。',false,.5)],quiet:true},
 {name:'old-resolved',messages:[message('incident','公开试点三天前证书报错，请排查。',false,72),message('resolved','公开试点证书故障好了，已经复测恢复。',false,71),message('noise','收到今天的公开试点通知，谢谢。',false,.5)],quiet:true},
 {name:'new-decision',messages:[message('decision','陈青：公开试点遇到两个互斥方案，A 可今天上线但只覆盖十个账号，B 覆盖全部账号但需延后两天。请许茂林决定选 A 还是 B，我等你的选择后执行。',false,.5)],quiet:false}
];
try{
 for(const test of cases){
  for(const old of S.list('ideas'))S.remove('ideas',old.id);
  S.put('inbox',{id:'public-case',title:'公开试点',channel:'Email',origin:'human',status:'pending',messages:test.messages});
  const response=await fetch('http://127.0.0.1:46864/api/ideas/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'核对公开试点的责任、角色、时间和最新状态，记录人物进展。只有当前确需本人处理的新请求才提出建议。'}),signal:AbortSignal.timeout(180000)}),result=await response.json();
  const ideas=S.list('ideas').filter(i=>i.status==='new'),run=result.run?.id?S.get('runs',result.run.id):undefined;
  checks.push({name:test.name+' real generation succeeds',pass:response.ok});
  checks.push({name:test.name+' responsibility and time',pass:response.ok&&(test.quiet?ideas.length===0:ideas.some(i=>i.intent==='owner_request'&&i.evidence[0].messageId==='decision'))});
  runs.push({case:test.name,status:response.status,error:result.error,model:run?.model,researchCalls:run?.tools?.filter(t=>t.name==='search_idea_sources'&&t.status==='succeeded').length,ideas:ideas.map(i=>({title:i.title,description:i.description,intent:i.intent,evidence:i.evidence}))});
  console.log(JSON.stringify({case:test.name,status:response.status,ideas:ideas.length}));
 }
 checks.push({name:'real model persisted evidence-based person tracking',pass:S.list('memories').some(m=>m.kind==='person_tracking'&&m.observations.length>0)});
 checks.push({name:'no tasks or business execution',pass:S.list('tasks').length===0});
}catch(e){checks.push({name:String(e),pass:false})}
const hashes=Object.fromEntries(await Promise.all(['server/src/ideas-background.ts','server/src/analysis-context.ts','server/src/people-context.ts'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
await writeFile(out+'/real.json',JSON.stringify({scope:'configured real model, isolated synthetic data',checks,runs,hashes},null,2));console.log(JSON.stringify(checks));if(checks.some(c=>!c.pass))process.exitCode=1;api.close();relay?.close();
