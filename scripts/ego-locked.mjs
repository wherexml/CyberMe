import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const lock=fileURLToPath(new URL('../.local/ego-browser.lock/',import.meta.url));
const owner=new URL('owner.json',`file://${lock}`);
const start=Date.now();let acquired=false,child,timer,forceTimer;
while(!acquired){
 try{await mkdir(lock);await writeFile(owner,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));acquired=true;}
 catch(e){if(e.code!=='EEXIST')throw e;try{const saved=JSON.parse(await readFile(owner,'utf8'));try{process.kill(saved.pid,0)}catch(err){if(err.code==='ESRCH'){await rm(lock,{recursive:true,force:true});continue}}}catch{}
  if(Date.now()-start>180000)throw new Error('Another browser action still owns the TaskSpace. Do not bypass its lock.');await new Promise(resolve=>setTimeout(resolve,200));}
}
const release=async()=>{if(acquired){acquired=false;await rm(lock,{recursive:true,force:true})}};
try{
 child=spawn('/Users/steve/.local/bin/ego-browser',process.argv.slice(2),{stdio:'inherit',env:process.env});
 const limit=Number(process.env.OPSTWIN_EGO_TIMEOUT_MS||60000);
 timer=setTimeout(()=>{console.error(`Browser operation exceeded ${limit}ms; inspect its actual page before retrying any action.`);child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),2000)},limit);
 for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>child.kill(sig));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1))});process.exitCode=code;
}finally{clearTimeout(timer);clearTimeout(forceTimer);await release()}
