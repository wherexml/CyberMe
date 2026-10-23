// Publish a prepared local signed candidate; does not install or start the app.
import fs from 'node:fs/promises';import path from 'node:path';import{execFileSync}from'node:child_process';import{randomUUID}from'node:crypto';
import{acquireLock,releaseLock,saveLock}from './cyberme-updater.mjs';
const root=path.resolve(import.meta.dirname,'..'),arg=process.argv.find(x=>x.startsWith('--candidate='))?.slice(12);if(!arg)throw Error('Use --candidate=<signed bundle inside .local/signing>');
const candidate=path.resolve(arg),base=root+'/.local/updates';if(!candidate.startsWith(root+'/.local/signing/')||await fs.realpath(candidate)!==candidate)throw Error('Invalid candidate path');await fs.mkdir(base,{recursive:true,mode:0o700});if(await fs.realpath(base)!==base)throw Error('Unsafe update directory');
const lock=await acquireLock(base,'publish');const id=randomUUID(),stage=base+'/.publish-'+id;let previous;
try{await saveLock(lock,{stage});await fs.mkdir(stage,{mode:0o700});execFileSync('/usr/bin/ditto',[candidate,stage+'/CyberMe.app']);let installed='/Applications/CyberMe.app';try{await fs.lstat(installed)}catch(e){if(e.code!=='ENOENT')throw e;installed='/Applications/OpsTwins MyGO.app'}const r=JSON.parse(execFileSync(process.execPath,[root+'/scripts/cyberme-updater.mjs','check',installed,stage,'0'],{encoding:'utf8'}));if(r.status!=='available')throw Error('Candidate rejected: '+(r.error||r.status));
 try{await fs.lstat(base+'/CyberMe.app');previous=base+'/.previous-'+id+'.app';await saveLock(lock,{previous});await fs.rename(base+'/CyberMe.app',previous)}catch(e){if(e.code!=='ENOENT')throw e}
 try{await fs.rename(stage+'/CyberMe.app',base+'/CyberMe.app')}catch(e){if(previous)await fs.rename(previous,base+'/CyberMe.app');throw e}
 console.log(JSON.stringify({status:'ready',...r,source:base+'/CyberMe.app'}));
}finally{await fs.rm(stage,{recursive:true,force:true});await releaseLock(lock)}
