// Exact installed-bundle identity, owned-runtime and read-only API smoke evidence.
import fs from'node:fs/promises';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const app='/Applications/OpsTwins MyGO.app',out=process.env.OPSTWIN_MEMORY_EVIDENCE_DIR||'output/mygo-memory-length-20261019',checks=[];
const sha=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
function check(name,pass){checks.push({name,pass});if(!pass)throw Error(name)}
async function api(path){const r=await fetch('http://127.0.0.1:46110/api/'+path);if(!r.ok)throw Error('http '+r.status);return r.json()}
try{
 const expected=JSON.parse(await fs.readFile(out+'/artifact-final.json'));check('installed executable matches frozen candidate',await sha(app+'/Contents/MacOS/opstwins-mygo')===expected.executable);
 check('installed memory backend matches verified source',await sha(app+'/Contents/Resources/runtime/server/src/conversation-memory.ts')===await sha('server/src/conversation-memory.ts'));
 const binary=await fs.readFile(app+'/Contents/MacOS/opstwins-mygo'),ui=await fs.readFile('native/mygo/assets/full/memory.js');check('compiled native bundle embeds verified memory UI',binary.includes(ui));
 for(const[program,args]of [['codesign',['--verify','--deep','--strict',app]],['xcrun',['stapler','validate',app]],['spctl',['--assess','--type','execute','--verbose=2',app]]]){execFileSync(program,args,{stdio:'pipe'});check(program+' passed',true)}
 check('production API healthy',!!await api('health'));const models=await api('settings/models');const p=models.providers.find(p=>p.id===models.standard.providerId),d=p.definitions.find(d=>d.id===models.standard.model);check('official DeepSeek limits retained',new URL(p.baseUrl).hostname==='api.deepseek.com'&&d.contextWindow===1048576&&d.maxTokens===393216);
 const lines=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');check('single installed App process',lines.filter(l=>l.trim().split(/\s+/).slice(2).join(' ')===app+'/Contents/MacOS/opstwins-mygo').length===1);
 for(const port of[46110,46312]){const pids=execFileSync('lsof',['-t','-nP',`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split('\n');check('single installed-owned runtime '+port,pids.length===1&&lines.some(l=>Number(l.trim().split(/\s+/)[0])===Number(pids[0])&&l.includes(app+'/Contents/Resources/runtime/bin/node')))}
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}
await fs.writeFile(out+'/installed.json',JSON.stringify({checks,privateContentSaved:false},null,2));console.log(checks);
