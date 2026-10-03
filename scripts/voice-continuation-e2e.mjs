// Repeat: OPSADV_QA_SPACE=<existing space id> ego-browser nodejs < scripts/voice-continuation-e2e.mjs
// Synthetic microphone source; real MediaRecorder, ASR HTTP and Chat. No external sends.
const fs=await import('node:fs/promises');
const out='/Users/steve/Projects/opstwin-advance/output/voice-continuation-20261002';
const task=await taskSpace(Number(process.env.OPSADV_QA_SPACE||64)),page=task.page('p1');
const marker=`OPSADV-QA-VOICE-CONT-${Date.now()}`;
const evidence={marker,mode:'Synthetic WebAudio microphone; real MediaRecorder + Doubao + Chat',checks:[]};
const check=(name,pass,detail)=>{evidence.checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name)};
const api=async(path,body)=>{const r=await fetch('http://127.0.0.1:46110/api'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error(path+': '+r.status);return r.json()};
const base64=(await fs.readFile(out+'/speech.wav')).toString('base64');
try{
 const convo=await api('/conversations',{title:marker,mode:'chat'});evidence.conversationId=convo.id;
 await page.goto('http://127.0.0.1:46100/chat?conversation='+convo.id);await page.waitForSelector('.chat-composer>textarea');
 console.log(await page.snapshot());
 const controls=await page.evaluate(()=>({audioInputs:document.querySelectorAll('input[accept*="audio"]').length,buttons:[...document.querySelectorAll('.composer-buttons button')].map(b=>b.getAttribute('aria-label'))}));
 check('Audio-file transcription controls removed',controls.audioInputs===0&&!controls.buttons.some(x=>/转写|Transcribe/.test(x)),controls);
 await page.evaluate(async b64=>{
  window.qaAudioContext=new AudioContext();await window.qaAudioContext.resume();
  window.qaAudioBuffer=await window.qaAudioContext.decodeAudioData(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer);
  window.qaStreams=[];window.qaEnded=false;
  navigator.mediaDevices.getUserMedia=async()=>{
   const ctx=window.qaAudioContext;await ctx.resume();const source=ctx.createBufferSource();source.buffer=window.qaAudioBuffer;
   const destination=ctx.createMediaStreamDestination();source.connect(destination);window.qaEnded=false;source.onended=()=>window.qaEnded=true;source.start(ctx.currentTime+0.2);window.qaStreams.push(destination.stream);return destination.stream;
  };
 },base64);
 await page.fill('.chat-composer>textarea',marker+' 测试：请写80条软件设计建议，每条至少60字。不要调用任何工具，不要读取数据，不要创建任务或文件，不要对外发送。');
 await page.press('.chat-composer>textarea','Enter');
 await page.waitForFunction(()=>!!document.querySelector('button[aria-label="插入当前任务"]'));
 const pending=await page.evaluate(()=>({busy:[...document.querySelectorAll('[role="status"]')].some(x=>x.textContent.includes('正在处理')),micDisabled:document.querySelector('button[aria-label="语音输入"]').disabled}));
 check('Microphone enabled while original Chat request is pending',pending.busy&&!pending.micDisabled,pending);
 for(let round=1;round<=2;round++){
  const before=(await api('/runs')).filter(r=>r.kind==='voice').map(r=>r.id);
  await page.click('button[aria-label="语音输入"]');await page.waitForSelector('.voice-inline.is-recording');
  check('Send disabled during recording '+round,await page.evaluate(()=>document.querySelector('.chat-composer button[type="submit"]').disabled));
  if(round===1)await page.screenshot({path:out+'/recording-during-chat.png'});
  await page.waitForFunction(()=>window.qaEnded,undefined,{timeout:20000});
  await page.click('.voice-finish');await page.waitForSelector('.voice-inline.is-ready',{timeout:60000});
  const state=await page.evaluate(()=>({draft:document.querySelector('.chat-composer>textarea').value,micDisabled:document.querySelector('button[aria-label="语音输入"]').disabled,tracks:window.qaStreams.map(s=>s.getTracks().map(t=>t.readyState))}));
  check('Real transcription appends and microphone resets '+round,state.draft.includes('连续语音测试')&&!state.micDisabled&&state.tracks.flat().every(s=>s==='ended'),state);
  const run=(await api('/runs')).find(r=>r.kind==='voice'&&!before.includes(r.id));
  check('Persisted actual ASR result '+round,run?.status==='succeeded'&&run?.engine==='doubao',{id:run?.id,status:run?.status,engine:run?.engine,output:run?.output});
 }
 const draft=await page.evaluate(()=>document.querySelector('.chat-composer>textarea').value);
 await page.press('.chat-composer>textarea','Enter');await page.waitForFunction(()=>!document.querySelector('.chat-composer>textarea').value&&!document.querySelector('button[aria-label="语音输入"]').disabled);
 check('Second message accepted and microphone available',await page.evaluate(()=>!document.querySelector('button[aria-label="语音输入"]').disabled));
 await page.click('button[aria-label="语音输入"]');await page.waitForSelector('.voice-inline.is-recording');await page.press('.chat-composer>textarea','Escape');await page.waitForFunction(()=>!document.querySelector('.voice-inline'));
 check('Third recording can start and cancel cleanly',await page.evaluate(()=>window.qaStreams.at(-1).getTracks().every(t=>t.readyState==='ended')));
 await page.fill('.chat-composer>textarea',marker+' preserved draft');
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('QA denied','NotAllowedError')}});
 await page.click('button[aria-label="语音输入"]');await page.waitForSelector('.voice-inline.is-failed');
 const failed=await page.evaluate(()=>({text:document.querySelector('.voice-inline').textContent,draft:document.querySelector('.chat-composer>textarea').value}));
 check('Permission failure preserves draft and offers re-record without file upload',failed.draft===marker+' preserved draft'&&failed.text.includes('重新录音')&&!failed.text.includes('选择音频'),failed);
 await page.screenshot({path:out+'/permission-recovery.png'});
 await page.press('.chat-composer>textarea','Escape');await page.reload();await page.waitForSelector('.chat-composer>textarea');
 check('Draft survives refresh; microphone remains available',await page.evaluate(expected=>document.querySelector('.chat-composer>textarea').value===expected&&!document.querySelector('button[aria-label="语音输入"]').disabled,marker+' preserved draft'));
 await page.fill('.chat-composer>textarea','');
 await page.screenshot({path:out+'/desktop-final.png'});
 evidence.sentTranscript=draft;evidence.status='PASS';
}catch(e){evidence.status='FAIL';evidence.error=String(e);throw e}finally{await fs.writeFile(out+'/e2e.json',JSON.stringify(evidence,null,2));console.log(evidence)}
