import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
export function startWorkspace({development=false}={}){
 if(!development&&!existsSync(new URL('../dist/index.html',import.meta.url))){console.error('Run npm run build before npm start.');process.exitCode=1;return;}
 const command=development?['node_modules/vite/bin/vite.js','--config','web/vite.config.ts']:['scripts/web-server.mjs'];
 const jobs=[spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','server/src/index.ts'],{cwd:root,stdio:'inherit',env:process.env}),spawn(process.execPath,command,{cwd:root,stdio:'inherit',env:process.env})];
 let stopping=false;let timer;
 function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const job of jobs)if(job.exitCode===null)job.kill('SIGTERM');timer=setTimeout(()=>{for(const job of jobs)if(job.exitCode===null)job.kill('SIGKILL');},4000);timer.unref();}
 process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
 for(const job of jobs){job.on('error',error=>{console.error(error.message);stop(1)});job.on('exit',code=>{if(!stopping)stop(code||0);if(jobs.every(job=>job.exitCode!==null)&&timer)clearTimeout(timer);});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))startWorkspace();
