// Isolated experiment v2, not a production retrieval switch.
// Dependency: npm install --prefix .local/acceptance/memory-vector-deps --save-exact sqlite-vec@0.1.6
// Run: node --import tsx scripts/memory-vector-compare.mjs
// Failure cases and frozen data were recorded first: scripts/memory-vector-plan.md and scripts/memory-vector-cases.json.
//
// This orchestrator embeds once and holds the auth key in memory only. Workers and restart
// processes get vectors from a file and a minimal environment that carries no credentials.
// Exit code 1 means the harness failed. Unmet capability is reported in `decision`, not as a crash.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {ARMS,DATA_ROOT_PREFIX,FUSION_POLICY,GATED_ARMS,PORTS,RESULT_PREFIX,assertPortFree,collectTexts,metricsByArm,scopeVisible,sha256} from './memory-vector-lib.mjs';

const FROZEN_CASES_SHA256='9f82f55b9ca6759b1396dd14c87c14188ab73ae0b1b4fa24c1d8c83f145fa7c6';
const EMBEDDING_URL='http://127.0.0.1:48000/v1/embeddings';
const EMBEDDING_BATCH=16;
const WORKER_TIMEOUT_MS=300000,RESTART_TIMEOUT_MS=120000;
const SOURCE_FILES=['scripts/memory-vector-compare.mjs','scripts/memory-vector-lib.mjs','scripts/memory-vector-worker.mjs','scripts/memory-vector-restart.mjs','scripts/memory-vector-cases.json','scripts/memory-vector-plan.md','server/src/conversation-memory.ts','server/src/store.ts','server/src/runtime-paths.ts'];

const root=resolve(import.meta.dirname,'..');
const runId=new Date().toISOString().replace(/[-:.]/g,'')+'-'+randomUUID().slice(0,8);
const out=join(root,'output/memory-upgrade-20261105/vector-v2',runId);
const dataRoot=join(root,DATA_ROOT_PREFIX+runId);
const casesText=readFileSync(join(root,'scripts/memory-vector-cases.json'),'utf8');
const plan=JSON.parse(casesText);
const {frozen}=plan;

const report={
 schema:'memory-vector-report-v2',runId,productionEnabled:false,
 harness:{status:'RUNNING',errors:[]},decision:'NOT_DECIDED',criteria:[],metrics:{},orderStability:null,lifecycle:{},restart:{},
 provenance:{frozen,fusionPolicy:FUSION_POLICY,fusionPolicyPreregistered:false,casesSha256:sha256(casesText),ports:PORTS,dataRoot,node:process.version,timingsMs:{}},
 notCovered:['undo in a shared slot','model extraction quality','packaged macOS dylib loading and signing','filter-before-top-k at scale','live embedding endpoint failure (the probe passes a null query vector)'],
};
let key='',activeChild=null;

async function embedBatch(texts){
 const start=performance.now();
 const response=await fetch(EMBEDDING_URL,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify({model:frozen.model,input:texts}),signal:AbortSignal.timeout(120000),redirect:'error'});
 if(!response.ok)throw Error('embedding_http_'+response.status);
 const body=await response.json();
 if(body.model&&body.model!==frozen.model)throw Error('embedding_model_mismatch:'+body.model);
 const vectors=body.data?.sort((a,b)=>a.index-b.index).map(x=>x.embedding);
 if(vectors?.length!==texts.length||vectors.some(v=>!Array.isArray(v)||v.length!==frozen.dimension||v.some(n=>!Number.isFinite(n))||!v.some(n=>n!==0)))throw Error('invalid_embeddings');
 return {vectors:vectors.map(v=>{const norm=Math.sqrt(v.reduce((n,x)=>n+x*x,0));return v.map(x=>x/norm);}),count:texts.length,ms:Math.round(performance.now()-start),responseModel:body.model??null};
}
async function embedAll(texts){
 const vectors=[],batches=[];
 for(let i=0;i<texts.length;i+=EMBEDDING_BATCH){
  const {vectors:part,...timing}=await embedBatch(texts.slice(i,i+EMBEDDING_BATCH));
  vectors.push(...part);batches.push(timing);
 }
 return {vectors,batches};
}

function runProcess(script,config,timeoutMs){
 const env=Object.fromEntries(Object.entries({PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,OPSTWIN_DATA_DIR:config.dataDir,OPSTWIN_PRIVATE_DIR:config.dataDir,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1'}).filter(([,v])=>v!==undefined));
 return new Promise((ok,no)=>{
  const child=spawn(process.execPath,['--import','tsx',join(root,'scripts',script),JSON.stringify(config)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  activeChild=child;
  let stdout='',stderr='',timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  child.stdout.on('data',x=>{stdout+=x;});
  child.stderr.on('data',x=>{stderr=(stderr+x).slice(-2000);});
  child.once('error',error=>{clearTimeout(timer);activeChild=null;no(error);});
  child.once('close',(code,signal)=>{clearTimeout(timer);activeChild=null;ok({code,signal,stdout,stderr,timedOut});});
 });
}
async function readResult(run,label){
 const prefix=`${label}_failed code=${run.code} signal=${run.signal} timedOut=${run.timedOut}`;
 const line=run.stdout.split('\n').reverse().find(x=>x.startsWith(RESULT_PREFIX));
 if(!line)throw Error(prefix+' no_result_line stderr='+run.stderr);
 let pointer;
 try{pointer=JSON.parse(line.slice(RESULT_PREFIX.length));}catch{throw Error(prefix+' invalid_result_line');}
 const text=await readFile(pointer.path,'utf8');
 if(sha256(text)!==pointer.sha256)throw Error(prefix+' result_hash_mismatch');
 let value;
 try{value=JSON.parse(text);}catch{throw Error(prefix+' invalid_result_json');}
 if(run.code!==0||run.timedOut||value.status!=='COMPLETED')throw Error(prefix+' error='+(value.error||'unknown')+' stderr='+run.stderr);
 return value;
}
function validateRestart(child,parent,config){
 const problems=[];
 if(child.schema!=='memory-vector-restart-v2')problems.push('schema');
 if(child.pid===process.pid||child.pid===parent.pid)problems.push('process_not_fresh');
 if(child.order!==config.order||child.dataDir!==config.dataDir)problems.push('wrong_data_root');
 if(child.embeddingCalls!==0)problems.push('embedding_called');
 if(child.sqliteVecVersion!==parent.sqliteVecVersion)problems.push('sqlite_vec_version');
 const parentKeys=Object.keys(parent.finalSweep).sort(),childKeys=Object.keys(child.sweep||{}).sort();
 if(JSON.stringify(parentKeys)!==JSON.stringify(childKeys))problems.push('sweep_coverage');
 if(childKeys.some(k=>ARMS.some(arm=>!Array.isArray(child.sweep[k][arm]))))problems.push('sweep_shape');
 if(!Array.isArray(child.currentIds)||!Array.isArray(child.preferenceIds))problems.push('state_shape');
 if(problems.length)throw Error('restart_output_invalid:'+problems.join(','));
}
// Parent and child must rank identically from the same persisted vectors.
function compareSweeps(parent,child){
 const mismatches=[];
 for(const [key,expected] of Object.entries(parent)){
  const actual=child[key];
  for(const arm of ARMS)if(JSON.stringify(expected[arm].map(x=>x.id))!==JSON.stringify(actual[arm].map(x=>x.id)))mismatches.push({q:expected.q,scope:expected.scope,arm,parent:expected[arm].map(x=>x.key),child:actual[arm].map(x=>x.key)});
  const rawParent=expected.rawSemantic,rawChild=actual.rawSemantic;
  const rawSame=rawParent.length===rawChild.length&&rawParent.every((x,i)=>x.id===rawChild[i].id&&x.decision===rawChild[i].decision&&Math.abs(x.similarity-rawChild[i].similarity)<1e-6);
  if(!rawSame)mismatches.push({q:expected.q,scope:expected.scope,arm:'rawSemantic'});
 }
 return mismatches;
}
function evaluateRestart(parent,child,order){
 const criterion=(id,cls,status,detail)=>report.criteria.push({id,class:cls,status,order,detail});
 const mismatches=compareSweeps(parent.finalSweep,child.sweep);
 criterion('restart-results-equal','capability',mismatches.length?'FAIL':'PASS',{queries:Object.keys(child.sweep).length,mismatches});
 const stateEqual=JSON.stringify(parent.currentIds)===JSON.stringify(child.currentIds)&&JSON.stringify(parent.preferenceIds)===JSON.stringify(child.preferenceIds);
 criterion('restart-authoritative-state-equal','capability',stateEqual?'PASS':'FAIL',{});
 const current=new Set(child.currentIds),inactive=parent.registry.filter(x=>!current.has(x.id));
 const results=Object.values(child.sweep),scopeById=new Map(parent.registry.map(x=>[x.id,x.scope]));
 const absent=inactive.map(entry=>({key:entry.key,id:entry.id,returnedCount:results.reduce((n,r)=>n+ARMS.reduce((m,arm)=>m+r[arm].filter(x=>x.id===entry.id).length,0),0),rawNeighborQueries:results.filter(r=>r.rawSemantic.some(x=>x.id===entry.id)).length}));
 const revived=absent.filter(x=>x.returnedCount>0);
 criterion('restart-inactive-absent','safety',revived.length?'FAIL':'PASS',{inactive:absent.length,revived});
 const leaks=results.flatMap(r=>GATED_ARMS.flatMap(arm=>r[arm].filter(x=>{const scope=scopeById.get(x.id);return scope===null||scope===undefined||!scopeVisible(scope,r.scope);}).map(x=>({q:r.q,scope:r.scope,arm,key:x.key}))));
 criterion('restart-scope-leak','safety',leaks.length?'FAIL':'PASS',{leaks});
 const retained=absent.filter(x=>x.rawNeighborQueries>0).length;
 criterion('restart-raw-vectors-reloaded','evidence',retained?'PASS':'MISSING_EVIDENCE',{inactiveWithRawNeighbors:retained});
 report.restart[order]={pid:child.pid,parentPid:parent.pid,queries:results.length,inactiveAbsent:absent,mismatchCount:mismatches.length};
}
function orderStability(orders){
 const [first,second]=orders;
 if(!first||!second)return null;
 const rowsB=new Map(second.metricRows.map(x=>[x.case.id,x.result]));
 const result={};
 for(const arm of ARMS){
  const differences=first.metricRows.flatMap(row=>{
   const a=row.result[arm].map(x=>x.key),b=rowsB.get(row.case.id)[arm].map(x=>x.key);
   return JSON.stringify(a)===JSON.stringify(b)?[]:[{case:row.case.id,group:row.case.group,forward:a,reverse:b,top1Changed:a[0]!==b[0]}];
  });
  result[arm]={casesCompared:first.metricRows.length,listsDiffer:differences.length,top1Differ:differences.filter(x=>x.top1Changed).length,differences};
 }
 return result;
}
const packageVersion=async path=>{try{return JSON.parse(await readFile(join(root,path),'utf8')).version;}catch{return null;}};

async function main(){
 if(sha256(casesText)!==FROZEN_CASES_SHA256)throw Error('frozen_cases_hash_mismatch');
 if(frozen.threshold!==0.55||frozen.topK!==3||frozen.model!=='Qwen3-Embedding-0.6B-8bit'||frozen.sqliteVec!=='v0.1.6')throw Error('frozen_parameters_changed');
 await assertPortFree(PORTS.parent);await assertPortFree(PORTS.child);
 await mkdir(out,{recursive:true});await mkdir(dataRoot,{recursive:true,mode:0o700});
 report.provenance.sourceHashes=Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file=>[file,sha256(await readFile(join(root,file)))])));
 report.provenance.libraries={hono:await packageVersion('node_modules/hono/package.json'),honoNodeServer:await packageVersion('node_modules/@hono/node-server/package.json'),tsx:await packageVersion('node_modules/tsx/package.json'),sqliteVecPackage:await packageVersion('.local/acceptance/memory-vector-deps/node_modules/sqlite-vec/package.json')};
 try{key=JSON.parse(await readFile(join(homedir(),'.omlx/settings.json'),'utf8')).auth?.api_key||'';}catch{}

 const {documents,queries}=collectTexts(plan);
 report.provenance.queryHash=sha256(JSON.stringify(queries));
 const documentEmbedding=await embedAll(documents);
 const queryEmbedding=await embedAll(queries.map(q=>frozen.queryInstruction+q));
 report.provenance.timingsMs.embedding={documents:documentEmbedding.batches,queries:queryEmbedding.batches};
 const vectorFile={model:frozen.model,documents:Object.fromEntries(documents.map((text,i)=>[text,documentEmbedding.vectors[i]])),queries:Object.fromEntries(queries.map((q,i)=>[q,queryEmbedding.vectors[i]]))};
 const vectorsText=JSON.stringify(vectorFile),vectorsFile=join(out,'embeddings.json'),vectorsSha=sha256(vectorsText);
 await writeFile(vectorsFile,vectorsText);
 report.provenance.embeddingHash=vectorsSha;
 report.provenance.embeddingCounts={documents:documents.length,queries:queries.length};

 const completed=[];
 for(const order of frozen.seedOrders){
  const dataDir=join(dataRoot,order);
  await mkdir(dataDir,{recursive:true,mode:0o700});
  await assertPortFree(PORTS.parent);
  const workerConfig={order,dataDir,port:PORTS.parent,vectorsFile,vectorsSha,resultFile:join(out,`worker-${order}.json`)};
  const parent=await readResult(await runProcess('memory-vector-worker.mjs',workerConfig,WORKER_TIMEOUT_MS),'worker_'+order);
  report.criteria.push(...parent.criteria);
  report.lifecycle[order]=parent.lifecycle;
  report.provenance.sqliteVecVersion=parent.sqliteVecVersion;
  report.provenance.timingsMs[order]=parent.timingsMs;
  const scopeByKey=Object.fromEntries(parent.registry.map(x=>[x.key,x.scope]));
  report.metrics[order]=metricsByArm(parent.metricRows,scopeByKey,frozen.topK);
  report.lexicalRetention={...report.lexicalRetention,[order]:parent.metricRows.filter(x=>x.result.lexicalRetention.applied).map(x=>({case:x.case.id,group:x.case.group,expected:x.case.expected,...x.result.lexicalRetention}))};
  // The worker has exited, so a bound port here means a listener leaked.
  await assertPortFree(PORTS.parent);
  await assertPortFree(PORTS.child);
  const restartConfig={order,dataDir,port:PORTS.child,vectorsFile,vectorsSha,resultFile:join(out,`restart-${order}.json`)};
  const child=await readResult(await runProcess('memory-vector-restart.mjs',restartConfig,RESTART_TIMEOUT_MS),'restart_'+order);
  validateRestart(child,parent,restartConfig);
  await assertPortFree(PORTS.child);
  evaluateRestart(parent,child,order);
  completed.push(parent);
  report.raw={...report.raw,[order]:{worker:workerConfig.resultFile,restart:restartConfig.resultFile}};
 }
 report.orderStability=orderStability(completed);
 report.harness.status='PASS';
}

function decide(){
 if(report.harness.status!=='PASS')return 'NO_DECISION_HARNESS_FAILED';
 if(report.criteria.some(x=>['safety','capability'].includes(x.class)&&x.status==='FAIL'))return 'NO_GO';
 if(report.criteria.some(x=>x.status==='MISSING_EVIDENCE'))return 'INCONCLUSIVE';
 return 'NO_BLOCKER_OBSERVED_NOT_PRODUCTION_APPROVAL';
}
try{
 await main();
}catch(error){
 report.harness.status='FAIL';
 report.harness.errors.push(String(error));
 process.exitCode=1;
}finally{
 activeChild?.kill('SIGKILL');
 report.decision=decide();
 const count=(cls,status)=>report.criteria.filter(x=>x.class===cls&&x.status===status).length;
 report.criteriaSummary=Object.fromEntries(['safety','capability','quality','evidence','gap'].map(cls=>[cls,{PASS:count(cls,'PASS'),FAIL:count(cls,'FAIL'),GAP:count(cls,'GAP'),MISSING_EVIDENCE:count(cls,'MISSING_EVIDENCE')}]));
 let text=JSON.stringify(report,null,2);
 if(key&&key.length>=8&&text.includes(key)){
  text=JSON.stringify({schema:report.schema,runId,harness:{status:'FAIL',errors:['credential_detected_in_report_discarded']},decision:'NO_DECISION_HARNESS_FAILED'},null,2);
  process.exitCode=1;
 }
 key='';
 const reportPath=join(out,'report.json');
 await mkdir(out,{recursive:true});
 await writeFile(reportPath,text);
 console.log(JSON.stringify({harness:report.harness,decision:report.decision,criteriaSummary:report.criteriaSummary,unmet:report.criteria.filter(x=>x.status!=='PASS'&&x.class!=='gap').map(x=>({id:x.id,class:x.class,status:x.status,order:x.order})),hybrid:Object.fromEntries(Object.entries(report.metrics).map(([order,m])=>[order,m.hybrid.overall])),hybridRrfOnly:Object.fromEntries(Object.entries(report.metrics).map(([order,m])=>[order,m.hybridRrfOnly.overall])),lexicalRetentionApplied:Object.fromEntries(Object.entries(report.lexicalRetention??{}).map(([order,rows])=>[order,rows.length])),report:reportPath},null,2));
}
