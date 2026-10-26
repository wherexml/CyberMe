import {esc,icon,button,ib,row,input,select} from './ui.js';

export function hydrateModelSettings(s){
  if(!s.modelProviders?.length)s.modelProviders=[{id:'mock-provider',...s.model,models:[...new Set([s.model.model,'示例推理模型'])]}];
  if(!s.modelProviders.some(p=>p.id===s.model.providerId))s.model.providerId=s.modelProviders[0].id;
}
export const currentProvider=s=>s.modelProviders.find(p=>p.id===s.model.providerId)||s.modelProviders[0];
export const editedProvider=(s,u)=>s.modelProviders.find(p=>p.id===(u.providerId||s.model.providerId))||currentProvider(s);
const providerModels=p=>p.models?.length?p.models:[p.model].filter(Boolean);
const resultDetails=r=>`<details class="probe-details"><summary>查看${r.status==='passed'?'测试':'错误'}详情</summary><dl><div><dt>模型</dt><dd>${esc(r.model)}</dd></div><div><dt>协议</dt><dd>${esc(r.protocol)}</dd></div><div><dt>结果</dt><dd>${esc(r.detail)}</dd></div></dl></details>`;
export function probeMarkup(r){
  if(!r)return '';
  const labels={running:'正在等待模型回复',passed:'连接正常',failed:'认证未通过',unknown:'结果未确认',partial:'响应中断',cancelled:'已停止测试'};
  const descriptions={running:'正在预览请求过程…',passed:'已收到模型回复 · 0.8 秒',failed:'检查供应商的 API Key 和服务地址后重试',unknown:'尚未拿到完整结果，请先查看原记录',partial:'收到部分回复，尚不能确认本次测试完成',cancelled:'可以调整配置后重新测试'};
  return `<div class="probe-result ${r.status}" data-probe-status="${r.status}"><div class="probe-result-line">${r.status==='running'?'<span class="probe-spinner" aria-hidden="true"></span>':icon(r.status==='passed'?'check':r.status==='cancelled'?'stop':'info')}<strong>${labels[r.status]}</strong>${r.status==='passed'?'<span class="probe-preview">预览</span>':''}</div><p>${descriptions[r.status]}</p>${r.status==='running'?button('停止','model-test-cancel','subtle'):r.status==='failed'?button('编辑供应商配置','probe-edit','probe-link'):r.status==='unknown'?button('查看原记录','model-test-lookup','probe-link'):''}${r.status!=='running'&&r.status!=='cancelled'?resultDetails(r):''}${r.lookedUp?'<p class="probe-lookup">原记录仍未确认</p>':''}</div>`;
}
export function modelsPage(s,u){
 const saved=currentProvider(s),p=s.modelProviders.find(x=>x.id===u.modelSelection?.providerId)||saved,models=providerModels(p),selectedModel=u.modelSelection?.model||s.model.model;
 return `<div class="model-settings-page"><div class="page-heading"><h1>模型</h1></div><form id="settings-form" data-kind="model">${row('服务供应商','',select('providerId',p.id,s.modelProviders.map(x=>[x.id,x.provider]),'服务渠道'))}${row('当前模型','',select('model',selectedModel,models,'当前模型'))}<div class="form-feedback" role="status"></div><div class="form-actions"><button type="button" class="subtle" data-action="cancel-setting">取消</button><button class="primary">保存选择</button></div></form><section class="model-probe-section" aria-label="模型连接测试"><div class="probe-heading"><div><h3>连接测试</h3></div>${button('测试模型','model-test','secondary','refresh')}</div><div id="model-feedback" role="status" aria-live="polite">${probeMarkup(u.modelProbe)}</div></section><section class="model-provider-section"><div class="model-section-heading"><h3>服务供应商</h3>${button('添加供应商','setting:provider-new','subtle','plus')}</div><div class="model-provider-list">${s.modelProviders.map(x=>`<button class="model-provider-row" data-action="edit-provider:${esc(x.id)}"><span class="provider-monogram">${icon('spark')}</span><span class="provider-copy"><strong>${esc(x.provider)}</strong><small>${providerModels(x).length} 个模型${x.id===saved.id?' · 当前使用':''}</small></span>${icon('right')}</button>`).join('')}</div></section></div>`;
}
export function modelListMarkup(models){return models.length?models.map(m=>`<div class="provider-model-item"><div>${icon('spark')}<span title="${esc(m)}">${esc(m)}</span></div>${ib('移除模型 '+m,'provider-model-remove:'+encodeURIComponent(m),'close')}</div>`).join(''):'<div class="provider-model-empty">暂无模型</div>'}
export function providerPage(s,u){
 const isNew=u.setting==='provider-new',p=isNew?{provider:'',endpoint:'',protocol:'OpenAI compatible',models:[],tokens:'32768',temperature:'0.7'}:editedProvider(s,u);
 const models=providerModels(p);
 return `<div class="model-provider-page"><div class="page-heading"><h1>${isNew?'添加供应商':esc(p.provider)}</h1></div><form id="settings-form" data-kind="provider" data-provider-id="${isNew?'':esc(p.id)}"><div class="provider-identity-grid"><label class="field">供应商名称${input('provider',p.provider,'例如：我的模型服务')}</label><label class="field">API 协议${select('protocol',p.protocol,['OpenAI compatible','Anthropic Messages','OpenAI Responses'],'API 协议')}</label></div><label class="field">服务地址${input('endpoint',p.endpoint,'https://api.example.com/v1','url')}</label><label class="field">API Key<div class="provider-key-control"><input type="password" name="credential" autocomplete="off" placeholder="输入 API Key" aria-label="API Key"><button type="button" data-action="provider-key-toggle" aria-label="显示 API Key" aria-pressed="false">显示</button></div></label><section class="provider-model-section"><div class="model-section-heading"><h3>模型 <span id="provider-model-count">${models.length}</span></h3>${button('获取模型列表','provider-fetch','subtle','refresh')}</div><input type="hidden" name="models" value="${esc(JSON.stringify(models))}"><div id="provider-fetch-feedback" role="status" aria-live="polite"></div><div id="provider-model-list">${modelListMarkup(models)}</div><div class="provider-model-add"><input aria-label="手动添加模型 ID" placeholder="输入模型 ID"><button type="button" class="subtle" data-action="provider-model-add">${icon('plus')}添加</button></div></section><details class="provider-advanced"><summary>高级参数</summary>${row('上下文长度','',input('tokens',p.tokens,'最大上下文','number'))}${row('Temperature','',input('temperature',p.temperature,'Temperature','number'))}</details><div class="form-feedback" role="status"></div><div class="form-actions"><button type="button" class="subtle" data-action="cancel-setting">取消</button><button class="primary">${isNew?'添加供应商':'保存配置'}</button></div></form></div>`;
}

export function createModelSettingsController({getState,getUI,render,rememberForm,navigate,toast}){
 let probeGeneration=0,fetchGeneration=0;
 const form=()=>document.querySelector('form[data-kind=provider]');
 const list=()=>{try{return JSON.parse(form().elements.models.value)}catch{return []}};
 function updateList(models){const f=form();f.elements.models.value=JSON.stringify(models);document.querySelector('#provider-model-list').innerHTML=modelListMarkup(models);document.querySelector('#provider-model-count').textContent=models.length;rememberForm(f)}
 function clearProbe(){probeGeneration++;getUI().modelProbe=null;const el=document.querySelector('#model-feedback');if(el)el.innerHTML=probeMarkup(null);const b=document.querySelector('[data-action=model-test]');if(b)b.disabled=false}
 function restoreList(){if(form())updateList(list())}
 function test(){
  const u=getUI(),s=getState(),f=document.querySelector('form[data-kind=model]');if(!f)return;
  const p=s.modelProviders.find(x=>x.id===f.elements.providerId.value),model=f.elements.model.value;
  if(!p||!model){toast('请先添加并选择一个模型');return}
  const generation=++probeGeneration,owner=f,scenario=u.scenario;
  const r={status:'running',model,protocol:p.protocol,providerId:p.id,detail:'',generation};u.modelProbe=r;
  const el=document.querySelector('#model-feedback'),b=document.querySelector('[data-action=model-test]');el.innerHTML=probeMarkup(r);b.disabled=true;
  if(scenario==='loading')return;
  setTimeout(()=>{if(generation!==probeGeneration||!owner.isConnected||getUI().scenario!==scenario||getUI().modelProbe!==r)return;
   r.status=({error:'failed',unknown:'unknown',partial:'partial',empty:'failed'})[scenario]||'passed';
   r.detail=({failed:scenario==='empty'?'暂无可用模型':'HTTP 401 · invalid_api_key（示例）',unknown:'原请求等待确认 · 没有自动重试',partial:'流式响应提前结束（示例）',passed:'你好，连接测试已完成。'})[r.status];
   el.innerHTML=probeMarkup(r);b.disabled=false;
  },850);
 }
 const actions={
  'edit-provider':id=>{getUI().providerId=id;clearProbe();navigate('settings/provider')},
  'probe-edit':()=>{getUI().providerId=getUI().modelProbe?.providerId||getState().model.providerId;clearProbe();navigate('settings/provider')},
  'model-test':test,
  'model-test-cancel':()=>{probeGeneration++;const r=getUI().modelProbe;if(r)r.status='cancelled';document.querySelector('#model-feedback').innerHTML=probeMarkup(r);document.querySelector('[data-action=model-test]').disabled=false},
  'model-test-lookup':()=>{const r=getUI().modelProbe;if(r){r.lookedUp=true;document.querySelector('#model-feedback').innerHTML=probeMarkup(r)}},
  'provider-key-toggle':()=>{const key=form()?.elements.credential;if(!key)return;key.type=key.type==='password'?'text':'password';const b=document.querySelector('[data-action=provider-key-toggle]');b.textContent=key.type==='text'?'隐藏':'显示';b.setAttribute('aria-label',(key.type==='text'?'隐藏':'显示')+' API Key');b.setAttribute('aria-pressed',String(key.type==='text'))},
  'provider-model-add':()=>{const el=document.querySelector('[aria-label="手动添加模型 ID"]'),id=el.value.trim();if(!id){el.focus();return}if(id.length>160){toast('模型 ID 请控制在 160 个字符以内');return}if(list().includes(id)){toast('这个模型已在列表中');return}updateList([...list(),id]);el.value='';el.focus()},
  'provider-model-remove':id=>updateList(list().filter(m=>m!==decodeURIComponent(id))),
  'provider-fetch':()=>{const f=form();if(!f)return;const feedback=document.querySelector('#provider-fetch-feedback'),b=document.querySelector('[data-action=provider-fetch]');if(!f.elements.endpoint.value.trim()){feedback.textContent='先填写服务地址，再获取模型列表';f.elements.endpoint.focus();return}
   const generation=++fetchGeneration,scenario=getUI().scenario,endpoint=f.elements.endpoint.value,protocol=f.elements.protocol.value;feedback.textContent='正在获取示例模型列表…';b.disabled=true;
   setTimeout(()=>{if(generation!==fetchGeneration||!f.isConnected)return;b.disabled=false;if(getUI().scenario!==scenario||f.elements.endpoint.value!==endpoint||f.elements.protocol.value!==protocol){feedback.textContent='配置已变化，请重新获取模型列表';return}if(scenario!=='normal'){feedback.textContent=scenario==='error'?'获取失败，已保留原模型列表。请检查地址后重试。':'尚未获得完整模型列表，已保留原有模型。';return}updateList([...new Set([...list(),'示例对话模型','示例推理模型','示例视觉模型'])]);feedback.textContent='已获取 3 个示例模型'},650);
  }
 };
 function onChange(t){
  if(t.closest('form[data-kind=model]')){clearProbe();if(t.name==='providerId'){const p=getState().modelProviders.find(x=>x.id===t.value),m=t.form.elements.model;m.innerHTML=providerModels(p).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');}getUI().modelSelection={providerId:t.form.elements.providerId.value,model:t.form.elements.model.value};}
 }
 function saveProvider(data,f){
  const s=getState(),id=f.dataset.providerId||'provider-'+crypto.randomUUID();
  if(!data.provider.trim()||!data.endpoint.trim())return '请填写供应商名称与服务地址';
  if(s.modelProviders.some(p=>p.id!==id&&p.provider===data.provider.trim()))return '供应商名称已存在，请换一个名称';
  let models;try{models=JSON.parse(data.models)}catch{return '模型列表无效，请重新添加'}
  if(!models.length)return '请至少添加一个模型';
  const p={id,provider:data.provider.trim(),endpoint:data.endpoint.trim(),protocol:data.protocol,tokens:data.tokens,temperature:data.temperature,models,model:models[0]};
  const i=s.modelProviders.findIndex(x=>x.id===id);if(i<0)s.modelProviders.push(p);else s.modelProviders[i]=p;
  if(s.model.providerId===id){const model=models.includes(s.model.model)?s.model.model:models[0];s.model={...s.model,...p,providerId:id,model};delete s.model.id;delete s.model.models;}
  getUI().providerId=id;clearProbe();return null;
 }
 function saveModel(data){clearProbe();getUI().modelSelection=null;const s=getState(),p=s.modelProviders.find(x=>x.id===data.providerId);if(!p||!providerModels(p).includes(data.model))return '请重新选择供应商和模型';s.model={...s.model,providerId:p.id,provider:p.provider,endpoint:p.endpoint,protocol:p.protocol,tokens:p.tokens,temperature:p.temperature,model:data.model};return null}
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[aria-label="手动添加模型 ID"]')){e.preventDefault();actions['provider-model-add']()}});
 return {actions,onChange,clearProbe,restoreList,saveProvider,saveModel};
}
