/* Local design policies only. Never queries TCC, grants permissions or stores secrets. */
(() => {
  'use strict';
  const key='opstwins-device-study-v1';
  const defaults={computer:{control:'ask',browser:'ask',awake:false,blocked:[]},filesystem:{blocked:[]},dictation:{autoSend:false,cues:true,push:'option-double',handsfree:'none'},data:{retention:'30',diagnostics:false}};
  let policies=structuredClone(defaults);
  try {
    const stored=JSON.parse(localStorage.getItem(key)||'null');
    for(const name of Object.keys(defaults))for(const [field,fallback] of Object.entries(defaults[name])){
      const value=stored?.[name]?.[field];
      if(Array.isArray(fallback)){if(Array.isArray(value))policies[name][field]=value.filter(x=>typeof x==='string');}
      else if(typeof value===typeof fallback)policies[name][field]=value;
    }
    for(const name of ['control','browser'])if(!['ask','deny'].includes(policies.computer[name]))policies.computer[name]='ask';
    for(const name of ['push','handsfree'])if(!['none','option-double','option-space'].includes(policies.dictation[name]))policies.dictation[name]=defaults.dictation[name];
    if(!['7','30','90','forever'].includes(policies.data.retention))policies.data.retention='30';
  } catch {}
  const drafts=new Map();
  let c;
  function commit(name,value){
    const next={...policies,[name]:structuredClone(value)};
    try{localStorage.setItem(key,JSON.stringify(next));policies=next;c.toast('已保存');return true;}catch{c.toast('保存失败，请重试');return false;}
  }
  function policyForm(name,build){
    const value=drafts.get(name)||structuredClone(policies[name]);drafts.set(name,value);
    const form=c.n('form','ss-form'),body=c.n('div'),footer=c.n('div','ss-form-footer'),status=c.n('span','ss-save-state');status.setAttribute('role','status');
    const save=c.button('保存',()=>form.requestSubmit(),'ss-button primary');
    function refresh(){const dirty=JSON.stringify(value)!==JSON.stringify(policies[name]);save.disabled=!dirty;status.textContent=dirty?'未保存':'';}
    const change=fn=>{fn(value);refresh();};
    const draw=()=>{body.replaceChildren();build(body,value,change,draw);refresh();};
    footer.append(status,c.actions(c.button('取消',()=>{drafts.delete(name);c.navigate(name);}),save));
    form.append(body,footer);form.onsubmit=e=>{e.preventDefault();if(form.reportValidity()&&commit(name,value)){drafts.delete(name);c.navigate(name);}};draw();return form;
  }
  function unavailable(label){const x=c.button(label,()=>{});x.disabled=true;return x;}
  function osPermissions(root,items){
    const card=c.card('系统权限');
    for(const [title,pane] of items){const link=c.n('a','ss-button','系统设置');link.href='x-apple.systempreferences:com.apple.preference.security?'+pane;link.title='打开 macOS '+title+'设置';link.setAttribute('aria-label','打开系统设置：'+title);
      const state=c.n('span','ss-status','未检测');card.append(c.row(title,'',c.actions(state,link)));}
    root.append(card);
  }
  function listEditor(root,title,list,change,draw,type){
    const card=c.card(title),isPath=type==='folder';
    for(const value of list){const remove=c.button('移除',()=>{change(()=>list.splice(list.indexOf(value),1));draw();});remove.setAttribute('aria-label','移除'+(isPath?'文件夹':'应用')+'：'+value);card.append(c.row(value,'',remove));}
    if(!list.length)card.append(c.n('p','ss-empty','暂无'));
    card.append(c.actions(c.button(isPath?'添加文件夹':'添加应用',()=>{
      c.modal(isPath?'屏蔽文件夹':'屏蔽应用',dialog=>{
        const form=c.n('form','ss-form'),input=c.input('',()=>{}),label=isPath?'文件夹路径':'应用名称';input.required=true;input.autocomplete='off';input.spellcheck=false;input.placeholder=isPath?'/Users/…/文件夹':'例如 Mail.app';input.setAttribute('aria-label',label);
        const error=c.n('p','ss-warning');error.setAttribute('role','alert');error.hidden=true;
        const submit=c.button('添加',()=>form.requestSubmit(),'ss-button primary');
        const validate=()=>{const value=input.value.trim().replace(/\/+$/,'')||(input.value.trim()==='/'?'/':'');let message='';if(!value)message='请输入'+label;else if(isPath&&(!value.startsWith('/')||value.split('/').some(x=>x==='.'||x==='..')||/[\u0000-\u001f]/.test(value)))message='请输入绝对路径';else if(!isPath&&(!value.endsWith('.app')||value.includes('/')||/[\u0000-\u001f]/.test(value)))message='请输入 .app 应用名称';else if(list.some(x=>x.toLowerCase()===value.toLowerCase()))message='已添加';input.setCustomValidity(message);error.textContent=message;error.hidden=!message;return value;};
        input.oninput=()=>{input.setCustomValidity('');error.hidden=true;};
        form.addEventListener('submit',e=>{e.preventDefault();const value=validate();if(!form.reportValidity())return;change(()=>list.push(value));dialog.close();draw();});
        form.append(c.field(label,input),error,c.actions(c.button('取消',()=>dialog.close()),submit));dialog.append(form);requestAnimationFrame(()=>input.focus());
      });
    })));
    root.append(card);
  }
  function computer(root){
    osPermissions(root,[['辅助功能','Privacy_Accessibility'],['屏幕录制','Privacy_ScreenCapture']]);
    root.append(policyForm('computer',(body,v,change,draw)=>{
      const card=c.card('操作权限'),choices=[['ask','每次询问'],['deny','不允许']];
      card.append(c.row('电脑操作','',c.select(v.control,choices,x=>change(d=>d.control=x),'电脑操作权限')),c.row('浏览器操作','',c.select(v.browser,choices,x=>change(d=>d.browser=x),'浏览器操作权限')),c.row('工作时保持唤醒','',c.toggle(v.awake,x=>change(d=>d.awake=x),'工作时保持唤醒')));body.append(card);listEditor(body,'屏蔽应用',v.blocked,change,draw,'app');
    }));
  }
  function filesystem(root){
    osPermissions(root,[['完整磁盘访问','Privacy_AllFiles']]);
    const apps=c.card('应用权限');
    for(const [name,icon] of [['Mail.app','file'],['Messages.app','chat'],['Notes.app','file'],['WhatsApp.app','chat']]){const sw=c.toggle(false,()=>{},name+'访问');sw.disabled=true;const row=c.row(name,'',c.actions(c.n('span','ss-status','未检测'),sw));const mark=c.n('span','ss-app-icon');mark.append(c.icon(icon));row.prepend(mark);apps.append(row);}root.append(apps);
    root.append(policyForm('filesystem',(body,v,change,draw)=>listEditor(body,'屏蔽文件夹',v.blocked,change,draw,'folder')));
  }
  function dictation(root){
    osPermissions(root,[['麦克风','Privacy_Microphone'],['辅助功能','Privacy_Accessibility']]);
    root.append(policyForm('dictation',(body,v,change)=>{
      const audio=c.card('输入');audio.append(c.row('输入设备','',unavailable('系统默认')));body.append(audio);
      const behavior=c.card('听写时');behavior.append(c.row('自动发送','',c.toggle(v.autoSend,x=>change(d=>d.autoSend=x),'听写自动发送')),c.row('提示音','',c.toggle(v.cues,x=>change(d=>d.cues=x),'听写提示音')));body.append(behavior);
      const shortcuts=c.card('快捷键');const values=[['none','未设置'],['option-double','双击 Option'],['option-space','Option + 空格']];
      const a=c.select(v.push,values,x=>{change(d=>d.push=x);validate();},'按住说话快捷键'),b=c.select(v.handsfree,values,x=>{change(d=>d.handsfree=x);validate();},'免手持快捷键');
      function validate(){b.setCustomValidity(v.push!=='none'&&v.push===v.handsfree?'快捷键不能相同':'');}validate();
      shortcuts.append(c.row('按住说话','',a),c.row('免手持模式','',b));body.append(shortcuts);
    }));
  }
  function devices(root){
    const card=c.card('这台设备');card.append(c.row('Mac','',c.n('span','ss-status','原生状态未接入')));root.append(card);
    const other=c.card('其他设备');other.append(c.n('p','ss-empty','暂无已连接设备'),c.actions(unavailable('连接设备')));root.append(other);
  }
  function data(root){
    root.append(policyForm('data',(body,v,change)=>{const card=c.card('数据保留');card.append(c.row('保留时间','',c.select(v.retention,[['7','7 天'],['30','30 天'],['90','90 天'],['forever','永久']],x=>change(d=>d.retention=x),'数据保留时间')),c.row('发送诊断数据','',c.toggle(v.diagnostics,x=>change(d=>d.diagnostics=x),'发送诊断数据')));body.append(card);}));
    const card=c.card('本机偏好');card.append(c.row('显示偏好','',c.button('导出',()=>{
      const blob=new Blob([JSON.stringify({appearance:c.prefs.appearance,font:c.prefs.font,reduced:c.prefs.reduced,variant:c.prefs.variant},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='opstwins-display-preferences.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    })));root.append(card);
  }
  function secure(root){const card=c.card('安全存储');card.append(c.row('凭据','密钥保留在服务端',c.n('span','ss-status','未接入')),c.actions(unavailable('添加凭据')));root.append(card);}
  function wallet(root){const card=c.card('付款方式');card.append(c.n('p','ss-empty','暂无'),c.actions(unavailable('添加付款方式')));root.append(card);}
  function help(root){const card=c.card('帮助');for(const [title,content] of [['快捷键','⌘K 搜索\n⌘, 设置\n⌘1 对话\n⌘2 收件箱\n⌘3 灵感\nEscape 关闭窗口'],['连接问题','打开「连接」查看当前状态，再进入应用详情检测连接。'],['权限问题','打开对应的系统设置，检查 OpsTwins 的权限。']])card.append(c.row(title,'',c.button('查看',()=>c.modal(title,d=>d.append(c.n('p','ss-help-text',content))))));root.append(card);}
  function legal(root){const card=c.card('隐私');card.append(c.row('文件访问','屏蔽的文件夹不得用于读取或 AI 处理',c.n('span','ss-status','待原生接入')),c.row('凭据','不在页面或日志中显示密钥'),c.row('外部发送','遵循自主权限与审批规则'));root.append(card);const terms=c.card('服务条款');terms.append(c.n('p','ss-empty','尚未提供'));root.append(terms);}
  function render(name,root,context){c={...context,root};({computer,filesystem,dictation,devices,data,secure,wallet,help,legal}[name]||help)(root);}
  window.OpsTwinsDeviceSettings={render};
})();
