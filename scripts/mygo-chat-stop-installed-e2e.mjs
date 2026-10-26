// Read-only exact installed source/runtime/receipt checks; no private text is persisted.
import fs from 'node:fs/promises';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const app='/Applications/OpsTwins MyGO.app',out='output/mygo-chat-stop-20261019',hash=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex'),checks=[];
const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name)};
try{
 const expected=JSON.parse(await fs.readFile(out+'/artifact-final.json'));
 check('installed executable is accepted candidate',await hash(app+'/Contents/MacOS/opstwins-mygo')===expected.executable);
 for(const file of ['server/src/agent.ts','server/src/index.ts','server/src/chat-status.ts'])check('installed exact source '+file,await hash(file)===await hash(app+'/Contents/Resources/runtime/'+file));
 execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});check('installed signature',true);
 execFileSync('xcrun',['stapler','validate',app],{stdio:'pipe'});check('installed notarization ticket',true);
 execFileSync('spctl',['--assess','--type','execute',app],{stdio:'pipe'});check('installed Gatekeeper',true);
 const get=async p=>{const r=await fetch('http://127.0.0.1:46110/api/'+p,{signal:AbortSignal.timeout(10000)});check('HTTP '+p.split('/')[0],r.ok);return r.json()};
 check('new backend healthy',(await get('health')).ok);
 const stopped=await get('chat/requests/desktop-3c200b55-e15b-4e8b-a6e7-a8a80a323162');check('actual screenshot original receipt projects stopped',stopped.status==='cancelled');
 const next=await get('chat/requests/desktop-ccd8b72c-fa3a-48df-bb00-6bb9254784ba');check('actual following receipt remains succeeded',next.status==='succeeded');
 const ps=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');
 check('single installed app process',ps.filter(l=>l.trim().split(/\s+/).slice(2).join(' ')===app+'/Contents/MacOS/opstwins-mygo').length===1);
 for(const port of [46110,46312]){const pid=execFileSync('lsof',['-t','-nP',`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split('\n');check('single owned runtime '+port,pid.length===1&&ps.some(l=>Number(l.trim().split(/\s+/)[0])===Number(pid[0])&&l.includes(app+'/Contents/Resources/runtime/bin/node')))}
}catch(e){checks.push({name:String(e),pass:false});process.exitCode=1}
await fs.writeFile(out+'/installed.json',JSON.stringify({checks,privateContentSaved:false},null,2));console.log(checks);
