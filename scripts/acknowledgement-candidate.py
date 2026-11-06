"""Prepare a signed local backend update from the installed app; no publication."""
from pathlib import Path
import hashlib,json,plistlib,subprocess,time,re

root=Path.cwd()
base=Path('/Applications/CyberMe.app')
candidate=root/('.local/signing/acknowledgement-filter-20261106-'+str(int(time.time()))+'/CyberMe.app')
out=root/'output/acknowledgement-filter-20261106'
files=['server/src/inbox-copilot.ts','shared/inbox-judgment.ts','server/src/inbox-triage.ts','server/src/inbox-omlx.ts','server/src/store.ts']
baselineBuild=plistlib.loads((base/'Contents/Info.plist').read_bytes())['CFBundleVersion']
assert not candidate.exists(), 'Candidate already exists; do not overwrite frozen bytes'
subprocess.run(['codesign','--verify','--deep','--strict',str(base)],check=True)
signature=subprocess.run(['codesign','-dv','--verbose=4',str(base)],capture_output=True,text=True,check=True).stderr
identity=re.search(r'^Authority=(Developer ID Application: .+)$',signature,re.M).group(1)
assert 'TeamIdentifier=T695TT4HT9' in signature
candidate.parent.mkdir(parents=True)
subprocess.run(['ditto',str(base),str(candidate)],check=True)
runtime=candidate/'Contents/Resources/runtime'
for file in files:
    (runtime/file).write_bytes((root/file).read_bytes())
info=candidate/'Contents/Info.plist'
data=plistlib.loads(info.read_bytes());before=data['CFBundleVersion'];data['CFBundleVersion']=str(max(int(time.time()*1000),int(before)+1));info.write_bytes(plistlib.dumps(data))
subprocess.run(['codesign','--force','--sign',identity,'--timestamp','--options','runtime',str(candidate)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(candidate)],check=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
changes=[];same=0
for p in runtime.rglob('*'):
    if not p.is_file():continue
    rel=p.relative_to(runtime).as_posix();old=base/'Contents/Resources/runtime'/rel
    if old.exists() and sha(p)==sha(old):same+=1
    else:changes.append(rel)
assert changes and set(changes).issubset(files),changes
assert plistlib.loads((base/'Contents/Info.plist').read_bytes())['CFBundleVersion']==baselineBuild, 'Installed app changed concurrently'
out.mkdir(parents=True,exist_ok=True)
record={'candidate':str(candidate),'build':data['CFBundleVersion'],'previousBuild':before,'runtimeChanged':changes,'runtimeUnchanged':same,'hashes':{f:sha(runtime/f) for f in files},'signatureVerified':True,'localOnly':True,'published':False,'newNotarization':False}
(out/'candidate.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record))
