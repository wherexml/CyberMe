import {useEffect,useRef,useState} from 'react';
import type {ModelSelection,ModelSettings} from '../../../shared/model-settings';
import type {Ctx} from './App';
import {Page,useRows} from './Settings';
import {ApiError,api,durable,enc,setUI,uid,type ModelProbeReceipt} from './store';
import {ModelProviderEditor,modelSettingsError} from './ModelProviderEditor';

type ProbeResult={status:'running'|'succeeded'|'failed'|'unknown'|'unreachable'|'missing';failureCode?:string};
const requestTimeout=()=>AbortSignal.timeout(10000);
const sameModel=(a:ModelSelection,b:ModelSelection)=>a.model===b.model&&a.providerId===b.providerId;

export default function ModelSettingsPage({ctx,sub}:{ctx:Ctx;sub?:{type:string;id?:string}}){
 const {z,nav,act}=useRows(ctx);
 const [models,setModels]=useState<ModelSettings>();
 const [readError,setReadError]=useState('');
 const [attempt,retryLoad]=useState(0);
 const [choice,setChoice]=useState<ModelSelection>();
 const [saveError,setSaveError]=useState('');
 const [saving,setSaving]=useState(false);
 const [posting,setPosting]=useState(false);
 const [probe,setProbe]=useState<{id:string;result:ProbeResult}>();
 const [check,recheck]=useState(0);
 const writePending=useRef(false);
 const activePage=useRef(sub);
 activePage.current=sub;
 useEffect(()=>()=>{activePage.current=undefined},[]);
 const receipt=ctx.ui.modelProbe?.version===models?.version?ctx.ui.modelProbe:undefined;
 const result=receipt&&probe?.id===receipt.id?probe.result:undefined;
 const probeStatus=receipt?(result?.status||'running'):undefined;

 useEffect(()=>{
  const controller=new AbortController();
  setReadError('');
  api<ModelSettings>('GET','/api/settings/models',undefined,AbortSignal.any([controller.signal,requestTimeout()]))
   .then(value=>{
    if(controller.signal.aborted)return;
    if(!value?.version||!value.standard||!value.deep||!Array.isArray(value.providers))throw new Error('invalid_model_settings_response');
    setModels(value);setSaveError('');
   })
   .catch(error=>{if(!controller.signal.aborted){setModels(undefined);setReadError(modelSettingsError(error,ctx.zh,'read'))}});
  return()=>controller.abort();
 },[attempt,ctx.zh]);

 useEffect(()=>{
  if(!receipt||posting)return;
  const controller=new AbortController();
  let timer:number|undefined;
  const read=async()=>{
   try{
    const value=await api<ProbeResult>('GET','/api/settings/models/tests/'+enc(receipt.id),undefined,AbortSignal.any([controller.signal,requestTimeout()]));
    if(controller.signal.aborted)return;
    setProbe({id:receipt.id,result:value});
    if(value.status==='running')timer=window.setTimeout(read,1000);
   }catch(e){
    if(!controller.signal.aborted)setProbe({id:receipt.id,result:{status:e instanceof ApiError&&e.status===404?'missing':'unreachable'}});
   }
  };
  void read();
  return()=>{controller.abort();window.clearTimeout(timer)};
 },[receipt?.id,posting,check]);

 async function saveChoice(){
  if(!models||!choice||writePending.current)return;
  writePending.current=true;setSaving(true);setSaveError('');
  try{
   setModels(await api('PATCH','/api/settings/models',{version:models.version,standard:choice,deep:choice},requestTimeout()));
   setChoice(undefined);
   if(activePage.current===sub)ctx.goSet('model');
  }catch(e){setSaveError(modelSettingsError(e,ctx.zh,'save'))}
  finally{writePending.current=false;setSaving(false)}
 }

 async function test(existing?:ModelProbeReceipt){
  if(!models||writePending.current)return;
  const next=existing||{id:uid('probe'),version:models.version};
  writePending.current=true;setPosting(true);setSaveError('');
  setProbe(undefined);setUI({modelProbe:next});
  try{
   await durable();
  }catch{
   setUI({modelProbe:undefined});setSaveError(z('Could not save the local test receipt.','无法保存本机测试回执。'));
   writePending.current=false;setPosting(false);return;
  }
  try{
   await api('POST','/api/settings/models/test',{requestId:next.id,role:'standard',version:next.version,wait:false},requestTimeout());
  }catch(e){
   // A transport failure may follow registration. Recover through GET with the same ID.
   if(e instanceof ApiError&&[400,409].includes(e.status)){
    setUI({modelProbe:undefined});setSaveError(modelSettingsError(e,ctx.zh,'save'));
   }
  }finally{writePending.current=false;setPosting(false)}
 }

 const refresh=()=>retryLoad(n=>n+1);
 const errorRows=saveError?[{rows:[{label:<span role="alert">{saveError}</span>,btn:{label:z('Reload','重新读取'),on:refresh}}]}]:[];
 if(!models)return <Page title={z('Models','模型')} sections={[{rows:[readError
  ?{label:<span role="alert">{readError}</span>,btn:{label:z('Retry','重试'),on:refresh}}
  :{label:<span role="status">{z('Loading models…','正在读取模型…')}</span>}]}]}/>;

 if(sub?.type==='provider'){
  const provider=models.providers.find(p=>p.id===sub.id);
  if(sub.id&&!provider)return <Page title={z('Provider','供应商')} sections={[{rows:[{label:z('Provider unavailable','供应商已不存在')}]}]}/>;
  return <ModelProviderEditor key={sub.id||'new'} ctx={ctx} models={models} provider={provider}
   onSaved={value=>{setModels(value);setSaveError('');if(activePage.current===sub)ctx.goSet('model')}} onReload={value=>setModels(value)}/>;
 }

 const available=models.providers.filter(p=>p.enabled&&p.configured);
 const current=models.providers.find(p=>p.id===models.standard.providerId);
 const hasChoices=available.some(p=>p.models.length>0);
 if(sub?.type==='picker'){
  const selected=choice||models.standard;
  const canSave=!!selected.model&&available.some(p=>p.id===selected.providerId&&p.models.includes(selected.model))
   &&(!sameModel(selected,models.standard)||!sameModel(selected,models.deep));
  return <Page title={z('Choose model','选择模型')} sections={[
   {rows:available.flatMap(p=>p.models.map(model=>{
    const value={providerId:p.id,model};
    return {key:p.id+'/'+model,label:model,sub:p.name,onRow:()=>{setChoice(value);setSaveError('')},check:sameModel(selected,value),dim:saving};
   }))},
   {rows:[act(z('Save','保存'),()=>void saveChoice(),undefined,{dim:saving||!canSave})]},
   ...errorRows,
  ]}/>;
 }

 const statusText=probeStatus==='succeeded'?z('Working','正常'):probeStatus==='failed'?z('Failed','失败'):
  probeStatus==='unknown'||probeStatus==='unreachable'?z('Unconfirmed','未确认'):probeStatus==='missing'?z('Request not received','未收到请求'):'';
 const statusColor=probeStatus==='succeeded'?'var(--okText)':probeStatus==='failed'?'var(--errText)':'var(--warnText)';
 const testLabel=probeStatus==='running'?z('Testing…','测试中…'):probeStatus==='unreachable'?z('Check result','查询结果'):
  probeStatus==='missing'?z('Retry test','重试测试'):z('Test connection','测试连接');
 const testDetail:Record<string,string>={
  provider_auth:z('The provider rejected authentication. Check its API key and access.','供应商拒绝鉴权，请检查 API 密钥和访问权限。'),
  provider_quota:z('The provider reported a quota or rate limit.','供应商报告额度不足或请求频率受限。'),
  provider_model_unavailable:z('The provider could not find the model or endpoint.','供应商找不到模型或接口，请核对模型 ID 与服务地址。'),
  provider_connection:z('Could not connect to the provider. Check the endpoint and network.','连接供应商失败，请检查服务地址和网络。'),
  provider_unavailable:z('The provider is temporarily unavailable.','供应商服务暂不可用。'),
  llm_timeout:z('The model did not respond in time.','模型响应超时。'),
 };
 return <Page title={z('Models','模型')} sections={[
  {rows:[
   nav(z('Current model','当前模型'),()=>{setChoice(models.standard);setSaveError('');ctx.goSet('model',{type:'picker'})},undefined,
    {sub:models.standard.model||z('Unselected','未选择'),dim:!hasChoices||posting}),
   act(testLabel,()=>{
    if(probeStatus==='unreachable'){setProbe(undefined);recheck(n=>n+1)}
    else void test(probeStatus==='missing'?receipt:undefined);
   },undefined,{dim:!current?.configured||!models.standard.model||posting||probeStatus==='running',
    value:statusText?<span role="status">{statusText}</span>:'',
    valueStyle:{fontSize:12,color:statusColor,whiteSpace:'nowrap'},
    sub:probeStatus==='failed'?testDetail[result?.failureCode||'']||z('The model did not return a usable response.','模型未返回可用响应。'):undefined}),
  ]},
  ...errorRows,
  {title:z('Providers','供应商'),rows:[
   ...models.providers.map(p=>nav(p.name,()=>ctx.goSet('model',{type:'provider',id:p.id}),undefined,{
     key:p.id,value:p.enabled?(p.configured?'':z('Not configured','未配置')):z('Disabled','已停用'),
   })),
   act(z('Add provider','添加供应商'),()=>ctx.goSet('model',{type:'provider'})),
  ]},
 ]}/>;
}
