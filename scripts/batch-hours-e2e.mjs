/** Real self-only HTTP/CLI batch, closes working window after actual text receipt. Never blindly retries. */
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root=resolve(import.meta.dirname,'..'),tag='batch-hours-'+new Date().toISOString().replace(/[:.]/g,'-'),out=join(root,'output',tag),data=join(root,'data',tag),base='http://127.0.0.1:46111';mkdirSync(out,{recursive:true});
const report={tag,status:'RUNNING',recipient:'Steve self only',simulation:false,windowChange:'Actual config change after real text receipt; not a simulated clock',steps:[]};
const save=()=>writeFileSync(join(out,'manifest.json'),JSON.stringify(report,null,2));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:body instanceof FormData?undefined:body?{'content-type':'application/json'}:undefined,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(JSON.stringify({status:r.status,error:j.error,message:j.message}));return j;}
function assert(x,m){if(!x)throw Error(m);}
const files=['server/src/policy.ts','server/src/sending.ts','server/src/integrations.ts','server/src/index.ts','scripts/batch-hours-e2e.mjs'];report.fingerprint=createHash('sha256').update(files.map(p=>readFileSync(join(root,p))).join('\n')).digest('hex');
let item,sendPromise;const child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:root,env:{...process.env,OPSTWIN_API_PORT:'46111',OPSTWIN_DATA_DIR:data},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
try{
 for(let n=0;;n++){try{await req('/api/health');break;}catch(e){if(n===50)throw e;await sleep(200);}}
 const conn=await req('/api/connections/test','POST',{name:'Feishu',provider:'Feishu',type:'CLI'});assert(conn.ok&&conn.connection.id==='feishu-local','Self connection unavailable');await req('/api/settings','PATCH',{autonomy:{holdSending:false}});await req('/api/connections/feishu-local','PATCH',{config:{workingHoursOnly:false}});
 const marker='OPSADV-QA-'+randomUUID();const attachments=[];for(let i=0;i<2;i++){const form=new FormData();form.append('file',new File([marker+' attachment '+i],`batch-${i}.txt`,{type:'text/plain'}));attachments.push((await req('/api/files','POST',form)).id);}
 item=await req('/api/inbox','POST',{title:marker,body:'Self-only batch working-hours E2E',draft:marker+' approved batch window test',recipientId:'self',isSelfTest:true,testMarker:marker,attachments});await req('/api/inbox/'+item.id,'PATCH',{approved:true});report.itemId=item.id;report.marker=marker;report.attachments=attachments;save();
 const key='hours-'+randomUUID();let settled=false;sendPromise=req('/api/inbox/'+item.id+'/send','POST',{idempotencyKey:key}).then(result=>({result}),error=>({error:String(error)})).finally(()=>settled=true);
 const db=new DatabaseSync(join(data,'opstwin-advance.db'),{readOnly:true});let observed;
 for(let n=0;n<1800&&!settled;n++){const row=db.prepare('SELECT data FROM send_intents WHERE key=?').get(key);const intent=row&&JSON.parse(row.data);if(intent?.messageIds?.length){observed=intent;await req('/api/connections/feishu-local','PATCH',{config:{workingHoursOnly:true,workDays:[],workFrom:'08:00',workUntil:'19:00',timezone:'Asia/Singapore'}});report.closedAt=new Date().toISOString();report.observedBeforeClose={messageIds:intent.messageIds,sentAttachments:intent.sentAttachments,workingHoursDecision:intent.workingHoursDecision};save();break;}await sleep(50);}db.close();
 const sent=await sendPromise;assert(!sent.error,sent.error);report.send=sent.result;save();assert(observed&&observed.sentAttachments.length<2,'Window change did not occur before batch completion');assert(sent.result.receipt.messageIds.length===3,'Batch lost attachment');const window=await req('/api/connections/feishu-local/working-window');assert(!window.allowed,'Window did not close');report.window=window;
 const replay=await req('/api/inbox/'+item.id+'/send','POST',{idempotencyKey:key});assert(replay.replayed&&replay.receipt.messageIds.join()===sent.result.receipt.messageIds.join(),'Closed-window receipt replay duplicated batch');report.replayed=true;
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}finally{
 if(sendPromise)await sendPromise;
 if(item){try{const current=await req('/api/inbox/'+item.id);if(current.receipt?.messageIds?.length){report.recall=await req('/api/inbox/'+item.id+'/undo','POST',{});assert(report.recall.item.status==='recalled','Recall incomplete');}}catch(e){report.cleanupError=String(e);report.status='FAIL';process.exitCode=1;}}
 report.completedAt=new Date().toISOString();save();child.kill('SIGTERM');writeFileSync(join(out,'server.log'),log);console.log(JSON.stringify({status:report.status,manifest:join(out,'manifest.json'),error:report.error,cleanupError:report.cleanupError}));
}
