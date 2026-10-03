import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'output/settings-language/api-e2e');
await mkdir(out,{recursive:true});
const data=resolve(out,'data-'+Date.now()),port=46129,base=`http://127.0.0.1:${port}`;
const env={...process.env,OPSTWIN_DATA_DIR:data,OPSTWIN_API_PORT:String(port)};
const entry="const store=await import('./server/src/store.ts');store.setMeta('initialized',true);await import('./server/src/index.ts');";
let child;const steps=[];
async function start(){
 child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',entry],{cwd:root,env,stdio:['ignore','pipe','ignore']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Service unavailable')),8000);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',()=>{clearTimeout(timer);reject(Error('Service exited before listening'))});child.stdout.on('data',chunk=>{if(String(chunk).includes(`API http://127.0.0.1:${port}`)){clearTimeout(timer);resolve();}});});
 for(let attempt=0;attempt<50;attempt++){if(child.exitCode!==null)throw Error('Service exited');try{assert.ok((await fetch(base+'/api/health')).ok);return;}catch{await new Promise(r=>setTimeout(r,100));}}throw Error('Health check unavailable');
}
async function stop(){if(!child||child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await done;clearTimeout(timer);}
async function get(path='/settings'){return (await fetch(base+'/api'+path)).json();}
async function patch(body){const r=await fetch(base+'/api/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
try{await start();const before=await get();
 for(const language of ['fr',null,5,'']){const r=await patch({identity:{language}});assert.equal(r.status,400);assert.equal(r.body.error,'invalid_language');assert.deepEqual(await get(),before);steps.push({case:'reject invalid language',language,status:'PASS'});}
 for(const language of ['zh-CN','en','zh-CN']){const r=await patch({identity:{language}});assert.equal(r.status,200);assert.deepEqual(r.body,{...before,identity:{...before.identity,language}});assert.equal((await get('/bootstrap')).settings.identity.language,language);steps.push({case:'round trip',language,status:'PASS'});}
 await stop();await start();assert.equal((await get()).identity.language,'zh-CN');steps.push({case:'restart persistence',status:'PASS'});
 await writeFile(resolve(out,'manifest.json'),JSON.stringify({status:'PASS',mode:'real HTTP + SQLite, isolated data',steps,externalActions:0},null,2));console.log(JSON.stringify({status:'PASS',checks:steps.length,artifact:resolve(out,'manifest.json')}));
}finally{await stop();}
