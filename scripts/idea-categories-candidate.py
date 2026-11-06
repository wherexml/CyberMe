from pathlib import Path
import subprocess,plistlib,time,json,shutil,hashlib,os
r=Path.cwd();base=Path('/Applications/CyberMe.app');out=r/'output/idea-categories-20261106';dest=r/('.local/signing/idea-categories-'+str(int(time.time()))+'/CyberMe.app');dest.parent.mkdir(parents=True);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();baseline=sha(base/'Contents/MacOS/opstwins-mygo')
assert plistlib.loads((base/'Contents/Info.plist').read_bytes())['CFBundleVersion']=='1793931515921','Installed baseline changed, review again'
subprocess.run(['ditto',str(base),str(dest)],check=True)
w=r/'.local/acceptance/memory-artwork-installed-20261106/native';assert (w/'proxy.go').read_text()==(r/'native/mygo/proxy.go').read_text()
assets=w/'assets';web=r/'.local/idea-categories-web'
for p in web.rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(web)
 if str(rel)=='cyberme.html' or str(rel).startswith('web-assets/cyberme-'):
  (assets/rel).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,assets/rel)
flags=f'-X github.com/egoist/mygo.production=1 -X main.updateSourceRoot={r}/.local/updates -X main.acceptanceWindowWidth=1000 -X main.workspaceRoot= -X main.runtimeNode= -X main.runtimeMode=standalone -X main.serviceScope=mygo-desktop -X main.servicePort=46312 -X main.clientScope=mygo-workspace'
subprocess.run(['go','build','-trimpath','-ldflags='+flags,'-o',str(dest/'Contents/MacOS/opstwins-mygo'),'.'],cwd=w,env={**os.environ,'GOTOOLCHAIN':'go1.27.1'},check=True)
files=['server/src/store.ts','server/src/agent.ts','server/src/ideas-background.ts','server/src/index.ts','server/src/idea-categories.ts','server/src/idea-category-value.ts','shared/idea-category.ts','shared/types.ts']
for f in files:shutil.copyfile(r/f,dest/'Contents/Resources/runtime'/f)
p=dest/'Contents/Info.plist';d=plistlib.loads(p.read_bytes());d['CFBundleVersion']=str(int(time.time()*1000));p.write_bytes(plistlib.dumps(d))
sig=subprocess.run(['codesign','-dv','--verbose=4',str(base)],capture_output=True,text=True).stderr;identity=next(x[len('Authority='):] for x in sig.splitlines() if x.startswith('Authority=Developer ID Application:'))
subprocess.run(['codesign','--force','--sign',identity,'--timestamp','--options','runtime',str(dest)],check=True);subprocess.run(['codesign','--verify','--deep','--strict',str(dest)],check=True)
assert sha(base/'Contents/MacOS/opstwins-mygo')==baseline
changed=[]
for p in (dest/'Contents/Resources/runtime').rglob('*'):
 if not p.is_file():continue
 rel=p.relative_to(dest/'Contents/Resources/runtime');old=base/'Contents/Resources/runtime'/rel
 if not old.exists() or sha(old)!=sha(p):changed.append(str(rel))
assert set(changed)<=set(files) and {'server/src/idea-categories.ts','server/src/idea-category-value.ts','shared/types.ts'}<=set(changed),changed
record={'candidate':str(dest),'build':d['CFBundleVersion'],'baselineExecutable':baseline,'executable':sha(dest/'Contents/MacOS/opstwins-mygo'),'runtimeFiles':{f:sha(r/f) for f in files},'signatureVerified':True};(out/'candidate.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
