// One seed order in one fresh data root. Writes go through the real module over HTTP.
// It reads precomputed vectors from a file and never sees embedding credentials.
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ARMS,GATED_ARMS,assertIsolatedData,closeServer,emitResult,makeHttp,openScopeDb,openVectorDb,rankOf,runSweep,scopeVisible,search,sha256,startLab,vectorBytes} from './memory-vector-lib.mjs';

const config=JSON.parse(process.argv[2]);
const root=resolve(import.meta.dirname,'..');
const output={schema:'memory-vector-worker-v2',pid:process.pid,order:config.order,dataDir:config.dataDir,criteria:[],lifecycle:{},timingsMs:{}};
const criterion=(id,cls,status,detail)=>output.criteria.push({id,class:cls,status,order:config.order,detail});
const phase=async(name,work)=>{const start=performance.now();const value=await work();output.timingsMs[name]=Math.round(performance.now()-start);return value;};
let server,scopeDb,vectorDb,emptyDb,S,exitCode=0;

try{
 assertIsolatedData(root,config.dataDir);
 const plan=JSON.parse(readFileSync(join(root,'scripts/memory-vector-cases.json'),'utf8'));
 const {frozen}=plan;
 const vectorText=readFileSync(config.vectorsFile,'utf8');
 if(sha256(vectorText)!==config.vectorsSha)throw Error('vector_file_hash_mismatch');
 const vectors=JSON.parse(vectorText);
 S=await import('../server/src/store.ts');
 S.setMeta('initialized',true);
 const M=await import('../server/src/conversation-memory.ts');
 S.put('conversations',{id:'lab',title:'公开合成记忆检索实验'});
 server=await startLab(S,M,config.port);
 const http=makeHttp(config.port);
 scopeDb=openScopeDb(config.dataDir);
 vectorDb=openVectorDb(root,join(config.dataDir,'vectors.db'));
 emptyDb=openVectorDb(root,join(config.dataDir,'vectors-no-tables.db'));
 output.sqliteVecVersion=vectorDb.prepare('select vec_version() as v').get().v;
 if(output.sqliteVecVersion!==frozen.sqliteVec)throw Error('sqlite_vec_version_mismatch:'+output.sqliteVecVersion);
 // index_meta carries no scope: scope has one source, experiment-scope.db.
 vectorDb.exec(`CREATE VIRTUAL TABLE memory_vec USING vec0(id TEXT PRIMARY KEY, embedding float[${frozen.dimension}] distance_metric=cosine);
CREATE TABLE index_meta(id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, model TEXT NOT NULL);`);

 const registry=new Map();
 const hasVector=id=>vectorDb.prepare('SELECT count(*) AS n FROM memory_vec WHERE id=?').get(id).n>0;
 const writeMemory=async ({key,kind='automatic',content,slot,category='work',scope=null,indexed=true})=>{
  const saved=kind==='manual'?await http('/lab/manual',{content}):await http('/lab/remember',{content,slot,category});
  scopeDb.prepare('INSERT OR REPLACE INTO memory_key(id,key) VALUES(?,?)').run(saved.id,key);
  if(scope)scopeDb.prepare('INSERT OR REPLACE INTO memory_scope(id,scope) VALUES(?,?)').run(saved.id,scope);
  if(indexed){
   const vector=vectors.documents[content];
   if(!vector)throw Error('document_vector_missing:'+key);
   vectorDb.prepare('INSERT INTO memory_vec(id,embedding) VALUES(?,?)').run(saved.id,vectorBytes(vector));
   vectorDb.prepare('INSERT INTO index_meta(id,content_hash,model) VALUES(?,?,?)').run(saved.id,S.hash(content),frozen.model);
  }
  const entry={key,id:saved.id,version:saved.version,scope,kind,indexed,slot:slot??null};
  registry.set(key,entry);
  return entry;
 };
 const run=(q,scope,{noEmbedding=false,vectorDb:vectorOverride}={})=>{
  const queryVector=noEmbedding?null:vectors.queries[q];
  if(!noEmbedding&&!queryVector)throw Error('query_vector_missing:'+q);
  return search({http,hash:S.hash,q,scope,queryVector,scopeDb,vectorDb:vectorOverride??vectorDb,frozen});
 };
 const statusOf=async key=>(await http('/lab/status?id='+encodeURIComponent(registry.get(key).id))).status;
 const describe=(result,key)=>{
  const entry=registry.get(key),raw=result.rawSemantic.find(x=>x.id===entry.id);
  return {key,id:entry.id,ranks:Object.fromEntries(ARMS.map(arm=>[arm,rankOf(result,arm,entry.id)])),raw:raw?{similarity:raw.similarity,decision:raw.decision}:null};
 };
 const returnedAnywhere=(result,id,arms=ARMS)=>arms.some(arm=>rankOf(result,arm,id)!==null);
 const rawAboveThreshold=(result,id)=>{const raw=result.rawSemantic.find(x=>x.id===id);return !!raw&&raw.similarity>=frozen.threshold;};
 const forget=(entry)=>http.raw('/api/memories/automatic/'+entry.id+'/revoke',{version:entry.version,action:'forget'});

 // Seed order is the only difference between the two runs.
 const seedList=config.order==='reverse'?[...plan.corpus].reverse():plan.corpus;
 output.seededOrder=seedList.map(x=>x.key);
 await phase('seed',async()=>{for(const item of seedList)await writeMemory(item);});
 for(const item of plan.corpus){
  if(hasVector(registry.get(item.key).id)!==item.indexed)throw Error('fixture_vector_state_wrong:'+item.key);
 }

 output.metricRows=await phase('metricSweep',async()=>{
  const rows=[];
  for(const testCase of plan.cases)rows.push({case:testCase,result:await run(testCase.q,testCase.scope)});
  return rows;
 });
 const rowById=new Map(output.metricRows.map(row=>[row.case.id,row]));

 const missingVectorFailures=output.metricRows.filter(row=>row.case.mustReturnArms).flatMap(row=>row.case.mustReturnArms.filter(arm=>!row.result[arm].some(x=>row.case.expected.includes(x.key))).map(arm=>({case:row.case.id,arm})));
 criterion('missing-vector-keyword-returned','capability',missingVectorFailures.length?'FAIL':'PASS',{failures:missingVectorFailures});

 const unscoped=rowById.get('mv-unscoped');
 const unscopedLeak=GATED_ARMS.filter(arm=>unscoped.result[arm].some(x=>x.key==='manual-unscoped'));
 const unscopedExists=unscoped.result.lexical.some(x=>x.key==='manual-unscoped');
 criterion('unscoped-excluded','safety',unscopedLeak.length?'FAIL':unscopedExists?'PASS':'MISSING_EVIDENCE',{leakedArms:unscopedLeak,baselineReturnedIt:unscopedExists});

 const scopeGuardRows=output.metricRows.filter(row=>row.case.forbidden?.length&&row.case.id!=='mv-unscoped');
 const exercised=scopeGuardRows.filter(row=>row.case.forbidden.some(key=>row.result.lexicalExcluded.some(x=>x.key===key&&x.reason==='out_of_scope')||row.result.rawSemantic.some(x=>x.key===key&&x.decision==='out_of_scope'&&x.similarity>=frozen.threshold))).map(row=>row.case.id);
 criterion('scope-gate-exercised','evidence',exercised.length?'PASS':'MISSING_EVIDENCE',{cases:scopeGuardRows.length,rejectedAtGate:exercised});

 output.fallbackProbes=await phase('fallbackProbes',async()=>{
  const probes=[];
  for(const id of plan.fallbackProbes){
   const {case:testCase,result:normal}=rowById.get(id);
   for(const [mode,options,status] of [['embedding_failed',{noEmbedding:true},'embedding_unavailable'],['index_unavailable',{vectorDb:emptyDb},'index_unavailable']]){
    const result=await run(testCase.q,testCase.scope,options);
    const expectedIn=arm=>result[arm].some(x=>testCase.expected.includes(x.key));
    probes.push({case:id,mode,semanticStatus:result.semanticStatus,statusAsExpected:result.semanticStatus===status,scopedLexical:result.scopedLexical,hybrid:result.hybrid,normalHybrid:normal.hybrid,pass:result.semanticStatus===status&&expectedIn('scopedLexical')&&expectedIn('hybrid')&&!result.scopedSemantic.length});
   }
  }
  return probes;
 });
 for(const mode of ['embedding_failed','index_unavailable']){
  const failures=output.fallbackProbes.filter(x=>x.mode===mode&&!x.pass).map(x=>x.case);
  criterion('fallback-'+mode,'capability',failures.length?'FAIL':'PASS',{failures});
 }

 await phase('lifecycle',async()=>{
  output.lifecycle.corrections=[];
  for(const fixture of plan.lifecycle.corrections){
   if(fixture.old.content)await writeMemory({...fixture.old,slot:fixture.slot,scope:fixture.scope});
   const next=await writeMemory({...fixture.next,slot:fixture.slot,scope:fixture.scope}),old=registry.get(fixture.old.key);
   const variants=[];
   for(const query of fixture.queries){
    const result=await run(query.q,query.scope);
    variants.push({variant:query.variant,q:query.q,current:describe(result,next.key),superseded:describe(result,old.key),leaked:returnedAnywhere(result,old.id),rawOldAboveThreshold:rawAboveThreshold(result,old.id),hybrid:result.hybrid});
   }
   output.lifecycle.corrections.push({id:fixture.id,oldStatus:await statusOf(old.key),nextStatus:await statusOf(next.key),previousId:(await http('/lab/status?id='+encodeURIComponent(next.id))).previousId,variants});
   const leaked=variants.filter(x=>x.leaked).map(x=>x.variant),missing=variants.filter(x=>x.current.ranks.hybrid===null).map(x=>x.variant);
   criterion('correction-superseded-excluded:'+fixture.id,'safety',leaked.length?'FAIL':'PASS',{leakedVariants:leaked});
   criterion('correction-current-retrieved:'+fixture.id,'quality',missing.length?'FAIL':'PASS',{missingFromHybrid:missing,hybridRanks:variants.map(x=>({variant:x.variant,rank:x.current.ranks.hybrid}))});
   criterion('correction-raw-candidate-exists:'+fixture.id,'evidence',variants.some(x=>x.rawOldAboveThreshold)?'PASS':'MISSING_EVIDENCE',{});
  }

  const wrong=plan.lifecycle.incorrectSlot;
  const wrongNext=await writeMemory({...wrong.next,scope:wrong.scope});
  const wrongVariants=[];
  for(const query of wrong.queries){
   const result=await run(query.q,query.scope);
   wrongVariants.push({variant:query.variant,q:query.q,old:describe(result,wrong.old.key),next:describe(result,wrongNext.key),hybrid:result.hybrid});
  }
  const wrongOldStatus=await statusOf(wrong.old.key);
  output.lifecycle.incorrectSlot={id:wrong.id,oldStatus:wrongOldStatus,nextStatus:await statusOf(wrongNext.key),variants:wrongVariants};
  // Production corrects by slot, so a mis-slotted correction leaves the old fact active. This is a coverage gap, not a gate failure.
  criterion('correction-wrong-slot','gap',wrongOldStatus==='active'?'GAP':'PASS',{oldStatus:wrongOldStatus});

  output.lifecycle.forget=[];
  for(const fixture of plan.lifecycle.forget){
   const old=await writeMemory({...fixture.old,slot:fixture.slot,scope:fixture.scope});
   const next=await writeMemory({...fixture.next,slot:fixture.slot,scope:fixture.scope});
   const before=[];
   for(const query of fixture.queries)before.push({variant:query.variant,current:describe(await run(query.q,query.scope),next.key)});
   const revoke=await forget(next);
   const after=[];
   for(const query of fixture.queries){
    const result=await run(query.q,query.scope);
    after.push({variant:query.variant,q:query.q,old:describe(result,old.key),next:describe(result,next.key),leaked:returnedAnywhere(result,old.id)||returnedAnywhere(result,next.id),rawOld:rawAboveThreshold(result,old.id),rawNext:rawAboveThreshold(result,next.id)});
   }
   output.lifecycle.forget.push({id:fixture.id,revokeStatus:revoke.status,oldStatus:await statusOf(old.key),nextStatus:await statusOf(next.key),before,after,note:'Raw neighbors are retained by design. This checks gating, not physical deletion.'});
   if(revoke.status!==200)throw Error('forget_fixture_revoke_failed:'+revoke.status);
   const leaked=after.filter(x=>x.leaked).map(x=>x.variant);
   criterion('forget-excluded:'+fixture.id,'safety',leaked.length?'FAIL':'PASS',{leakedVariants:leaked});
   const evidence=after.some(x=>x.rawOld)&&after.some(x=>x.rawNext);
   criterion('forget-raw-candidates-exist:'+fixture.id,'evidence',evidence?'PASS':'MISSING_EVIDENCE',{perQuery:after.map(x=>({variant:x.variant,oldAboveThreshold:x.rawOld,nextAboveThreshold:x.rawNext}))});
  }

  output.lifecycle.gates=[];
  for(const fixture of plan.lifecycle.gates){
   const entry=await writeMemory(fixture.memory);
   const before=[];
   for(const query of fixture.queries)before.push(describe(await run(query.q,query.scope),entry.key));
   const tamper={
    'source-change':()=>http('/lab/source-change',{id:entry.id}),
    'manual-remove':()=>http('/lab/manual-remove',{id:entry.id}),
    'content-hash':()=>vectorDb.prepare("UPDATE index_meta SET content_hash='tampered' WHERE id=?").run(entry.id),
    model:()=>vectorDb.prepare("UPDATE index_meta SET model='mismatched-model' WHERE id=?").run(entry.id),
    'meta-delete':()=>vectorDb.prepare('DELETE FROM index_meta WHERE id=?').run(entry.id),
    'vector-delete':()=>vectorDb.prepare('DELETE FROM memory_vec WHERE id=?').run(entry.id),
   }[fixture.action];
   if(!tamper)throw Error('unknown_gate_action:'+fixture.action);
   await tamper();
   const after=[];
   for(const query of fixture.queries){
    const result=await run(query.q,query.scope),view=describe(result,entry.key);
    const decisionOk=fixture.expectDecision===null?view.raw===null:view.raw?.decision===fixture.expectDecision;
    const keywordOk=fixture.expectKeyword?view.ranks.scopedLexical!==null&&view.ranks.hybrid!==null:!ARMS.some(arm=>view.ranks[arm]!==null);
    after.push({q:query.q,view,decisionOk,keywordOk});
   }
   const pass=after.every(x=>x.decisionOk&&x.keywordOk),controlPresent=before.some(x=>x.ranks.hybrid!==null);
   output.lifecycle.gates.push({id:fixture.id,action:fixture.action,expectKeyword:fixture.expectKeyword,expectDecision:fixture.expectDecision,before,after});
   criterion(fixture.id,fixture.expectKeyword?'capability':'safety',!controlPresent?'MISSING_EVIDENCE':pass?'PASS':'FAIL',{controlPresent,after:after.map(({q,decisionOk,keywordOk,view})=>({q,decisionOk,keywordOk,raw:view.raw,ranks:view.ranks}))});
  }

  // Collisions use the unmodified production semantics. A shared slot is never renamed to pass.
  output.lifecycle.collisions=[];
  for(const fixture of plan.lifecycle.collisions){
   const members=[],stages=[];
   for(const step of fixture.steps){
    const before=await Promise.all(members.map(async key=>({key,scope:registry.get(key).scope,id:registry.get(key).id,status:await statusOf(key)})));
    let http_status=null,errorBody=null;
    if(step.action==='remember'){
     await writeMemory({key:step.key,content:step.content,slot:fixture.slot,scope:step.scope});
     members.push(step.key);
    }else{
     const response=await forget(registry.get(step.target));
     http_status=response.status;
     if(response.status!==200)errorBody=response.data;
    }
    const after=await Promise.all(members.map(async key=>({key,scope:registry.get(key).scope,id:registry.get(key).id,status:await statusOf(key)})));
    const observedActive=after.filter(x=>x.status==='active').map(x=>x.key).sort(),expectedActive=[...step.expectActive].sort();
    const activeOk=JSON.stringify(observedActive)===JSON.stringify(expectedActive);
    const statusOk=step.expectStatus===undefined||step.expectStatus===http_status;
    const targetOk=step.expectTargetStatus===undefined||after.find(x=>x.key===step.target)?.status===step.expectTargetStatus;
    stages.push({action:step.action,key:step.key??step.target,before,after,observedActive,expectedActive,httpStatus:http_status,errorBody,meetsIsolationExpectation:activeOk&&statusOk&&targetOk});
   }
   const retrieval=[];
   for(const query of fixture.queries){
    const result=await run(query.q,query.scope);
    retrieval.push({q:query.q,scope:query.scope,expected:query.expected,hybrid:result.hybrid,scopedLexical:result.scopedLexical,expectedRanks:query.expected.map(key=>describe(result,key)),expectedReturned:query.expected.every(key=>rankOf(result,'hybrid',registry.get(key).id)!==null)});
   }
   const unmet=stages.filter(x=>!x.meetsIsolationExpectation).length,lost=retrieval.filter(x=>!x.expectedReturned).map(x=>x.q);
   output.lifecycle.collisions.push({id:fixture.id,slot:fixture.slot,stages,retrieval,capability:unmet||lost.length?'FAIL':'PASS'});
   criterion(fixture.id,'capability',unmet||lost.length?'FAIL':'PASS',{stagesUnmet:unmet,stages:stages.map(x=>({action:x.action,key:x.key,httpStatus:x.httpStatus,observedActive:x.observedActive,expectedActive:x.expectedActive})),retrievalLost:lost});
  }

  const pref=plan.lifecycle.preferences;
  const prefOld=await writeMemory({...pref.old,slot:pref.slot,category:'preference',indexed:false});
  const prefNew=await writeMemory({...pref.next,slot:pref.slot,category:'preference',indexed:false});
  const afterCorrection=await http('/lab/preferences');
  const prefForget=await forget(prefNew);
  const afterForget=await http('/lab/preferences');
  output.lifecycle.preferences={afterCorrection:afterCorrection.map(x=>x.id),forgetStatus:prefForget.status,afterForget:afterForget.map(x=>x.id),ids:{old:prefOld.id,next:prefNew.id}};
  criterion('preference-correction-replaces','safety',afterCorrection.some(x=>x.id===prefNew.id)&&!afterCorrection.some(x=>x.id===prefOld.id)?'PASS':'FAIL',{});
  criterion('preference-forget-no-restore','safety',prefForget.status===200&&!afterForget.some(x=>[prefOld.id,prefNew.id].includes(x.id))?'PASS':'FAIL',{});
 });

 output.finalSweep=await phase('finalSweep',()=>runSweep(plan,run));
 output.currentIds=[...(await http('/api/memories/automatic')).items.map(x=>x.id),...(await http('/lab/personal')).items.map(x=>x.id)].sort();
 output.preferenceIds=(await http('/lab/preferences')).map(x=>x.id);
 output.registry=[...registry.values()].map(({key,id,scope,kind,indexed,slot})=>({key,id,scope,kind,indexed,slot}));

 const scopeById=new Map(output.registry.map(x=>[x.id,x.scope]));
 const allResults=[...output.metricRows.map(x=>x.result),...Object.values(output.finalSweep)];
 const scopeLeaks=[],unscopedReturned=[];
 for(const result of allResults)for(const arm of GATED_ARMS)for(const item of result[arm]){
  const scope=scopeById.get(item.id);
  if(scope===null||scope===undefined)unscopedReturned.push({q:result.q,arm,key:item.key});
  else if(!scopeVisible(scope,result.scope))scopeLeaks.push({q:result.q,scope:result.scope,arm,key:item.key});
 }
 criterion('scope-leak-gated','safety',scopeLeaks.length?'FAIL':'PASS',{leaks:scopeLeaks});
 criterion('unscoped-returned-gated','safety',unscopedReturned.length?'FAIL':'PASS',{returned:unscopedReturned});
 const current=new Set(output.currentIds),inactive=new Set(output.registry.filter(x=>!current.has(x.id)).map(x=>x.id));
 const inactiveReturned=Object.values(output.finalSweep).flatMap(result=>ARMS.flatMap(arm=>result[arm].filter(x=>inactive.has(x.id)).map(x=>({q:result.q,arm,key:x.key}))));
 criterion('inactive-excluded-final','safety',inactiveReturned.length?'FAIL':'PASS',{inactive:inactive.size,returned:inactiveReturned});
 const saturated=allResults.filter(x=>x.semanticSaturated).length;
 criterion('semantic-overfetch-not-saturated','evidence',saturated?'MISSING_EVIDENCE':'PASS',{saturated});
 output.status='COMPLETED';
}catch(error){
 output.status='FAILED';output.error=String(error);exitCode=1;
}finally{
 // Every handle is closed before exit, so the restart check reopens from disk only.
 try{if(server)await closeServer(server);}catch(error){output.status='FAILED';output.error=String(error);exitCode=1;}
 for(const handle of [emptyDb,vectorDb,scopeDb,S?.db]){try{handle?.close();}catch(error){output.status='FAILED';output.error=String(error);exitCode=1;}}
}
emitResult(config.resultFile,output,exitCode);
