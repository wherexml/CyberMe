// Isolated CyberMe + the published Mem0 OSS SDK, with real local embedding and reranking.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {assertPortFree,closeServer,makeHttp,startLab} from './memory-vector-lib.mjs';

const root=resolve(import.meta.dirname,'..');
const sdkRoot=join(root,'.local/mem0-evaluation/sdk');
const out=join(root,'output/mem0-memory-20261109');
const dataPrefix=join(root,'.local/mem0-evaluation/run-');
const dataDir=process.argv[2]==='--restart'?process.argv[3]:dataPrefix+randomUUID();
assert.match(dataDir,new RegExp('^'+dataPrefix+'[a-f0-9-]{36}$'));
const port=46951;
const workspace='cyberme-synthetic';
const otherWorkspace='another-workspace';
const rerankerModel='Qwen3-Reranker-0.6B-mlx-8Bit';
const rerankThreshold=0.85;
const judgeModel='Qwen3.6-35B-A3B-MLX-4bit';
const judgeEnabled=process.argv.includes('--judge');
const planText=await readFile(join(root,'scripts/memory-vector-cases.json'),'utf8');
const plan=JSON.parse(planText);
const holdout=JSON.parse(await readFile(join(root,'scripts/mem0-memory-holdout.json'),'utf8'));
const frozen=plan.frozen;
assert.equal(frozen.threshold,0.55);
assert.equal(frozen.topK,3);
assert.equal(frozen.model,'Qwen3-Embedding-0.6B-8bit');
await mkdir(dataDir,{recursive:true,mode:0o700});
await mkdir(out,{recursive:true});
delete process.env.OPSTWIN_STANDALONE;
delete process.env.OPSTWIN_ROOT;
Object.assign(process.env,{OPSTWIN_DATA_DIR:dataDir,OPSTWIN_PRIVATE_DIR:dataDir,OPSTWIN_NO_BACKGROUND:'1',MEM0_TELEMETRY:'false',MEM0_DIR:dataDir});
const key=JSON.parse(await readFile(join(homedir(),'.omlx/settings.json'),'utf8')).auth?.api_key||'';
const sdk=createRequire(join(sdkRoot,'package.json'));
const {Memory}=sdk('mem0ai/oss');
const S=await import('../server/src/store.ts');
const M=await import('../server/src/conversation-memory.ts');
const {judgeMemoryCandidates}=await import('../server/src/mem0-recall-pilot.ts');
assert.equal(S.DATA,dataDir);
const digest=text=>createHash('sha256').update(text).digest('hex');
async function localModel(path,body){
 const response=await fetch('http://127.0.0.1:48000/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('local_'+path+'_http_'+response.status);
 return response.json();
}
const documents=new Map(),queries=new Map();
async function embed(texts){
 const result=await localModel('embeddings',{model:frozen.model,input:texts,encoding_format:'float'});
 const vectors=result.data.sort((a,b)=>a.index-b.index).map(row=>row.embedding);
 assert.equal(vectors.length,texts.length);
 for(const vector of vectors)assert.ok(vector.length===frozen.dimension&&vector.every(Number.isFinite),'invalid embedding');
 return vectors;
}
async function prefill(cache,texts,prefix=''){
 const pending=[...new Set(texts)].filter(text=>!cache.has(text));
 for(let i=0;i<pending.length;i+=16){
  const batch=pending.slice(i,i+16);
  const vectors=await embed(batch.map(text=>prefix+text));
  for(const [j,text] of batch.entries())cache.set(text,vectors[j]);
 }
}
const memory=new Memory({
 vectorStore:{provider:'memory',config:{dbPath:join(dataDir,'mem0.db'),dimension:frozen.dimension,collectionName:workspace}},
 disableHistory:true,
 llm:{provider:'openai',config:{apiKey:'unused-local-only',baseURL:'http://127.0.0.1:48000/v1'}},
 embedder:{provider:'langchain',config:{model:{
  async embedQuery(text){
   if(documents.has(text))return documents.get(text);
   await prefill(queries,[text],frozen.queryInstruction);
   return queries.get(text);
  },
  embedDocuments:embed,
 }}},
});
const records=new Map();
async function index(row,workspaceId=workspace){
 await prefill(documents,[row.content]);
 const added=await memory.add(row.content,{userId:workspaceId,infer:false,metadata:{sourceId:row.id,scope:row.scope,contentHash:digest(row.content)}});
 assert.equal(added.results.length,1);
}
async function sdkSearch(query,scope){
 const result=await memory.search(query,{topK:12,threshold:frozen.threshold,filters:{user_id:workspace,scope:{in:[...new Set(['global',scope])]}},explain:true});
 return result.results;
}
const visible=(row,scope)=>row.scope!==null&&(row.scope==='global'||row.scope===scope);
async function activeById(http){
 const [automatic,manual]=await Promise.all([http('/api/memories/automatic'),http('/lab/personal')]);
 return new Map([...automatic.items.map(m=>[m.id,m.content]),...manual.items.map(m=>[m.id,m.content??m.body])]);
}
async function recall(http,query,scope){
 const [raw,lexical]=await Promise.all([sdkSearch(query,scope),http('/lab/lexical?q='+encodeURIComponent(query))]);
 const active=await activeById(http);
 const project=hit=>{
  const row=records.get(hit.metadata.sourceId);
  if(hit.user_id!==workspace||!row||!visible(row,scope)||digest(active.get(row.id)||'')!==hit.metadata.contentHash)return undefined;
  return row;
 };
 const scopedLexical=lexical.items.map(item=>records.get(item.id)).filter(row=>row&&visible(row,scope)&&active.get(row.id)===row.content);
 const mem0=raw.map(project).filter(Boolean);
 const pool=[...new Map([...mem0,...scopedLexical].map(row=>[row.id,row])).values()];
 let reranked=[];
 if(pool.length){
  const {results}=await localModel('rerank',{model:rerankerModel,query,documents:pool.map(row=>row.content),top_n:pool.length});
  assert.equal(results.length,pool.length);
  // Revalidate authoritative sources again after the last await.
  const fresh=await activeById(http);
  reranked=results.filter(result=>Number.isFinite(result.relevance_score)&&result.relevance_score>=rerankThreshold)
    .map(result=>pool[result.index]).filter(row=>row&&fresh.get(row.id)===row.content).slice(0,frozen.topK);
 }
 return {
  lexical:lexical.items.slice(0,frozen.topK).map(item=>records.get(item.id)?.key).filter(Boolean),
  mem0:mem0.slice(0,frozen.topK).map(row=>row.key),
  reranked:reranked.map(row=>row.key),
  ...(judgeEnabled?{judgePool:pool.slice(0,8).map(row=>({key:row.key,text:row.content}))}:{}),
  rawOutsideScope:raw.filter(hit=>hit.user_id!==workspace||!records.has(hit.metadata.sourceId)||!visible(records.get(hit.metadata.sourceId),scope)).length,
 };
}
async function assess(batch){
 await Promise.all(batch.map(async row=>{
  const numbered=row.judgePool.map((candidate,index)=>({key:String(index),text:candidate.text}));
  const scope={cape:'海岬',dawn:'晨舟'}[row.scope];
  const approved=await judgeMemoryCandidates(row.q,numbered,key,undefined,scope);
  row.judged=approved.map(index=>row.judgePool[Number(index)].key);
  delete row.judgePool;
 }));
}
await assertPortFree(port);
const service=await startLab(S,M,port),http=makeHttp(port);
const checks=[];
function check(name,passed){checks.push({name,passed:!!passed});assert.ok(passed,name);}
const registryPath=join(dataDir,'registry.json');
try{
 if(process.argv[2]==='--restart'){
  const registry=JSON.parse(await readFile(registryPath,'utf8'));
  for(const row of registry.records)records.set(row.id,row);
  const results=[];
  for(const probe of registry.probes)results.push(await recall(http,probe.q,probe.scope));
  assert.deepEqual(results,registry.before);
  console.log(JSON.stringify({restart:'PASS',probes:results.length}));
 }else{
  S.put('conversations',{id:'lab',title:'隔离合成记忆'});
  async function save(seed){
   const row=seed.kind==='manual'?await http('/lab/manual',{content:seed.content}):await http('/lab/remember',{content:seed.content,slot:seed.slot});
   const entry={...seed,id:row.id};
   records.set(row.id,entry);
   if(entry.indexed)await index(entry);
   return {...row,...entry};
  }
  await prefill(documents,plan.corpus.filter(row=>row.indexed).map(row=>row.content));
  const cases=[...plan.cases,...(judgeEnabled?holdout.map(row=>({...row,group:'holdout'})):[])];
  await prefill(queries,cases.map(row=>row.q),frozen.queryInstruction);
  for(const seed of plan.corpus)await save(seed);
  await index({id:'other-private-record',scope:'global',content:'我习惯用散点图展示营收走势。'},otherWorkspace);
  const results=[];
  for(const test of cases)results.push({...test,...await recall(http,test.q,test.scope)});
  if(judgeEnabled)for(let i=0;i<results.length;i+=3){
   await assess(results.slice(i,i+3));
   console.log('Answerability checked '+Math.min(i+3,results.length)+'/'+results.length);
  }
  check('SDK filters exclude other workspace and project tags',results.every(row=>row.rawOutsideScope===0));
  const metrics=Object.fromEntries(['lexical','mem0','reranked',...(judgeEnabled?['judged']:[])].map(arm=>{
   const positive=results.filter(r=>r.group!=='holdout'&&r.expected.length),negative=results.filter(r=>r.group!=='holdout'&&!r.expected.length),paraphrase=positive.filter(r=>r.group==='paraphrase');
   const held=results.filter(r=>r.group==='holdout'),heldPositive=held.filter(r=>r.expected.length),heldNegative=held.filter(r=>!r.expected.length);
   const hit=r=>r[arm].some(key=>r.expected.includes(key));
   return [arm,{top3:[positive.filter(hit).length,positive.length],paraphrase:[paraphrase.filter(hit).length,paraphrase.length],falseRecall:[negative.filter(r=>r[arm].length).length,negative.length],...(judgeEnabled?{holdoutHit:[heldPositive.filter(hit).length,heldPositive.length],holdoutFalseRecall:[heldNegative.filter(r=>r[arm].length).length,heldNegative.length]}:{})}];
  }));
  console.log(JSON.stringify(metrics));
  const chart=[...records.values()].find(r=>r.key==='chart');
  const correction={key:'chart-corrected',kind:'automatic',slot:chart.slot,scope:'global',content:'我现在长期偏好柱状图呈现销售额变化。',indexed:true};
  const updated=await save(correction);
  const updatedQuery={q:'销售额变化用什么图呈现？',scope:'global'};
  const newer=await recall(http,updatedQuery.q,updatedQuery.scope);
  check('superseded source excluded while correction recalled',!newer.mem0.includes('chart')&&!newer.reranked.includes('chart')&&newer.reranked.includes(updated.key));
  await http('/api/memories/automatic/'+updated.id+'/revoke',{version:updated.version,action:'forget'});
  const forgotten=await recall(http,updatedQuery.q,updatedQuery.scope);
  check('forget excludes both generations even with stale SDK rows',[...forgotten.mem0,...forgotten.reranked].every(key=>!['chart','chart-corrected'].includes(key)));
  const brief=[...records.values()].find(r=>r.key==='brief');
  await http('/lab/source-change',{id:brief.id});
  const edited=await recall(http,plan.cases[1].q,'global');
  check('edited source is absent from context',!edited.mem0.includes('brief')&&!edited.reranked.includes('brief'));
  const probes=[updatedQuery,{q:plan.cases[1].q,scope:'global'},{q:'海岬项目服务端用什么数据库？',scope:'cape'}];
  const before=[];
  for(const probe of probes)before.push(await recall(http,probe.q,probe.scope));
  await writeFile(registryPath,JSON.stringify({records:[...records.values()],probes,before}),{mode:0o600});
  await closeServer(service);S.db.close();
  const restarted=spawnSync(process.execPath,['--import','tsx',import.meta.filename,'--restart',dataDir,...(judgeEnabled?['--judge']:[])],{encoding:'utf8',timeout:45000});
  check('new process rebuilds authoritative eligibility and reopens Mem0 index',restarted.status===0&&restarted.stdout.includes('"restart":"PASS"'));
  const qualityPassed=metrics.reranked.paraphrase[0]>metrics.lexical.paraphrase[0]&&metrics.reranked.falseRecall[0]*2<=metrics.lexical.falseRecall[0];
  const judgePassed=judgeEnabled?metrics.judged.paraphrase[0]>=8&&metrics.judged.falseRecall[0]<=2&&results.find(row=>row.id==='cp-04').judged.length===0&&metrics.judged.holdoutHit[0]>=4&&metrics.judged.holdoutFalseRecall[0]<=1:undefined;
  await writeFile(join(out,judgeEnabled?'judged.json':'result.json'),JSON.stringify({status:'PASS',qualityPassed,judgePassed,synthetic:true,apiUrl:'http://127.0.0.1:'+port,sdkVersion:'3.3.1',embedding:frozen.model,reranker:rerankerModel,...(judgeEnabled?{judge:judgeModel}:{}),thresholds:{semantic:frozen.threshold,reranker:rerankThreshold},casesSha256:digest(planText),metrics,checks,results},null,2));
  console.log(JSON.stringify({qualityPassed,judgePassed,checks}));
 }
}finally{
 if(service.listening){await closeServer(service);S.db.close();}
}
