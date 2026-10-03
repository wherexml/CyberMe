import React, {useEffect, useState} from 'react';
import type {ModelRoles, ModelSettings as ModelConfig, ModelSelection} from '../../../shared/model-settings';
import {api} from '../domain/api';

type Translate=(en:string,zh:string)=>string;
const draftKey='opsadv-model-settings-draft';
const roles=(value:ModelRoles):ModelRoles=>({standard:value.standard,deep:value.deep});
type Probe={ok:boolean; model:string; runId?:string; error?:string};
export default function ModelSettings({t}:{t:Translate}) {
  const [saved,setSaved]=useState<ModelConfig>();
  const [draft,setDraft]=useState<ModelRoles>();
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[testing,setTesting]=useState('');
  const [error,setError]=useState(''),[success,setSuccess]=useState(false),[conflict,setConflict]=useState(false);
  const [probes,setProbes]=useState<Record<string,Probe>>({});
  const dirty=!!saved&&!!draft&&JSON.stringify(roles(saved))!==JSON.stringify(draft);
  const busy=loading||saving||!!testing;
  async function load(restoreDraft=false) {
    setLoading(true);setError('');setSuccess(false);
    try {
      const value=await api.get<ModelConfig>('/settings/models',{cache:'no-store'});
      let next=roles(value);
      if(restoreDraft)try {
        const cached=JSON.parse(sessionStorage.getItem(draftKey)||'null');
        if(cached&&['standard','deep'].every(role=>typeof cached[role]?.model==='string'&&value.providers.some(p=>p.id===cached[role]?.providerId)))next=roles(cached);
      }catch{}
      setSaved(value);setDraft(next);setConflict(false);setProbes({});
    }catch(e){setError((e as Error).message==='Failed to fetch'?t('Could not reach the server. Retry when connected.','无法连接服务，请恢复连接后重试。'):(e as Error).message);}finally{setLoading(false);}
  }
  useEffect(()=>{void load(true);},[]);
  useEffect(()=>{if(!saved||!draft)return;try{if(dirty)sessionStorage.setItem(draftKey,JSON.stringify(draft));else sessionStorage.removeItem(draftKey);}catch{}},[saved,draft,dirty]);
  function change(role:keyof ModelRoles,choice:ModelSelection) {
    setDraft(value=>value?{...value,[role]:choice}:value);setSuccess(false);setError('');
    setProbes(value=>{const next={...value};delete next[role];return next;});
  }
  async function save(e:React.FormEvent) {
    e.preventDefault();if(!saved||!draft||busy||!dirty)return;
    setSaving(true);setError('');setSuccess(false);
    try{
      const value=await api.patch<ModelConfig>('/settings/models',{version:saved.version,...draft});
      setSaved(value);setDraft(roles(value));setProbes({});setConflict(false);setSuccess(true);
    }catch(e:any){setError(e.message==='Failed to fetch'?t('Could not reach the server. Your changes are kept; retry when connected.','无法连接服务，修改已保留，请恢复连接后重试。'):e.message);if(e.status===409)setConflict(true);}finally{setSaving(false);}
  }
  async function test(role:keyof ModelRoles) {
    if(!saved||busy||dirty)return;setTesting(role);setError('');setSuccess(false);
    setProbes(p=>{const next={...p};delete next[role];return next;});
    try{
      const value=await api.post<any>('/settings/models/test',{role,version:saved.version});
      setProbes(p=>({...p,[role]:{ok:value.run?.status==='succeeded',model:value.run?.model||saved[role].model,runId:value.run?.id}}));
    }catch(e:any){
      if(e.status===409){setConflict(true);setError(e.message);}
      else setProbes(p=>({...p,[role]:{ok:false,model:e.data?.detail?.run?.model||saved[role].model,runId:e.data?.detail?.run?.id,error:e.message}}));
    }finally{setTesting('');}
  }
  return <form className="settings-models" onSubmit={save} aria-busy={busy}>
    <div className="settings-model-intro"><p>{t('Choose a model and provider for each kind of work. Saving applies to new runs; active runs keep their model.','为不同任务选择模型和服务渠道。保存后对新运行生效，正在执行的任务保持原模型。')}</p><p className="settings-hint">{t('Uses providers configured on this server. API keys stay on the server. Suggested models are not a live availability guarantee.','使用本机服务端已配置的渠道，密钥保留在服务端。推荐模型不代表渠道当前一定可用。')}</p></div>
    {loading&&<p role="status">{t('Loading model configuration…','正在读取模型配置…')}</p>}
    {error&&<div className="settings-error" role="alert">{error}</div>}
    {!saved&&!loading&&<button type="button" className="settings-button" onClick={()=>load(true)}>{t('Retry loading','重新读取')}</button>}
    {saved&&draft&&<>
      <div className="settings-model-grid">{(['standard','deep'] as const).map(role=>{
        const choice=draft[role],provider=saved.providers.find(p=>p.id===choice.providerId),probe=probes[role];
        const suggestions=[...new Set([...(provider?.models||[]),...(saved[role].providerId===choice.providerId?[saved[role].model]:[])])];
        return <section key={role} className="settings-card settings-model-card" aria-labelledby={'model-title-'+role}>
          <div><h2 id={'model-title-'+role}>{role==='standard'?t('Standard tasks','普通任务'):t('Deep thinking','深度思考')}</h2><p className="settings-hint">{role==='standard'?t('Chat, triage, summaries and standard drafts.','日常聊天、来信判断、摘要及普通草稿。'):t('Deep Think and drafts generated in deep mode.','深度思考及使用深度模式生成的草稿。')}</p></div>
          <div className="settings-model-current"><span>{t('Saved model','当前已保存')}</span><strong>{saved[role].model}</strong></div>
          <label className="settings-field" htmlFor={'model-provider-'+role}>{t('Provider','服务渠道')}<select id={'model-provider-'+role} className="settings-select" value={choice.providerId} disabled={busy} onChange={e=>{const next=saved.providers.find(p=>p.id===e.target.value)!;change(role,{providerId:next.id,model:next.models[0]||''});}}>{saved.providers.map(p=><option key={p.id} value={p.id} disabled={!p.configured}>{p.name}{!p.configured?t(' · Not configured',' · 未配置'):''}</option>)}</select></label>
          <label className="settings-field" htmlFor={'model-preset-'+role}>{t('Model','模型')}<select id={'model-preset-'+role} className="settings-select" value={suggestions.includes(choice.model)?choice.model:'custom'} disabled={busy} onChange={e=>change(role,{...choice,model:e.target.value==='custom'?'':e.target.value})}>{suggestions.map(model=><option key={model} value={model}>{model}</option>)}<option value="custom">{t('Custom model ID','自定义模型 ID')}</option></select></label>
          {!suggestions.includes(choice.model)&&<label className="settings-field" htmlFor={'model-id-'+role}>{t('Model ID','模型 ID')}<input id={'model-id-'+role} className="settings-input" value={choice.model} maxLength={200} required disabled={busy} autoComplete="off" spellCheck={false} onChange={e=>change(role,{...choice,model:e.target.value})}/></label>}
          <div className="settings-model-endpoint"><span>{t('Endpoint','服务地址')}</span><code>{provider?.baseUrl}</code><span>{provider?.configured?t('Credential configured on server','服务端凭据已配置'):t('Credential not configured','服务端凭据未配置')}</span></div>
          <div className="settings-model-test"><button type="button" className="settings-button" disabled={busy||dirty||conflict} onClick={()=>test(role)}>{testing===role?t('Testing…','测试中…'):t('Test saved model','测试已保存模型')}</button>{dirty&&<span className="settings-hint">{t('Save before testing.','保存后可测试。')}</span>}</div>
          {probe&&<div className={probe.ok?'settings-result':'settings-error'} role="status"><strong>{probe.ok?t('Connection succeeded','连接成功'):t('Connection failed','连接失败')}</strong><div>{probe.model}</div>{probe.runId&&<a href={'/api/runs/'+encodeURIComponent(probe.runId)} target="_blank" rel="noreferrer">{t('View run evidence','查看运行证据')}</a>}{probe.error&&<details><summary>{t('Error details','错误详情')}</summary><p>{probe.error}</p></details>}</div>}
        </section>;
      })}</div>
      <div className="settings-model-footer"><p role="status">{dirty?t('Unsaved changes','尚未保存'):Object.values(probes).some(p=>!p.ok)?t('Configuration saved. A connection test failed; retry or choose another model.','配置已保存，连接测试失败；可重试或选择其他模型。'):success?t('Model configuration saved. Test the connection to check availability.','模型配置已保存，可测试连接确认可用性。'):t('Saved configuration','已保存的配置')}</p><div className="settings-language-actions"><button type="button" className="settings-button" disabled={busy} onClick={()=>load(false)}>{conflict?t('Reload latest configuration','重新读取最新配置'):t('Cancel / Reload','取消 / 重新读取')}</button><button type="submit" className="settings-button settings-button-primary" disabled={busy||!dirty||conflict}>{saving?t('Saving…','保存中…'):t('Save models','保存模型配置')}</button></div></div>
    </>}
  </form>;
}
