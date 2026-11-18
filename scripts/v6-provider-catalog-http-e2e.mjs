// Run with v6-provider-catalog-fixture.mjs. This performs real HTTP/SDK requests against an isolated provider.
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const host='http://127.0.0.1:46991',upstream='http://127.0.0.1:46992';
const out='output/v6-model-discovery',route='/api/settings/models';
const checks=[];
const check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw Error(name);};
async function ask(path,method='GET',data){
 const res=await fetch(host+path,{method,signal:AbortSignal.timeout(16000),...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
 const raw=await res.text();return {status:res.status,raw,data:JSON.parse(raw)};
}
const control=data=>ask('/__fixture/control','POST',data);
const evidence=async()=> (await ask('/__fixture/evidence')).data;
const discover=(version,provider)=>ask(route+'/providers/discover','POST',{version,provider});
const submit=(requestId,version,provider,models)=>ask(route+'/provider-tests','POST',{requestId,version,provider,models});
async function terminal(id){
 for(let i=0;i<60;i++){
  const v=await ask(route+'/provider-tests/'+id);
  if(v.status===200&&v.data.status!=='running')return v;
  await new Promise(r=>setTimeout(r,300));
 }
 throw Error('Batch failed to reach its terminal receipt');
}
try{
 await control({clear:true,catalogState:'default'});
 const saved=(await ask(route)).data;
 const version=saved.version,openai={id:'openai-test',baseUrl:upstream+'/v1',api:'openai-completions'};
 const anthropic={id:'anthropic-test',baseUrl:upstream+'/anthropic',api:'anthropic-messages'};
 const draft={id:'unsaved-provider',baseUrl:upstream+'/proxy',api:'openai-completions',apiKey:'public-fixture-draft-key'};
 const list=await discover(version,openai);
 check('Saved provider catalog uses its stored credential and deduplicates valid IDs',list.status===200&&list.data.models.length===4
  &&list.data.models.some(m=>m.id==='public-good'&&m.contextWindow===32000&&m.maxTokens===800&&!m.vision));
 check('Catalog does not echo either credential or invalid IDs',!list.raw.includes('public-fixture-existing-key')&&!list.raw.includes('not a model id'));
 check('Catalog discovery performs no inference',(await evidence()).calls.every(x=>x.kind==='catalog'));
 const fallback=await discover(version,draft);
 check('New unsaved key works at a proxy with a conventional /v1 catalog fallback',fallback.status===200&&!fallback.raw.includes(draft.apiKey)
  &&(await evidence()).calls.some(c=>c.path==='/proxy/v1/models'&&c.auth));
 const paged=await discover(version,anthropic);
 check('Anthropic credentials and all pages are sent on the configured path',paged.status===200&&paged.data.models.map(m=>m.id).join(',')==='saved-claude,public-claude-new'
  &&(await evidence()).calls.some(c=>c.after==='saved-claude'));
 const moved=await discover(version,{...openai,baseUrl:upstream+'/other/v1'});
 check('Edited endpoint never gets a saved key',moved.status===400&&moved.data.error==='model_provider_key_required'
  &&!(await evidence()).calls.some(c=>c.path.startsWith('/other')));
 const stale=await discover('stale',openai);
 check('Stale settings version rejected before connecting',stale.status===409);
 for(const [state,error] of [['unsupported','provider_catalog_unsupported'],['invalid','provider_catalog_invalid'],['redirect','provider_catalog_invalid']]){
  await control({catalogState:state});
  const value=await discover(version,openai);
  check(state+' catalog returns a classified error without vendor body',value.status===502&&value.data.error===error&&!value.raw.includes('private upstream HTML'));
 }
 check('Redirect destination never requested',!(await evidence()).calls.some(c=>c.path==='/redirected'));
 await control({catalogState:'empty'});
 check('Valid empty catalog returns empty result',(await discover(version,openai)).data.models.length===0);
 await control({clear:true,catalogState:'default',losePost:true});
 const id=randomUUID(),models=['public-good','public-denied','public-empty','public-four','public-five','public-hang'];
 const loss=await submit(id,version,openai,models);
 check('Simulated loss occurs after registering the test',loss.status===503);
 const competitor=await submit(randomUUID(),version,openai,['public-good']);
 check('Concurrency is limited across batches',competitor.status===409&&competitor.data.error==='provider_probe_busy');
 const retry=await submit(id,version,openai,models);
 check('Same test request reads original in-flight receipt',retry.status===200&&retry.data.id===id);
 const conflict=await submit(id,version,openai,['public-good']);
 check('Same request ID with different inputs is rejected',conflict.status===409&&conflict.data.error==='model_probe_conflict');
 const done=await terminal(id);
 check('Mixed outcomes are returned in requested order',done.data.results.map(x=>x.model).join(',')===models.join(',')
  &&done.data.results.map(x=>x.status==='succeeded'?'success':x.failureCode).join(',')==='success,provider_auth,provider_empty_response,success,success,llm_timeout');
 check('Batch receipts contain no secret or upstream response body',!done.raw.includes('private vendor failure')&&!done.raw.includes('public-fixture-existing-key'));
 const executed=await evidence();
 check('One short, tool-free request per requested model, with at most four concurrent calls',executed.peak<=4
  &&executed.calls.filter(x=>x.kind==='test').length===models.length&&executed.calls.every(x=>x.auth&&x.tiny));
 for(const [provider,model,path] of [[anthropic,'saved-claude','/anthropic/v1/messages'],
  [{...draft,baseUrl:upstream+'/v1',api:'openai-responses'},'public-response','/v1/responses']]){
  const protocolId=randomUUID();
  check(path+' starts test',(await submit(protocolId,version,provider,[model])).status===200);
  const receipt=await terminal(protocolId);
  check(path+' returns a true text response',receipt.data.results[0].status==='succeeded');
 }
 check('Existing Claude Code compatibility reaches the Anthropic protocol', (await evidence()).calls.some(x=>x.path==='/anthropic/v1/messages'&&x.compatibility&&x.tiny));
 check('Discovery and batch tests never write or switch provider settings',(await ask(route)).data.version===version);
}catch(error){checks.push({name:'Execution error',pass:false,error:error.message});process.exitCode=1;}
await mkdir(out,{recursive:true});await writeFile(out+'/http-result.json',JSON.stringify({source:host,checks},null,2));
console.log({passed:checks.filter(x=>x.pass).length,total:checks.length,failed:checks.filter(x=>!x.pass).map(x=>x.name)});
