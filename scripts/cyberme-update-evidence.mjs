// Read-only, redacted proof. Never saves a private draft or message body.
import fs from'node:fs/promises';import path from'node:path';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const phase=process.argv[2];if(!/^[a-z-]+$/.test(phase||''))throw Error('Explicit phase required');const out=path.resolve('output/cyberme-update-20261023'),app='/Applications/CyberMe.app',hash=x=>createHash('sha256').update(x).digest('hex');
const state=JSON.parse(await fs.readFile(process.env.HOME+'/Library/Application Support/OpsTwins/.local/mygo-workspace/state.json','utf8'));
const plist=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',app+'/Contents/Info.plist'],{encoding:'utf8'}));
const health=await fetch('http://127.0.0.1:46110/api/health').then(r=>r.json());
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const result={phase,at:new Date().toISOString(),app,name:plist.CFBundleDisplayName,version:plist.CFBundleShortVersionString,build:plist.CFBundleVersion,dataEpoch:plist.CyberMeDataEpoch||'1',signatureVerified:true,executableSHA256:hash(await fs.readFile(app+'/Contents/MacOS/opstwins-mygo')),helperSHA256:hash(await fs.readFile(app+'/Contents/Resources/runtime/scripts/cyberme-updater.mjs')),health:{ok:health.ok,runtimeMode:health.runtimeMode},draftsSHA256:hash(JSON.stringify(Object.entries(state.drafts).sort())),publicDraftPresent:JSON.stringify(state.drafts).includes('CYBERME-UPDATE-DRAFT-20261023'),privateContentSaved:false};
await fs.mkdir(out,{recursive:true});await fs.writeFile(out+'/'+phase+'.json',JSON.stringify(result,null,2));console.log(result);
