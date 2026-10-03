// Browser E2E established before the stable-composer correction. No real microphone/ASR claim.
const fs=await import('node:fs/promises'),crypto=await import('node:crypto');
const base='/Users/steve/Projects/opstwin-advance',out=base+'/output/dictation-stable-composer';await fs.mkdir(out,{recursive:true});
const task=await taskSpace(globalThis.OPS_UI_SPACE??'OpsTwins stable dictation composer'),p=task.page('p1'),checks=[];console.log({spaceId:task.spaceId});
const paths=['docs/design/macos-dictation.js','docs/design/macos-dictation.css'];const hashes={};for(const f of paths)hashes[f]=crypto.createHash('sha256').update(await fs.readFile(base+'/'+f)).digest('hex');
const check=(name,pass)=>{checks.push({name,status:pass?'PASS':'FAIL'});if(!pass)throw Error(name)};
let saved;
try{
 await p.goto('file://'+base+'/docs/design/macos-ui-study.html');await p.cdp('Page.bringToFront');
 saved=await p.evaluate(()=>Object.fromEntries(['opstwins-ui-study-prefs','opstwins-ui-study-state-v2','opstwins-design-sessions-v1'].map(k=>[k,localStorage.getItem(k)])));
 await p.evaluate(()=>{window.__media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__audio=[];navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext(),d=c.createMediaStreamDestination(),o=c.createOscillator();o.connect(d);o.start();window.__audio.push(c);return d.stream}});
 for(const width of [1272,760,390]){await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:961,deviceScaleFactor:1,mobile:false});for(const dark of [false,true]){await p.evaluate(d=>document.body.classList.toggle('dark',d),dark);for(const multiline of [false,true]){
  await p.fill('#input',multiline?'合成第一行\n合成第二行\n合成第三行':'合成草稿');
  const before=await p.evaluate(()=>{const f=document.querySelector('#composer'),r=f.getBoundingClientRect(),s=getComputedStyle(f);return {x:r.x,y:r.y,w:r.width,h:r.height,bg:s.backgroundColor,radius:s.borderRadius,padding:s.padding}});
  await p.click('#dictation-info');await p.waitForFunction(()=>document.querySelector('#composer').dataset.voiceState==='recording',undefined,{timeout:5000});
  check('fixed composer '+width+' '+dark+' '+multiline,await p.evaluate(before=>{const f=document.querySelector('#composer'),r=f.getBoundingClientRect(),s=getComputedStyle(f);return Math.abs(r.x-before.x)<.6&&Math.abs(r.y-before.y)<.6&&Math.abs(r.width-before.w)<.6&&Math.abs(r.height-before.h)<.6&&s.backgroundColor===before.bg&&s.borderRadius===before.radius&&s.padding===before.padding},before));
  check('compact icons and waveform '+width+' '+dark+' '+multiline,await p.evaluate(()=>[...document.querySelectorAll('.voice-button')].every(b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();return r.width>=30&&r.width<=34&&r.height<=34&&s.width===22&&s.height===22})&&document.querySelector('#voice-waveform').getBoundingClientRect().width>0));
  if(width===1272&&!multiline){const clip=await p.evaluate(()=>{const r=document.querySelector('#composer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}});await p.screenshot({path:out+'/'+(dark?'dark':'light')+'.png',clip})}
  await p.click('#voice-cancel');await p.waitForFunction(()=>document.querySelector('#composer').dataset.voiceState==='idle');check('cancel draft '+width+' '+dark+' '+multiline,await p.evaluate(m=>document.querySelector('#input').value===(m?'合成第一行\n合成第二行\n合成第三行':'合成草稿'),multiline));
 }}}
}catch(error){checks.push({name:'E2E',status:'FAIL',error:error.message})}finally{
 await p.evaluate(()=>{window.OpsTwinsDictation.cancel();navigator.mediaDevices.getUserMedia=window.__media;for(const c of window.__audio||[])void c.close()}).catch(()=>{});
 if(saved)await p.evaluate(s=>{for(const [k,v]of Object.entries(s)){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}},saved);
 await p.cdp('Emulation.clearDeviceMetricsOverride');await p.reload();
}
check('sources stable',await Promise.all(paths.map(async f=>crypto.createHash('sha256').update(await fs.readFile(base+'/'+f)).digest('hex')===hashes[f])).then(x=>x.every(Boolean)));
await fs.writeFile(out+'/result.json',JSON.stringify({spaceId:task.spaceId,checks,hashes,scope:'layout; actual MediaRecorder with synthetic oscillator; microphone/ASR NOT_RUN'},null,2));console.log({passed:checks.filter(x=>x.status==='PASS').length,failed:checks.filter(x=>x.status==='FAIL').length});if(checks.some(x=>x.status==='FAIL'))throw Error('E2E failed');
