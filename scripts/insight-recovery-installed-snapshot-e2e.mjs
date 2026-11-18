// Read the installed authorized cache; isolate all writes. Credentials stay in RAM.
// Full private snapshot is temporary, mode 0700, removed after run. Artifacts contain counts only.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {serve} from '@hono/node-server';
const home=path.join(os.homedir(),'Library/Application Support/OpsTwins'),scope=await fs.mkdtemp(path.resolve('.local/acceptance/installed-snapshot-')),out=path.resolve('output/insight-recovery-20261107');
Object.assign(process.env,{OPSTWIN_DATA_DIR:scope,OPSTWIN_PRIVATE_DIR:scope,OPSTWIN_NO_BACKGROUND:'1',OPSTWIN_NO_LISTEN:'1',OPSTWIN_API_PORT:'46879',OPSTWIN_WEB_PORT:'46879',OPSTWIN_IDEAS_BACKGROUND:'0',OPSTWIN_IDEAS_CHAT_BACKGROUND:'0',OPSTWIN_MEMORY_BACKGROUND:'0',OPSTWIN_INBOX_BACKGROUND:'0',OPSTWIN_CONNECTION_BACKGROUND:'0',OPSTWIN_NOTIFICATION_DELIVERY:'off'});
const {llm}=JSON.parse(await fs.readFile(home+'/.local/config.json','utf8')),origin=new URL(llm.baseUrl).origin,nativeFetch=globalThis.fetch;
await fs.writeFile(scope+'/config.json',JSON.stringify({llm:{...llm,apiKey:'in-memory-placeholder'}}),{mode:0o600});
globalThis.fetch=(input,init={})=>{if(new URL(input instanceof Request?input.url:String(input)).origin!==origin)return nativeFetch(input,init);const headers=new Headers(init.headers);headers.set('authorization','Bearer '+llm.apiKey);headers.set('x-api-key',llm.apiKey);return nativeFetch(input,{...init,headers})};
const S=await import('../server/src/store.ts'),original=new DatabaseSync(home+'/data/opstwin-advance.db',{readOnly:true});
const types=['connections','inbox_source_rules','inbox','tasks','memories','projects','ideas','feishu_records'];
for(const type of types)for(const r of original.prepare('SELECT * FROM entities WHERE type=?').all(type)){const keys=Object.keys(r);S.db.prepare('INSERT OR REPLACE INTO entities ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(r))}
for(const key of ['initialized','settings','ideas-background-v1']){const r=original.prepare('SELECT value FROM meta WHERE key=?').get(key);if(r)S.setMeta(key,JSON.parse(r.value))}original.close();
// Force a fresh read without changing the installed application's cache or state.
const old=S.meta('ideas-background-v1',{});S.setMeta('ideas-background-v1',{...old,status:'idle',nextAt:undefined});
const {app}=await import('../server/src/index.ts'),B=await import('../server/src/ideas-background.ts');const api=serve({fetch:app.fetch,port:46879,hostname:'127.0.0.1'});let report;
try{
const r=await fetch('http://127.0.0.1:46879/api/ideas/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'核对今天最新会议纪要和相关聊天的新变化；值得关注的判断、趋势和他人执行进展形成洞察，不强行转为本人待办。使用原文与精确 evidenceRef。'}),signal:AbortSignal.timeout(180000)}),d=await r.json(),st=B.ideasBackgroundStatus(),run=S.get('runs',st.runId),sources=new Map(B.sources().map(x=>[x.id,x]));
report={at:new Date().toISOString(),scope:'read-only installed cache snapshot; isolated writes; original configured model',http:r.status,error:d.error,run:{status:run?.status,sourceCount:run?.sourceCount,protocol:run?.protocol,repair:run?.events?.filter(e=>e.type==='structured_output_repair').map(({code,issues,path,reason})=>({code,issues,path,reason})),researchCalls:run?.tools?.filter(t=>t.name==='search_idea_sources'&&t.status==='succeeded').length},counts:d.counts,ideas:d.ideas?.map(i=>({intent:i.intent,occurredAt:i.occurredAt,sourceTypes:i.sourceIds.map(id=>sources.get(id)?.type),chatEvidence:i.evidence.filter(e=>e.messageId).length})),pass:r.ok};
}catch{report={pass:false,error:'snapshot_request_failed'}}
await fs.writeFile(out+'/installed-snapshot.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));api.close();S.db.close();await fs.rm(scope,{recursive:true,force:true});if(!report.pass)process.exitCode=1;
