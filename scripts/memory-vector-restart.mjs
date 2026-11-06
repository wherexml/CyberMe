// Fresh restart process. It reopens persisted source, scope and vector data, then runs the
// same search over persisted query vectors. It has no embedding path and receives no credentials.
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {assertIsolatedData,closeServer,emitResult,makeHttp,openScopeDb,openVectorDb,runSweep,search,sha256,startLab} from './memory-vector-lib.mjs';

const config=JSON.parse(process.argv[2]);
const root=resolve(import.meta.dirname,'..');
const result={schema:'memory-vector-restart-v2',pid:process.pid,order:config.order,dataDir:config.dataDir,embeddingCalls:0};
let server,scopeDb,vectorDb,S,exitCode=0;
try{
 assertIsolatedData(root,config.dataDir);
 const plan=JSON.parse(readFileSync(join(root,'scripts/memory-vector-cases.json'),'utf8'));
 const vectorText=readFileSync(config.vectorsFile,'utf8');
 if(sha256(vectorText)!==config.vectorsSha)throw Error('query_vector_hash_mismatch');
 const queries=JSON.parse(vectorText).queries;
 S=await import('../server/src/store.ts');
 const M=await import('../server/src/conversation-memory.ts');
 server=await startLab(S,M,config.port);
 const http=makeHttp(config.port);
 scopeDb=openScopeDb(config.dataDir);
 vectorDb=openVectorDb(root,join(config.dataDir,'vectors.db'));
 result.sqliteVecVersion=vectorDb.prepare('select vec_version() as v').get().v;
 const run=(q,scope)=>{
  if(!queries[q])throw Error('persisted_query_vector_missing:'+q);
  return search({http,hash:S.hash,q,scope,queryVector:queries[q],scopeDb,vectorDb,frozen:plan.frozen});
 };
 result.sweep=await runSweep(plan,run);
 result.currentIds=[...(await http('/api/memories/automatic')).items.map(x=>x.id),...(await http('/lab/personal')).items.map(x=>x.id)].sort();
 result.preferenceIds=(await http('/lab/preferences')).map(x=>x.id);
 result.status='COMPLETED';
}catch(error){
 result.status='FAILED';result.error=String(error);exitCode=1;
}finally{
 try{if(server)await closeServer(server);}catch(error){result.status='FAILED';result.error=String(error);exitCode=1;}
 for(const handle of [vectorDb,scopeDb,S?.db]){try{handle?.close();}catch{}}
}
emitResult(config.resultFile,result,exitCode);
