// Explicitly local, user-authorized App update. No publication/notary requirement.
// Validate code signatures and frozen bytes; preserve user data and rollback App.
import fs from'node:fs/promises';import path from'node:path';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import net from'node:net';
const candidateArg=process.argv.find(x=>x.startsWith('--candidate='))?.slice(12),outArg=process.argv.find(x=>x.startsWith('--evidence-dir='))?.slice(15);if(!candidateArg||!outArg||!/^output\/mygo-[a-z0-9-]+$/.test(outArg))throw Error('Explicit candidate and project evidence required');
const candidate=path.resolve(candidateArg),out=path.resolve(outArg),root=process.cwd(),target='/Applications/OpsTwins MyGO.app',staged='/Applications/OpsTwins MyGO.local-next.app',backup=path.resolve('.local/apps/history/'+path.basename(out)+'-local-before-install.app');
if(!candidate.startsWith(path.resolve('.local/signing')+path.sep)||await fs.realpath(candidate)!==candidate)throw Error('Invalid local candidate');
const exe=app=>app+'/Contents/MacOS/opstwins-mygo',sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex'),expected=JSON.parse(await fs.readFile(out+'/artifact-final.json')).executable;
if(await sha(exe(candidate))!==expected)throw Error('Frozen executable changed');
for(const port of[46110,46312]){const busy=await new Promise(r=>{const s=net.connect({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();r(true)});s.on('error',()=>r(false))});if(busy)throw Error('Stop owned runtime before installation: '+port)}
for(const file of[candidate,target])if((await fs.lstat(file)).isSymbolicLink())throw Error('Bundle symlinks rejected');
for(const file of[staged,backup]){try{await fs.lstat(file);throw Error('Transaction path exists')}catch(e){if(e.code!=='ENOENT')throw e}}
execFileSync('codesign',['--verify','--deep','--strict',candidate],{stdio:'pipe'});await fs.mkdir(path.dirname(backup),{recursive:true});execFileSync('ditto',[candidate,staged]);execFileSync('codesign',['--verify','--deep','--strict',staged],{stdio:'pipe'});if(await sha(exe(staged))!==expected)throw Error('Staged bytes differ');
const previous=await sha(exe(target));await fs.rename(target,backup);try{await fs.rename(staged,target)}catch(e){await fs.rename(backup,target);throw e}
const receipt={installed:target,backup,previousSHA256:previous,installedSHA256:await sha(exe(target)),localOnly:true,published:false,notarizationRequired:false,codeSignatureVerified:true,userStateCopied:false};await fs.writeFile(out+'/install-receipt.json',JSON.stringify(receipt,null,2));console.log(receipt);
