"""Focused local update on the frozen 0.1.3 candidate; never packages the dirty runtime wholesale."""
from pathlib import Path
import shutil,json,hashlib,subprocess,plistlib,time,os
r=Path(__file__).resolve().parent.parent
base=r/'.local/signing/ideas-console-20261023/CyberMe.app'; frozen=r/'.local/ideas-console-build';build=r/'.local/cyberme-ideas-build-20261023'; candidate=r/'.local/signing/cyberme-ideas-20261023/CyberMe.app';out=r/'output/cyberme-ideas-installed-20261023'
assert not build.exists() and not candidate.exists()
subprocess.run(['codesign','--verify','--deep','--strict',str(base)],check=True)
assert plistlib.loads((base/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']=='0.1.3'
shutil.copytree(frozen,build,ignore=shutil.ignore_patterns('.git','*.app'))
assets=build/'assets'; source=r/'.local/idea-icon-assets'
# These frozen generated files were inspected against the installed-era asset manifest;
# differences are exclusively draft discussions, durable key and the icon renderer.
for f in ['full/workspace.js','full/refinement.js','full/runtime.js','macos-idea-icons.js']:
 shutil.copyfile(source/f,assets/f)
shutil.copytree(r/'docs/design/assets/idea-icons',assets/'assets/idea-icons',dirs_exist_ok=True)
p=assets/'desktop.html';s=p.read_text();assert 'OPSTWINS_APP_VERSION="0.1.3"' in s;p.write_text(s.replace('OPSTWINS_APP_VERSION="0.1.3"','OPSTWINS_APP_VERSION="0.1.4"'))
candidate.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['ditto',str(base),str(candidate)],check=True)
flags=f'-X github.com/egoist/mygo.production=1 -X main.updateSourceRoot={r}/.local/updates -X main.acceptanceWindowWidth=1000 -X main.workspaceRoot= -X main.runtimeNode= -X main.runtimeMode=standalone -X main.serviceScope=mygo-desktop -X main.servicePort=46312 -X main.clientScope=mygo-workspace'
subprocess.run(['go','build','-trimpath','-ldflags='+flags,'-o',str(candidate/'Contents/MacOS/opstwins-mygo'),'.'],cwd=build,env={**os.environ,'GOTOOLCHAIN':'go1.27.1'},check=True)
runtime=candidate/'Contents/Resources/runtime'
for f in ['server/src/ideas-background.ts','server/src/agent-capabilities.ts','shared/types.ts','shared/idea-icons.ts','shared/idea-icon-catalog.json']:shutil.copyfile(r/f,runtime/f)
p=runtime/'server/src/index.ts';s=p.read_text();assert 'ideaIconInstruction' not in s
s="import {ideaIconInstruction,resolveIdeaIcon} from '../../shared/idea-icons';\n"+s
replacements=[("if(type==='ideas'){data.description=", "if(type==='ideas'){data.iconKey=resolveIdeaIcon(data,old.iconKey);data.description="),('const result=await runAgent(`基于用户目标和数据库实际上下文','const result=await runAgent(`${ideaIconInstruction}\\n基于用户目标和数据库实际上下文'),('"action":"task|automation|draft|file"','"action":"task|automation|draft|file","iconKey":"从图标目录选择"')]
for old,new in replacements:assert s.count(old)==1,old;s=s.replace(old,new)
p.write_text(s)
p=candidate/'Contents/Info.plist';info=plistlib.loads(p.read_bytes());info['CFBundleShortVersionString']='0.1.4';info['CFBundleVersion']=str(int(time.time()*1000));p.write_bytes(plistlib.dumps(info))
subprocess.run(['codesign','--force','--sign','F3C065FE2C81D5863813D53ED81B3FF41540D901','--timestamp','--options','runtime',str(candidate)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(candidate)],check=True)
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
record={'version':'0.1.4','build':info['CFBundleVersion'],'baseCandidate':str(base),'candidate':str(candidate),'executableSHA256':h(candidate/'Contents/MacOS/opstwins-mygo'),'assets':{str(p.relative_to(assets)):h(p) for p in assets.rglob('*') if p.is_file()},'runtimeChanges':{f:h(runtime/f) for f in ['server/src/index.ts','server/src/ideas-background.ts','server/src/agent-capabilities.ts','shared/types.ts','shared/idea-icons.ts','shared/idea-icon-catalog.json']},'icons':len(list((assets/'assets/idea-icons').glob('*.svg'))),'privateDataIncluded':False}
(out/'candidate.json').write_text(json.dumps(record,indent=2))
subprocess.run(['ditto','-c','-k','--keepParent',str(candidate),str(candidate.parent/'notary.zip')],check=True)
print(json.dumps({k:record[k] for k in ['version','build','icons','candidate']}))
