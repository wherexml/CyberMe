// Development launcher for the full desktop; reuses the existing API, never imports data.
import {constants} from 'node:fs';
import {readFile,mkdir,open,lstat,realpath} from 'node:fs/promises';import {spawn} from 'node:child_process';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),scope=resolve(root,'.local/mygo-desktop');await mkdir(scope,{recursive:true,mode:0o700});if(await realpath(scope)!==scope||(await lstat(scope)).uid!==process.getuid())throw Error('Invalid scope');
async function ready(){try{const link=JSON.parse(await readFile(resolve(scope,'connection.json'),'utf8'));const r=await fetch('http://127.0.0.1:46312/api/health',{headers:{'X-OpsTwins-Pilot':link.token},signal:AbortSignal.timeout(1500)});return r.ok}catch{return false}}
if(!await ready()){
 const log=await open(resolve(scope,'gateway.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);const st=await log.stat();if(st.uid!==process.getuid()||st.nlink!==1||(st.mode&0o777)!==0o600){await log.close();throw Error('Invalid private log')} const child=spawn(process.execPath,[resolve(root,'scripts/mygo-workspace-gateway.mjs')],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
 let ok=false;for(let n=0;n<40;n++){if(await ready()){ok=true;break}await new Promise(r=>setTimeout(r,250))}if(!ok)throw Error('Workspace API 46110 or gateway 46312 unavailable; inspect private gateway.log');
}
const app=resolve(root,'.local/apps/OpsTwins MyGO.app');await lstat(app);const launch=spawn('open',[app],{stdio:'inherit'});launch.on('exit',code=>{process.exitCode=code||0});
