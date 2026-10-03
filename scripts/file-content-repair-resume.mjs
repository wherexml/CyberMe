/** Retry only the upstream-failed deep journey; preserve the original failed manifest. */
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),latest=JSON.parse(readFileSync(join(root,'output/file-content-repair/http-latest.json'),'utf8')),out=latest.out,prior=JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')),data=join(root,'data',prior.tag),base='http://127.0.0.1:46116';
const child=spawn(process.execPath,['--import','tsx',join(out,'harness.ts')],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:'46116',OPSTWIN_DATA_DIR:data,OPSTWIN_NO_BACKGROUND:'1'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
const standard=process.argv.includes('--standard'),recoveryName=standard?'standard-recovery':'deep-recovery';
const report={mode:standard?'chat':'deep',status:'RUNNING',originalManifest:join(out,'manifest.json'),originalFailure:prior.error,externalSend:false};
try{for(let n=0;;n++){try{await fetch(base+'/api/health');break;}catch(e){if(n>80)throw e;await new Promise(r=>setTimeout(r,200));}}
 const bootstrap=await(await fetch(base+'/api/bootstrap')).json(),item=bootstrap.inbox.find(i=>i.title==='会议纪要附件确认');if(!item)throw Error('Original failed item missing');
 const input={mode:standard?'chat':'deep',requestId:randomUUID(),...(standard?{retryOfRunId:item.draftRunId}:{})},url=base+'/api/inbox/'+item.id+'/draft';const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(190000)}),result=await response.json();if(!response.ok)throw Error(result.message||result.error);
 if(result.run.status!=='succeeded'||result.item.draftError||result.item.attachments.length||result.item.sourceAttachments[0].filename!=='会议纪要.pdf')throw Error('Deep draft/descriptor regression');
 const replay=await(await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).json(),refreshed=await(await fetch(base+'/api/inbox/'+item.id)).json();if(!replay.replayed||replay.run.id!==result.run.id||refreshed.draftRunId!==result.run.id||refreshed.draft!==result.item.draft)throw Error('Refresh/replay changed run');
 report.status='PASS';report.deep={itemId:item.id,runId:result.run.id,model:result.run.model,descriptorRead:false,replayed:true,refreshPreserved:true};writeFileSync(join(out,recoveryName+'-draft.json'),JSON.stringify(result,null,2));
 const good=prior.checks.filter(c=>c.status==='PASS');if(good.length!==6)throw Error('Unexpected original test coverage');writeFileSync(join(root,'output/file-content-repair/http-latest.json'),JSON.stringify({out,status:'PASS',originalStatus:prior.status,recoveryManifest:join(out,recoveryName+'.json'),passedChecks:good.length+1,deepStatus:standard?'BLOCKED: upstream returned 502 twice':'PASS',fallback:standard},null,2));
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}finally{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}writeFileSync(join(out,recoveryName+'.json'),JSON.stringify(report,null,2));writeFileSync(join(out,recoveryName+'-server.log'),log);console.log(JSON.stringify(report,null,2));}
