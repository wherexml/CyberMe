// Production HTTP integration; public fixtures only. Never print token, model configuration or bodies.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {token}=JSON.parse(await readFile(resolve(root,'.local/mygo-pilot-public-v2/connection.json'),'utf8'));
const checks=[];
async function call(method,path,body,auth=true){const r=await fetch('http://127.0.0.1:46310'+path,{method,headers:{'Content-Type':'application/json',...(auth?{'X-OpsTwins-Pilot':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
async function check(name,fn){try{await fn();checks.push({name,status:'PASS'})}catch(e){checks.push({name,status:'FAIL',error:e.code||e.name});throw e}}
const file=resolve(root,'output/mygo-1007/http-'+Date.now()+'.json');
try{
 await check('missing authentication denied',async()=>assert.equal((await call('GET','/api/health',undefined,false)).status,403));
 await check('source and binding routes denied',async()=>{for(const path of ['/api/connections','/api/settings/feishu/binding','/api/sources/chats'])assert.equal((await call('GET',path)).status,403)});
 await check('write-capable chat denied',async()=>assert.equal((await call('POST','/api/chat',{message:'must not execute',requestId:randomUUID(),readOnly:false})).status,403));
 await check('external send denied',async()=>assert.equal((await call('POST','/api/inbox/mygo-public-inbox-1/send',{})).status,403));
 await check('exact public dataset',async()=>{const r=await call('GET','/api/inbox?limit=200');assert.equal(r.status,200);const rows=Array.isArray(r.data)?r.data:r.data.items;assert.equal(rows.length,3);assert(rows.every(r=>/^mygo-public-inbox-[123]$/.test(r.id)))});
 await check('autosave canonical lease, conflict and recovery',async()=>{const path='/api/inbox/mygo-public-inbox-1',old=await call('GET',path);assert.equal(old.status,200);const marker='OPSADV-QA-MYGO HTTP '+randomUUID();const saved=await call('PATCH',path,{draft:marker,editedByUser:true,baseUpdatedAt:old.data.updatedAt});assert.equal(saved.status,200);assert.equal(saved.data.draft,marker);const stale=await call('PATCH',path,{draft:'must not overwrite',baseUpdatedAt:old.data.updatedAt});assert.equal(stale.status,409);const exact=await call('GET',path);assert.equal(exact.data.draft,marker);const restored=await call('PATCH',path,{draft:old.data.draft,editedByUser:old.data.editedByUser,baseUpdatedAt:exact.data.updatedAt});assert.equal(restored.status,200);assert.equal(restored.data.draft,old.data.draft)});
 await check('safe model metadata',async()=>{const r=await call('GET','/api/settings/models');assert.equal(r.status,200);assert(!JSON.stringify(r.data).includes('apiKey'));assert(r.data.providers.length>0)});
 await check('missing durable request is 404',async()=>{assert.equal((await call('GET','/api/chat/requests/missing-'+randomUUID())).status,404);assert.equal((await call('GET','/api/pilot/drafts/missing-'+randomUUID())).status,404)});
}finally{await mkdir(dirname(file),{recursive:true});const sources={};for(const p of ['scripts/mygo-pilot-service.mjs','scripts/mygo-pilot-http-e2e.mjs'])sources[p]=createHash('sha256').update(await readFile(resolve(root,p))).digest('hex');await writeFile(file,JSON.stringify({at:new Date().toISOString(),scope:'public-v2',checks,sources,gui:'NOT_RUN by this script'},null,2));console.log(JSON.stringify({file,passed:checks.filter(c=>c.status==='PASS').length,failed:checks.filter(c=>c.status==='FAIL').length}));}
