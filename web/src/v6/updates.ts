// One updater lifecycle for the V6 notice and Settings. Native code owns trust and installation.
import {useSyncExternalStore} from 'react';
import {durable,host} from './store';
import {update} from './native';

export interface UpdateState {status:string;current?:{version:string;build?:string};available?:{version:string;build:string};ready?:boolean;downloaded?:number;total?:number;error?:string}
let snapshot:{value:UpdateState;busy:boolean;open:boolean}={value:{status:'idle'},busy:false,open:false};
const listeners=new Set<()=>void>();
const publish=(patch:Partial<typeof snapshot>)=>{snapshot={...snapshot,...patch};listeners.forEach(f=>f())};
const active=(s:string)=>['checking','downloading','verifying','installing','prepared'].includes(s);
const attempted=new Set<string>();
let running=false,timer:ReturnType<typeof setTimeout>|undefined,lastCheck=0,restartRequested=false,mutation=0;
export const useUpdate=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn)}},()=>snapshot);
export const showUpdate=(open=true)=>publish({open});
function accept(value:UpdateState|null){if(!value)return;const ready=value.ready&&!snapshot.value.ready;publish({value,...(ready?{open:true}:{})})}
export async function updateAction(action:'check'|'download'|'cancel'|'install'){
 if(!host()||snapshot.busy)return;
 if(action==='check'&&(active(snapshot.value.status)||snapshot.value.ready))return;
 if(action==='install'&&!snapshot.value.ready)return;
 mutation++;publish({busy:true});
 try{
  if(action==='check')lastCheck=Date.now();
  if(action==='download'&&snapshot.value.available)attempted.add(snapshot.value.available.version+':'+snapshot.value.available.build);
  if(action==='install'){
   restartRequested=true;
   // The composer synchronously flushes its latest React draft before native durability.
   window.dispatchEvent(new Event('cyberme-before-update'));
   await durable();
  }
  accept(await update[action]());
  if(action==='install'&&snapshot.value.status!=='waiting')restartRequested=false;
 }catch{
  restartRequested=false;
  publish({value:{...snapshot.value,status:'error',error:action==='install'?'update_prepare_failed':'update_failed'},open:true});
 }finally{publish({busy:false})}
}
export function startUpdates(){
 if(running||!host())return;running=true;lastCheck=Date.now()-3600000+10000;
 const tick=async()=>{
  if(!running)return;
  if(!snapshot.busy){
   try{const generation=mutation,value=await update.status();if(generation===mutation&&!snapshot.busy)accept(value)}catch{/* Keep the last verified state; never infer installation. */}
   const s=snapshot.value;
   if(s.status==='waiting'&&restartRequested)await updateAction('install');
   else if(s.status==='available'&&!s.ready&&s.available&&!s.error){
    const key=s.available.version+':'+s.available.build;
    if(!attempted.has(key))await updateAction('download');
   }else if(!active(s.status)&&!s.ready&&Date.now()-lastCheck>=3600000)await updateAction('check');
  }
  if(running)timer=setTimeout(tick,active(snapshot.value.status)?500:2000);
 };
 void tick();
}
export function stopUpdates(){running=false;clearTimeout(timer)}
export function updateTitle(s:UpdateState,zh:boolean){
 const labels:Record<string,[string,string]>={idle:['检查更新','Check for updates'],checking:['正在检查更新…','Checking for updates…'],current:['已是最新版本','Up to date'],none:['暂无可用更新','No update available'],unavailable:['此版本不支持更新','Updates unavailable'],available:['发现新版本','Update available'],downloading:['正在下载更新…','Downloading update…'],verifying:['正在验证更新…','Verifying update…'],ready:['更新已准备好安装','Update ready to install'],waiting:['等待当前任务结束…','Waiting for running tasks…'],installing:['正在安装…','Installing…'],prepared:['正在重启…','Restarting…'],error:['更新未完成，请重试','Update failed. Try again'],recovered:['请重新检查更新','Check for updates again']};
 return (labels[s.status]||labels.error)[zh?0:1];
}
