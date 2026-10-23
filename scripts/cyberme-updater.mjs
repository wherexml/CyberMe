// Local Developer ID update channel. No network downloads or arbitrary page-supplied commands.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
const TEAM='T695TT4HT9', ID='com.opstwins.mygo.full', TARGET='/Applications/CyberMe.app';
const [action,current,sourceRoot,parentText]=process.argv.slice(2);
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const fail=code=>{throw Error(code)};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function exact(p){if(await fs.realpath(p)!==p)fail('unsafe_path');const s=await fs.lstat(p);if(s.isSymbolicLink()||s.uid!==process.getuid())fail('unsafe_owner');return s}
async function info(app){await exact(app);const p=JSON.parse(run('/usr/bin/plutil',['-convert','json','-o','-',app+'/Contents/Info.plist']));if(p.CFBundleIdentifier!==ID||p.CFBundleExecutable!=='opstwins-mygo')fail('wrong_application');if(!/^\d+\.\d+\.\d+$/.test(p.CFBundleShortVersionString)||!/^\d+$/.test(p.CFBundleVersion))fail('invalid_version');return {version:p.CFBundleShortVersionString,build:p.CFBundleVersion,dataEpoch:String(p.CyberMeDataEpoch||'1')}}
function newer(a,b){const av=a.version.split('.').map(Number),bv=b.version.split('.').map(Number);for(let i=0;i<3;i++){if(av[i]!==bv[i])return av[i]>bv[i]}return BigInt(a.build)>BigInt(b.build)}
import {spawnSync} from 'node:child_process';
function signature(app){run('/usr/bin/codesign',['--verify','--deep','--strict',app]);const r=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',app],{encoding:'utf8',timeout:15000});if(r.status!==0||!r.stderr.includes('TeamIdentifier='+TEAM)||!r.stderr.includes('Authority=Developer ID Application:'))fail('untrusted_signature')}
const exists=async p=>{try{await fs.lstat(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e}};
async function inspect(){const installed=await info(current);if(!await exists(sourceRoot))return {status:'none',current:installed};await exact(sourceRoot);const candidate=path.join(sourceRoot,'CyberMe.app');if(!await exists(candidate))return {status:'none',current:installed};const available=await info(candidate);signature(candidate);if(available.dataEpoch!==installed.dataEpoch)fail('incompatible_data');let lastFailure=false;try{lastFailure=JSON.parse(await fs.readFile(sourceRoot+'/last-result.json','utf8')).status==='failed'}catch{}return {status:newer(available,installed)?'available':'current',current:installed,available,lastFailure}}
const processList=()=>run('/bin/ps',['-ww','-axo','pid=,ppid=,command=']).split('\n').map(s=>s.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(m=>({pid:Number(m[1]),ppid:Number(m[2]),command:m[3]}));
function sameProcess(p){return processList().some(x=>x.pid===p.pid&&x.command===p.command)}
function ownedServices(app){const prefix=app+'/Contents/Resources/runtime/',all=processList();const owned=all.filter(p=>p.pid!==process.pid&&p.command.startsWith(prefix));for(const p of owned)if(![prefix+'bin/node --import tsx server/src/index.ts',prefix+'bin/node scripts/mygo-workspace-gateway.mjs'].includes(p.command)&&!p.command.startsWith(prefix+'node_modules/@esbuild/darwin-arm64/bin/esbuild --service='))fail('runtime_process_busy');const ids=new Set(owned.map(p=>p.pid));if(all.some(p=>ids.has(p.ppid)&&!ids.has(p.pid)&&p.command!=='<defunct>'))fail('runtime_child_busy');return owned}
function listeners(port){try{return run('/usr/sbin/lsof',['-nP','-t','-iTCP:'+port,'-sTCP:LISTEN']).split('\n').filter(Boolean).map(Number)}catch(e){if(e.status===1)return [];throw e}}
async function idle(app){const owned=ownedServices(app),ids=new Set(owned.map(p=>p.pid));for(const port of [46110,46312])if(listeners(port).some(pid=>!ids.has(pid)))fail('foreign_runtime');if(listeners(46110).length){let r;try{r=await fetch('http://127.0.0.1:46110/api/runs?status=running&limit=1',{signal:AbortSignal.timeout(5000)})}catch{fail('runtime_unavailable')}if(!r.ok)fail('runtime_unavailable');const rows=await r.json();if((Array.isArray(rows)?rows:rows.items||[]).length)fail('runtime_busy')}return owned}
async function writeReceipt(tx,data){const raw=JSON.stringify({...data,at:new Date().toISOString()},null,2);await fs.writeFile(tx+'/receipt.json',raw,{mode:0o600});if(data.status!=='prepared'){const base=path.dirname(path.dirname(tx)),temp=base+'/.result-'+randomUUID();await fs.writeFile(temp,raw,{mode:0o600,flag:'wx'});await fs.rename(temp,base+'/last-result.json')}}
export async function saveLock(lock,fields){const prior=JSON.parse(await fs.readFile(lock+'/owner.json','utf8'));const temp=lock+'/owner-'+randomUUID();await fs.writeFile(temp,JSON.stringify({...prior,...fields}),{mode:0o600,flag:'wx'});await fs.rename(temp,lock+'/owner.json')}
export async function releaseLock(lock){await fs.unlink(lock+'/owner.json');await fs.rmdir(lock)}
async function stopOwnedForRollback(app){
 const prefix=app+'/Contents/Resources/runtime/';let rows=processList();const ids=new Set(rows.filter(p=>p.pid!==process.pid&&(p.command.startsWith(prefix)||p.command===app+'/Contents/MacOS/opstwins-mygo')).map(p=>p.pid));
 // Include only the descendants of this failed candidate's processes, never unrelated listeners.
 for(let n=0;n<10;n++)for(const p of rows)if(ids.has(p.ppid)&&p.pid!==process.pid)ids.add(p.pid);
 const owned=rows.filter(p=>ids.has(p.pid)&&p.command!=='<defunct>');for(const p of owned)if(sameProcess(p)){try{process.kill(p.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}}
 for(let n=0;n<50&&owned.some(sameProcess);n++)await wait(100);
 for(const p of owned)if(sameProcess(p)){try{process.kill(p.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}
 for(let n=0;n<50&&owned.some(sameProcess);n++)await wait(100);if(owned.some(sameProcess))fail('rollback_process_busy');
}
let recoveredTransaction=false;
export async function acquireLock(base,kind){
 const lock=base+'/install.lock';await exact(base);
 if(await exists(lock)){
  await exact(lock);let owner;try{owner=JSON.parse(await fs.readFile(lock+'/owner.json','utf8'))}catch{fail('update_recovery_required')}
  if([owner.owner,owner.helper].filter(Boolean).some(sameProcess)||owner.tx&&processList().some(p=>p.command.endsWith('/apply.mjs apply '+owner.tx)))fail('update_in_progress');
  // Atomically claim abandoned recovery; an unrecognised or interrupted recovery is never guessed.
  try{await fs.mkdir(lock+'/recovery',{mode:0o700})}catch{fail('update_recovery_required')}
  try{
   if(owner.kind==='publish'){
    if(owner.stage&&owner.stage.startsWith(base+'/.publish-')&&path.dirname(owner.stage)===base&&await exists(owner.stage)){await exact(owner.stage);await fs.rm(owner.stage,{recursive:true})}
    if(owner.previous&&owner.previous.startsWith(base+'/.previous-')&&path.dirname(owner.previous)===base&&!await exists(base+'/CyberMe.app')&&await exists(owner.previous)){signature(owner.previous);await fs.rename(owner.previous,base+'/CyberMe.app')}
   }else if(owner.kind==='install'&&owner.tx){
    if(path.dirname(owner.tx)!==base+'/transactions'||!/^[-a-f0-9]{36}$/.test(path.basename(owner.tx)))fail('update_recovery_required');await exact(owner.tx);
    const t=JSON.parse(await fs.readFile(owner.tx+'/transaction.json','utf8')),id=path.basename(owner.tx);
    if(!['/Applications/OpsTwins MyGO.app',TARGET].includes(t.current)||t.target!==TARGET||t.staged!=='/Applications/.CyberMe-update-'+id+'.app'||t.backup!==base+'/backups/'+id+'.app')fail('update_recovery_required');
    if(await exists(t.backup)){
     if(await exists(t.target)&&t.next&&processList().some(p=>p.command===t.target+'/Contents/MacOS/opstwins-mygo')&&JSON.stringify(await info(t.target))===JSON.stringify(t.next)){signature(t.target);if(!await healthy())fail('recovery_restart_required');await writeReceipt(owner.tx,{status:'installed',target:t.target,backup:t.backup,recovered:true,version:await info(t.target)})}
     else {if(processList().some(p=>p.command===t.target+'/Contents/MacOS/opstwins-mygo'))fail('recovery_restart_required');signature(t.backup);await stopOwnedForRollback(t.target);if(await exists(t.target)){if(await exists(t.staged))fail('update_recovery_required');await fs.rename(t.target,t.staged)}try{await fs.rename(t.backup,t.current)}catch(e){if(await exists(t.staged)&&!await exists(t.current))await fs.rename(t.staged,t.current);throw e}run('/usr/bin/open',['-n',t.current]);await writeReceipt(owner.tx,{status:'failed',error:'interrupted_update',rollback:true,backup:t.backup})}
    }else{if(!await exists(t.current))fail('update_recovery_required');await writeReceipt(owner.tx,{status:'failed',error:'interrupted_prepare',rollback:false})}
    if(await exists(t.staged)){await exact(t.staged);await fs.rm(t.staged,{recursive:true})}
   }else if(owner.kind!=='install')fail('update_recovery_required');
   await fs.rmdir(lock+'/recovery');await releaseLock(lock);recoveredTransaction=true;
  }catch(e){await fs.rmdir(lock+'/recovery').catch(()=>{});throw e}
 }
 try{await fs.mkdir(lock,{mode:0o700})}catch{fail('update_in_progress')}
 await fs.writeFile(lock+'/owner.json',JSON.stringify({kind,owner:processList().find(p=>p.pid===process.pid)}),{mode:0o600,flag:'wx'});return lock;
}
async function prepare(){
 if(!['/Applications/OpsTwins MyGO.app',TARGET].includes(current))fail('install_location_required');
 const parent=Number(parentText);if(!Number.isSafeInteger(parent)||parent<2||!processList().some(p=>p.pid===parent&&p.command===current+'/Contents/MacOS/opstwins-mygo'))fail('parent_invalid');
 let state=await inspect();if(state.status!=='available')return state;
 signature(current);await idle(current);
 const lock=await acquireLock(sourceRoot,'install');
 let staged,tx;
 try{
  if(recoveredTransaction){await releaseLock(lock);return {status:'recovered'}}
  state=await inspect();if(state.status!=='available'){await releaseLock(lock);return state}
  const id=randomUUID();tx=sourceRoot+'/transactions/'+id;await fs.mkdir(tx,{recursive:true,mode:0o700});await exact(tx);
  staged='/Applications/.CyberMe-update-'+id+'.app';const backup=sourceRoot+'/backups/'+id+'.app';await fs.mkdir(path.dirname(backup),{recursive:true,mode:0o700});await exact(path.dirname(backup));
  if((await fs.stat('/Applications')).dev!==(await fs.stat(path.dirname(backup))).dev)fail('different_filesystem');
  if(current!==TARGET&&await exists(TARGET))fail('target_exists');if(await exists(staged)||await exists(backup))fail('transaction_exists');await saveLock(lock,{kind:'install',tx,staged,current,backup});await fs.writeFile(tx+'/transaction.json',JSON.stringify({current,target:TARGET,staged,backup,parent,lock,tx}),{mode:0o600});
  run('/usr/bin/ditto',[sourceRoot+'/CyberMe.app',staged]);signature(staged);const next=await info(staged);if(JSON.stringify(next)!==JSON.stringify(state.available))fail('candidate_changed');
  const services=await idle(current);const transaction={current,target:TARGET,staged,backup,parent,services,next,lock,tx};
  await fs.writeFile(tx+'/transaction.json',JSON.stringify(transaction),{mode:0o600});await fs.copyFile(fileURLToPath(import.meta.url),tx+'/apply.mjs');
  await writeReceipt(tx,{status:'prepared',version:next});
  const log=await fs.open(tx+'/helper.log','wx',0o600);
  const child=spawn(process.execPath,[tx+'/apply.mjs','apply',tx],{detached:true,stdio:['ignore',log.fd,log.fd],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME}});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});await saveLock(lock,{kind:'install',tx,staged,current,backup,helper:processList().find(p=>p.pid===child.pid)});child.unref();await log.close();
  return {status:'prepared',current:state.current,available:state.available};
 }catch(e){if(staged&&await exists(staged))await fs.rm(staged,{recursive:true});await releaseLock(lock);throw e}
}
async function healthy(){try{const r=await fetch('http://127.0.0.1:46110/api/health',{signal:AbortSignal.timeout(1500)}),b=await r.json();return r.ok&&b.ok&&b.runtimeMode==='standalone'&&listeners(46312).length>0}catch{return false}}
async function stopServices(app){const services=await idle(app);for(const p of services)if(sameProcess(p))process.kill(p.pid,'SIGTERM');for(let n=0;n<100;n++){if(!services.some(sameProcess))return;await wait(100)}fail('runtime_exit_timeout')}
async function apply(tx){
 const t=JSON.parse(await fs.readFile(tx+'/transaction.json','utf8'));let moved=false,installed=false,keepLock=false;
 try{
  for(let n=0;n<300&&processList().some(p=>p.pid===t.parent&&p.command===t.current+'/Contents/MacOS/opstwins-mygo');n++)await wait(100);
  if(processList().some(p=>p.pid===t.parent&&p.command===t.current+'/Contents/MacOS/opstwins-mygo'))fail('app_exit_timeout');
  await stopServices(t.current);signature(t.staged);if(JSON.stringify(await info(t.staged))!==JSON.stringify(t.next))fail('staged_changed');
  await fs.rename(t.current,t.backup);moved=true;await fs.rename(t.staged,t.target);installed=true;
  run('/usr/bin/open',['-n',t.target]);
  for(let n=0;n<120;n++){await wait(500);if(await healthy()&&processList().some(p=>p.command===t.target+'/Contents/MacOS/opstwins-mygo')){await writeReceipt(tx,{status:'installed',target:t.target,backup:t.backup,version:await info(t.target),signatureVerified:true});return}}
  fail('launch_failed');
 }catch(e){
  let rollback=false,rollbackError;
  if(moved){try{if(installed){await stopOwnedForRollback(t.target);await fs.rename(t.target,t.staged)}await fs.rename(t.backup,t.current);run('/usr/bin/open',['-n',t.current]);rollback=true}catch(re){rollbackError=re.message;try{if(!await exists(t.current)&&await exists(t.staged)){await fs.rename(t.staged,t.current);run('/usr/bin/open',['-n',t.current])}}catch{}}}
  else if(!processList().some(p=>p.command===t.current+'/Contents/MacOS/opstwins-mygo')){try{run('/usr/bin/open',['-n',t.current])}catch{}}
  if(rollbackError){keepLock=true;await saveLock(t.lock,{rollbackError});for(const app of [...new Set([t.current,t.target])])if(await exists(app)){try{run('/usr/bin/open',['-n',app])}catch{}break}}await writeReceipt(tx,{status:'failed',error:e.message,rollback,rollbackError,backup:t.backup,staged:t.staged,current:t.current});
 }finally{if(!keepLock)await releaseLock(t.lock).catch(()=>{})}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{if(action==='apply')await apply(current);else if(action==='check')console.log(JSON.stringify(await inspect()));else if(action==='prepare')console.log(JSON.stringify(await prepare()));else if(action==='recover'){await releaseLock(await acquireLock(current,'install'));console.log(JSON.stringify({status:'recovered'}))}else fail('invalid_action')}catch(e){console.log(JSON.stringify({status:'error',error:/^[a-z_]+$/.test(e.message)?e.message:'verification_failed'}))}
