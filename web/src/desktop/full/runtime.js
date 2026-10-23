/* Shared production transport and durable HTML drafts. No capability is exposed to page JavaScript. */
(() => {
 const managed=new Set(['opstwins-ui-study-prefs','opstwins-ui-study-state-v2','opstwins-design-sessions-v1','opstwins-idea-discussions-v1','opstwins-design-chat-v1','opstwins-settings-study-v1','opstwins-device-study-v1','opstwins-full-requests','opstwins-full-model-state','opstwins-full-identity','opstwins-full-connections']);
 let saveSequence=0;let state,queue=Promise.resolve(),savingError=null;const native=!!window.mygo;
 const storageGet=Storage.prototype.getItem,storageSet=Storage.prototype.setItem;
 async function initialize(){document.documentElement.classList.toggle('desktop-native',native);
  if(native){const scope=await window.mygo.call('Bridge.Scope');if(storageGet.call(localStorage,'desktop-state-scope')!==scope){for(const key of managed){localStorage.removeItem(key);sessionStorage.removeItem(key)}localStorage.removeItem('desktop-unsynced');storageSet.call(localStorage,'desktop-state-scope',scope)}state=await window.mygo.call('Bridge.ReadState');for(const [k,v] of Object.entries(state.drafts||{}))if(k.startsWith('html:')&&storageGet.call(localStorage,'desktop-unsynced')!=='true'){storageSet.call(localStorage,k.slice(5),v);if(k==='html:opstwins-settings-study-v1')storageSet.call(sessionStorage,k.slice(5),v)}}
  Storage.prototype.setItem=function(k,v){storageSet.call(this,k,v);if(managed.has(k)&&native){if(this===sessionStorage)storageSet.call(localStorage,k,v);const sequence=++saveSequence;storageSet.call(localStorage,'desktop-unsynced','true');queue=queue.catch(()=>{}).then(async()=>{const next=structuredClone(state);for(const key of managed){const value=storageGet.call(localStorage,key);if(value!==null)next.drafts['html:'+key]=value}state=await window.mygo.call('Bridge.SaveState',next);savingError=null;if(sequence===saveSequence)storageSet.call(localStorage,'desktop-unsynced','false')}).catch(e=>{savingError=e;window.dispatchEvent(new CustomEvent('desktop-save-error',{detail:e.message}));throw e});queue.catch(()=>{})}};
  if(native&&storageGet.call(localStorage,'desktop-unsynced')==='true')await retrySave();
 }
 async function durable(){await queue;if(savingError)throw savingError}
 async function retrySave(){if(!native)return;await queue.catch(()=>{});state=await window.mygo.call('Bridge.ReadState');const next=structuredClone(state);for(const k of managed){const value=storageGet.call(localStorage,k)??storageGet.call(sessionStorage,k);if(value!==null)next.drafts['html:'+k]=value}state=await window.mygo.call('Bridge.SaveState',next);savingError=null;storageSet.call(localStorage,'desktop-unsynced','false');queue=Promise.resolve()}
 async function api(method,path,body,options={}){
  if(!path.startsWith('/api/')&&!path.startsWith('/files/'))throw Error('不允许的接口');
  if(method!=='GET')await durable();
  const headers={...(body instanceof FormData?{}:{'Content-Type':'application/json'})};
  const response=await fetch(path,{method,headers,...options,body:method==='GET'||body==null?undefined:body instanceof FormData?body:JSON.stringify(body)});
  const contentType=response.headers.get('content-type')||'';
  const data=contentType.includes('json')?await response.json():await response.text();
  if(!response.ok){const e=Error(data?.message||data?.error||'请求失败 '+response.status);e.status=response.status;e.data=data;throw e}return data;
 }
 const list=value=>Array.isArray(value)?value:value?.items||value?.messages||[];
 async function bootstrap(){const b=await api('GET','/api/bootstrap');const results=await Promise.allSettled([api('GET','/api/settings/models'),api('GET','/api/conversations/primary')]);b.models=results[0].status==='fulfilled'?results[0].value:{unavailable:true};b.primaryConversationId=results[1].status==='fulfilled'?results[1].value.conversationId:undefined;b.capturedAt=new Date().toISOString();b.histories={};b.settingsDetails={};return b}
 async function createSession(id,title){const row=await api('POST','/api/conversations/side',{id,title:title.slice(0,120)});const data=window.OPSTWINS_DESIGN_DATA;if(data&&!data.conversations.some(c=>c.id===row.id))data.conversations.push(row);return row}
 async function manageSession(id,fields){if(id===window.OpsTwinsChatSessions?.main())throw Error('主会话必须保留');if(fields.deleted===true||fields.archived===true){const unresolved=await api('GET','/api/chat/conversations/'+encodeURIComponent(id)+'/unresolved?limit=100');if(unresolved.items.some(r=>['running','partial'].includes(r.status))||unresolved.hasMore)throw Error('此会话仍有运行或部分结果，请先检查原记录')}if(fields.deleted===true)return api('DELETE','/api/conversations/'+encodeURIComponent(id));if(fields.deleted===false)return api('POST','/api/conversations/'+encodeURIComponent(id)+'/restore',{});const row=await api('GET','/api/conversations/'+encodeURIComponent(id));return api('PATCH','/api/conversations/'+encodeURIComponent(id),{...fields,baseUpdatedAt:row.updatedAt})}
 window.OpsTwinsDesktop={createSession,manageSession,api,list,durable,initialize,retrySave,bootstrap,native};
})();
