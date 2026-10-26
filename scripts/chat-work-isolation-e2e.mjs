import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'output/chat-work-real-20261023'),base='http://127.0.0.1:46640';
const checks=[];
async function check(name,fn){try{await fn();checks.push({name,status:'PASS'});}catch(e){checks.push({name,status:'FAIL',error:e.message});}}
await check('Isolated public notes are available',async()=>{const r=await fetch(base+'/api/bootstrap');assert.equal(r.status,200);const b=await r.json();assert.deepEqual(b.memories.map(x=>x.id).sort(),['cw-public-discussion','cw-public-plan']);assert.equal(b.connections.length,0);});
await check('Bare API access requires private capability',async()=>assert.equal((await fetch('http://127.0.0.1:46641/api/bootstrap')).status,403));
await check('Cross-origin POST is rejected before dispatch',async()=>assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({message:'must not dispatch'})})).status,403));
await check('External sends are not exposed',async()=>assert.equal((await fetch(base+'/api/inbox/public/send',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403));
await check('Settings mutations are not exposed',async()=>assert.equal((await fetch(base+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{}'})).status,403));
await check('Installed client binary matches recorded baseline',async()=>{const items=JSON.parse(await readFile(resolve(out,'client-baseline.json'),'utf8')).filter(x=>x.path.startsWith('/Applications/'));assert.ok(items.length);for(const item of items){const bytes=await readFile(item.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);}});
await writeFile(resolve(out,`isolation-${Date.now()}.json`),JSON.stringify({at:new Date().toISOString(),checks},null,2));console.log(JSON.stringify(checks));if(checks.some(x=>x.status==='FAIL'))process.exitCode=1;
