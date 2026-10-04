// Project only the qualified synthetic visual fixture into an unmodified design copy.
// No production/default endpoint, credentials, model call or design CSS/JS rewrite.
import {readFile,writeFile,mkdir,lstat,realpath,rename,rm} from 'node:fs/promises';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import vm from 'node:vm';
import http from 'node:http';
const SELF=fileURLToPath(import.meta.url),ROOT=resolve(dirname(SELF),'..');
const DESIGN=join(ROOT,'docs/design'),OUTPUT=join(ROOT,'output/native-parity-20261003');
const STATIC_ORIGIN='http://127.0.0.1:46248';
const hash=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const equal=(a,b)=>stable(a)===stable(b);
const fail=code=>{throw new Error(code);};
const noteId='memory-OPSADV-QA-VISUAL-LONG',ideaId='idea-OPSADV-QA-VISUAL-LONG',providerId='visual-public-provider',cid='ui-side-OPSADV-QA-VISUAL';
const noteTail='OPSADV-QA-VISUAL-NOTE-END',ideaTail='OPSADV-QA-VISUAL-IDEA-END';
async function nonlink(path,missing=false){
 const parts=relative(ROOT,path).split(sep);if(parts.includes('..')||relative(ROOT,path).startsWith('..')||path===ROOT)fail('invalid_reference_path');
 let at=ROOT;const rootStat=await lstat(ROOT);if(rootStat.isSymbolicLink()||await realpath(ROOT)!==ROOT)fail('unsafe_reference_root');
 for(const part of parts){at=join(at,part);let st;try{st=await lstat(at);}catch(e){if(e.code==='ENOENT'&&missing)return;if(e.code==='ENOENT')fail('reference_path_missing');throw e;}
  if(st.isSymbolicLink())fail('reference_symlink_rejected');if(st.uid!==process.getuid())fail('reference_owner_rejected');
 }
}
function outputPath(raw){
 const out=resolve(ROOT,raw),rel=relative(OUTPUT,out);
 if(!rel||rel.startsWith('..')||!/^reference-projection(?:-repair)?(?:[/-][A-Za-z0-9_.-]+)+$/.test(rel.replaceAll(sep,'/')))fail('invalid_reference_output');
 return out;
}
async function getJSON(base,route,ledger,max=2*1024*1024){
 const response=await fetch(base+route,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000)});
 if(response.status!==200||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('reference_http_rejected');
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>max){await response.body.cancel().catch(()=>{});fail('reference_response_too_large');}chunks.push(chunk);}
 const raw=Buffer.concat(chunks);let value;try{value=JSON.parse(raw.toString('utf8'));}catch{fail('reference_invalid_json');}
 ledger.push({route,status:response.status,bytes,sha256:hash(raw),at:new Date().toISOString()});return value;
}
function publicData(value){
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  if(/^(?:api.?key|authorization|password|secret|credentials?|access.?token|refresh.?token|passphrase|private.?key)$/i.test(key))fail('reference_private_field_rejected');
  publicData(item);
 }
}
function fixtureMeta(meta,port){
 if(meta.kind!=='SYNTHETIC_VISUAL_ONLY'||meta.port!==port||meta.revision!==1||meta.noteId!==noteId||meta.longIdeaId!==ideaId||meta.noteLength!==9534||meta.noteTail!==noteTail||meta.longIdeaTail!==ideaTail||meta.modelProviderDefinitions!=='SYNTHETIC_PUBLIC_CATALOG_UNCONFIGURED_NO_MODEL_SUCCESS')fail('unqualified_visual_fixture');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(meta.qaDate)||new Date(meta.qaDate+'T00:00:00.000Z').toISOString().slice(0,10)!==meta.qaDate||!/[a-f0-9]{64}/.test(meta.noteSHA256)||!/[a-f0-9]{64}/.test(meta.longIdeaSHA256))fail('invalid_visual_fixture_metadata');
}
function validateBootstrap(boot,meta){
 if(boot.revision!==meta.revision||!boot.settings||!boot.settings.identity)fail('invalid_reference_bootstrap');
 const groups=['conversations','messages','inbox','tasks','ideas','activities','artifacts','automations','connections','memories','projects','sources'];
 const approved=new Set([cid,'visual-user','visual-assistant','inbox-OPSADV-QA-VISUAL','task-OPSADV-QA-VISUAL','idea-OPSADV-QA-VISUAL',ideaId,noteId]);
 for(const key of groups){if(!Array.isArray(boot[key])||boot[key].length>10)fail('invalid_reference_public_collection');
  for(const item of boot[key]){if(!approved.has(item.id))fail('nonpublic_reference_record');for(const field of ['createdAt','updatedAt','eventAt'])if(item[field]&&!String(item[field]).startsWith(meta.qaDate+'T'))fail('reference_date_mismatch');}
 }
 if(boot.conversations.length!==1||boot.conversations[0].id!==cid||boot.messages.length!==2||boot.messages.some(x=>x.conversationId!==cid)||boot.inbox.length!==1||boot.tasks.length!==1||boot.tasks[0].dueDate!==meta.qaDate||boot.memories.length!==1||boot.memories[0].id!==noteId||boot.ideas.length!==2)fail('reference_identity_mismatch');
 publicData(boot);
}
function validateModels(models){
 publicData(models);
 if(models.version!=='synthetic-visual-readonly-1'||!Array.isArray(models.providers)||models.providers.length!==1||models.standard?.providerId!==providerId||models.deep?.providerId!==providerId)fail('invalid_public_model_catalog');
 const p=models.providers[0];
 if(p.id!==providerId||p.configured!==false||p.baseUrl!=='https://example.invalid/visual-only'||p.api!=='openai-completions'||!Array.isArray(p.definitions)||p.definitions.length!==2||!equal(p.models,['visual-standard','visual-deep'])||models.standard.model!=='visual-standard'||models.deep.model!=='visual-deep')fail('invalid_public_provider');
 for(const d of p.definitions)if(!p.models.includes(d.id)||!Number.isInteger(d.contextWindow)||!Number.isInteger(d.maxTokens)||typeof d.smart!=='boolean'||typeof d.reasoning!=='boolean'||typeof d.vision!=='boolean')fail('invalid_public_model_definition');
}
async function designInputs(){
 const source=await readFile(join(DESIGN,'macos-ui-study.html'),'utf8'),assets=[];
 for(const m of source.matchAll(/(?:href|src)="([^"\n]+)"/g)){
  const url=m[1];if(url.startsWith('#')||/^(https?:|data:)/.test(url)||url.startsWith('../../.local/design/'))continue;
  const path=resolve(DESIGN,url);if(!path.startsWith(DESIGN+sep))fail('design_asset_outside_contract');
  await nonlink(path);const bytes=await readFile(path);assets.push({path:relative(ROOT,path),sha256:hash(bytes),bytes:bytes.length});
 }
 // These dynamic original JS artwork paths are exact public contract assets, not a directory export.
 const images=['wechat','google-calendar','gmail','feishu','opstwins'].map(x=>'assets/'+x+'.svg');
 const icons=['privacy','insight','briefing','automation','workflow','report','finance','meeting','followup','reminder','files','research'].map(x=>'assets/idea-icons/'+x+'.svg');
 for(const url of [...images,...icons]){const path=join(DESIGN,url);await nonlink(path);const bytes=await readFile(path);assets.push({path:relative(ROOT,path),sha256:hash(bytes),bytes:bytes.length});}
 const unique=[...new Map(assets.map(a=>[a.path,a])).values()];
 return{source,assets:unique,sha256:hash(source)};
}
const storageScript='<script>const qaLocal=new Map(),qaSession=new Map();for(const [name,map] of [["localStorage",qaLocal],["sessionStorage",qaSession]])Object.defineProperty(window,name,{value:{getItem:key=>map.has(String(key))?map.get(String(key)):null,setItem:(key,value)=>map.set(String(key),String(value)),removeItem:key=>map.delete(String(key)),clear:()=>map.clear(),key:index=>[...map.keys()][index]??null,get length(){return map.size}}});</script>';
function htmlCopy(source){
 return source.replace(/(?:href|src)="([^"\n]+)"/g,(m,url)=>{
  if(url==='../../.local/design/macos-study-data.js')return 'src="visual-data.js"';
  if(url==='../../.local/design/chat-capability.js')return 'src="data:text/javascript,void%200"';
  if(url.startsWith('#')||/^(https?:|data:)/.test(url))return m;
  return m.replace(url,STATIC_ORIGIN+'/design/'+url.split('/').map(encodeURIComponent).join('/'));
 }).replace('<body>','<body>'+storageScript);
}
async function project(port,out){
 if(![46246,46247].includes(port))fail('reference_port_rejected');
 await nonlink(out,true);try{await lstat(out);fail('reference_output_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const inputBefore=await designInputs(),fixtureSourceBefore=hash(await readFile(join(ROOT,'scripts/native-product-visual-fixture.mjs'))),ledger=[],api='http://127.0.0.1:'+port;
 const meta=await getJSON(api,'/__qa/fixture',ledger,65536);fixtureMeta(meta,port);
 const boot=await getJSON(api,'/api/bootstrap',ledger);validateBootstrap(boot,meta);
 const [note,idea,models,primary,settings]=await Promise.all([
  getJSON(api,'/api/memories/'+encodeURIComponent(noteId),ledger),getJSON(api,'/api/ideas/'+encodeURIComponent(ideaId),ledger),
  getJSON(api,'/api/settings/models',ledger,65536),getJSON(api,'/api/conversations/primary',ledger,65536),getJSON(api,'/api/settings',ledger,65536)]);
 if(note.id!==noteId||typeof note.body!=='string'||note.body.length!==9534||!note.body.endsWith(noteTail)||hash(note.body)!==meta.noteSHA256||!equal({...note,body:note.body.slice(0,1200)},boot.memories[0]))fail('reference_fullmemory_mismatch');
 if(idea.id!==ideaId||typeof idea.description!=='string'||idea.description.length!==meta.longIdeaLength||!idea.description.endsWith(ideaTail)||hash(idea.description)!==meta.longIdeaSHA256||!equal(idea,boot.ideas.find(x=>x.id===ideaId)))fail('reference_longidea_mismatch');
 if(primary.conversationId!==cid||!equal(primary.conversation,boot.conversations[0])||!equal(settings,boot.settings))fail('reference_primary_settings_mismatch');
 validateModels(models);publicData(note);publicData(idea);
 const tailSearch=await getJSON(api,'/api/workspace/search?'+new URLSearchParams({q:noteTail,kind:'memories',offset:'0',limit:'50',revision:String(meta.revision)}),ledger,65536);
 if(tailSearch.revision!==meta.revision||tailSearch.total!==1||tailSearch.items?.length!==1||tailSearch.items[0].id!==noteId||tailSearch.items[0].targetId!==noteId||!tailSearch.items[0].snippet.includes(noteTail))fail('reference_native_search_mismatch');
 const metaAfter=await getJSON(api,'/__qa/fixture',ledger,65536),bootAfter=await getJSON(api,'/api/bootstrap',ledger);
 const modelsAfter=await getJSON(api,'/api/settings/models',ledger,65536);
 if(!equal(meta,metaAfter)||!equal(boot,bootAfter)||!equal(models,modelsAfter))fail('reference_source_changed');
 const inputAfter=await designInputs();if(!equal(inputBefore,inputAfter)||fixtureSourceBefore!==hash(await readFile(join(ROOT,'scripts/native-product-visual-fixture.mjs'))))fail('reference_inputs_changed');
 const fixture=structuredClone(boot);fixture.memories=[note];fixture.ideas=fixture.ideas.map(x=>x.id===ideaId?idea:x);
 Object.assign(fixture,{histories:{},primaryConversationId:primary.conversationId,capturedAt:meta.qaDate+'T00:00:00.000Z',models});
 // HTML's existing snapshot schema requires a surfacing flag; only the explicit public pending item is projected.
 // Preserve the synthetic Jev probabilities as served instead of fabricating another assessment.
 fixture.inbox=fixture.inbox.map(item=>({...item,attention:item.status==='pending'&&!!item.draft&&item.triage?.status==='succeeded'&&item.triage.needsReply>0.5}));
 const data='window.OPSTWINS_DESIGN_DATA='+JSON.stringify(fixture).replace(/</g,'\\u003c')+';\n',html=htmlCopy(inputBefore.source);
 const manifest={schema:2,kind:'SYNTHETIC-VISUAL-REFERENCE-DATA-PREREQUISITE-ONLY',createdAt:new Date().toISOString(),capturedAt:fixture.capturedAt,qaDate:meta.qaDate,source:'docs/design/macos-ui-study.html',sourceSha256:inputBefore.sha256,originalDesignAssets:inputBefore.assets,fixtureSource:'scripts/native-product-visual-fixture.mjs',fixtureSourceSHA256:fixtureSourceBefore,api,requests:ledger,publicProjection:{revision:meta.revision,primaryConversationId:cid,note:{id:noteId,characters:9534,sha256:meta.noteSHA256,tail:noteTail},longIdea:{id:ideaId,characters:idea.description.length,sha256:meta.longIdeaSHA256,contextIds:idea.contextIds,sourceIds:idea.sourceIds,tail:ideaTail},models:{version:models.version,providerId,configured:false,providerCount:1,definitionCount:2,catalogSHA256:hash(stable(models))},kindCounts:Object.fromEntries(Object.entries(fixture).filter(([_k,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))},generated:[{name:'reference.html',sha256:hash(html),bytes:Buffer.byteLength(html)},{name:'visual-data.js',sha256:hash(data),bytes:Buffer.byteLength(data)}],staticResources:{origin:STATIC_ORIGIN,referenceURL:STATIC_ORIGIN+'/reference.html',routes:[...inputBefore.assets.map(x=>({route:'/design/'+relative(DESIGN,join(ROOT,x.path)).split(sep).map(encodeURIComponent).join('/'),path:x.path,sha256:x.sha256,bytes:x.bytes})),{route:'/reference.html',path:relative(ROOT,join(out,'reference.html')),sha256:hash(html),bytes:Buffer.byteLength(html)},{route:'/visual-data.js',path:relative(ROOT,join(out,'visual-data.js')),sha256:hash(data),bytes:Buffer.byteLength(data)}],rule:'GET exact listed routes only; decode/reject encoded slash, query, traversal; no directory, privatefile, capability or API exposure; verify bytes SHA before serving'},sourceStyleOrScriptEdits:0,modelCalls:0,businessWrites:0,GUI:'NOT_RUN',scores:null,limitations:['Original HTML local Search uses160char snippets and includes complete projected fields; native formal Search uses220char serverDTO. Do not forge CSS/JS to erase semantics.','New supplier form and225continuous Settings contract are newer direct native requirements, not equivalent to old HTML role page. Use direct contract independent metrics.','Shared Date.now rendering remains real; capturedAt/task/source dates derive from this actual public fixture qaDate.','Storage is isolated RAM only; original chat-capability bridge replaced by void in this generated copy. No model/action success is synthesized.']};
 await nonlink(out,true);await mkdir(dirname(out),{recursive:true});await nonlink(dirname(out));
 // New-only exact destination; no overwriting any original reference or previous generated run.
 await mkdir(out);await nonlink(out);try{
  await writeFile(join(out,'visual-data.js'),data,{flag:'wx'});await writeFile(join(out,'reference.html'),html,{flag:'wx'});
  await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 }catch(e){throw new Error('reference_output_incomplete');}
 return{out,manifest,fixture};
}
function options(argv){
 if(argv.length===1&&argv[0]==='--http-e2e')return{e2e:true};
 if(!argv.length||argv.some(a=>!/^--fixture-port=(46246|46247)$/.test(a)&&!a.startsWith('--output='))||new Set(argv.map(a=>a.split('=')[0])).size!==argv.length)fail('invalid_reference_options');
 const portArg=argv.find(a=>a.startsWith('--fixture-port='));if(!portArg)fail('explicit_fixture_port_required');
 const raw=argv.find(a=>a.startsWith('--output='))?.slice(9)||'output/native-parity-20261003/reference-projection/generated-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
 return{port:Number(portArg.slice(15)),out:outputPath(raw)};
}
const opts=options(process.argv.slice(2));
if(opts.e2e)await httpE2E();else{
 try{const result=await project(opts.port,opts.out);console.log(JSON.stringify({kind:result.manifest.kind,html:relative(ROOT,join(result.out,'reference.html')),manifest:relative(ROOT,join(result.out,'manifest.json')),referenceURL:result.manifest.staticResources.referenceURL,noteCharacters:9534,modelCalls:0,GUI:'NOT_RUN'}));}
 catch(error){console.error(String(error.message));process.exitCode=1;}
}
async function httpE2E(){
 const listeners=port=>{try{return execFileSync('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-Fp'],{encoding:'utf8'}).split('\n').filter(x=>/^p\d+$/.test(x)).map(x=>Number(x.slice(1)));}catch(e){if(e.status===1)return[];throw e;}};
 if(listeners(46247).length)fail('reference_test_port_busy');
 const at=new Date().toISOString(),out=join(OUTPUT,'reference-projection-repair/http-e2e',at.replaceAll(':','-'));
 await nonlink(out,true);await mkdir(out,{recursive:true});await nonlink(out);
 const beforeDesign=await designInputs(),beforeFixture=await readFile(join(ROOT,'scripts/native-product-visual-fixture.mjs'));
 const existingPorts={46193:listeners(46193),46246:listeners(46246)};
 const source=beforeFixture.toString(),copy=source.replaceAll('46246','46247').replace("ROOT=path.resolve(path.dirname(SELF),'..')",'ROOT='+JSON.stringify(ROOT));
 const transport=join(out,'fixture-port-only.mjs');await writeFile(transport,copy,{flag:'wx'});
 let staticServer=null;const children=[],checks=[],report={schema:1,at,scope:'FULL_PROCESS_PUBLIC_REFERENCE_PROJECTION_HTTP_NOT_GUI',checks,sourceSHA256:hash(await readFile(SELF)),fixtureSourceSHA256:hash(beforeFixture),ownedPortCopySHA256:hash(copy),transportChanges:['46246→46247 only test-port identifiers; all public data/GET/search handlers unchanged','ROOT constant same project path because copied source is in output'],existingPorts,GUI:'NOT_RUN',modelCalls:0,businessWrites:0,scores:null};
 const save=async()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 const check=async(name,pass,meta={})=>{checks.push({name,status:pass?'PASS':'FAIL',at:new Date().toISOString(),...meta});await save();if(!pass)fail(name);};
 function child(file,args){const proc=spawn(process.execPath,[file,...args],{cwd:ROOT,stdio:['ignore','pipe','pipe']});const row={pid:proc.pid,args,code:null};let stdout='',stderr='';proc.stdout.on('data',c=>stdout+=c);proc.stderr.on('data',c=>stderr+=c);const done=new Promise(res=>proc.once('exit',(code,signal)=>{Object.assign(row,{code,signal,stdoutSHA256:hash(stdout),stderrSHA256:hash(stderr)});res();}));const c={proc,row,done};children.push(c);return c;}
 const wait=async(fn)=>{const start=Date.now();while(!fn()){if(Date.now()-start>10000)fail('reference_test_ready_timeout');await new Promise(r=>setTimeout(r,50));}};
 try{
  const own=child(transport,['--test-port=46247','--qa-date='+new Date().toISOString().slice(0,10)]);await wait(()=>listeners(46247).includes(own.proc.pid));
  await check('own frozen public fixture with port-only transport copy actual ready',true,{pid:own.proc.pid});
  const dest=join(out,'generated'),run=child(SELF,['--fixture-port=46247','--output='+relative(ROOT,dest)]);await run.done;
  await check('generator full subprocess exits0',run.row.code===0);
  const manifest=JSON.parse(await readFile(join(dest,'manifest.json'),'utf8'));
  const raw=await readFile(join(dest,'visual-data.js'),'utf8'),data=JSON.parse(raw.slice('window.OPSTWINS_DESIGN_DATA='.length).trim().slice(0,-1));
  const req=[];const qa=await getJSON('http://127.0.0.1:46247','/__qa/fixture',req),note=await getJSON('http://127.0.0.1:46247','/api/memories/'+noteId,req),idea=await getJSON('http://127.0.0.1:46247','/api/ideas/'+ideaId,req),catalog=await getJSON('http://127.0.0.1:46247','/api/settings/models',req),boot=await getJSON('http://127.0.0.1:46247','/api/bootstrap',req);
  await check('exact full9534 memory not1200 bootstrap projection',data.memories[0].body.length===9534&&equal(data.memories[0],note)&&data.memories[0].body.endsWith(noteTail)&&boot.memories[0].body.length===1200,{id:noteId,characters:9534,sha256:hash(note.body)});
  await check('exact long Idea IDs/description/context retained',equal(data.ideas.find(i=>i.id===ideaId),idea)&&idea.description.endsWith(ideaTail),{id:ideaId,descriptionSHA256:hash(idea.description),characters:idea.description.length});
  await check('public formal model catalog all fields preserved unconfigured',equal(data.models,catalog)&&data.models.providers[0].configured===false,{providerId,definitionCount:2,catalogSHA256:hash(stable(catalog)),modelCalls:0});
  await check('fixture date same capturedAt/source/task/due without hardcoded timestamp',data.capturedAt===qa.qaDate+'T00:00:00.000Z'&&data.tasks[0].dueDate===qa.qaDate&&equal(data.tasks,boot.tasks));
  await check('primary same exact conversation and messages unchanged',data.primaryConversationId===cid&&equal(data.conversations,boot.conversations)&&equal(data.messages,boot.messages));
  await check('Inbox synthetic assessment unchanged only display attention flag',data.inbox[0].attention===true&&equal(data.inbox.map(({attention,...rest})=>rest),boot.inbox));
  // Evaluate only the exact original snapshot index/plain function, against the real generated HTTP projection.
  // No DOM/browser/pixel claim; the full generator/HTTP subprocess path above is the E2E being verified.
  const ui=await readFile(join(DESIGN,'macos-ui-study.js'),'utf8'),names=ui.slice(ui.indexOf('const searchNames='),ui.indexOf('function openSearchResult(')),plain=ui.slice(ui.indexOf('function searchPlain('),ui.indexOf('function searchRow('));
  const context=vm.createContext({data,console:{}});const actualIndex=vm.runInContext(names+plain+';searchRecords.filter(r=>r.plainText.toLocaleLowerCase().includes('+JSON.stringify(noteTail.toLowerCase())+')).map(r=>({type:r.type,id:r.item.id}));',context);
  await check('unmodified original HTML local search index NOTE-END hits same exact memory',actualIndex.length===1&&actualIndex[0].id===noteId&&actualIndex[0].type==='memories',{JSsourceSHA256:hash(ui),resultIds:actualIndex.map(x=>x.id),scope:'Source index evaluated against generated projection; browserSearch NOT_RUN'});
  const html=await readFile(join(dest,'reference.html'),'utf8');await check('generated HTML equals only approved URI/storage substitutions',html===htmlCopy(beforeDesign.source));
  await check('inline CSS/style blocks byte-identical',equal([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]),[...beforeDesign.source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1])));
  await check('all original designCSS/JS assets pre/post identical',equal(beforeDesign,await designInputs()));
  await check('isolated localStorage and sessionStorage/capability disabled only generatedcopy',html.includes(storageScript)&&!html.includes('src="../../.local/design/chat-capability.js"')&&html.includes('src="data:text/javascript,void%200"'));
  for(const asset of manifest.generated){const b=await readFile(join(dest,asset.name));await check('generated artifact exactSHA '+asset.name,hash(b)===asset.sha256&&b.length===asset.bytes);}
  await check('GET-only route ledger includes exact fullmemory/models/primary/search',manifest.requests.every(x=>x.status===200)&&['/api/bootstrap','/api/memories/'+noteId,'/api/ideas/'+ideaId,'/api/settings/models','/api/conversations/primary'].every(x=>manifest.requests.some(q=>q.route===x)));
  const destBefore=hash(await readFile(join(dest,'manifest.json'))),repeat=child(SELF,['--fixture-port=46247','--output='+relative(ROOT,dest)]);await repeat.done;
  await check('repeat same destination fails without overwriting original projection',repeat.row.code!==0&&hash(await readFile(join(dest,'manifest.json')))===destBefore);
  for(const argv of [[],['--fixture-port=46193'],['--fixture-port=46110'],['--fixture-port=46247','--fixture-port=46247'],['--fixture-port=46247','--output=../outside-reference'],['--fixture-port=46247','--output=.local/private-runtime/reference']]){const bad=child(SELF,argv);await bad.done;await check('unsafe option/production/output rejects before write '+JSON.stringify(argv),bad.row.code!==0);}
  const link=join(out,'linked');await (await import('node:fs/promises')).symlink(out,link);const badLink=child(SELF,['--fixture-port=46247','--output='+relative(ROOT,join(link,'generated-unsafe'))]);await badLink.done;
  await check('output symlink ancestor rejects before new files',badLink.row.code!==0);await rm(link);
  own.proc.kill('SIGTERM');await own.done;await check('owned public fixture normalSIGTERM exit0 portfree',own.row.code===0&&!listeners(46247).length);
  const routes=new Map(manifest.staticResources.routes.map(x=>[x.route,x]));
  staticServer=http.createServer(async(req,res)=>{
   const item=req.method==='GET'&&!req.url.includes('?')?routes.get(req.url):null;
   if(!item){res.writeHead(403,{'Cache-Control':'no-store'});res.end();return;}
   try{const p=join(ROOT,item.path);await nonlink(p);const body=await readFile(p);if(hash(body)!==item.sha256)throw Error('static changed');
    const mime=p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':p.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
   }catch{res.writeHead(503);res.end();}
  });await new Promise((ready,reject)=>{staticServer.once('error',reject);staticServer.listen(46247,'127.0.0.1',ready);});
  for(const item of routes.values()){const response=await fetch('http://127.0.0.1:46247'+item.route,{redirect:'manual',signal:AbortSignal.timeout(5000)}),body=Buffer.from(await response.arrayBuffer());await check('exactHTTP static original/generated bytes '+item.route,response.status===200&&body.length===item.bytes&&hash(body)===item.sha256,{route:item.route,bytes:body.length,sha256:hash(body)});}
  for(const route of ['/','.local/config.json','/design/../../.local/config.json','/design/%2e%2e/%2e%2e/.local/config.json','/design/macos-ui-study.js?scope=private','/api/bootstrap','/design/chat-capability.js']){const response=await fetch('http://127.0.0.1:46247'+(route.startsWith('/')?route:'/'+route),{redirect:'manual'});await check('exactstatic unknown/private/API denied '+route,response.status===403);}
  await check('staticmap HTTPSnone fileURIabsent/generated-only HTTP origin',manifest.staticResources.origin===STATIC_ORIGIN&&!html.includes('file:')&&!manifest.staticResources.routes.some(x=>x.path.startsWith('.local/')||x.path.includes('capability')));
  await new Promise(done=>{staticServer.close(done);staticServer.closeAllConnections();});staticServer=null;
  const offline=child(SELF,['--fixture-port=46247','--output='+relative(ROOT,join(out,'generated-offline'))]);await offline.done;let absent=false;try{await lstat(join(out,'generated-offline'));}catch(e){absent=e.code==='ENOENT';}
  await check('HTTP unavailable fails closed without partial generated dir',offline.row.code!==0&&absent);
  report.generatedReference=relative(ROOT,join(dest,'reference.html'));report.projectionManifestSHA256=destBefore;report.status='PASS_PUBLIC_PROJECTION_HTTP_GUI_NOT_RUN';
 }catch(error){report.status='FAIL_PUBLIC_PROJECTION_HTTP';report.error=String(error.message);process.exitCode=1;}
 finally{
  if(staticServer)await new Promise(done=>{staticServer.close(done);staticServer.closeAllConnections();});
  for(const c of children.reverse())if(c.row.code===null&&c.proc.exitCode===null){c.proc.kill('SIGTERM');await c.done;}
  report.children=children.map(x=>x.row);report.fixtureSourceUnchanged=hash(await readFile(join(ROOT,'scripts/native-product-visual-fixture.mjs')))===hash(beforeFixture);report.designSourcesUnchanged=equal(await designInputs(),beforeDesign);
  report.existingPortsAfter={46193:listeners(46193),46246:listeners(46246)};report.existingPortsUnchanged=equal(existingPorts,report.existingPortsAfter);report.ownedPortFreeAfter=!listeners(46247).length;
  report.pass=checks.filter(x=>x.status==='PASS').length;report.fail=checks.filter(x=>x.status==='FAIL').length;await save();
  const entries=(await (await import('node:fs/promises')).readdir(out,{withFileTypes:true})).filter(x=>x.isFile()&&x.name!=='manifest.json'),files=[];
  for(const x of entries){const p=join(out,x.name),b=await readFile(p);files.push({path:relative(ROOT,p),bytes:b.length,sha256:hash(b)});}
  await writeFile(join(out,'manifest.json'),JSON.stringify({at:new Date().toISOString(),status:report.status,pass:report.pass,fail:report.fail,sourceStable:report.sourceSHA256===hash(await readFile(SELF)),fixtureSourceUnchanged:report.fixtureSourceUnchanged,designSourcesUnchanged:report.designSourcesUnchanged,existingPortsUnchanged:report.existingPortsUnchanged,ownedPortFreeAfter:report.ownedPortFreeAfter,modelCalls:0,businessWrites:0,GUI:'NOT_RUN',scores:null,files},null,2)+'\n');
  console.log(JSON.stringify({status:report.status,pass:report.pass,fail:report.fail,manifest:relative(ROOT,join(out,'manifest.json')),reference:report.generatedReference,ownedPortFreeAfter:report.ownedPortFreeAfter}));
 }
}
