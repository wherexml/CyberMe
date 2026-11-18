// Installed authorized cache -> temporary isolated SQLite. Configured real model credentials remain in RAM.
// Counts only in artifacts. No production writes, raw business text, credential export or external messages.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
const scope=await fs.mkdtemp(path.resolve('.local/acceptance/insight-delivery-real-')),out=path.resolve('output/insight-delivery-recovery-20261108'),home=path.join(os.homedir(),'Library/Application Support/OpsTwins');
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',CYBERME_FOLLOWUP_WORKER:'0',CYBERME_INSIGHT_VISUALS:'1'});
const {llm}=JSON.parse(await fs.readFile(home+'/.local/config.json','utf8')),origin=new URL(llm.baseUrl).origin,originalFetch=globalThis.fetch;let requests=0;
await fs.writeFile(scope+'/config.json',JSON.stringify({llm:{...llm,apiKey:'memory-only-placeholder'}}),{mode:0o600});
globalThis.fetch=(input,init={})=>{if(new URL(input instanceof Request?input.url:String(input)).origin!==origin)return originalFetch(input,init);requests++;const headers=new Headers(init.headers);headers.set('authorization','Bearer '+llm.apiKey);headers.set('x-api-key',llm.apiKey);return originalFetch(input,{...init,headers})};
const S=await import('../server/src/store.ts'),original=new DatabaseSync(home+'/data/opstwin-advance.db',{readOnly:true});
for(const type of ['connections','inbox_source_rules','inbox','tasks','memories','projects','ideas'])for(const r of original.prepare('SELECT * FROM entities WHERE type=?').all(type)){const keys=Object.keys(r);S.db.prepare('INSERT OR REPLACE INTO entities ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(r))}
for(const key of ['initialized','settings']){const r=original.prepare('SELECT value FROM meta WHERE key=?').get(key);if(r)S.setMeta(key,JSON.parse(r.value))}original.close();
const V=await import('../server/src/insight-visuals.ts'),eligible=V.visualEligibility().items.filter(x=>x.eligibility==='ok'),ids=new Set(eligible.map(x=>x.id));
const sample=S.list('ideas').filter(x=>ids.has(x.id)).sort((a,b)=>String(b.refreshedAt||b.updatedAt).localeCompare(String(a.refreshedAt||a.updatedAt))).slice(0,2);const before=new Map(sample.map(x=>[x.id,JSON.stringify(x)]));
// Keep only the fixed two newest eligible insights so the real automatic worker cannot generate extra items.
for(const idea of S.list('ideas'))if(!before.has(idea.id))S.db.prepare("DELETE FROM entities WHERE type='ideas' AND id=?").run(idea.id);
let report;
try{const timer=V.startInsightVisuals({pollMs:15000});clearInterval(timer);await new Promise(r=>setTimeout(r,0));const began=Date.now();
 while(V.visualStatus().running&&Date.now()-began<900000)await new Promise(r=>setTimeout(r,1000));
 const rows=sample.map(i=>{const r=S.db.prepare('SELECT data FROM insight_visuals WHERE idea_id=?').get(i.id);const v=r?JSON.parse(r.data):{};return {intent:i.intent,status:v.status,review:v.review?.verdict,mode:v.quality?.mode,calls:v.calls,error:v.error,recordUnchanged:JSON.stringify(S.get('ideas',i.id))===before.get(i.id)}});
 report={at:new Date().toISOString(),scope:'real configured model, newest two eligible installed insights, isolated writes',sampleCount:sample.length,requests,elapsedMs:Date.now()-began,rows,ready:rows.filter(x=>x.status==='ready'&&x.review==='pass').length,pass:sample.length===2&&rows.every(x=>x.status==='ready'&&x.review==='pass'&&x.recordUnchanged)};
}catch{report={pass:false,error:'real_visual_request_failed',requests}}
await fs.writeFile(out+'/real.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));S.db.close();await fs.rm(scope,{recursive:true,force:true});if(!report.pass)process.exitCode=1;
