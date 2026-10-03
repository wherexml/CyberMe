import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.env.TRIAGE_FAILURE_PORT||46210),base=`http://127.0.0.1:${port}`;
const out=new URL('../output/inbox-triage-20261002/',import.meta.url);
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:String(port),OPSTWIN_DATA_DIR:fileURLToPath(new URL('failure-db/',out)),OPSTWIN_NO_BACKGROUND:'1',JEV_API_KEY:'invalid-e2e-credential'},stdio:'ignore'});
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});return {status:r.status,data:await r.json()};}
try{
 let ready=false;for(let i=0;i<100;i++){try{ready=(await req('/api/health')).status===200;}catch{}if(ready)break;await delay(100);}if(!ready)throw new Error('Failure API did not start');
 const item=(await req('/api/inbox','POST',{title:'OPSADV-QA-TRIAGE-FAILURE-'+Date.now(),body:'Please reply to confirm receipt.',sender:'Failure E2E',channel:'Internal',status:'pending'})).data;
 const first=await req('/api/inbox/'+item.id+'/triage','POST',{}),second=await req('/api/inbox/'+item.id+'/triage','POST',{}),retry=await req('/api/inbox/'+item.id+'/triage','POST',{force:true});
 const fresh=(await req('/api/inbox/'+item.id)).data;
 const checks={real401:first.data.error?.includes('401'),failed_not_no_reply:first.data.status==='failed'&&first.data.route==='review',failure_cached:first.data.completedAt===second.data.completedAt,explicit_retry:retry.data.completedAt!==first.data.completedAt,no_side_effects:fresh.status==='pending'&&!fresh.draft&&!fresh.receipt,no_credential_in_response:!JSON.stringify([first,second,retry]).includes('invalid-e2e-credential')};
 await writeFile(new URL('failure-e2e.json',out),JSON.stringify({checks,first,second,retry,item:fresh},null,2));console.log(checks);if(Object.values(checks).some(v=>!v))process.exitCode=1;
}finally{server.kill('SIGTERM');}
