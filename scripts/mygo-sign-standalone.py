#!/usr/bin/env python3
"""Sign nested Mach-O code before sealing the app; no secret export."""
import subprocess,json,hashlib,os
from pathlib import Path
root=Path(__file__).resolve().parent.parent
app=root/'.local/apps/OpsTwins Standalone.app'
identity='F3C065FE2C81D5863813D53ED81B3FF41540D901'
private=root/'.local/signing/standalone-20261016';private.mkdir(parents=True,exist_ok=True)
node_ent=private/'node-entitlements.plist';node_ent.write_text('<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>')
app_ent=private/'app-entitlements.plist'
app_ent.write_text('<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.device.audio-input</key><true/></dict></plist>')
magic={bytes.fromhex(x) for x in ['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']}
paths=[]
for p in app.rglob('*'):
 if not p.is_file() or p.is_symlink():continue
 with p.open('rb') as f:head=f.read(4)
 if head in magic:
  desc=subprocess.check_output(['file','-b',str(p)],text=True)
  if 'Mach-O' in desc:paths.append(p)
for p in sorted(paths,key=lambda p:len(p.parts),reverse=True):
 if p==app/'Contents/MacOS/opstwins-mygo':continue
 cmd=['codesign','--force','--sign',identity,'--timestamp','--options','runtime']
 if p==app/'Contents/Resources/runtime/bin/node':cmd+=['--entitlements',str(node_ent)]
 subprocess.run(cmd+[str(p)],check=True,capture_output=True)
subprocess.run(['codesign','--force','--sign',identity,'--timestamp','--options','runtime','--entitlements',str(app_ent),str(app)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict','--verbose=2',str(app)],check=True)
out=root/'output/mygo-standalone-20261016';out.mkdir(parents=True,exist_ok=True)
(out/'signed-components.json').write_text(json.dumps([{'path':str(p.relative_to(app)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in paths],indent=2))
print('Signed',len(paths),'Mach-O components')
