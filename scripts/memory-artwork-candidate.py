"""Focused signed local update on a byte-verified installed native snapshot."""
from pathlib import Path
import subprocess,shutil,plistlib,json,hashlib,time,re,os
r=Path.cwd();base=Path('/Applications/CyberMe.app');work=r/'.local/acceptance/memory-artwork-installed-20261106';out=r/'output/memory-artwork-20261106';out.mkdir(exist_ok=True)
parity=json.loads((work/'baseline-native-parity.json').read_text());assert len(parity)==20 and all(parity.values())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseexe=sha(base/'Contents/MacOS/opstwins-mygo')
subprocess.run(['codesign','--verify','--deep','--strict',str(base)],check=True)
signature=subprocess.run(['codesign','-dv','--verbose=4',str(base)],capture_output=True,text=True,check=True).stderr
identity=re.search(r'^Authority=(Developer ID Application: .+)$',signature,re.M).group(1);assert 'TeamIdentifier=T695TT4HT9' in signature
candidate=r/('.local/signing/memory-artwork-20261106-'+str(int(time.time()))+'/CyberMe.app');candidate.parent.mkdir(parents=True)
subprocess.run(['ditto',str(base),str(candidate)],check=True)
assets=work/'native/assets';web=r/'.local/memory-artwork-web';changed=[]
manifest=json.loads((work/'baseline-assets.json').read_text())
assert all(sha(r/'native/mygo/assets'/x['path'])==x['sha256'] for x in manifest['embeddedAssets'])
shutil.rmtree(assets);shutil.copytree(r/'native/mygo/assets',assets)
# Only CyberMe entry/bundle changes. All other entries and shared assets must match baseline.
for p in web.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(web)
 if str(rel)!='cyberme.html' and not str(rel).startswith('web-assets/'):continue
 old=assets/rel
 if old.exists() and p.read_bytes()==old.read_bytes():continue
 assert str(rel)=='cyberme.html' or (str(rel).startswith('web-assets/cyberme-') and p.suffix in ['.js','.css']),str(rel)
 old.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,old);changed.append(str(rel))
flags=f'-X github.com/egoist/mygo.production=1 -X main.updateSourceRoot={r}/.local/updates -X main.acceptanceWindowWidth=1000 -X main.workspaceRoot= -X main.runtimeNode= -X main.runtimeMode=standalone -X main.serviceScope=mygo-desktop -X main.servicePort=46312 -X main.clientScope=mygo-workspace'
subprocess.run(['go','build','-trimpath','-ldflags='+flags,'-o',str(candidate/'Contents/MacOS/opstwins-mygo'),'.'],cwd=work/'native',env={**os.environ,'GOTOOLCHAIN':'go1.27.1'},check=True)
runtime=candidate/'Contents/Resources/runtime'
shutil.copyfile(r/'server/src/memory-library.ts',runtime/'server/src/memory-library.ts')
p=runtime/'server/src/index.ts';s=p.read_text();assert "import {memoryPeople}" not in s
anchor="import {knowledgePaths,saveKnowledgePaths} from './knowledge-paths';";assert s.count(anchor)==1
s=s.replace(anchor,anchor+"\nimport {memoryPeople} from './memory-library';")
anchor="app.get('/api/settings/knowledge-paths',c=>json(c,knowledgePaths()));";assert s.count(anchor)==1
s=s.replace(anchor,anchor+"\napp.get('/api/memory-library/people',c=>json(c,memoryPeople()));");p.write_text(s)
assert s==(r/'server/src/index.ts').read_text(),'Concurrent server source differs: review required'
info=candidate/'Contents/Info.plist';data=plistlib.loads(info.read_bytes());oldbuild=data['CFBundleVersion'];data['CFBundleVersion']=str(max(int(time.time()*1000),int(oldbuild)+1));info.write_bytes(plistlib.dumps(data))
subprocess.run(['codesign','--force','--sign',identity,'--timestamp','--options','runtime',str(candidate)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(candidate)],check=True)
assert sha(base/'Contents/MacOS/opstwins-mygo')==baseexe,'Installed app changed while preparing'
runtimeChanges=[];same=0
for p in runtime.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(runtime);old=base/'Contents/Resources/runtime'/rel
 if old.exists() and sha(p)==sha(old):same+=1
 else:runtimeChanges.append(str(rel))
assert set(runtimeChanges)=={'server/src/index.ts','server/src/memory-library.ts'},runtimeChanges
record={'candidate':str(candidate),'build':data['CFBundleVersion'],'previousBuild':oldbuild,'version':data['CFBundleShortVersionString'],'baselineExecutable':baseexe,'executable':sha(candidate/'Contents/MacOS/opstwins-mygo'),'baselineNativeSectionsMatched':20,'changedAssets':changed,'runtimeChanges':runtimeChanges,'runtimeUnchanged':same,'signatureVerified':True,'localOnly':True,'newNotarization':False}
(out/'candidate.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
