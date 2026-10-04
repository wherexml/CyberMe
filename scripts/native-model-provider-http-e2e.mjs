// Real production HTTP with public isolated configuration; no external sends/model calls.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:net';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'.local/acceptance/model-provider-v20'),out=join(root,'output/native-model-ui-20261004'),port=46236,api=`http://127.0.0.1:${port}`;
const runOut=join(out,'stable-provider-binding',new Date().toISOString().replaceAll(':','-'));fs.mkdirSync(runOut,{recursive:true});
await new Promise((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(port,'127.0.0.1',()=>s.close(ok));});
fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.mkdirSync(out,{recursive:true});
const secret='public-fixture-key-20261004',file=join(dir,'config.json');
const unrelated={sentinel:'OPSADV-QA-root-preserved',items:[1,2,3]};
fs.writeFileSync(file,JSON.stringify({unrelatedPublic:unrelated,llm:{baseUrl:'https://fixture.invalid/v1',apiKey:secret,api:'anthropic-messages',model:'fixture-read-only',deepModel:'fixture-read-only'}}),{mode:0o600});
const data=join(dir,'data');fs.mkdirSync(data,{recursive:true});
const db=new DatabaseSync(join(data,'opstwin-advance.db'));db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('initialized','true');db.close();
let log='';const start=()=>spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_PRIVATE_DIR:dir,OPSTWIN_DATA_DIR:data,OPSTWIN_API_PORT:String(port),OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NOTIFICATION_DELIVERY:'off',OPSTWIN_AUTONOMOUS_DELIVERY:'off'},stdio:['ignore','pipe','pipe']});let child=start();child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
const checks=[],report={scope:'isolated production HTTP; public synthetic credentials; model calls NOT_RUN; GUI separate',checks};
const req=async(method,path,body)=>{const r=await fetch(api+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();if(text.includes(secret))throw Error('credential disclosure');return {status:r.status,value:JSON.parse(text)}};
const check=(name,condition)=>{checks.push({name,status:condition?'PASS':'FAIL'});if(!condition)throw Error(name)};
const get=async()=>{const r=await req('GET','/api/settings/models');check('read settings',r.status===200);return r.value};
const save=async(p,version)=>req('PATCH','/api/settings/models/providers',{version,provider:p});
let failed=false;
try {
 for(let n=0;n<100;n++){try{if((await fetch(api+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 let s=await get();check('legacy model definitions projected',s.providers[0].definitions.some(m=>m.id==='fixture-read-only'));
 const m={id:'public-model-v20',smart:false,contextWindow:64000,maxTokens:4096,reasoning:true,vision:false};
 const p={id:'public-provider-v20',name:'公开验收供应商',baseUrl:'https://public.invalid/v1',api:'openai-completions',apiKey:secret,enabled:true,definitions:[m]};
 const first=await save(p,s.version);check('create provider with complete model definition',first.status===200);
 check('public response excludes key',!JSON.stringify(first.value).includes('apiKey'));
 check('private file mode 0600',(fs.statSync(file).mode&0o777)===0o600);
 const stale=await save(p,s.version);check('stale lease rejected',stale.status===409);
 s=await get();let invalid=await req('PATCH','/api/settings/models/providers',{version:s.version,provider:p,unexpected:true});check('malformed provider envelope is400 not lease409',invalid.status===400);let r=await save({...p,definitions:[{...m,maxTokens:64001}]},s.version);check('output larger than context rejected',r.status===400);
 r=await save({...p,definitions:[m,m]},s.version);check('duplicate model rejected',r.status===400);
 r=await save({...p,baseUrl:'https://public.invalid/v1?token=secret'},s.version);check('credential URL rejected',r.status===400);
 r=await save({...p,api:'unsupported'},s.version);check('unsupported protocol rejected',r.status===400);
 const noKey={...p};delete noKey.apiKey;
 r=await save({...noKey,baseUrl:'https://changed.invalid/v1'},s.version);check('changed destination cannot reuse key',r.status===400);
 r=await save({...noKey,name:'更新供应商'},s.version);check('same destination reuses private key',r.status===200);
 s=await get();r=await req('PATCH','/api/settings/models',{version:s.version,standard:{providerId:p.id,model:m.id},deep:s.deep});check('select saved model',r.status===200);
 const llm=JSON.parse(fs.readFileSync(file)).llm;check('runtime config carries complete model options',JSON.stringify(llm.modelOptions)===JSON.stringify(m)&&llm.api==='openai-completions'&&llm.apiKey===secret);
 s=await get();r=await save({...noKey,enabled:false},s.version);check('active provider cannot be disabled',r.status===400);
 r=await save({...noKey,definitions:[]},s.version);check('active model cannot be removed',r.status===400);
 s=await get();check('reload retains provider model metadata',s.providers.find(x=>x.id===p.id).definitions[0].contextWindow===64000);
 // Real complete-process duplicate destination regression, not an in-process unit.
 const duplicate={...p,id:'public-provider-duplicate-v21',name:'公开同渠道验收供应商'};
 r=await save(duplicate,s.version);check('same-binding second provider created',r.status===200);
 s=await get();const originalDeep={...s.deep};
 r=await req('PATCH','/api/settings/models',{version:s.version,standard:{providerId:duplicate.id,model:m.id},deep:originalDeep});check('select same-binding second provider HTTP200',r.status===200);
 check('canonical retains selected duplicate provider ID',r.value.standard.providerId===duplicate.id);
 s=await get();check('reread retains duplicate provider ID',s.standard.providerId===duplicate.id);
 const oldProvider={...noKey,name:'旧供应商仅改名字'};
 r=await save(oldProvider,s.version);check('editing old identical binding does not steal selected ID',r.status===200&&r.value.standard.providerId===duplicate.id);
 s=await get();const editedDef={...m,contextWindow:96000,maxTokens:8192};const edited={...duplicate,name:'当前供应商改名字',definitions:[editedDef]};delete edited.apiKey;
 r=await save(edited,s.version);check('editing selected duplicate retains ID and definition',r.status===200&&r.value.standard.providerId===duplicate.id&&r.value.providers.find(x=>x.id===duplicate.id).definitions[0].maxTokens===8192);
 check('selected duplicate runtime options canonical',JSON.parse(fs.readFileSync(file)).llm.modelOptions.maxTokens===8192);
 s=await get();r=await save({...edited,enabled:false},s.version);check('selected duplicate cannot be disabled',r.status===400&&r.value.error==='provider_in_use');
 r=await save({...edited,definitions:[]},s.version);check('selected duplicate model cannot be removed',r.status===400&&r.value.error==='provider_in_use');
 r=await req('PATCH','/api/settings/models',{version:s.version,standard:{providerId:duplicate.id,model:'unknown-public-model'},deep:originalDeep});check('defined provider rejects unknown selected model',r.status===400);
 const goodBytes=fs.readFileSync(file);const mutate=async(fn)=>{const value=JSON.parse(goodBytes);fn(value.llm);fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});return req('GET','/api/settings/models');};
 for(const [name,mutation] of [
  ['unknown explicit ID',l=>{l.standardProviderId='missing-public-provider';}],
  ['empty explicit ID',l=>{l.standardProviderId='';}],
  ['nonstring explicit ID',l=>{l.standardProviderId=3;}],
  ['null explicit ID',l=>{l.standardProviderId=null;}],
  ['explicit endpoint mismatch',l=>{l.baseUrl='https://mismatch.invalid/v1';}],
  ['explicit protocol mismatch',l=>{l.api='openai-responses';}],
  ['explicit key mismatch',l=>{l.apiKey='public-other-key-20261004';}],
  ['explicit compatibility mismatch',l=>{l.gatewayCompatibility='claude-code';}],
  ['explicit disabled provider',l=>{l.modelProviders.find(x=>x.id===duplicate.id).enabled=false;}],
  ['explicit removed current model',l=>{l.modelProviders.find(x=>x.id===duplicate.id).definitions=[];}],
  ['explicit duplicated ID',l=>{l.modelProviders.push({...l.modelProviders.find(x=>x.id===duplicate.id)});}],
  ['deep unknown explicit ID',l=>{l.deepProviderId='missing-public-provider';}],
  ['deep binding mismatch',l=>{l.deepBaseUrl='https://deep-mismatch.invalid/v1';}],
 ]){const invalid=await mutate(mutation);check(name+' rejected clearly',invalid.status===503&&invalid.value.error==='model_provider_binding_invalid');}
 fs.writeFileSync(file,goodBytes,{mode:0o600});s=await get();
 const legacy=JSON.parse(goodBytes);delete legacy.llm.standardProviderId;delete legacy.llm.deepProviderId;fs.writeFileSync(file,JSON.stringify(legacy),{mode:0o600});s=await get();const legacyRoles={standard:{...s.standard},deep:{...s.deep}};
 const migrate={...p,id:'public-legacy-migrate-v21',name:'公开legacy迁移',baseUrl:'https://legacy-migrate.invalid/v1'};
 r=await save(migrate,s.version);check('legacy first provider write preserves both roles',r.status===200&&JSON.stringify(r.value.standard)===JSON.stringify(legacyRoles.standard)&&JSON.stringify(r.value.deep)===JSON.stringify(legacyRoles.deep));
 const migrated=JSON.parse(fs.readFileSync(file)).llm;check('legacy first write persists stable role IDs',migrated.standardProviderId===legacyRoles.standard.providerId&&migrated.deepProviderId===legacyRoles.deep.providerId);
 // A first role write from a legacy configuration also pins the other role.
 const roleLegacy=JSON.parse(fs.readFileSync(file));delete roleLegacy.llm.standardProviderId;delete roleLegacy.llm.deepProviderId;fs.writeFileSync(file,JSON.stringify(roleLegacy),{mode:0o600});s=await get();const legacyDeep={...s.deep};
 r=await req('PATCH','/api/settings/models',{version:s.version,standard:{providerId:duplicate.id,model:m.id},deep:legacyDeep});check('legacy first role write pins explicit new ID and original deep',r.status===200&&r.value.standard.providerId===duplicate.id&&JSON.stringify(r.value.deep)===JSON.stringify(legacyDeep));
 const pinned=JSON.parse(fs.readFileSync(file)).llm;check('legacy first role private IDs canonical',pinned.standardProviderId===duplicate.id&&pinned.deepProviderId===legacyDeep.providerId);
 // Return to the selected duplicate and verify real restart after stable migration.
 s=await get();r=await req('PATCH','/api/settings/models',{version:s.version,standard:{providerId:duplicate.id,model:m.id},deep:originalDeep});check('duplicate selected again after legacy migration',r.status===200&&r.value.standard.providerId===duplicate.id);
 await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
 child=start();child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 for(let n=0;n<100;n++){try{if((await fetch(api+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 s=await get();check('same-binding explicit supplier survives process restart',s.standard.providerId===duplicate.id&&s.deep.providerId===originalDeep.providerId);
 r=await req('PATCH','/api/settings/models',{version:s.version,standard:s.standard,deep:{providerId:p.id,model:m.id}});check('deep same-binding independent supplier selected',r.status===200&&r.value.standard.providerId===duplicate.id&&r.value.deep.providerId===p.id);
 s=await get();r=await req('PATCH','/api/settings/models',{version:s.version,standard:s.standard,deep:originalDeep});check('deep role restored without losing standard duplicate ID',r.status===200&&r.value.standard.providerId===duplicate.id&&r.value.deep.providerId===originalDeep.providerId);
 const changedProvider={...edited,baseUrl:'https://explicit-current.changed.invalid/v1',apiKey:'public-fixture-replacement-key-20261004'};s=await get();r=await save(changedProvider,s.version);check('selected destination edit with explicit new key retains stable identity',r.status===200&&r.value.standard.providerId===duplicate.id);
 s=await get();check('changed destination reread remains explicit selected supplier',s.standard.providerId===duplicate.id&&s.providers.find(x=>x.id===duplicate.id).baseUrl===changedProvider.baseUrl);
 r=await save({...edited,apiKey:secret},s.version);check('selected destination restored with exact binding identity',r.status===200&&r.value.standard.providerId===duplicate.id);
 check('all provider and role writes preserve unrelated root fields',JSON.stringify(JSON.parse(fs.readFileSync(file)).unrelatedPublic)===JSON.stringify(unrelated));
 // Keep the existing GUI fixture role behavior after regression.
 s=await get();
 // Restore the public fixture role for GUI, leaving the new provider available.
 r=await req('PATCH','/api/settings/models',{version:s.version,standard:s.deep,deep:s.deep});check('restore fixture role',r.status===200);
 await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
 child=start();child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 for(let n=0;n<100;n++){try{if((await fetch(api+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 s=await get();check('process restart retains provider definition',s.providers.find(x=>x.id===p.id).definitions[0].maxTokens===4096);
 report.status='PASS';
}catch(e){failed=true;report.status='FAIL';report.error=String(e.message);}
finally{
 report.sourceHashes=Object.fromEntries(['server/src/model-settings.ts','server/src/agent.ts','native/macos/app/src/settings.rs','native/macos/app/src/search.rs'].map(f=>[f,createHash('sha256').update(fs.readFileSync(join(root,f))).digest('hex')]));
 fs.writeFileSync(join(runOut,'http-manifest.json'),JSON.stringify(report,null,2));fs.writeFileSync(join(out,'http-manifest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:checks.length,artifact:join(runOut,'http-manifest.json')}));
 if(process.argv.includes('--serve')&&!failed){console.log('Isolated GUI API '+api);await new Promise(()=>{});}else{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
}
if(failed)process.exitCode=1;
