#!/usr/bin/env python3
"""Read only actual public native font frames; never simulates UI or sends."""
import hashlib,json,pathlib
from PIL import Image,ImageChops
root=pathlib.Path(__file__).resolve().parents[1]
d=root/'output/native-parity-20261003/fonts-resume-20261004'
checks=[]
def check(name,ok):
    assert ok,name
    checks.append({'name':name,'status':'PASS'})
def image(name):return Image.open(d/name).convert('RGB')
def ink_bounds(im,roi):
    x0,y0,x1,y1=roi
    pts=[(x,y) for y in range(y0,y1) for x in range(x0,x1) if max(im.getpixel((x,y)))<100]
    assert pts,'No real dark glyph pixels'
    return [min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts),max(y for x,y in pts)]
a=image('07-chat-14-system-zoom.png');b=image('09-chat-16.png')
check('Same viewport for actual 14/16 body comparison',a.size==b.size==(4096,2114))
roi=(2300,240,2850,350);ab=ink_bounds(a,roi);bb=ink_bounds(b,roi)
wa=ab[2]-ab[0]+1;wb=bb[2]-bb[0]+1
check('Actual glyph width scales by 16/14',abs(wb/wa-16/14)<0.015)
nav=(90,85,420,1000)
check('Settings navigation remains pixel-identical',ImageChops.difference(image('03-settings-14.png').crop(nav),image('08-settings-16.png').crop(nav)).getbbox() is None)
check('Actual menu has three current choices',all(x in (d/'02-font-menu.ax.txt').read_text() for x in ['14 pt','15 pt','16 pt']))
check('Normal restart retained 16pt menu value','button 16 pt' in (d/'11-settings-16-restart.ax.txt').read_text())
draft='OPSADV-QA-FONT-20261004 多行草稿\n末字终'
check('Both font changes and normal restart retained exact draft',all(draft in (d/n).read_text() for n in ['04-chat-14.ax.txt','09-chat-16.ax.txt','10-chat-16-restart.ax.txt','12-chat-restored-15.ax.txt']))
state=json.loads((root/'.local/acceptance/fonts-resume-20261004/gui-qualified/settings-drafts.json').read_text())
check('Own local preference restored to 15',state['local']['font']==15)
binding=json.loads((d/'source-binding.json').read_text())
check('Actual source and signed binary binding unchanged',hashlib.sha256((root/'native/macos/app/src/settings.rs').read_bytes()).hexdigest()==binding['sourceSha256'] and hashlib.sha256(pathlib.Path(binding['app']+'/Contents/MacOS/opstwin').read_bytes()).hexdigest()==binding['signedBinarySha256'])
frames=[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(d.glob('*')) if p.suffix=='.png' or p.name.endswith('.ax.txt')]
check('Original clipped and recovered frames retained',len(frames)==24)
result={'status':'PASS','mode':'ARCHIVED_ACTUAL_GUI_EVIDENCE','checks':checks,'bodyPixelROI':roi,'bodyInk14':ab,'bodyInk16':bb,'width14':wa,'width16':wb,'ratio':wb/wa,'fixedNavigationROI':nav,'frames':frames,'notClaimed':['13/19pt legacy plan','bilingual UI','all font content types','final full score','cause of clipped initial captures','exact maximized bounds after restart']}
(d/'readback-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'checks':len(checks),'frames':len(frames),'width14':wa,'width16':wb}))
