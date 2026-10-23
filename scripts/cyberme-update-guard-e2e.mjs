// Real installer CLI integration: no mocked signature verifier or production writes.
import fs from 'node:fs/promises';import path from 'node:path';import{execFileSync}from'node:child_process';import{randomUUID}from'node:crypto';
const root=process.cwd(),installed='/Applications/CyberMe.app',scope=path.join(root,'.local/update-guard-'+randomUUID()),out=path.join(root,'output/cyberme-update-20261023');await fs.mkdir(scope,{recursive:true});const checks=[];
function check(name,expected){const raw=execFileSync(process.execPath,['scripts/cyberme-updater.mjs','check',installed,scope,'0'],{encoding:'utf8'}),r=JSON.parse(raw);checks.push({name,status:expected(r)?'PASS':'FAIL',result:r});}
try{
 check('missing candidate is explicit local absence',r=>r.status==='none');
 await fs.symlink(installed,scope+'/CyberMe.app');check('symlink candidate rejected',r=>r.status==='error'&&r.error==='unsafe_path');await fs.unlink(scope+'/CyberMe.app');
 execFileSync('/usr/bin/ditto',[installed,scope+'/CyberMe.app']);check('same signed build is not offered',r=>r.status==='current');
 const plist=scope+'/CyberMe.app/Contents/Info.plist',original=await fs.readFile(plist);execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier com.example.wrong',plist]);check('wrong bundle ID rejected',r=>r.status==='error'&&r.error==='wrong_application');await fs.writeFile(plist,original);
 const file=scope+'/CyberMe.app/Contents/Resources/runtime/package.json',bytes=await fs.readFile(file);await fs.appendFile(file,'\n ');check('tampered sealed resource rejected',r=>r.status==='error');await fs.writeFile(file,bytes);check('restored real signature passes',r=>r.status==='current');
 const lock=scope+'/install.lock';await fs.mkdir(lock);const command=execFileSync('/bin/ps',['-ww','-p',String(process.pid),'-o','command='],{encoding:'utf8'}).trim();await fs.writeFile(lock+'/owner.json',JSON.stringify({kind:'publish',owner:{pid:process.pid,command}}));
 const recover=()=>JSON.parse(execFileSync(process.execPath,['scripts/cyberme-updater.mjs','recover',scope],{encoding:'utf8'}));
 let r=recover();checks.push({name:'live owner blocks lock recovery',status:r.error==='update_in_progress'?'PASS':'FAIL',result:r});
 await fs.writeFile(lock+'/owner.json',JSON.stringify({kind:'publish',owner:{pid:999999999,command:'public-stale-owner'}}));r=recover();checks.push({name:'abandoned owned publish lock recovers',status:r.status==='recovered'?'PASS':'FAIL',result:r});
 await fs.mkdir(lock);r=recover();checks.push({name:'unknown lock requires explicit recovery',status:r.error==='update_recovery_required'?'PASS':'FAIL',result:r});await fs.rmdir(lock);
}finally{await fs.writeFile(out+'/guard-result.json',JSON.stringify({scope:'actual signed bundle and codesign CLI',checks},null,2));await fs.rm(scope,{recursive:true,force:true});console.log(JSON.stringify(checks));if(checks.some(c=>c.status==='FAIL'))process.exitCode=1}
