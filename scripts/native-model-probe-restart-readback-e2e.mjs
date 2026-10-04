// Read-only repeatable verification of this scope's original durable receipts.
import fs from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('output/native-parity-20261003/model-probe-recovery-20261004');
const read=name=>JSON.parse(fs.readFileSync(out+'/'+name));
const get=async path=>{const r=await fetch('http://127.0.0.1:46254'+path);if(!r.ok)throw Error('Read failed: '+r.status);return r.json();};
const checks=[];
const check=(name,ok,details={})=>{checks.push({name,status:ok?'PASS':'FAIL',...details});if(!ok)throw Error(name);};
try {
 const http=read('http-e2e.json'),gui=read('gui-before-restart.json'),interrupted=read('server-interrupt-before.json');
 for(const [name,id,status] of [['HTTP completed original after restart',http.requestId,'succeeded'],['native original after restart',gui.requestId,'succeeded'],['interrupted original remains unknown',interrupted.requestId,'unknown']]){
  const receipt=await get('/api/settings/models/tests/'+id);
  check(name,receipt.status===status,{requestId:id,runId:receipt.runId,result:receipt.status,underlyingRunStatus:receipt.run.status});
 }
 const stats=read('proxy-stats.json');
 check('native normal restart made no second POST',stats.postCount===1&&stats.testGetCount===1&&stats.requestIds[0]===gui.requestId,{postCount:stats.postCount,getCount:stats.testGetCount});
 const state=JSON.parse(fs.readFileSync(resolve('.local/acceptance/model-probe-recovery-20261004/gui/model-probe.json')));
 check('local original cleared only after succeeded GET',state===null);
 const runs=await get('/api/runs');
 const expected=fs.existsSync(out+'/http-e2e-final.json')?4:3;
 check('one model run per original test',runs.filter(r=>r.kind==='model_probe').length===expected,{expected});
 fs.writeFileSync(out+'/restart-readback-e2e.json',JSON.stringify({status:'PASS',checks,notRun:['native running/failed/unknown GUI','delayed POST + GET404 GUI','local Saver failure GUI']},null,2));
 console.log(JSON.stringify({status:'PASS',checks:checks.length}));
}catch(e){fs.writeFileSync(out+'/restart-readback-e2e.json',JSON.stringify({status:'FAIL',checks,error:String(e)},null,2));console.log(JSON.stringify({status:'FAIL',checks:checks.length}));process.exitCode=1;}
