// Persisted-process recovery check. Signals only the exact child PID supplied by the caller.
import fs from 'node:fs/promises';import {spawn,execFileSync} from 'node:child_process';
const pid=Number(process.argv[2]);if(!Number.isInteger(pid))throw Error('Exact own fixture PID required');
const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();if(!['node --import tsx scripts/mygo-main-analysis-service.mjs',process.execPath+' --import tsx scripts/mygo-main-analysis-service.mjs'].includes(command))throw Error('Fixture owner mismatch');
const out='output/mygo-main-analysis-20261018/restart-'+Date.now();await fs.mkdir(out,{recursive:true});
const api=async path=>{const {token}=JSON.parse(await fs.readFile('.local/mygo-v17-public/connection.json'));return (await fetch('http://127.0.0.1:46510'+path,{headers:{'X-OpsTwins-Pilot':token}})).json()};
const snapshot=async()=>{const d=await api('/api/pilot/main-analysis');return {primary:d.primary,requests:d.draftRequests,messages:d.messages.map(m=>({id:m.id,createdAt:m.createdAt,content:m.content,metadata:m.inboxAnalysis}))}};
const before=await snapshot();process.kill(pid,'SIGTERM');for(let i=0;i<50;i++){try{process.kill(pid,0)}catch{break}await new Promise(r=>setTimeout(r,100))}
const child=spawn(process.execPath,['--import','tsx','scripts/mygo-main-analysis-service.mjs'],{stdio:'ignore',detached:true});child.unref();await fs.writeFile('.local/mygo-main-analysis-20261018/service.pid',String(child.pid),{mode:0o600});
let after;for(let i=0;i<100;i++){try{after=await snapshot();if(after.primary)break}catch{}await new Promise(r=>setTimeout(r,100))}
const checks=[['主会话指针保持',after?.primary===before.primary],['消息ID与原时间保持',JSON.stringify(after?.messages.map(m=>[m.id,m.createdAt]))===JSON.stringify(before.messages.map(m=>[m.id,m.createdAt]))],['重启未重放起草',JSON.stringify(after?.requests)===JSON.stringify(before.requests)],['重启投影内容保持',JSON.stringify(after?.messages)===JSON.stringify(before.messages)]];
await fs.writeFile(out+'/result.json',JSON.stringify({pidBefore:pid,pidAfter:child.pid,checks:checks.map(([name,pass])=>({name,status:pass?'PASS':'FAIL'})),scope:'public process recovery, no model calls'},null,2));console.log({out,checks});if(checks.some(x=>!x[1]))process.exitCode=1;
