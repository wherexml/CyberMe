// Install only the exact accepted signed candidate. User state is outside these bundles.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import net from 'node:net';
const root=process.cwd(),source=path.resolve('.local/apps/OpsTwins Standalone.app'),target='/Applications/OpsTwins MyGO.app',next='/Applications/OpsTwins MyGO.main-analysis-next.app',backup=path.resolve('.local/apps/history/main-analysis-before-20261019.app'),out='output/mygo-main-analysis-20261018';
const hash=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');const exe=p=>p+'/Contents/MacOS/opstwins-mygo';
const expected=JSON.parse(await fs.readFile(out+'/artifact-final.json')).executable;
if(await hash(exe(source))!==expected)throw Error('Candidate source changed');
const info=JSON.parse(await fs.readFile(out+'/notary-status.json')),submission=JSON.parse(await fs.readFile(out+'/notary-submission.json')),intent=JSON.parse(await fs.readFile(out+'/notary-intent.json'));if(info.status!=='Accepted'||info.id!==submission.id||intent.executable!==expected||info.name!==path.basename(intent.archive))throw Error('Exact candidate notarization not accepted');
for(const port of [46110,46312]){const busy=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false))});if(busy)throw Error('Own old runtime must stop before replacing: '+port)}
for(const p of [source,target])if((await fs.lstat(p)).isSymbolicLink())throw Error('Bundle symlink rejected');
for(const p of [next,backup])try{await fs.lstat(p);throw Error('Transaction destination already exists: '+p)}catch(e){if(e.code!=='ENOENT')throw e}
for(const cmd of [['codesign','--verify','--deep','--strict',source],['xcrun','stapler','validate',source],['spctl','--assess','--type','execute','--verbose=2',source]])execFileSync(cmd[0],cmd.slice(1),{stdio:'pipe'});
const old=await hash(exe(target));await fs.mkdir(path.dirname(backup),{recursive:true});execFileSync('ditto',[source,next]);execFileSync('codesign',['--verify','--deep','--strict',next]);if(await hash(exe(next))!==expected)throw Error('Staged bytes differ');
await fs.rename(target,backup);try{await fs.rename(next,target)}catch(e){await fs.rename(backup,target);throw e}
await fs.writeFile(out+'/install-receipt.json',JSON.stringify({installed:target,backup,previousSHA256:old,installedSHA256:await hash(exe(target)),notaryId:info.id,userStateCopied:false},null,2));console.log({installed:target,backup,sha256:expected});
