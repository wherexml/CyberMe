// Real HTTP/model acceptance. Evidence deliberately excludes message and draft bodies.
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
const base='http://127.0.0.1:46113',checks=[];
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const source='.local/design/macos-study-data.js';
const original=fs.readFileSync(source,'utf8');
const snapshot=JSON.parse(original.replace(/^window\.OPSTWINS_DESIGN_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
const item=snapshot.inbox.find(x=>!x.draft&&!x.sensitive&&!['sending','sent','delivered','done','dismissed','recalled','cancelled','send_unknown'].includes(x.status));
if(!item)throw Error('No eligible saved source for preview acceptance');
const database='data/opstwin-advance.db';
const protectedFiles=[database,database+'-wal'].filter(file=>fs.existsSync(file));
const before=Object.fromEntries(protectedFiles.map(file=>[file,digest(fs.readFileSync(file))]));
function check(name,ok){checks.push({name,status:ok?'PASS':'FAIL'});if(!ok)throw Error(name);}
async function request(id,body,origin='null'){
 const r=await fetch(base+'/replies/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});
 return {status:r.status,value:await r.json()};
}
let result;
try {
 check('Private source file has restricted permissions',(fs.statSync(source).mode&0o077)===0);
 const denied=await request(item.id,{capturedAt:snapshot.capturedAt},'https://untrusted.example');
 check('Unexpected origins blocked before generation',denied.status===403);
 const stale=await request(item.id,{capturedAt:'stale'});
 check('Changed snapshots blocked',stale.status===409);
 const missing=await request('missing-acceptance-source',{capturedAt:snapshot.capturedAt});
 check('Unknown source cannot generate',missing.status===404);
 const first=await request(item.id,{capturedAt:snapshot.capturedAt});
 check('Configured model returns a real preview draft',first.status===200&&first.value.status==='succeeded'&&first.value.text?.trim().length>0);
 const again=await request(item.id,{capturedAt:snapshot.capturedAt});
 check('Repeat request reuses persisted result',again.status===200&&again.value.cached===true&&again.value.generationId===first.value.generationId&&again.value.text===first.value.text);
 const context=vm.createContext({window:{},fetch,AbortSignal});
 vm.runInContext(fs.readFileSync('docs/design/macos-message-time.js','utf8'),context);
 vm.runInContext(fs.readFileSync('docs/design/macos-inbox-preview.js','utf8'),context);
 const client=context.window.OpsTwinsInboxPreview,transitions=[];
 await client.request(item,'stale',()=>transitions.push(client.state(item.id).status));
 check('Client exposes failure from the real service',client.state(item.id).status==='failed');
 await client.request(item,snapshot.capturedAt,()=>transitions.push(client.state(item.id).status));
 check('Client retry recovers the cached real draft',client.state(item.id).status==='succeeded'&&client.state(item.id).text===first.value.text);
 check('Client status transition is observable',transitions.join(',')==='running,failed,running,succeeded');
 check('Source snapshot unchanged',digest(fs.readFileSync(source))===digest(original));
 check('Business database and WAL unchanged',protectedFiles.every(file=>digest(fs.readFileSync(file))===before[file]));
 result={status:'PASS',checks,sourceHash:digest(original),itemHash:digest(item.id),model:first.value.model,draftHash:digest(first.value.text),draftCharacters:first.value.text.length,generationId:first.value.generationId,generatedAt:first.value.generatedAt,freshGeneration:first.value.cached!==true,events:first.value.events.map(e=>({type:e.type,status:e.status})),clientIntegration:'Node VM with real HTTP; no DOM',browser:'NOT_RUN'};
} catch(error){result={status:'FAIL',checks,error:error.message,browser:'NOT_RUN'};process.exitCode=1;}
fs.mkdirSync('output/macos-ui-study-20261003',{recursive:true});
fs.writeFileSync('output/macos-ui-study-20261003/inbox-reply-http-result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
