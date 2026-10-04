// Read-only, synthetic visual data. Never a business/Agent/OS acceptance substitute.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const SELF=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(SELF),'..');
const args=process.argv.slice(2),isE2E=args.length===1&&args[0]==='--http-e2e';
if(!isE2E&&args.some(a=>a!=='--test-port=46246'&&!/^--qa-date=\d{4}-\d{2}-\d{2}$/.test(a)))throw Error('Only --test-port=46246 or --qa-date=YYYY-MM-DD allowed');
if(new Set(args.map(a=>a.split('=')[0])).size!==args.length)throw Error('Duplicate fixture option');
const qaDate=args.find(a=>a.startsWith('--qa-date='))?.slice(10)||new Date().toISOString().slice(0,10);
if(new Date(qaDate+'T00:00:00.000Z').toISOString().slice(0,10)!==qaDate)throw Error('Invalid QA date');
const port=args.includes('--test-port=46246')?46246:46193;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=qaDate+'T00:00:00.000Z', conversationId='ui-side-OPSADV-QA-VISUAL';
const conversations=[{id:conversationId,title:'验收会话',createdAt:stamp,updatedAt:stamp}];
const messages=[{id:'visual-user',conversationId,role:'user',content:'请整理今天的工作安排',createdAt:stamp},{id:'visual-assistant',conversationId,role:'assistant',content:'## 今天的工作安排\n\n先审阅收件箱，再处理需要你决策的事项\n\n- 核对来源与回复草稿\n- 查看任务的截止时间\n- 保留未完成事项供下次继续\n\n这是公开合成内容，仅用于界面比较',createdAt:stamp}];
const inbox=[{id:'inbox-OPSADV-QA-VISUAL',title:'今天的进度确认',sender:'验收联系人',senderId:'qa-contact',channel:'Internal',body:'请确认今天的工作进度，并说明下一步安排',messages:[{id:'visual-source',role:'other',isMine:false,type:'text',sentAt:Date.parse(stamp),senderName:'验收联系人',sender:'验收联系人',text:'请确认今天的工作进度，并说明下一步安排',content:'请确认今天的工作进度，并说明下一步安排',createdAt:stamp}],draft:'今天的安排已经整理好，我先核对进度，再同步下一步',status:'pending',sourceSystem:'opstwin',createdAt:stamp,updatedAt:stamp,eventAt:stamp,triage:{status:'succeeded',method:'jev',route:'quick_reply',needsReply:0.92,needsOwner:0.25,needsDeepThink:0.4,risk:0.1,reason:'需要明确进度和下一步安排'}}];
const tasks=[{id:'task-OPSADV-QA-VISUAL',title:'核对项目进度',notes:'检查来源并整理下一步工作安排',status:'active',dueDate:qaDate,createdAt:stamp,updatedAt:stamp}];
const ideas=[{id:'idea-OPSADV-QA-VISUAL',title:'整理每周进度摘要',description:'从已保存的工作记录整理每周进度，让需要决策的事项更容易审阅',status:'pending',category:'insight',createdAt:stamp,updatedAt:stamp}];
const settings={identity:{name:'验收用户',role:'产品使用者',language:'zh-CN',about:'公开合成资料',instructions:'回复保持简洁'},autonomy:{holdSending:false,levels:{ack:'draft',meet:'draft',docs:'draft',commit:'draft',boss:'draft',sensitive:'observe'},deepThink:['vip'],quietFrom:'23:00',quietUntil:'07:00',alerts:'urgent_digest',transparency:true}};
const noteId='memory-OPSADV-QA-VISUAL-LONG',noteStart='OPSADV-QA-VISUAL-NOTE-START',noteTail='OPSADV-QA-VISUAL-NOTE-END';
const noteHead='# 公开全文工作笔记\n\n'+noteStart+'\n公开格式 <em>公开文字</em> · 字面查询50% _literal\n';
const filler=Array.from({length:600},(_,i)=>'第'+String(i+1).padStart(3,'0')+'行：公开工作记录与来源核验，只含合成资料\n').join('');
const noteBody=(noteHead+filler).slice(0,9534-noteTail.length-1)+'\n'+noteTail;
if(noteBody.length!==9534)throw Error('Public note length contract');
const memories=[{id:noteId,title:'公开全文工作笔记',kind:'note',body:noteBody,createdAt:stamp,updatedAt:stamp}];
const longIdeaId='idea-OPSADV-QA-VISUAL-LONG',longIdeaTail='OPSADV-QA-VISUAL-IDEA-END';
const longIdeaDescription='OPSADV-QA-VISUAL-IDEA-START\n'+Array.from({length:12},(_,i)=>`第${i+1}段公开工作描述：来源资料只用于阅读与讨论，长描述在卡片中显示三行省略号，打开详情后必须保留全部文字和最后标记，不触发生成、忽略或外部发送。`).join('\n')+'\n'+longIdeaTail;
ideas.push({id:longIdeaId,title:'公开长描述显示验收',description:longIdeaDescription,status:'pending',category:'insight',contextIds:['memory:'+noteId],sourceIds:[],createdAt:stamp,updatedAt:stamp});
const publicModels={version:'synthetic-visual-readonly-1',standard:{providerId:'visual-public-provider',model:'visual-standard'},deep:{providerId:'visual-public-provider',model:'visual-deep'},providers:[{id:'visual-public-provider',name:'公开视觉供应商（不连接）',baseUrl:'https://example.invalid/visual-only',api:'openai-completions',enabled:true,configured:false,compatibility:{supportsStore:false,supportsUsageInStreaming:true},models:['visual-standard','visual-deep'],definitions:[{id:'visual-standard',smart:true,contextWindow:128000,maxTokens:4096,reasoning:false,vision:true},{id:'visual-deep',smart:false,contextWindow:64000,maxTokens:8192,reasoning:true,vision:false}]}]};
const bootstrap={revision:1,conversations,messages,inbox,tasks,ideas,settings,activities:[],artifacts:[],automations:[],connections:[],memories:memories.map(m=>({...m,body:m.body.slice(0,1200)})),projects:[],sources:[]};
const page=items=>({items,total:items.length,offset:0,limit:50,hasMore:false,nextOffset:items.length});
const WORKSPACE_KINDS=['messages','conversations','inbox','ideas','tasks','artifacts','projects','memories','automations','activities'];
const entities={messages,conversations,inbox,ideas,tasks,memories,artifacts:[],projects:[],automations:[],activities:[]};
const scalarFields=['title','name','sender','senderName','body','content','description','notes','prompt','summary','markdown','text','draft','detail'];
const plain=raw=>String(raw??'').replace(/<[^>]*>/g,' ').replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,m=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[m]||m)).replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
const bounded=(text,n)=>Array.from(text).slice(0,n).join('');
function searchText(item){return [...scalarFields.map(k=>typeof item[k]==='string'?item[k]:''),...['messages','steps'].flatMap(k=>(Array.isArray(item[k])?item[k]:[]).flatMap(row=>typeof row==='string'?[row]:['text','content','body','senderName','title','description','notes'].map(f=>typeof row[f]==='string'?row[f]:'')))].join('\n');}
function snippet(raw,terms){const text=plain(raw),fold=text.toLowerCase(),indexes=terms.map(t=>fold.indexOf(t.toLowerCase())).filter(n=>n>=0),hit=indexes.length?Math.min(...indexes):0,start=Math.max(0,hit-65),head=start?'…':'';return head+bounded(text.slice(start),220-head.length);}
function workspaceSearch(u){
 const fail=(code,status=400)=>({status,value:{error:code,message:'Public synthetic search parameter rejected'}});
 const pairs=[...u.searchParams],allowed=['q','kind','offset','limit','revision'];
 if(new Set(pairs.map(([k])=>k)).size!==pairs.length||pairs.some(([k])=>!allowed.includes(k)))return fail('invalid_search_params');
 const q=(u.searchParams.get('q')||'').trim(),terms=q.split(/\s+/u).filter(Boolean),kind=u.searchParams.get('kind')||'all';
 if(!q||Array.from(q).length>500||terms.length>16)return fail('invalid_search_query');
 if(kind!=='all'&&!WORKSPACE_KINDS.includes(kind))return fail('invalid_search_kind');
 const integer=(name,defaultValue,min,max=Number.MAX_SAFE_INTEGER)=>{const raw=u.searchParams.get(name);return raw===null?defaultValue:/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)>=min&&Number(raw)<=max?Number(raw):null;};
 const offset=integer('offset',0,0),limit=integer('limit',50,1,100),revision=integer('revision',1,0);
 if(offset===null||limit===null||revision===null)return fail('invalid_search_params');
 if(revision!==1)return {status:409,value:{error:'search_changed',message:'Synthetic fixture revision changed; restart search',detail:{revision:1}}};
 const rows=WORKSPACE_KINDS.flatMap(k=>(entities[k]||[]).filter(item=>!item.deleted&&!item.archivedAt).map(item=>({item,kind:k,text:searchText(item)}))).filter(row=>(kind==='all'||row.kind===kind)&&terms.every(term=>row.text.toLowerCase().includes(term.toLowerCase()))).sort((a,b)=>{const ta=a.item.createdAt||a.item.updatedAt||'',tb=b.item.createdAt||b.item.updatedAt||'';return tb.localeCompare(ta)||a.kind.localeCompare(b.kind)||a.item.id.localeCompare(b.item.id);});
 const items=rows.slice(offset,offset+limit).map(({item,kind,text})=>({id:item.id,kind,targetId:kind==='messages'?(item.conversationId||item.id):item.id,title:bounded(plain(item.title||item.name||item.sender||''),180),snippet:snippet(text,terms),time:item.createdAt||item.updatedAt||null})),hasMore=offset+items.length<rows.length;
 return {status:200,value:{items,total:rows.length,offset,limit,hasMore,nextOffset:hasMore?offset+items.length:null,revision:1}};
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1:'+port);let status=200,value;
 if(req.method!=='GET'){status=405;value={error:'visual_fixture_read_only'};}
 else if(u.pathname==='/api/native/version')value={apiVersion:1,revision:1,server:'SYNTHETIC-VISUAL-FIXTURE',features:['messages.page']};
 else if(u.pathname==='/api/health')value={ok:true,revision:1};
 else if(u.pathname==='/api/bootstrap')value=bootstrap;
 else if(u.pathname==='/api/workspace/search'){const result=workspaceSearch(u);status=result.status;value=result.value;}
 else if(u.pathname==='/api/memories')value=page(bootstrap.memories);
 else if(u.pathname==='/api/memories/'+noteId)value=memories[0];
 else if(u.pathname==='/__qa/fixture')value={kind:'SYNTHETIC_VISUAL_ONLY',port,qaDate,utcDateDefault:!args.some(a=>a.startsWith('--qa-date=')),noteId,noteLength:noteBody.length,noteSHA256:hash(noteBody),noteStart,noteTail,longIdeaId,longIdeaLength:longIdeaDescription.length,longIdeaSHA256:hash(longIdeaDescription),longIdeaTail,revision:1,modelProviderDefinitions:'SYNTHETIC_PUBLIC_CATALOG_UNCONFIGURED_NO_MODEL_SUCCESS'};
 else if(u.pathname==='/api/conversations/primary')value={conversationId,conversation:conversations[0]};
 else if(u.pathname==='/api/conversations')value=page(conversations);
 else if(u.pathname==='/api/conversations/'+conversationId)value=conversations[0];
 else if(u.pathname==='/api/messages/visual-user')value=messages[0];
 else if(u.pathname==='/api/messages/visual-assistant')value=messages[1];
 else if(u.pathname==='/api/conversations/'+conversationId+'/messages')value={items:messages,hasMore:false,nextBefore:null};
 else if(u.pathname==='/api/chat/conversations/state')value={items:(u.searchParams.get('ids')||'').split(',').map(id=>({id,found:id===conversationId,running:false,partial:false,pending:0,locked:id!==conversationId}))};
 else if(u.pathname===`/api/chat/conversations/${conversationId}/unresolved`)value={conversationId,revision:1,total:0,partialCount:0,items:[],hasMore:false,nextBefore:null};
 else if(u.pathname.startsWith('/api/chat/continuation/'))value={running:false,items:[]};
 else if(u.pathname==='/api/inbox/query')value={...page(inbox),unknownTimeCount:0};
 else if(u.pathname==='/api/inbox/'+inbox[0].id)value=inbox[0];
 else if(u.pathname==='/api/tasks')value=page(tasks);
 else if(u.pathname==='/api/tasks/'+tasks[0].id)value=tasks[0];
 else if(u.pathname==='/api/ideas')value=page(ideas);
 else if(ideas.some(idea=>u.pathname==='/api/ideas/'+idea.id))value=ideas.find(idea=>u.pathname==='/api/ideas/'+idea.id);
 else if(u.pathname==='/api/settings')value=settings;
 else if(u.pathname==='/api/settings/models')value=publicModels;
 else if(u.pathname==='/api/artifacts')value=page([]);
 else if(u.pathname==='/__qa/data')value=bootstrap;
 else {status=404;value={error:'not_found'};}
 res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));
});
if(!isE2E){server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'SYNTHETIC_VISUAL_READY',port,pid:process.pid,qaDate,noteId})));process.once('SIGTERM',()=>{server.close();server.closeAllConnections();});}else await httpE2E();

// Complete process HTTP fixture acceptance, not units or production/GUI certification.
async function httpE2E(){
 const listeners=n=>{try{return [...new Set(execFileSync('/usr/sbin/lsof',['-nP',`-iTCP:${n}`,'-sTCP:LISTEN','-Fp'],{encoding:'utf8'}).split('\n').filter(x=>/^p\d+$/.test(x)).map(x=>Number(x.slice(1))))];}catch(error){if(error.status===1)return[];throw error;}};
 if(listeners(46246).length)throw Error('Visual test port46246 busy');
 const at=new Date().toISOString(),out=path.join(ROOT,'output/native-parity-20261003/visual-fixture-search-repair/http-e2e',at.replaceAll(':','-'));
 fs.mkdirSync(out,{recursive:true});
 const checks=[],children=[],existingBefore=listeners(46193),report={schema:1,at,kind:'FULL_PROCESS_SYNTHETIC_VISUAL_HTTP_NOT_GUI_OR_BUSINESS',checks,sourceBefore:hash(fs.readFileSync(SELF)),existing46193Before:existingBefore,modelCalls:0,GUI:'NOT_RUN',productionWrites:0};
 const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 const check=(name,pass,metadata={})=>{checks.push({name,status:pass?'PASS':'FAIL',at:new Date().toISOString(),...metadata});save();if(!pass)throw Error(name);};
 function child(argv){const proc=spawn(process.execPath,[SELF,...argv],{cwd:ROOT,stdio:['ignore','pipe','pipe']});const row={pid:proc.pid,exited:false};let stdout='',stderr='';proc.stdout.on('data',chunk=>stdout+=chunk);proc.stderr.on('data',chunk=>stderr+=chunk);const done=new Promise(resolve=>proc.once('exit',(code,signal)=>{Object.assign(row,{exited:true,code,signal,stdoutSHA256:hash(stdout),stderrSHA256:hash(stderr)});resolve();}));const c={proc,row,done};children.push(c);return c;}
 async function waitFor(fn){const t=Date.now();while(!fn()){if(Date.now()-t>10000)throw Error('Test process ready timeout');await new Promise(resolve=>setTimeout(resolve,50));}}
 async function get(route,options={}){const response=await fetch('http://127.0.0.1:46246'+route,{...options,signal:AbortSignal.timeout(5000),redirect:'manual'});const raw=Buffer.from(await response.arrayBuffer());let value;try{value=JSON.parse(raw);}catch{value=null;}const projected={status:response.status,bytes:raw.length,sha256:hash(raw),value};raw.fill(0);return projected;}
 const query=(q,extra={})=>'/api/workspace/search?'+new URLSearchParams({q,kind:'all',offset:'0',limit:'50',...extra});
 try{
  for(const argv of [['--test-port=9999'],['--test-port=46193'],['--qa-date=2026-02-31'],['--test-port=46246','--test-port=46246']]){const bad=child(argv);await bad.done;check('unsafe port/date/duplicate option rejects before listen: '+argv.join(' '),bad.row.code!==0&&!listeners(46246).length);}
  const own=child(['--test-port=46246','--qa-date='+qaDate]);await waitFor(()=>listeners(46246).includes(own.proc.pid));
  const qa=(await get('/__qa/fixture')).value,boot=await get('/api/bootstrap');
  check('owned46246 synthetic server actual process ready',qa.kind==='SYNTHETIC_VISUAL_ONLY'&&qa.port===46246,{pid:own.proc.pid});
  check('explicit UTC QA date and task dueDate reproducible',qa.qaDate===qaDate&&boot.value.tasks[0].dueDate===qaDate,{qaDate});
  check('bootstrap note is truncated1200 not fake full detail',boot.value.memories[0].body.length===1200&&!boot.value.memories[0].body.includes(qa.noteTail));
  const detail=await get('/api/memories/'+qa.noteId);check('exact public note GET length9534/firstlast/SHA',detail.status===200&&detail.value.body.length===9534&&detail.value.body.includes(qa.noteStart)&&detail.value.body.endsWith(qa.noteTail)&&hash(detail.value.body)===qa.noteSHA256,{id:qa.noteId,characters:detail.value.body.length,bodySHA256:hash(detail.value.body)});
  const tail=await get(query(qa.noteTail));check('nonempty tail search hits exact memory with visible tail snippet',tail.status===200&&tail.value.total===1&&tail.value.items[0].id===qa.noteId&&tail.value.items[0].kind==='memories'&&tail.value.items[0].targetId===qa.noteId&&tail.value.items[0].snippet.includes(qa.noteTail),{searchSHA256:tail.sha256,total:tail.value.total});
  const results=await get(query('工作'));const required=['id','kind','targetId','title','snippet','time'].sort().join('|');
  check('formal bounded DTO fields/pagination/revision',results.status===200&&results.value.limit===50&&results.value.offset===0&&results.value.revision===1&&results.value.items.every(item=>Object.keys(item).sort().join('|')===required&&Array.from(item.snippet).length<=220&&Array.from(item.title).length<=180&&!/[<>]/.test(item.snippet))&&results.value.hasMore===false&&results.value.nextOffset===null,{count:results.value.total,kinds:[...new Set(results.value.items.map(x=>x.kind))]});
  check('same query includes tasks/ideas/memories distinct kind owners',['tasks','ideas','memories'].every(k=>results.value.items.some(row=>row.kind===k)));
  for(const kind of ['tasks','ideas','memories']){const page=await get(query('工作',{kind}));check('exact kind filter '+kind,page.status===200&&page.value.total>0&&page.value.items.every(row=>row.kind===kind));for(const row of page.value.items){const full=await get('/api/'+kind+'/'+row.targetId);check('search result exact detail exists '+row.id,full.status===200&&full.value.id===row.id,{id:row.id,kind,bytes:full.bytes,sha256:full.sha256});}}
  const first=await get(query('工作',{limit:'1'})),second=await get(query('工作',{limit:'1',offset:'1',revision:String(first.value.revision)}));
  check('stable offset pagination/no duplicate nextOffset',first.value.items.length===1&&first.value.hasMore&&first.value.nextOffset===1&&second.value.items.length===1&&second.value.items[0].id!==first.value.items[0].id&&second.value.total===first.value.total);
  check('out of range empty page honest total', (await get(query('工作',{offset:'999'}))).value.items.length===0);
  for(const [q,expected] of [['50%',1],['_literal',1],['50% _literal',1],['50% does-not-exist',0]]){const result=await get(query(q));check('AND literal percent/underscore public query '+q,result.status===200&&result.value.total===expected);}
  const onlyPlain=await get(query('公开文字'));check('snippet strips markup without returning fullbody',onlyPlain.value.items.every(row=>!row.snippet.includes('<em>')&&!('body'in row)));
  const long=await get('/api/ideas/'+qa.longIdeaId);check('long Idea exact full description end marker preserves fields',long.status===200&&long.value.description.length>500&&long.value.description.endsWith(qa.longIdeaTail)&&hash(long.value.description)===qa.longIdeaSHA256,{id:qa.longIdeaId,characters:long.value.description.length,descriptionSHA256:hash(long.value.description)});
  const catalog=(await get('/api/settings/models')).value;check('public unconfigured provider definitions formal projection',typeof catalog.version==='string'&&catalog.providers.length===1&&catalog.providers[0].configured===false&&catalog.providers[0].definitions.length===2&&catalog.providers[0].definitions.every(d=>typeof d.smart==='boolean'&&Number.isInteger(d.contextWindow)&&Number.isInteger(d.maxTokens)&&typeof d.reasoning==='boolean'&&typeof d.vision==='boolean')&&catalog.standard.providerId===catalog.providers[0].id&&catalog.deep.providerId===catalog.providers[0].id&&!JSON.stringify(catalog).includes('apiKey'),{configured:false,providerCount:1,definitionCount:2,upstreamCalls:0});
  const message=await get(query('工作',{kind:'messages'}));check('message search targetId is public conversation',message.status===200&&message.value.items.length>0&&message.value.items.every(x=>x.targetId===conversationId));
  for(const [params,status] of [[{q:''},400],[{q:'x'.repeat(501)},400],[{q:Array.from({length:17},(_,i)=>'word'+i).join(' ')},400],[{kind:'settings'},400],[{limit:'101'},400],[{offset:'-1'},400],[{limit:'1.2'},400],[{revision:'0'},409],[{revision:'invalid'},400]])check('formal invalid search parameters reject '+Object.keys(params).join(','),(await get(query('工作',params))).status===status);
  check('unknown query field rejected400',(await get(query('工作')+'&unknown=true')).status===400);
  check('duplicate query field rejected400',(await get(query('工作')+'&q=other')).status===400);
  check('unknown exact memory404',(await get('/api/memories/unknown-OPSADV-QA')).status===404);
  check('unknown conversation messages404 not broad endswith fallback',(await get('/api/conversations/unknown-OPSADV-QA/messages')).status===404);
  for(const method of ['POST','PATCH','DELETE'])for(const route of ['/api/workspace/search','/api/memories/'+qa.noteId,'/api/settings/models/test'])check('all fixture saves/tests reject405 '+method+' '+route,(await get(route,{method,body:'OPSADV-QA-NO-SAVE'})).status===405);
  check('repeated GET hash stable and bootstrap not mutated',(await get('/api/memories/'+qa.noteId)).sha256===detail.sha256&&(await get('/api/bootstrap')).sha256===boot.sha256);
  report.fixtureProjection={qaDate,noteId:qa.noteId,noteCharacters:9534,noteSHA256:qa.noteSHA256,longIdeaId:qa.longIdeaId,longIdeaCharacters:qa.longIdeaLength,longIdeaSHA256:qa.longIdeaSHA256,providerConfigured:false,kindCounts:Object.fromEntries(WORKSPACE_KINDS.map(k=>[k,entities[k].length]))};
  own.proc.kill('SIGTERM');await own.done;
  check('explicit date owned fixture normal exit before default-date restart',own.row.code===0&&!listeners(46246).length);
  const utcBefore=new Date().toISOString().slice(0,10),defaultOwn=child(['--test-port=46246']);await waitFor(()=>listeners(46246).includes(defaultOwn.proc.pid));
  const defaultQA=(await get('/__qa/fixture')).value,defaultBoot=(await get('/api/bootstrap')).value,utcAfter=new Date().toISOString().slice(0,10);
  check('no QA override uses current UTC date actual process',defaultQA.utcDateDefault===true&&[utcBefore,utcAfter].includes(defaultQA.qaDate)&&defaultBoot.tasks[0].dueDate===defaultQA.qaDate,{qaDate:defaultQA.qaDate});
  report.status='PASS_SYNTHETIC_VISUAL_HTTP_GUI_NOT_RUN';
 }catch(error){report.status='FAIL_SYNTHETIC_VISUAL_HTTP';report.error=String(error.message);process.exitCode=1;}
 finally{for(const c of children.reverse())if(!c.row.exited){c.proc.kill('SIGTERM');await c.done;}report.children=children.map(c=>c.row);report.existing46193After=listeners(46193);report.existing46193PIDUnchanged=JSON.stringify(report.existing46193Before)===JSON.stringify(report.existing46193After);report.testPortFreeAfter=!listeners(46246).length;report.sourceAfter=hash(fs.readFileSync(SELF));report.pass=checks.filter(c=>c.status==='PASS').length;report.fail=checks.filter(c=>c.status==='FAIL').length;save();const files=fs.readdirSync(out).filter(n=>n!=='manifest.json').map(n=>{const file=path.join(out,n),b=fs.readFileSync(file);return{path:path.relative(ROOT,file),bytes:b.length,sha256:hash(b)};});fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({at:new Date().toISOString(),status:report.status,pass:report.pass,fail:report.fail,GUI:'NOT_RUN',production:false,existing46193PIDUnchanged:report.existing46193PIDUnchanged,testPortFreeAfter:report.testPortFreeAfter,sourceStable:report.sourceBefore===report.sourceAfter,sourceSHA256:report.sourceAfter,files},null,2)+'\n');console.log(JSON.stringify({status:report.status,pass:report.pass,fail:report.fail,manifest:path.relative(ROOT,path.join(out,'manifest.json')),existing46193PIDUnchanged:report.existing46193PIDUnchanged,testPortFreeAfter:report.testPortFreeAfter}));}
}
