/* Microphone -> real MediaRecorder -> configured server ASR. Audio stays in memory. */
(() => {
 const $=id=>document.getElementById(id);let ui,phase='idle',generation=0,stream,recorder,context,analyser,frame,timer,blob,controller,sendIntent=false,last;
 const samples=[];let stamp=0;
 const errors={voice_no_speech:'未检测到人声',voice_empty_text:'未识别到文字',voice_timeout:'转写超时',voice_busy:'语音服务繁忙',voice_setup_required:'语音服务未配置',voice_auth:'语音服务鉴权失败',voice_unavailable:'转写失败',voice_cancelled:'已取消',voice_size:'录音过大',voice_duration:'录音过长'};
 function draw(){
  const canvas=$('voice-waveform'),width=canvas.clientWidth,height=40,dpr=devicePixelRatio||1;
  if(!width)return;
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr)}
  const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);
  const count=Math.max(1,Math.floor(width/12)),visible=samples.slice(-count),empty=count-visible.length;
  for(let i=0;i<count;i++){const level=i<empty?0:visible[i-empty],h=Math.max(5,Math.min(34,Math.sqrt(level)*65)),x=i*12+(width-(count-1)*12)/2;c.fillStyle=i<empty?'#666':'#a6a6a6';c.beginPath();c.roundRect(x-2.5,(height-h)/2,5,h,2.5);c.fill()}
 }
 function tick(now){
  if(phase!=='recording')return;
  if(now-stamp>=65){const wave=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(wave);let power=0;for(const v of wave)power+=v*v;const rms=Math.sqrt(power/wave.length);samples.push(rms);if(samples.length>180)samples.shift();$('voice-waveform').dataset.peak=String(Math.max(Number($('voice-waveform').dataset.peak)||0,rms));stamp=now;draw()}
  frame=requestAnimationFrame(tick);
 }
 function release(){clearTimeout(timer);cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;analyser=null;if(context){void context.close().catch(()=>{});context=null}}
 function paint(){
  const active=phase!=='idle',form=$('composer');form.dataset.voiceState=phase;form.classList.toggle('voice-active',active);$('voice-controls').hidden=!active;
  for(const id of ['attachment-info','input','dictation-info','send'])$(id).hidden=active;
  const stop=$('voice-stop'),send=$('voice-send'),error=$('voice-error');stop.disabled=!['recording','failed'].includes(phase);send.disabled=phase!=='recording';
  stop.setAttribute('aria-label',phase==='failed'?'重试转写':'停止听写');stop.title=phase==='failed'?'重试转写':'停止听写';stop.querySelector('use').setAttribute('href',phase==='failed'?'#voice-retry-symbol':'#voice-stop-symbol');
  error.hidden=phase!=='failed';$('voice-waveform').hidden=phase==='failed';$('voice-waveform').setAttribute('aria-label',phase==='recording'?'正在听写':phase==='requesting'?'正在请求麦克风':'正在转写');
  form.setAttribute('aria-busy',String(['requesting','transcribing'].includes(phase)));draw();
 }
 function cancel(){
  generation++;controller?.abort();controller=null;
  if(recorder&&recorder.state!=='inactive'){try{recorder.stop()}catch{}}
  recorder=null;release();blob=null;sendIntent=false;phase='idle';paint();
 }
 async function transcribe(id){
  if(!blob?.size){release();phase='idle';paint();ui.notify('没有录到声音');return}
  phase='transcribing';paint();controller=new AbortController();
  try{
   const config=window.OPSTWINS_CHAT_CAPABILITY;if(!config?.token)throw Error('本机语音连接未启动');
   const body=new FormData();body.append('file',blob,'dictation.webm');
   const response=await fetch(config.url+'/voice/transcribe',{method:'POST',headers:{'X-OpsTwins-Chat':config.token},body,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(70000)])});
   const result=await response.json();if(id!==generation)return;
   if(!response.ok||!result.transcript?.trim())throw Error(errors[result.error]||'转写失败');
   last={runId:result.runId,model:result.model};const input=$('input'),text=result.transcript.trim();input.value=input.value.trim()?input.value+'\n'+text:text;
   phase='idle';blob=null;controller=null;paint();ui.changed();input.focus();
   const submit=sendIntent;sendIntent=false;if(submit)ui.submit();
  }catch(error){
   if(id!==generation)return;sendIntent=false;phase='failed';controller=null;$('voice-error').textContent=error.name==='TimeoutError'?'转写超时':Object.values(errors).includes(error.message)?error.message:'转写失败';$('voice-error').title=error.message;paint();
  }
 }
 function stop(send=false){
  if(phase==='failed'){void transcribe(generation);return}
  if(phase!=='recording')return;
  sendIntent=send;phase='transcribing';paint();clearTimeout(timer);cancelAnimationFrame(frame);
  try{recorder.stop()}catch{release();phase='failed';$('voice-error').textContent='录音失败';paint()}
 }
 async function start(){
  if(phase!=='idle')return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder||!window.AudioContext){ui.notify('此浏览器暂不支持听写');return}
  const id=++generation;phase='requesting';samples.length=0;blob=null;sendIntent=false;$('voice-waveform').dataset.peak='0';paint();
  try{
   const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(id!==generation){acquired.getTracks().forEach(t=>t.stop());return}
   stream=acquired;const recordingContext=new AudioContext();context=recordingContext;await recordingContext.resume();if(id!==generation){acquired.getTracks().forEach(t=>t.stop());void recordingContext.close().catch(()=>{});return}
   analyser=context.createAnalyser();analyser.fftSize=512;context.createMediaStreamSource(stream).connect(analyser);
   const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
   const chunks=[];let bytes=0;recorder.ondataavailable=e=>{if(id!==generation)return;if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>12*1024*1024){cancel();ui.notify('录音过大，请重新听写')}}};
   recorder.onerror=()=>{if(id!==generation)return;cancel();ui.notify('录音失败，请重试')};
   recorder.onstop=()=>{if(id!==generation)return;blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});recorder=null;release();void transcribe(id)};
   recorder.start(250);phase='recording';paint();frame=requestAnimationFrame(tick);timer=setTimeout(()=>stop(false),89000);$('voice-cancel').focus();
  }catch(error){
   if(id!==generation)return;release();recorder=null;phase='idle';paint();ui.notify(error.name==='NotAllowedError'?'请允许麦克风后重试':error.name==='NotFoundError'?'未找到麦克风':'无法启动麦克风，请重试');$('dictation-info').focus();
  }
 }
 function init(options){ui=options;$('dictation-info').onclick=()=>void start();$('voice-cancel').onclick=()=>{cancel();$('input').focus()};$('voice-stop').onclick=()=>stop(false);$('voice-send').onclick=()=>stop(true);paint();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&phase!=='idle'){e.preventDefault();e.stopImmediatePropagation();cancel();$('input').focus()}},true);
  window.addEventListener('pagehide',cancel);new ResizeObserver(draw).observe($('voice-waveform'));
 }
 window.OpsTwinsDictation=Object.freeze({init,cancel,active:()=>phase!=='idle',hasRecording:()=>!!blob?.size,lastResult:()=>last});
})();
