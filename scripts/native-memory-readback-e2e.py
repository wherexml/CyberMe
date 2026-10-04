#!/usr/bin/env python3
"""Read-only archived native GUI/HTTP evidence; does not rerun GUI or score product."""
import hashlib, json, pathlib
from PIL import Image
root = pathlib.Path(__file__).resolve().parent.parent
d = root / 'output/native-parity-20261003/memory-recovery-resume-20261004'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
data = lambda name: json.loads((d/name).read_text())
checks = []
def check(name, value):
    checks.append({'name': name, 'pass': bool(value)})
for v in ['v42', 'v43']:
    b=data('source-binding-'+v+'-signed.json')
    check(v+' frozen source and original signed app', sha(d/('settings-'+v+'-original.rs')) == b['sourceSha256'] and sha(pathlib.Path(b['app'])/'Contents/MacOS/opstwin') == b['signedBinarySha256'])
c=data('created-before-restart.json');check('Actual create full 9534 body and single dropped response', c['characters']==9534 and c['expectedEqual'] and c['stats']['createPosts']==1 and c['stats']['drops']==1)
r=data('normal-quit-durable-request.json');check('Normal Quit kept exact request and full body',r['createId']==c['id'] and r['bodyEqual'] and r['characters']==9534 and r['fullRead'])
r=data('original-request-recovered.json');check('Restart original GET no duplicate POST/snapshot',all(r[k] for k in ['originalDraftCleared','noDuplicateCreate','noNewSnapshotOnReadback']))
r=data('long-edit-saved-canonical.json');check('Actual native full long edit saved 9573 characters',r['expectedEqual'] and r['characters']==9573)
r=data('v41-conflict-recovery-failure.json');check('Original v41 real conflict FAIL retained',r['status']=='FAIL' and r['minePreserved'] and r['oldLeaseStillUsed'] and r['oldLease']!=r['currentLease'])
r=data('v42-late-success-lost-draft.json');check('Original v42 real later-input loss FAIL retained',r['status']=='FAIL' and r['serverSubmittedOnly'] and r['laterDraftRemoved'])
r=data('v43-late-success-kept-draft.json');check('v43 actual delayed success kept later input and canonical lease',all(r[k] for k in ['serverSubmittedOnly','laterDraftKept','leaseUpdated']))
later='OPSADV-QA-MEMORY-20261004 LATE-SAVE-4 public submitted.\n末字终\nOPSADV-QA-LATER-UNSAVED-4 后输入终'
for name in ['36-v43-later-before-ack.ax.txt','37-v43-later-after-ack.ax.txt','38-v43-restart-later-kept.ax.txt']:
    check(name+' exact visible later input',later in (d/name).read_text())
r=data('v43-restart-explicit-save.json');check('After restart explicit save exact body and draft cleared',r['exactLaterSaved'] and r['draftCleared'] and r['stats']['receipts'][-1]['status']==200)
r=data('v43-late409-proxy-stats.json');check('Actual production 409 before delayed cross-section callback',r['receipts'][-1]['status']==409 and r['lastHeldPatchForwardAt']-r['receipts'][-1]['receivedAt']>=14900)
ax=(d/'41-v43-late409-other-section-after.ax.txt').read_text();check('Actual model section has no late memory error', 'button 测试连接' in ax and '该对象已在其他页面更新' not in ax and 'button 重新加载' not in ax)
r=data('v43-keep-conflict-no-write.json');check('v43 keep mine and rebase through read only',all(r[k] for k in ['mineKept','leaseCurrent','zeroWrites']))
r=data('v43-discard-conflict-no-write.json');check('v43 discard only after full canonical read',all(r[k] for k in ['fullCanonicalRead','leaseCurrent','zeroWrites']))
r=data('v43-negative-gates.json');check('Eight rejected cases no additional forwards',len(r['cases'])==8 and all(x['status']==403 for x in r['cases']) and r['zeroAdditionalWrites'])
check('Three original public memories unchanged',all(x['unchanged'] and x['updatedAtUnchanged'] for x in data('original-notes-unchanged.json')))
frames=[]
for p in sorted(d.glob('*.raw.jpg')):
    with Image.open(p) as im:
        im.load(); frames.append({'name':p.name,'sha256':sha(p),'actualFormat':im.format,'width':im.width,'height':im.height,'embeddedIccBytes':len(im.info.get('icc_profile',b''))})
check('Original screenshot streams valid JPEG with original ICC',len(frames)==27 and all(x['actualFormat']=='JPEG' and x['embeddedIccBytes']>0 for x in frames))
manifest={'scope':'Archived actual GUI and production HTTP only; no fresh GUI or full score','checks':checks,'frames':frames,'AX':[{'name':p.name,'sha256':sha(p)} for p in sorted(d.glob('*.ax.txt'))]}
manifest['status']='PASS' if all(c['pass'] for c in checks) else 'FAIL'
(d/'readback-e2e.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'status':manifest['status'],'checks':len(checks),'screenshots':len(frames),'AX':len(manifest['AX'])}))
assert manifest['status']=='PASS',[c for c in checks if not c['pass']]
