// Read-only installed gateway journey; no private document content in evidence.
import fs from 'node:fs';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const out='output/memory-artwork-20261106',link=JSON.parse(fs.readFileSync(os.homedir()+'/Library/Application Support/OpsTwins/.local/mygo-desktop/connection.json'));
const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name)};
try{
 const candidate=JSON.parse(fs.readFileSync(out+'/gateway-candidate.json')),receipt=JSON.parse(fs.readFileSync('.local/updates/last-result.json'));
 check('installed receipt matches final candidate',receipt.status==='installed'&&receipt.version.build===candidate.build&&receipt.signatureVerified);
 const request=(path,method='GET',auth=true)=>fetch('http://127.0.0.1:'+link.port+path,{method,headers:auth?{'X-OpsTwins-Pilot':link.token}:{},signal:AbortSignal.timeout(15000)});
 check('workspace health',(await request('/api/health')).ok);
 const response=await request('/api/memory-library/people');check('authenticated people read traverses gateway',response.ok);const value=await response.json();
 check('configured owner aliases',value.owner.name==='许茂林'&&value.owner.aliases.includes('Steve'));
 check('all configured original profiles readable',value.people.length===21&&!value.incomplete&&value.people.every(p=>typeof p.markdown==='string'&&p.markdown.length>0));
 check('unauthenticated read rejected',(await request('/api/memory-library/people','GET',false)).status===403);
 check('write method rejected',(await request('/api/memory-library/people','POST')).status===403);
 check('unlisted path rejected',(await request('/api/memory-library/other')).status===403);
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),route='Contents/Resources/runtime/scripts/mygo-workspace-gateway.mjs';
 check('installed gateway matches reviewed source',hash('/Applications/CyberMe.app/'+route)===hash('scripts/mygo-workspace-gateway.mjs'));
 check('installed native executable matches candidate',hash('/Applications/CyberMe.app/Contents/MacOS/opstwins-mygo')===hash(candidate.candidate+'/Contents/MacOS/opstwins-mygo'));
 execFileSync('codesign',['--verify','--deep','--strict','/Applications/CyberMe.app'],{stdio:'pipe'});check('installed signature valid',true);
 console.log({passed:checks.length,build:candidate.build});
}finally{fs.writeFileSync(out+'/installed-checks.json',JSON.stringify({checks},null,2));}
