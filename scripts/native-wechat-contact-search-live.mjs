#!/usr/bin/env node
// Explicit readonly lookup; private search terms enter stdin, never saved in evidence.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
let query='';for await(const chunk of process.stdin)query+=chunk;query=query.trim();if(!query)throw Error('Provide a contact query on stdin');
const root=resolve(import.meta.dirname,'..'),api=process.env.OPSTWIN_QA_API||'http://127.0.0.1:46110',out=join(root,'output/native-wechat-search-20261004/live-'+randomUUID());
if(!/^http:\/\/127\.0\.0\.1:\d{5}$/.test(api))throw Error('Five digit loopback API required');
const results=[];
for(const searchAll of [false,true]){const response=await fetch(api+'/api/wechat/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,searchAll,limit:100}),signal:AbortSignal.timeout(45000)});const data=await response.json();results.push({scope:searchAll?'explicit-archive-batch':'legacy-page',status:response.status,count:data.items?.length,scanned:data.scanned,pagesScanned:data.pagesScanned,hasMore:data.hasMore,queryComplete:data.queryComplete,filterScope:data.filterScope,...(data.error?{code:data.error}:{})});}
query='';await mkdir(out,{recursive:true});const sourceHashes={};for(const path of ['server/src/wechat-sync.ts','native/macos/app/src/settings.rs'])sourceHashes[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');const status=results.every(r=>r.status===200)&&results[1].count>0?'PASS':'NO_MATCH_OR_FAILURE';await writeFile(join(out,'manifest.json'),JSON.stringify({status,scope:'actual local readonly contact lookup; no contact or query content persisted',results,sourceHashes,externalSends:0},null,2)+'\n');console.log(JSON.stringify({status,results,artifact:join(out,'manifest.json')}));if(status!=='PASS')process.exitCode=1;
