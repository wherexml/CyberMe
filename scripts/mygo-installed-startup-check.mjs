// Read-only evidence for the real installed-app journey. UI launch/actions use native automation.
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const phase=process.argv[2];if(!/^[a-z0-9-]+$/.test(phase||''))throw Error('Supply a public evidence phase');
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'output/mygo-managed-startup-20261016');mkdirSync(out,{recursive:true});
const app='/Applications/OpsTwins MyGO.app',exe=app+'/Contents/MacOS/opstwins-mygo';
const hash=createHash('sha256').update(readFileSync(exe)).digest('hex');
const ps=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');
const appProcesses=ps.filter(x=>x.includes(exe)).map(x=>x.trim().split(/\s+/).slice(0,2).map(Number));
const listeners={};for(const port of [46110,46312]){try{listeners[port]=execFileSync('lsof',['-t','-nP',`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split('\n').map(Number)}catch{listeners[port]=[]}}
const checks={};
try{const r=await fetch('http://127.0.0.1:46110/api/health',{signal:AbortSignal.timeout(2500)});const d=await r.json();checks.api={status:r.status,ok:d.ok,name:d.name}}catch{checks.api={ok:false}}
try{const link=JSON.parse(readFileSync(resolve(root,'.local/mygo-desktop/connection.json'),'utf8'));const r=await fetch('http://127.0.0.1:46312/api/health',{headers:{'X-OpsTwins-Pilot':link.token},signal:AbortSignal.timeout(2500)});const d=await r.json();checks.gateway={status:r.status,ok:d.ok,name:d.name}}catch{checks.gateway={ok:false}}
const report={phase,at:new Date().toISOString(),app,hash,appProcesses,listeners,checks};writeFileSync(resolve(out,phase+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(phase!=='stopped'&&(!checks.api.ok||!checks.gateway.ok||appProcesses.length!==1||Object.values(listeners).some(x=>x.length!==1)))process.exitCode=1;
if(phase==='stopped'&&(appProcesses.length||Object.values(listeners).some(x=>x.length)))process.exitCode=1;
