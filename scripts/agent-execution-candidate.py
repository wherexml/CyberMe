"""Prepare a focused signed local backend update from the installed application."""
from pathlib import Path
import hashlib,json,plistlib,subprocess,time,re

root=Path.cwd();base=Path('/Applications/CyberMe.app')
out=root/'output/agent-execution-20261106';out.mkdir(parents=True,exist_ok=True)
files=['server/src/agent-execution.ts','server/src/agent-credential-capture.ts','server/src/agent.ts','server/src/agent-capabilities.ts','server/src/store.ts','server/src/index.ts','server/agent/agents.md']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baselineInfo=(base/'Contents/Info.plist').read_bytes()
baselineExecutable=sha(base/'Contents/MacOS/opstwins-mygo')
baselineFiles={f:sha(base/'Contents/Resources/runtime'/f) for f in files if (base/'Contents/Resources/runtime'/f).exists()}
subprocess.run(['codesign','--verify','--deep','--strict',str(base)],check=True)
signature=subprocess.run(['codesign','-dv','--verbose=4',str(base)],capture_output=True,text=True,check=True).stderr
identity=re.search(r'^Authority=(Developer ID Application: .+)$',signature,re.M).group(1)
assert 'TeamIdentifier=T695TT4HT9' in signature
candidate=root/('.local/signing/agent-execution-20261106-'+str(int(time.time()))+'/CyberMe.app');candidate.parent.mkdir(parents=True)
subprocess.run(['ditto',str(base),str(candidate)],check=True)
runtime=candidate/'Contents/Resources/runtime'
for f in files:(runtime/f).write_bytes((root/f).read_bytes())
info=candidate/'Contents/Info.plist';data=plistlib.loads(info.read_bytes());oldBuild=data['CFBundleVersion'];data['CFBundleVersion']=str(max(int(time.time()*1000),int(oldBuild)+1));info.write_bytes(plistlib.dumps(data))
assert sha(candidate/'Contents/MacOS/opstwins-mygo')==baselineExecutable
subprocess.run(['codesign','--force','--sign',identity,'--timestamp','--options','runtime',str(candidate)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(candidate)],check=True)
assert (base/'Contents/Info.plist').read_bytes()==baselineInfo and sha(base/'Contents/MacOS/opstwins-mygo')==baselineExecutable,'Installed application changed during preparation'
assert all(sha(base/'Contents/Resources/runtime'/f)==v for f,v in baselineFiles.items())
changed=[];same=0
for p in runtime.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(runtime).as_posix();old=base/'Contents/Resources/runtime'/rel
 if old.exists() and sha(p)==sha(old):same+=1
 else:changed.append(rel)
assert set(changed)==set(files),changed
record={'candidate':str(candidate),'build':data['CFBundleVersion'],'previousBuild':oldBuild,'baselineExecutable':baselineExecutable,'baselineFiles':baselineFiles,'runtimeChanged':changed,'runtimeUnchanged':same,'hashes':{f:sha(runtime/f) for f in files},'signatureVerified':True,'localOnly':True,'newNotarization':False}
(out/'candidate.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
