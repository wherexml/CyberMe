"""Preserve 0.1.4 and version embedded asset URLs for native WebKit updates."""
from pathlib import Path
import shutil,json,hashlib,subprocess,plistlib,time,os
r=Path(__file__).resolve().parent.parent;base=r/'.local/signing/cyberme-ideas-20261023/CyberMe.app';build=r/'.local/cyberme-ideas-final-build-20261023';candidate=r/'.local/signing/cyberme-ideas-final-20261023/CyberMe.app';out=r/'output/cyberme-ideas-installed-20261023'
assert not build.exists() and not candidate.exists()
subprocess.run(['codesign','--verify','--deep','--strict',str(base)],check=True)
shutil.copytree(r/'.local/cyberme-ideas-build-20261023',build)
shutil.copyfile(r/'docs/design/macos-idea-icons.js',build/'assets/macos-idea-icons.js')
# Current native main differs from the frozen main only by this reviewed resource cache fix.
shutil.copyfile(r/'native/mygo/main.go',build/'main.go')
p=build/'assets/desktop.html';s=p.read_text();assert 'OPSTWINS_APP_VERSION="0.1.4"' in s;p.write_text(s.replace('OPSTWINS_APP_VERSION="0.1.4"','OPSTWINS_APP_VERSION="0.1.5"'))
candidate.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['ditto',str(base),str(candidate)],check=True)
flags=f'-X github.com/egoist/mygo.production=1 -X main.updateSourceRoot={r}/.local/updates -X main.acceptanceWindowWidth=1000 -X main.workspaceRoot= -X main.runtimeNode= -X main.runtimeMode=standalone -X main.serviceScope=mygo-desktop -X main.servicePort=46312 -X main.clientScope=mygo-workspace'
subprocess.run(['go','build','-trimpath','-ldflags='+flags,'-o',str(candidate/'Contents/MacOS/opstwins-mygo'),'.'],cwd=build,env={**os.environ,'GOTOOLCHAIN':'go1.27.1'},check=True)
p=candidate/'Contents/Info.plist';info=plistlib.loads(p.read_bytes());info['CFBundleShortVersionString']='0.1.5';info['CFBundleVersion']=str(int(time.time()*1000));p.write_bytes(plistlib.dumps(info))
subprocess.run(['codesign','--force','--sign','F3C065FE2C81D5863813D53ED81B3FF41540D901','--timestamp','--options','runtime',str(candidate)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(candidate)],check=True)
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();record={'candidate':str(candidate),'version':'0.1.5','build':info['CFBundleVersion'],'executableSHA256':h(candidate/'Contents/MacOS/opstwins-mygo'),'rendererSHA256':h(build/'assets/macos-idea-icons.js'),'changesFrom014':['versioned native static resource URLs and no-store','assets/desktop.html version'],'runtimeUnchanged':True}
(out/'native-icons-candidate.json').write_text(json.dumps(record,indent=2))
subprocess.run(['ditto','-c','-k','--keepParent',str(candidate),str(candidate.parent/'notary.zip')],check=True)
print(json.dumps(record))
