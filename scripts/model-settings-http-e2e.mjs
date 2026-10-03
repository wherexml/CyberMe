import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,statSync} from 'node:fs';
const base='http://127.0.0.1:46110/api/settings/models';
const out='output/model-settings-20261002';mkdirSync(out,{recursive:true});
const checks=[];
async function req(method='GET',body,expected=200){const res=await fetch(base,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const text=await res.text();for(const key of secrets)assert(!text.includes(key),'Credential leaked');const result=JSON.parse(text);assert.equal(res.status,expected,JSON.stringify(result));return result;}
const privateBefore=JSON.parse(readFileSync('.local/config.json','utf8'));
const secrets=[privateBefore.llm?.apiKey,privateBefore.llm?.deepApiKey].filter(Boolean);
const initial=await req();let current=initial;
const selection=x=>({standard:x.standard,deep:x.deep});
try{
  assert(initial.providers.length>=2);checks.push({name:'GET exposes configured channels without secrets',status:'PASS'});
  for(const [name,input,status] of [
    ['stale version',{version:'stale',...selection(initial)},409],
    ['invalid model',{version:initial.version,...selection(initial),standard:{...initial.standard,model:'invalid model'}},400],
    ['unknown provider',{version:initial.version,...selection(initial),deep:{...initial.deep,providerId:'unknown'}},400],
    ['endpoint injection',{version:initial.version,...selection(initial),baseUrl:'https://example.com'},400],
    ['missing role',{version:initial.version,standard:initial.standard},400],
  ]){await req('PATCH',input,status);assert.equal((await req()).version,initial.version);checks.push({name,status:'PASS'});}
  current=await req('PATCH',{version:current.version,standard:initial.standard,deep:initial.standard});
  assert.deepEqual(selection(current),{standard:initial.standard,deep:initial.standard});
  assert(current.providers.some(p=>p.id===initial.deep.providerId));checks.push({name:'Both roles use one provider; other provider retained',status:'PASS'});
  await req('PATCH',{version:initial.version,...selection(initial)},409);checks.push({name:'Concurrent stale save rejected',status:'PASS'});
  current=await req('PATCH',{version:current.version,standard:initial.deep,deep:initial.standard});
  const privateAfter=JSON.parse(readFileSync('.local/config.json','utf8'));
  assert.equal(privateAfter.llm.apiKey,privateBefore.llm.deepApiKey||privateBefore.llm.apiKey);
  assert.equal(privateAfter.llm.baseUrl,privateBefore.llm.deepBaseUrl||privateBefore.llm.baseUrl);
  assert.equal(privateAfter.llm.deepApiKey,privateBefore.llm.apiKey);
  assert.equal(privateAfter.llm.gatewayCompatibility,privateBefore.llm.deepGatewayCompatibility);
  assert.equal(statSync('.local/config.json').mode&0o777,0o600);
  for(const k of Object.keys(privateBefore).filter(k=>k!=='llm'))assert.deepEqual(privateAfter[k],privateBefore[k]);
  checks.push({name:'Role swap moves endpoint, credentials, protocol and compatibility together; private file mode 0600; other config preserved',status:'PASS'});
}finally{
  if(current.version!==initial.version){current=await req('PATCH',{version:current.version,...selection(initial)});assert.deepEqual(selection(current),selection(initial));checks.push({name:'Original selections restored',status:'PASS'});}
  writeFileSync(out+'/http.json',JSON.stringify({at:new Date().toISOString(),checks,restored:selection(current)},null,2));
}
console.log(JSON.stringify({checks:checks.length,status:'PASS',artifact:out+'/http.json'}));
