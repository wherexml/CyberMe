// Explicit, unpublished E2E probe: fail BEFORE opening a business database.
// Prepare only. Installation still requires the native update button.
import fs from'node:fs/promises';import path from'node:path';import{execFileSync}from'node:child_process';import{randomUUID}from'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'.local/signing/cyberme-update-frozen/CyberMe.app'),target=path.join(root,'.local/signing/cyberme-update-fault-'+randomUUID(),'CyberMe.app');
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',source],{stdio:'pipe'});await fs.mkdir(path.dirname(target),{recursive:true});execFileSync('/usr/bin/ditto',[source,target]);
await fs.writeFile(target+'/Contents/Resources/runtime/server/src/index.ts','throw new Error("CYBERME_PUBLIC_STARTUP_FAILURE_PROBE");\n');
execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleVersion '+Date.now(),target+'/Contents/Info.plist']);
execFileSync('/usr/bin/codesign',['--force','--sign','F3C065FE2C81D5863813D53ED81B3FF41540D901','--timestamp','--options','runtime','--preserve-metadata=entitlements,requirements',target],{stdio:'pipe'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',target],{stdio:'pipe'});
await fs.writeFile(root+'/output/cyberme-update-20261023/fault-candidate.json',JSON.stringify({target,scope:'local unpublished startup failure before database open',published:false},null,2));console.log(target);
