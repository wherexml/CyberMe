import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {useI18n} from './i18n';

export function useVoiceInput(onTranscript:(text:string)=>void){
 const {language}=useI18n();const local=(en:string,zh:string)=>language==='zh-CN'?zh:en;
 const [status,setStatus]=useState<'idle'|'permission'|'recording'|'transcribing'|'failed'|'ready'>('idle');
 const [error,setError]=useState(''),[evidence,setEvidence]=useState<{provider:string;model:string;runId:string}|null>(null);
 const [level,setLevel]=useState(0),[inputDevice,setInputDevice]=useState(''),[inputMuted,setInputMuted]=useState(false),[errorCode,setErrorCode]=useState('');const meter=useRef<AudioContext|null>(null),meterTimer=useRef<ReturnType<typeof setInterval>|null>(null);
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),audio=useRef<File|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),controller=useRef<AbortController|null>(null),generation=useRef(0),active=useRef(false),callback=useRef(onTranscript);callback.current=onTranscript;
 const stopTracks=()=>{if(meterTimer.current)clearInterval(meterTimer.current);meterTimer.current=null;if(meter.current)void meter.current.close().catch(()=>{});meter.current=null;setLevel(0);stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 function cancel(){generation.current++;active.current=false;controller.current?.abort();controller.current=null;if(recorder.current?.state==='recording')recorder.current.stop();recorder.current=null;stopTracks();audio.current=null;setStatus('idle');setError('');setErrorCode('');setInputDevice('');setInputMuted(false);setEvidence(null);}
 useEffect(()=>()=>{generation.current++;controller.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();stopTracks();},[]);
 async function transcribe(file:File){
  if(active.current)return;active.current=true;const token=++generation.current;audio.current=file;setErrorCode('');setError('');setEvidence(null);setStatus('transcribing');controller.current=new AbortController();
  try{const form=new FormData();form.append('file',file);const result=await api.post<{transcript:string;provider:string;model:string;runId:string}>('/voice/transcribe',form,{signal:controller.current.signal});if(token!==generation.current)return;callback.current(result.transcript);setEvidence(result);audio.current=null;setStatus('ready');}
  catch(cause){if(token!==generation.current)return;setErrorCode(cause instanceof ApiError?cause.data?.error||'':'');setError(local(voiceErrorEnglish(cause instanceof ApiError?cause.data?.error||'':''),(cause as Error).message));setStatus('failed');}
  finally{if(token===generation.current){active.current=false;controller.current=null;}}
 }
 async function start(){
  if(active.current||recorder.current?.state==='recording')return;active.current=true;const token=++generation.current;setError('');setEvidence(null);setErrorCode('');setStatus('permission');
  try{
   const service=await api.get<{configured:boolean}>('/voice/status');if(!service.configured)throw new ApiError(503,{error:'voice_setup_required',message:'服务端语音模型尚未配置，文字草稿已保留。'});
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new ApiError(400,{error:'voice_browser_unsupported',message:'浏览器不支持麦克风录音，请更换支持录音的浏览器或继续输入。'});
   const captured=await navigator.mediaDevices.getUserMedia({audio:true});if(token!==generation.current){captured.getTracks().forEach(track=>track.stop());return;}stream.current=captured;
   const track=captured.getAudioTracks()[0];setInputDevice(track?.label||local('Microphone','麦克风'));setInputMuted(!!track?.muted);if(track){track.onmute=()=>setInputMuted(true);track.onunmute=()=>setInputMuted(false);}
   try{const context=new AudioContext();meter.current=context;await context.resume();if(token!==generation.current){void context.close().catch(()=>{});return;}const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(captured).connect(analyser);const samples=new Uint8Array(analyser.fftSize);meterTimer.current=setInterval(()=>{analyser.getByteTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,n)=>sum+((n-128)/128)**2,0)/samples.length);setLevel(Math.min(100,Math.round(rms*400)));},100);}catch{/* Recording remains available if level metering is unsupported. */}

   const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value));const instance=new MediaRecorder(captured,mime?{mimeType:mime}:undefined);recorder.current=instance;const chunks:Blob[]=[];
   instance.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
   instance.onerror=()=>{if(token!==generation.current)return;generation.current++;active.current=false;stopTracks();setStatus('failed');setError(local('Recording failed. Your draft is preserved. Record again or continue typing.','录音失败，文字草稿已保留，请重新录音或继续输入。'));};
   instance.onstop=()=>{if(token!==generation.current)return;stopTracks();recorder.current=null;active.current=false;const type=instance.mimeType||'audio/webm';void transcribe(new File(chunks,'voice-recording'+(type.includes('mp4')?'.m4a':type.includes('ogg')?'.ogg':'.webm'),{type}));};
   instance.start(250);active.current=false;setStatus('recording');timer.current=setTimeout(()=>instance.state==='recording'&&instance.stop(),90000);
  }catch(cause){if(token!==generation.current)return;active.current=false;stopTracks();setStatus('failed');const code=(cause as DOMException).name;setError(code==='NotAllowedError'?local('Microphone access was denied. Check your microphone permissions or continue typing.','麦克风未获授权，请检查麦克风权限或继续输入。'):code==='NotFoundError'?local('No microphone found. Connect a microphone or continue typing.','未找到麦克风，请连接麦克风或继续输入。'):local(cause instanceof ApiError?voiceErrorEnglish(cause.data?.error||''):'Could not start recording. Check the microphone and try again.',(cause as Error).message));}
 }
 return {status,error,errorCode,level,inputDevice,inputMuted,evidence,start,stop:()=>recorder.current?.state==='recording'&&recorder.current.stop(),cancel,retry:()=>audio.current&&void transcribe(audio.current),canRetry:!!audio.current&&!['voice_no_speech','voice_auth','voice_setup_required','voice_resource'].includes(errorCode),busy:['permission','recording','transcribing'].includes(status)};
}

function voiceErrorEnglish(code:string){
 if(code==='voice_browser_unsupported')return 'This browser cannot record audio. Use a browser that supports recording or continue typing.';
 if(['voice_no_speech','voice_empty_text'].includes(code))return 'No speech detected. Check your microphone and record again.';
 if(['voice_auth','voice_config_invalid','voice_setup_required','voice_resource'].includes(code))return 'Voice service configuration needs attention. Your draft is preserved.';
 if(['voice_decode_failed','voice_invalid_audio','voice_empty_audio','voice_type','voice_file_required'].includes(code))return 'This audio could not be read. Record again.';
 if(code==='voice_duration')return 'Use a recording of 90 seconds or less.';
 if(code==='voice_size')return 'This recording is too large. Record a shorter message.';
 if(code==='voice_busy')return 'Voice transcription is busy. Try again shortly.';
 if(code==='voice_timeout')return 'Transcription timed out. Your draft is preserved; you can retry.';
 if(code==='voice_cancelled')return 'Transcription cancelled. Your draft is preserved.';
 return 'Transcription failed. Your draft is preserved. Retry or record again.';
}
