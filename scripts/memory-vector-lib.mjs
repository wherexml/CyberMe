// Shared by the worker and the fresh restart process, so both run the same search code.
// Isolated experiment only: no production retrieval path imports this file.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';

export const PORTS={parent:46827,child:46828};
// hybridRrfOnly is RRF before lexical retention. It is a comparison arm that exposes the policy's effect.
export const ARMS=['lexical','scopedLexical','scopedSemantic','hybrid','hybridRrfOnly'];
export const GATED_ARMS=['scopedLexical','scopedSemantic','hybrid','hybridRrfOnly'];
export const FUSION_POLICY='rrf+retain-scoped-lexical-rank-1-v1';
const RESERVED_PORTS=[46110,46312];
const RAW_NEIGHBOR_LIMIT=200;
export const DATA_ROOT_PREFIX='.local/acceptance/memory-vector-v2-';
export const RESULT_PREFIX='MEMORY_VECTOR_RESULT ';

export const sha256=value=>createHash('sha256').update(value).digest('hex');

export function assertExperimentPort(port){
 if(!Number.isInteger(port)||port<10000||port>65535||RESERVED_PORTS.includes(port))throw Error('invalid_experiment_port:'+port);
}
export async function assertPortFree(port){
 assertExperimentPort(port);
 await new Promise((ok,no)=>{const s=createServer();s.once('error',no);s.listen(port,'127.0.0.1',()=>s.close(ok));});
}
// Refuses anything but a fresh experiment root before the store module opens a database.
export function assertIsolatedData(root,dataDir){
 const expected=resolve(root,DATA_ROOT_PREFIX);
 if(!resolve(dataDir).startsWith(expected))throw Error('data_dir_not_isolated');
 if(process.env.OPSTWIN_DATA_DIR!==dataDir||process.env.OPSTWIN_PRIVATE_DIR!==dataDir)throw Error('data_env_mismatch');
 if(process.env.OPSTWIN_STANDALONE)throw Error('standalone_env_forbidden');
}
export function emitResult(path,value,exitCode=0){
 const text=JSON.stringify(value);
 writeFileSync(path,text);
 process.exitCode=exitCode;
 // Explicit exit: a lingering import side effect must not hang verification.
 process.stdout.write(RESULT_PREFIX+JSON.stringify({path,sha256:sha256(text)})+'\n',()=>process.exit(exitCode));
}

export function collectTexts(plan){
 const documents=new Set(),queries=new Set();
 const walk=value=>{
  if(Array.isArray(value)){value.forEach(walk);return;}
  if(!value||typeof value!=='object')return;
  if(typeof value.q==='string')queries.add(value.q);
  if(typeof value.content==='string')documents.add(value.content);
  Object.values(value).forEach(walk);
 };
 walk(plan.corpus);walk(plan.cases);walk(plan.lifecycle);
 return {documents:[...documents],queries:[...queries]};
}
// Every registered query, including lifecycle ones. The parent and the child must cover the same list.
export function sweepQueries(plan){
 const seen=new Map();
 const walk=value=>{
  if(Array.isArray(value)){value.forEach(walk);return;}
  if(!value||typeof value!=='object')return;
  if(typeof value.q==='string'){
   if(typeof value.scope!=='string'||!value.scope)throw Error('query_scope_required:'+value.q);
   seen.set(sweepKey(value.q,value.scope),{q:value.q,scope:value.scope});
  }
  Object.values(value).forEach(walk);
 };
 walk(plan.cases);walk(plan.lifecycle);
 return [...seen.values()];
}
export const sweepKey=(q,scope)=>scope+'\u0000'+q;

// Experiment scope lives apart from vectors, so losing the index cannot change eligibility.
export function openScopeDb(dataDir){
 const db=new DatabaseSync(join(dataDir,'experiment-scope.db'));
 db.exec(`CREATE TABLE IF NOT EXISTS memory_key(id TEXT PRIMARY KEY,key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_scope(id TEXT PRIMARY KEY,scope TEXT NOT NULL CHECK(scope<>''));`);
 return db;
}
export function openVectorDb(root,path){
 const sqliteVec=createRequire(join(root,'.local/acceptance/memory-vector-deps/package.json'))('sqlite-vec');
 const db=new DatabaseSync(path,{allowExtension:true});
 sqliteVec.load(db);
 db.enableLoadExtension(false);
 return db;
}
export const vectorBytes=vector=>new Uint8Array(new Float32Array(vector).buffer);

export async function startLab(S,M,port){
 assertExperimentPort(port);
 const api=new Hono();
 M.mountMemory(api);
 let serial=0;
 const automaticRow=id=>{const row=S.db.prepare('SELECT data FROM automatic_memories WHERE id=?').get(id);return row?JSON.parse(row.data):undefined;};
 api.post('/lab/remember',async c=>{
  const {content,slot,category='work'}=await c.req.json(),id='lab-source-'+(++serial);
  S.put('messages',{id,conversationId:'lab',role:'user',content});
  S.put('runs',{id:id+'-run',kind:'chat',status:'succeeded',tools:[]});
  return c.json(M.rememberFact({slot,category,evidence:content},{prompt:content,messageId:id,requestId:id+'-request',conversationId:'lab',runId:id+'-run'}));
 });
 api.post('/lab/manual',async c=>{const {content}=await c.req.json();return c.json(S.put('memories',{kind:'personal',title:'公开合成手写备注',body:content}));});
 api.post('/lab/manual-remove',async c=>{const {id}=await c.req.json();S.remove('memories',id);return c.json({ok:true});});
 api.post('/lab/source-change',async c=>{const {id}=await c.req.json(),row=automaticRow(id);S.put('messages',{...S.get('messages',row.messageId),content:'公开来源已改动。'});return c.json({ok:true});});
 api.get('/lab/lexical',c=>c.json(M.recalledMemories(c.req.query('q')||'')));
 api.get('/lab/preferences',c=>c.json(M.automaticPreferences()));
 // Same predicate as recalledMemories uses for handwritten personal memories.
 api.get('/lab/personal',c=>c.json({items:S.list('memories').filter(m=>!m.sourceSystem&&m.kind==='personal')}));
 api.get('/lab/status',c=>{const row=automaticRow(c.req.query('id'));return c.json({status:row?.status??null,previousId:row?.previousId??null});});
 api.onError((e,c)=>c.json({error:e.code||e.message},e.status||500));
 return await new Promise((ok,no)=>{const server=serve({fetch:api.fetch,hostname:'127.0.0.1',port},()=>ok(server));server.once?.('error',no);});
}
export const closeServer=server=>new Promise(ok=>{server.close(ok);server.closeAllConnections?.();});

export function makeHttp(port){
 const raw=async(path,body)=>{
  const response=await fetch(`http://127.0.0.1:${port}`+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  return {status:response.status,data:await response.json()};
 };
 const http=async(path,body)=>{const {status,data}=await raw(path,body);if(status<200||status>=300)throw Error('lab_http_'+status+':'+JSON.stringify(data));return data;};
 http.raw=raw;
 return http;
}

const uniqueById=items=>{const seen=new Set();return items.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;});};
export const scopeVisible=(memoryScope,queryScope)=>memoryScope==='global'||memoryScope===queryScope;

function semanticCandidates({queryVector,vectorDb,frozen,current,scopes,queryScope,hash,keyOf}){
 if(!queryVector)return {status:'embedding_unavailable',raw:[],valid:[],saturated:false};
 let rows;
 try{rows=vectorDb.prepare('SELECT id,distance FROM memory_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance').all(vectorBytes(queryVector),RAW_NEIGHBOR_LIMIT);}
 catch{return {status:'index_unavailable',raw:[],valid:[],saturated:false};}
 let meta=[],status='ok';
 try{meta=vectorDb.prepare('SELECT id,content_hash,model FROM index_meta').all();}catch{status='index_meta_unavailable';}
 const metaById=new Map(meta.map(x=>[x.id,x]));
 const decide=(id,similarity)=>{
  const row=metaById.get(id);
  if(!row)return 'no_index_meta';
  if(row.model!==frozen.model)return 'model_mismatch';
  if(!current.has(id))return 'not_active_source';
  if(hash(current.get(id).content)!==row.content_hash)return 'content_hash_mismatch';
  if(!scopes.has(id))return 'unscoped';
  if(!scopeVisible(scopes.get(id),queryScope))return 'out_of_scope';
  return similarity>=frozen.threshold?'eligible':'below_threshold';
 };
 const raw=rows.map(x=>{const similarity=1-x.distance;return {id:x.id,key:keyOf(x.id),distance:x.distance,similarity,decision:decide(x.id,similarity)};});
 return {status,raw,valid:raw.filter(x=>x.decision==='eligible'),saturated:rows.length>=RAW_NEIGHBOR_LIMIT};
}

// RRF uses rank only and rewards appearing in both lists, so an item with no vector can lose
// to three weaker items found by both paths. The best eligible keyword hit therefore keeps
// position K. See "Fusion amendment" in memory-vector-plan.md for the precision costs.
function retainLexicalTop(top,lexicalTop,fused,topK){
 if(!lexicalTop||top.some(x=>x.id===lexicalTop.id))return {hybrid:top,lexicalRetention:{applied:false}};
 const retained=fused.find(x=>x.id===lexicalTop.id),displaced=top[topK-1];
 return {hybrid:[...top.slice(0,topK-1),{...retained,retainedByPolicy:true}],lexicalRetention:{applied:true,retained:retained.key,displaced:displaced.key}};
}

// The single search implementation. Keyword eligibility reads only the authoritative
// source and the scope table; it never consults memory_vec or index_meta.
export async function search({http,hash,q,scope,queryVector,scopeDb,vectorDb,frozen}){
 if(typeof scope!=='string'||!scope)throw Error('query_scope_required');
 const lexicalResponse=await http('/lab/lexical?q='+encodeURIComponent(q));
 const automatic=(await http('/api/memories/automatic')).items.filter(x=>!x.slot.startsWith('communication:'));
 const personal=(await http('/lab/personal')).items;
 const current=new Map();
 for(const row of automatic)current.set(row.id,{kind:'automatic',content:row.content});
 for(const row of personal)current.set(row.id,{kind:'manual',content:String(row.content??row.body??'')});
 const scopes=new Map(scopeDb.prepare('SELECT id,scope FROM memory_scope').all().map(x=>[x.id,x.scope]));
 const keys=new Map(scopeDb.prepare('SELECT id,key FROM memory_key').all().map(x=>[x.id,x.key]));
 const keyOf=id=>keys.get(id)||id;
 const lexicalAll=uniqueById(lexicalResponse.items);
 const lexicalExcluded=[],scopedLexicalAll=[];
 for(const item of lexicalAll){
  if(!current.has(item.id))lexicalExcluded.push({id:item.id,key:keyOf(item.id),reason:'not_active_source'});
  else if(!scopes.has(item.id))lexicalExcluded.push({id:item.id,key:keyOf(item.id),reason:'unscoped'});
  else if(!scopeVisible(scopes.get(item.id),scope))lexicalExcluded.push({id:item.id,key:keyOf(item.id),reason:'out_of_scope'});
  else scopedLexicalAll.push(item);
 }
 const semantic=semanticCandidates({queryVector,vectorDb,frozen,current,scopes,queryScope:scope,hash,keyOf});
 const scores=new Map();
 for(const list of [scopedLexicalAll,semantic.valid])list.forEach((x,i)=>scores.set(x.id,(scores.get(x.id)||0)+1/(frozen.rrfK+i+1)));
 const fused=[...scores].sort((a,b)=>b[1]-a[1]).map(([id,score])=>({id,key:keyOf(id),score}));
 const hybridRrfOnly=fused.slice(0,frozen.topK);
 const {hybrid,lexicalRetention}=retainLexicalTop(hybridRrfOnly,scopedLexicalAll[0],fused,frozen.topK);
 const lexicalView=x=>({id:x.id,key:keyOf(x.id),score:x.score});
 return {
  q,scope,
  lexical:lexicalAll.slice(0,frozen.topK).map(lexicalView),
  scopedLexical:scopedLexicalAll.slice(0,frozen.topK).map(lexicalView),
  scopedSemantic:semantic.valid.slice(0,frozen.topK).map(x=>({id:x.id,key:x.key,similarity:x.similarity})),
  hybrid,
  hybridRrfOnly,
  lexicalRetention,
  rawSemantic:semantic.raw,
  semanticStatus:semantic.status,
  semanticSaturated:semantic.saturated,
  lexicalTruncated:!!lexicalResponse.truncated,
  lexicalExcluded,
 };
}
export async function runSweep(plan,run){
 const results={};
 for(const {q,scope} of sweepQueries(plan))results[sweepKey(q,scope)]=await run(q,scope);
 return results;
}
export const rankOf=(result,arm,id)=>{const i=result[arm].findIndex(x=>x.id===id);return i<0?null:i+1;};

const zero=()=>({queries:0,hitAt1:0,hitAt3:0,emptyReturnFailures:0,missWithResults:0,returnedRelevant:0,returnedIrrelevant:0,precisionSum:0,maxPrecisionSum:0,noAnswerQueries:0,falseReturnQueries:0,outOfScopeLeaks:0,unscopedReturned:0,inScopeIrrelevant:0,forbiddenReturned:0});
function finish(m){
 const {precisionSum,maxPrecisionSum,...rest}=m;
 return {...rest,precisionAt3:m.queries?precisionSum/m.queries:null,maxPrecisionAt3:m.queries?maxPrecisionSum/m.queries:null,falseReturnRate:m.noAnswerQueries?m.falseReturnQueries/m.noAnswerQueries:null};
}
function addRow(m,row,arm,scopeByKey,topK){
 const {expected,forbidden=[],scope}=row.case,items=row.result[arm],keys=items.map(x=>x.key);
 const relevant=keys.filter(k=>expected.includes(k)).length;
 for(const key of keys){
  if(forbidden.includes(key))m.forbiddenReturned++;
  if(expected.includes(key))continue;
  const memoryScope=scopeByKey[key];
  if(memoryScope===null||memoryScope===undefined)m.unscopedReturned++;
  else if(!scopeVisible(memoryScope,scope))m.outOfScopeLeaks++;
  else m.inScopeIrrelevant++;
 }
 if(expected.length){
  m.queries++;
  if(expected.includes(keys[0]))m.hitAt1++;
  if(relevant>0)m.hitAt3++;
  if(!keys.length)m.emptyReturnFailures++;
  else if(!relevant)m.missWithResults++;
  m.returnedRelevant+=relevant;
  m.returnedIrrelevant+=keys.length-relevant;
  // The denominator stays topK, so a short result set cannot inflate precision.
  m.precisionSum+=relevant/topK;
  m.maxPrecisionSum+=Math.min(expected.length,topK)/topK;
 }else{
  m.noAnswerQueries++;
  if(keys.length)m.falseReturnQueries++;
 }
}
export function metricsByArm(rows,scopeByKey,topK){
 return Object.fromEntries(ARMS.map(arm=>{
  const overall=zero(),groups={};
  for(const row of rows){
   addRow(overall,row,arm,scopeByKey,topK);
   addRow(groups[row.case.group]??=zero(),row,arm,scopeByKey,topK);
  }
  return [arm,{overall:finish(overall),byGroup:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,finish(v)]))}];
 }));
}
