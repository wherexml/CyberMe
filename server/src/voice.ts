import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT,DATA,beginRun,updateRun,now,registerSecret,publicValue} from './store';
import {ApiError,command} from './integrations';

function configuration(){
 const file=join(ROOT,'.local/config.json');let value;try{value=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).voice:undefined;}catch{throw new ApiError(503,'voice_config_invalid','服务端语音配置格式无效');}
 if(value?.provider==='doubao'){if(typeof value.apiKey!=='string'||!value.apiKey.trim())throw new ApiError(503,'voice_setup_required','服务端尚未配置豆包语音凭据');registerSecret(value.apiKey);return {provider:'Doubao',engine:'doubao',apiKey:value.apiKey,model:'volc.bigasr.auc_turbo',endpoint:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',ffmpeg:'/opt/homebrew/bin/ffmpeg',ffprobe:'/opt/homebrew/bin/ffprobe'};}
 if(!value?.endpoint)return undefined;
 let endpoint:URL;try{endpoint=new URL(value.endpoint);}catch{throw new ApiError(503,'voice_config_invalid','语音服务地址无效');}
 if(endpoint.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new ApiError(503,'voice_config_invalid','语音服务必须是本机WebSocket地址');
 return {provider:'FunASR',engine:'funasr',apiKey:undefined,endpoint:endpoint.href,model:String(value.model||'paraformer-large'),ffmpeg:String(value.ffmpeg||'/opt/homebrew/bin/ffmpeg'),ffprobe:String(value.ffprobe||'/opt/homebrew/bin/ffprobe')};
}
export function voiceStatus(){const config=configuration();return {configured:!!config,provider:config?.provider,model:config?.model,maxBytes:12*1024*1024,maxSeconds:90};}
function recognize(endpoint:string,pcm:Buffer,name:string):Promise<string>{return new Promise((resolve,reject)=>{
 const socket=new WebSocket(endpoint);let settled=false;
 const finish=(error?:Error,text?:string)=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();error?reject(error):resolve(text!);};
 const timer=setTimeout(()=>finish(new ApiError(504,'voice_timeout','语音模型响应超时，音频可重试')),45000);
 socket.onopen=()=>{socket.send(JSON.stringify({mode:'offline',wav_name:name,wav_format:'pcm',audio_fs:16000,chunk_size:[5,10,5],is_speaking:true,itn:true}));for(let offset=0;offset<pcm.length;offset+=8000)socket.send(new Uint8Array(pcm.subarray(offset,offset+8000)));socket.send(JSON.stringify({is_speaking:false}));};
 socket.onmessage=event=>{try{const result=JSON.parse(String(event.data));if(result.wav_name&&result.wav_name!==name)return;if(result.mode!=='offline')return;const text=String(result.text||'').trim();if(!text)finish(new ApiError(422,'voice_empty_text','没有识别到文字，请重新录音或选择有声音的文件'));else finish(undefined,text);}catch(error){finish(error instanceof ApiError?error:new ApiError(502,'voice_invalid_response','语音模型返回格式无效'));}};
 socket.onerror=()=>finish(new ApiError(503,'voice_unavailable','无法连接本机语音模型，可保留音频重试'));
 socket.onclose=()=>{if(!settled)finish(new ApiError(502,'voice_disconnected','语音模型在返回结果前断开，音频可重试'));};
});}
function wav(pcm:Buffer){const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);}
async function recognizeDoubao(config:NonNullable<ReturnType<typeof configuration>>,pcm:Buffer,requestId:string,signal?:AbortSignal){
 let response:Response;try{response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':config.apiKey!,'X-Api-Resource-Id':config.model,'X-Api-Request-Id':requestId,'X-Api-Sequence':'-1'},body:JSON.stringify({user:{uid:'opstwin-advance'},audio:{data:wav(pcm).toString('base64')},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true}}),signal:AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])])});}catch{if(signal?.aborted)throw new ApiError(499,'voice_cancelled','语音转写已取消');throw new ApiError(503,'voice_unavailable','豆包语音暂时无法连接，录音已保留，可重试');}
 if(response.status===401||response.status===403)throw new ApiError(503,'voice_auth','豆包语音鉴权或资源权限不足，请检查服务端配置');
 const code=response.headers.get('x-api-status-code');const detail={providerStatus:response.status,providerCode:code,providerRequestId:requestId,providerMessage:publicValue((response.headers.get('x-api-message')||'').slice(0,300))};if(code==='45000001')throw new ApiError(503,'voice_resource','豆包语音请求或资源配置无效，请检查服务端配置',detail);if(code==='45000002')throw new ApiError(422,'voice_empty_audio','录音没有声音数据，请重新录音',detail);if(code==='45000151')throw new ApiError(422,'voice_invalid_audio','豆包语音无法读取音频格式，请重新录音',detail);if(response.status===429||code==='55000031')throw new ApiError(503,'voice_busy','豆包语音繁忙，请稍后重试',detail);if(code==='20000003')throw new ApiError(422,'voice_no_speech','这段录音未检测到人声，请检查麦克风输入后重新录音',detail);if(!response.ok||code!=='20000000')throw new ApiError(502,'voice_provider_error','豆包语音识别失败，录音已保留，可重试',detail);
 let result;try{result=await response.json();}catch{throw new ApiError(502,'voice_invalid_response','豆包语音返回格式无效');}
 const transcript=typeof result?.result?.text==='string'?result.result.text.trim():'';if(!transcript)throw new ApiError(422,'voice_empty_text','没有识别到文字，请重新录音或选择有声音的文件');return transcript;
}
export async function transcribeVoice(file:File,signal?:AbortSignal){
 if(!file||typeof file.arrayBuffer!=='function')throw new ApiError(400,'voice_file_required','请选择录音或音频文件');
 if(!file.size||file.size>12*1024*1024)throw new ApiError(413,'voice_size','语音文件必须在1字节至12MB之间');
 if(!/^audio\//.test(file.type)&&!/^video\/webm$/.test(file.type))throw new ApiError(415,'voice_type','请选择音频文件');
 const config=configuration();if(!config)throw new ApiError(503,'voice_setup_required','服务端尚未配置语音模型');
 const bytes=Buffer.from(await file.arrayBuffer());const audioSha256=createHash('sha256').update(bytes).digest('hex');
 const run=beginRun('voice','语音转写',{engine:config.engine,provider:config.provider,model:config.model,audioSha256,audioBytes:bytes.length});
 let folder:string|undefined;
 try{
  folder=await mkdtemp(join(DATA,'voice-'));const input=join(folder,'input.audio'),output=join(folder,'audio.pcm');
  await writeFile(input,bytes,{mode:0o600});const probe=await command(config.ffprobe,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',input],10000,undefined,signal);const probedDuration=Number(probe.stdout.trim());
  if(probe.exitCode!==0||probe.timedOut)throw new ApiError(422,'voice_invalid_audio','音频无法解码，请选择有效录音');
  if(Number.isFinite(probedDuration)&&probedDuration>90)throw new ApiError(413,'voice_duration','每段语音最多90秒');
  const decoded=await command(config.ffmpeg,['-hide_banner','-loglevel','error','-i',input,'-t','91','-vn','-ar','16000','-ac','1','-f','s16le',output],15000,undefined,signal);
  if(decoded.exitCode!==0||decoded.timedOut)throw new ApiError(422,'voice_decode_failed','音频转换失败，原录音可重试');
  const pcm=await readFile(output);if(!pcm.length)throw new ApiError(422,'voice_empty_audio','录音没有声音数据');
  const duration=pcm.length/32000;if(duration>90)throw new ApiError(413,'voice_duration','每段语音最多90秒');
  let sumSquares=0,peak=0;for(let offset=0;offset+1<pcm.length;offset+=2){const sample=pcm.readInt16LE(offset)/32768;sumSquares+=sample*sample;peak=Math.max(peak,Math.abs(sample));}const meanDbfs=20*Math.log10(Math.max(1e-6,Math.sqrt(sumSquares/(pcm.length/2)))),peakDbfs=20*Math.log10(Math.max(1e-6,peak));
  const providerRequestId=randomUUID();updateRun(run.id,{providerRequestId,durationSeconds:duration,meanDbfs,peakDbfs});if(signal?.aborted)throw new ApiError(499,'voice_cancelled','语音转写已取消');
  const transcript=config.engine==='doubao'?await recognizeDoubao(config,pcm,providerRequestId,signal):await recognize(config.endpoint,pcm,run.id);if(signal?.aborted)throw new ApiError(499,'voice_cancelled','语音转写已取消');const done=updateRun(run.id,{status:'succeeded',completedAt:now(),output:transcript,durationSeconds:duration,engine:config.engine});
  return {transcript,runId:done.id,provider:config.provider,model:config.model,audioSha256,durationSeconds:duration};
 }catch(error){if(signal?.aborted)error=new ApiError(499,'voice_cancelled','语音转写已取消');updateRun(run.id,{status:error instanceof ApiError&&error.code==='voice_cancelled'?'cancelled':'failed',completedAt:now(),error:String(error),...(error instanceof ApiError?{errorCode:error.code,errorDetail:error.detail}:{})});if(error instanceof ApiError){error.detail={...(error.detail||{}),runId:run.id};throw error;}throw new ApiError(503,'voice_process_failed','语音处理失败，请检查本机解码与语音服务',{runId:run.id});}
 finally{if(folder)await rm(folder,{recursive:true,force:true});}
}
