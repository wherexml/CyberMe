#!/usr/bin/env python3
"""Read-only replayable evidence audit of actual GUI + production policy consumer."""
import hashlib,json,pathlib
from PIL import Image
root=pathlib.Path(__file__).resolve().parent.parent;d=root/'output/native-parity-20261003/autonomy-resume-20261004'
data=lambda n:json.loads((d/n).read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();checks=[]
def check(n,v):checks.append({'name':n,'pass':bool(v)})
b=data('source-binding-v43-signed.json');check('Frozen actual source and signed App',sha(d/'settings-v43-original.rs')==b['sourceSha256'] and sha(pathlib.Path(b['app'])/'Contents/MacOS/opstwin')==b['signedBinarySha256'])
f=data('failed-save-canonical-draft.json');a=f['draft'];check('503 no server write and full draft retained',f['canonicalUnchanged'] and f['stats']['forwarded']==0 and f['stats']['rejected']==1 and a['holdSending'] is True and a['quietFrom']=='23:15' and a['quietUntil']=='06:45' and a['alerts']=='digest' and a['transparency'] is False)
check('Six exact levels, locked values canonical',a['levels']=={'ack':'observe','meet':'send_undo','docs':'autonomous','commit':'draft','boss':'draft','sensitive':'observe'})
check('All five checkbox toggles exact new selected set',set(a['deepThink'])=={'customers','manager','everyone'})
for name in ['10-v43-dirty-restart-bottom.ax.txt','15-v43-saved-restart-bottom.ax.txt']:
 t=(d/name).read_text();check(name+' visible policy/quiet/notifications',all(x in t for x in ['button 可撤销发送','button 自主发送','Value: 23:15','Value: 06:45','checkbox (settable, boolean) 客户, Value: on','checkbox (settable, boolean) 所有人, Value: on','radio button (selected, settable, boolean) 仅汇总','switch (settable, boolean) off']))
r=data('explicit-retry-saved-canonical.json');check('Explicit retry canonical exact submitted group',r['canonicalExactDraft'] and r['autonomyDraftCleared'] and r['stats']['forwarded']==1 and r['stats']['successes']==1)
check('Cancel returned saved quiet time', 'Value: 23:15' in (d/'12-v43-cancel-reverts-quiet.ax.txt').read_text())
r=data('policy-consumption-local-http.json');check('Actual next real readOnly model consumed everyone policy',r.get('status')==200 and r['run']['status']=='succeeded' and r['run']['mode']=='deep' and r['run']['readOnly'] is True and r['run']['model']=='claude-opus-5-5' and r['run']['policy']['reasons']==['everyone'] and r['artifactCount']==0 and r['intentsUnchanged'])
r=data('actual-policy-run-original-readback.json');check('Original durable same run + first NOT_RUN without request',r['firstNoDurableRequest'] and r['originalSucceededLedger'] and r['sameRunId'] and r['sendIntentCount']==0 and r['calendarIntentCount']==0)
r=data('policy-consumption-http.json');check('GUI hold policy rejected self send before any intent',r['heldGuard']['status']==423 and r['heldGuard']['code']=='sending_held' and r['intentsUnchanged'])
r=data('baseline-restored-canonical.json');check('Actual GUI baseline restored only two successful writes',r['baselineRestored'] and r['canonical']==data('public-autonomy-baseline.json') and r['stats']['forwarded']==2 and r['stats']['successes']==2)
r=data('negative-gates.json');check('Eight bounded negatives zero extra forwards',len(r['cases'])==8 and all(x['status']==403 for x in r['cases']) and r['zeroAdditionalForward'])
check('Only own public Inbox records soft deleted',all(x['deletedStatus']==200 and x['exactGet']==404 for x in data('public-inbox-soft-cleanup.json')))
frames=[]
for p in sorted(d.glob('*.raw.jpg')):
 with Image.open(p) as im:
  im.load();frames.append({'name':p.name,'sha256':sha(p),'format':im.format,'size':list(im.size),'embeddedIccBytes':len(im.info.get('icc_profile',b''))})
check('Seventeen original JPEG streams with embedded ICC',len(frames)==17 and all(x['format']=='JPEG' and x['embeddedIccBytes']>0 for x in frames))
out={'status':'PASS' if all(x['pass'] for x in checks) else 'FAIL','scope':'Archived real native policy GUI/HTTP only, not all 85/independent score','checks':checks,'frames':frames,'AX':[{'name':p.name,'sha256':sha(p)} for p in sorted(d.glob('*.ax.txt'))]};(d/'readback-e2e.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps({'status':out['status'],'checks':len(checks),'screenshots':len(frames),'AX':len(out['AX'])}));assert out['status']=='PASS',[x for x in checks if not x['pass']]
