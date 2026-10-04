#!/usr/bin/env python3
# coding: utf-8
import pathlib,json,io,hashlib,datetime,argparse
from PIL import Image,ImageCms
parser=argparse.ArgumentParser(description='Read original native E2E screenshots with real ICC; reproduce composer shell upper-edge measurements.')
parser.add_argument('--evidence-dir',default='output/native-parity-20261003/composer-v35-20261004')
args=parser.parse_args()
p=pathlib.Path(args.evidence_dir).resolve();out={}
for f in sorted(p.glob('*.png')):
 im=Image.open(f);icc=im.info.get('icc_profile')
 if not icc:raise SystemExit('Original ICC required')
 rgb=ImageCms.profileToProfile(im,ImageCms.ImageCmsProfile(io.BytesIO(icc)),ImageCms.createProfile('sRGB'),outputMode='RGB');w,h=rgb.size
 xs=[600,800,1000,1200] if w==1800 else [1000,1200,1400,1600]
 rows={};start=h-(165 if 'single' in f.stem else 225)
 for x in xs:
  values=[[y,list(rgb.getpixel((x,y)))] for y in range(start,h-30)]
  first=next((y for y,c in values if min(c)>=254),None)
  rows[str(x)]={'firstNearWhiteY':first,'values':values}
 out[f.stem]={'size':[w,h],'iccBytes':len(icc),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'columns':rows}
checks=[]
for names in [('01-wide-before','02-wide-recording','03-wide-cancel'),('04-narrow-before','05-narrow-recording','06-narrow-cancel'),('07-narrow-single-before','08-narrow-single-recording','09-narrow-single-cancel')]:
 checks.append({'frames':names,'sameTopAtFourColumns':all(c['firstNearWhiteY'] is not None for n in names for c in out[n]['columns'].values()) and len(set(tuple(c['firstNearWhiteY'] for c in out[n]['columns'].values()) for n in names))==1 and len(set(tuple(out[n]['size']) for n in names))==1})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'profiles':out,'checks':checks,'limits':['First near-white pixel at four interior columns verifies shell upper edge, not text pixels or full 1pt font geometry.','Real ICC converted to sRGB; originals unchanged.','No ASR/send: actual Start/Cancel only.','No complete UI score.']}
(p/'pixel-profiles.json').write_text(json.dumps(result,indent=2));print(json.dumps({'artifact':str((p/'pixel-profiles.json').resolve()),'checks':checks,'tops':{k:{x:c['firstNearWhiteY'] for x,c in v['columns'].items()} for k,v in out.items()}}))
raise SystemExit(0 if all(c['sameTopAtFourColumns'] for c in checks) else 1)
