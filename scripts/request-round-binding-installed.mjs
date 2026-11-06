// Authorized repair: re-evaluate exact affected rounds through the installed API.
// No deletion, draft generation, approval, task creation or sending.
import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs/promises';import path from 'node:path';import {homedir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=process.cwd(),out=path.resolve('output/request-round-binding-20261106'),baselinePath=path.resolve('.local/acceptance/request-round-before-install/database.db'),dbPath=path.join(homedir(),'Library/Application Support/OpsTwins/data/opstwin-advance.db');
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex'),readRows=db=>db.prepare("SELECT data FROM entities WHERE type='inbox' AND deleted=0 ORDER BY id").all().map(x=>JSON.parse(x.data));
const baseline=new DatabaseSync(baselinePath,{readOnly:true}),before=readRows(baseline),roots=new Set(before.filter(r=>{const t=baseline.prepare("SELECT data FROM entities WHERE type='inbox_triages' AND id=?").get(r.id);return r.requestRoundId&&t&&JSON.parse(t.data).requestMessageId!==r.requestRoundId}).map(r=>r.sourceParentInboxId));const targets=before.filter(r=>roots.has(r.id)||roots.has(r.sourceParentInboxId));
const candidate=JSON.parse(await fs.readFile(out+'/candidate.json','utf8')),receipt=JSON.parse(await fs.readFile(root+'/.local/updates/last-result.json','utf8'));const checks=[],results=[];const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
const read=async id=>{const r=await fetch('http://127.0.0.1:46110/api/inbox/'+id,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Installed read failed');return r.json()};
let db;
try{
 check('已安装已验签的候选构建',receipt.status==='installed'&&receipt.version.build===candidate.build&&receipt.signatureVerified);
 execFileSync('codesign',['--verify','--deep','--strict','/Applications/CyberMe.app'],{stdio:'pipe'});check('安装包严格签名校验',true);
 for(const [file,h]of Object.entries(candidate.hashes))check('安装文件匹配 '+file,sha(await fs.readFile('/Applications/CyberMe.app/Contents/Resources/runtime/'+file,'utf8'))===h);
 const health=await (await fetch('http://127.0.0.1:46110/api/health')).json();check('运行独立安装版服务',health.ok&&health.runtimeMode==='standalone');
 for(const r of targets){
  const response=await fetch('http://127.0.0.1:46110/api/inbox/'+r.id+'/triage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({force:true}),signal:AbortSignal.timeout(120000)}),t=await response.json(),item=await read(r.id);
  results.push({idHash:sha(r.id).slice(0,12),http:response.status,status:t.status,method:t.method,resolution:t.resolution,route:t.route,bindingMatches:!r.requestRoundId||!t.requestMessageId||r.requestRoundId===t.requestMessageId,surface:item.attention.surface});
  check('原请求重新判断 '+sha(r.id).slice(0,8),response.ok&&t.status==='succeeded'&&results.at(-1).bindingMatches);console.log(JSON.stringify(results.at(-1)));
 }
 check('截图会话重复决定卡清零',results.every(x=>x.surface==='none'));
 db=new DatabaseSync(dbPath,{readOnly:true});const after=readRows(db),lookup=new Map(after.map(x=>[x.id,x]));
 for(const field of ['messages','draft','draftCandidate','editedByUser','manualDraft','receipt','receipts','status','sendKey'])check('239条既有记录字段保留 '+field,before.every(r=>lookup.has(r.id)&&sha(r[field]??null)===sha(lookup.get(r.id)[field]??null)));
 check('没有新建或删除轮次',sha(before.filter(r=>r.requestRoundId).map(r=>r.id))===sha(after.filter(r=>r.requestRoundId).map(r=>r.id)));
 check('发送意图账本未改变',sha(baseline.prepare('SELECT * FROM send_intents ORDER BY key').all())===sha(db.prepare('SELECT * FROM send_intents ORDER BY key').all()));
 const decisionRows=[];for(const r of after.filter(r=>r.requestRoundId)){const v=await read(r.id);if(v.attention.surface==='decision')decisionRows.push({root:r.sourceParentInboxId,request:v.triage?.requestMessageId||v.lastOpenRequest?.requestMessageId});}
 check('所有现有轮次无重复决定键',new Set(decisionRows.map(x=>JSON.stringify(x))).size===decisionRows.length);
}finally{
 db?.close();baseline.close();await fs.writeFile(out+'/installed-result.json',JSON.stringify({scope:'real installed API, existing data, actual local model; no sending',build:candidate.build,baselineItems:before.length,affectedItems:targets.length,checks,results},null,2));console.log(JSON.stringify({checks:checks.length,passed:checks.filter(x=>x.pass).length}));
}
